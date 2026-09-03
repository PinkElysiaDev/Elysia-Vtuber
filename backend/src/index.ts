/**
 * Vtuber 逻辑服务入口
 * 装配：配置系统 / WS RPC 服务 / HTTP WebUI / C++ 执行器客户端 / 触发器 / LLM / 输出
 */

import * as path from 'path'
import * as http from 'http'
import * as fs from 'fs'
import { loadConfig, BackendConfig, TriggerAction, backendRoot, saveConfig } from './config'
import { WsServer } from './server/ws'
import { CppClient } from './cpp/client'
import { EventBus } from './core/rpc'
import { EventHistory } from './core/history'
import { ToolRegistry } from './core/tools'
import { expandArgs, expandTemplate } from './core/variables'
import { LLMGateway } from './llm/gateway'
import { LLMSession } from './llm/session'
import { buildSystemModule } from './modules/system'
import { buildConfigModule } from './modules/config'
import { buildEventModule, StandardEvent } from './modules/events'
import { buildJukeboxModule } from './modules/jukebox'
import { Jukebox } from './music/jukebox'
import { createDefaultRegistry } from './music/registry'
import { LoginManager } from './music/login-manager'
import { buildMusicLoginModule } from './modules/music-login'
import { buildCppModule } from './modules/cpp'
import { TriggerEngine, TriggerFire } from './modules/triggers'
import { OutputRouter } from './modules/output'
import { buildRuntimeModule, registerBuiltinTools, registerLive2dTools, LIVE2D_DYNAMIC_TOOLS } from './modules/tools'
import { buildMcpModule } from './modules/mcp'
import { McpManager } from './mcp/manager'
import { buildLlmModelsModule } from './modules/llm-models'
import { VtuberDatabase } from './core/database'
import { RetentionSweeper } from './core/retention'
import { buildOutputFontModule, fontsDir } from './modules/output-font'
import { applyLive2dConfig, applyStageConfig, applyWindowConfig, buildLive2dModule } from './modules/live2d'
import { TtsEngine } from './tts/engine'
import { buildTtsModule } from './modules/tts'

export const VERSION = '0.2.0'

const HISTORY_CONTEXT = 20

class VtuberService {
  config: BackendConfig
  configPath: string
  bus = new EventBus()
  ws = new WsServer()
  /** 音频执行器客户端（audio_executor.exe，端口 19277） */
  audioCpp: CppClient
  /** Live2D 执行器客户端（vtuber_executor.exe，端口 19276） */
  live2dCpp: CppClient
  history = new EventHistory(100)
  tools = new ToolRegistry()
  triggers = new TriggerEngine()
  gateway: LLMGateway
  /** SQLite 数据库（播放记录/事件历史持久化） */
  db: VtuberDatabase
  /** 数据保留清理器 */
  retention: RetentionSweeper
  session: LLMSession
  output: OutputRouter
  jukebox: Jukebox
  ttsEngine: TtsEngine
  loginManager: LoginManager
  /** MCP 外部服务器管理（工具注册进 this.tools） */
  mcp: McpManager
  /** 上次 MCP 配置快照：仅 mcpServers 实际变更才重连，避免无关配置写入打断 MCP 子进程 */
  private lastMcpJson = ''
  /** 上次歌曲信息输出配置快照：nowPlaying 实际变更才让点歌机重写输出文件 */
  private lastNowPlayingJson = ''
  private eventCount = 0
  private filteredCount = 0
  private lastEventAt = 0
  private httpServer: http.Server | null = null
  private fireQueue: TriggerFire[] = []
  private firing = false
  /** 待机动作调度 */
  private idleTimer: NodeJS.Timeout | null = null
  private idleSeq = 0
  private lastIdleAt = 0
  private lastLive2dJson = ''
  private lastWindowJson = ''
  private lastStageJson = ''
  private live2dApplyChain: Promise<void> = Promise.resolve()
  private stagePersistTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // VTUBER_CONFIG 环境变量可指定替代配置文件（隔离测试实例用）；默认仓库内 backend-config.json
    this.configPath = process.env.VTUBER_CONFIG
      ? path.resolve(process.env.VTUBER_CONFIG)
      : path.resolve(backendRoot(), 'backend-config.json')
    this.config = loadConfig(this.configPath)
    this.audioCpp = new CppClient(this.config.audioCpp)
    this.live2dCpp = new CppClient(this.config.live2dCpp)
    this.gateway = new LLMGateway(this.config.llm)
    // SQLite：与配置同目录 data/vtuber.db（测试实例自动隔离）
    this.db = new VtuberDatabase()
    this.db.open(path.resolve(path.dirname(this.configPath), 'data', 'vtuber.db'))
    // 旧 JSON 播放记录迁移
    this.db.migratePlayHistoryJson(path.resolve(path.dirname(this.configPath), 'play-history.json'))
    this.retention = new RetentionSweeper({
      db: this.db,
      getPlayHistoryDays: () => this.config.dataRetention?.playHistoryDays ?? 90,
      getEventHistoryDays: () => this.config.dataRetention?.eventHistoryDays ?? 30,
    })
    this.ttsEngine = new TtsEngine({
      getTts: () => this.config.tts,
      getAudio: () => this.config.audio,
      cpp: this.audioCpp,
      broadcast: (method, params) => this.ws.broadcast('webui', method, params),
    })
    this.output = new OutputRouter({
      getConfig: () => this.config.output,
      getRoomId: () => this.getRoomId(),
      sendDanmaku: (text, roomId) => {
        this.ws.broadcast('plugin', 'danmaku.send', { roomId, text })
        this.ws.broadcast('webui', 'output.danmaku', { roomId, text })
      },
      displayText: (text, style, emotion) => {
        this.ws.broadcast('webui', 'output.display', { text, style, emotion })
        if (this.live2dCpp.isConnected()) {
          this.live2dCpp.notify('display.show', { text, style, emotion })
        }
      },
      speak: (text) => {
        this.ws.broadcast('webui', 'output.tts', { text })
        this.ttsEngine.speak(text)
      },
    })
    this.session = new LLMSession({
      gateway: this.gateway,
      tools: this.tools,
      getSystemPrompt: () => this.config.llm.systemPrompt,
      getRoomId: () => this.getRoomId(),
      getHistory: () => this.history.recent(HISTORY_CONTEXT),
      getToolGate: () => this.config.llm.tools ?? {},
    })
    this.jukebox = new Jukebox({
      registry: createDefaultRegistry(),
      getConfig: () => this.config.music,
      db: this.db,
      persistConfig: () => {
        saveConfig(this.config, this.configPath)
        this.ws.broadcast('webui', 'config.changed', { ok: true })
      },
      cpp: this.audioCpp,
      broadcast: (method, params) => this.ws.broadcast('webui', method, params),
    })
    this.loginManager = new LoginManager({
      registry: this.jukebox.registry,
      persistSessions: (sessions) => {
        this.config.music.sessions = sessions
        saveConfig(this.config, this.configPath)
      },
      broadcast: (method, params) => this.ws.broadcast('webui', method, params),
    })
    registerBuiltinTools({
      tools: this.tools,
      output: this.output,
      triggers: this.triggers,
      session: this.session,
      cpp: this.live2dCpp,
      jukebox: this.jukebox,
      getRoomId: () => this.getRoomId(),
    })
    this.reregisterLive2dTools()
    this.mcp = new McpManager({
      tools: this.tools,
      getConfig: () => this.config.llm.mcpServers ?? {},
      saveConfig: (servers) => {
        this.config.llm.mcpServers = servers
        saveConfig(this.config, this.configPath)
        // 直接写配置不经过 config 模块，须同步 diff 基线，否则后续无关配置写入会被误判为 MCP 变更而重连
        this.lastMcpJson = JSON.stringify(servers)
      },
    })
    this.lastMcpJson = JSON.stringify(this.config.llm.mcpServers ?? {})
    void this.mcp.reconnectAll().catch((err: unknown) => {
      console.warn('[mcp] 初始连接失败:', err instanceof Error ? err.message : String(err))
    })
    this.triggers.setCallback((fire) => this.onTrigger(fire))
    this.triggers.configure(this.config.triggers)
    // 与 applyConfigRuntime 的 diff 口径一致：window/assetRegistration/stage 单独处理，不参与模型重载判定
    const { window: _initWin, assetRegistration: _initAssets, stage: _initStage, ...initLive2d } = this.config.live2d
    this.lastLive2dJson = JSON.stringify(initLive2d)
    this.lastStageJson = JSON.stringify(this.config.live2d.stage)

    // 音频执行器重连后：恢复被打断的播放（音乐/TTS）
    this.audioCpp.onConnected(() => {
      this.jukebox.onPlayerReconnected()
    })
    this.audioCpp.onStateChange((state) => {
      this.ws.broadcast('webui', 'audio.state', state)
    })
    this.audioCpp.onEvent('player.levels', (params) => {
      this.ws.broadcast('webui', 'player.levels', params)
    })

    // Live2D 执行器重连后：重推模型/窗口/舞台/资源注册配置 + WebUI 地址（面板快捷入口）
    this.live2dCpp.onConnected(() => {
      this.live2dCpp
        .request('live2d.setEnv', { webuiUrl: `http://127.0.0.1:${this.config.server.httpPort}/` })
        .catch(() => { /* 地址推送失败不影响其他配置 */ })
      applyLive2dConfig(this.live2dCpp, this.config.live2d).catch(() => {})
    })
    this.live2dCpp.onStateChange((state) => {
      this.ws.broadcast('webui', 'live2d.state', state)
    })
    // 悬浮面板舞台编辑 → 持久化（不回推执行器）+ 广播 WebUI 联动
    this.live2dCpp.onEvent('live2d.stageChanged', (params) => this.onExecutorStageChanged(params))
  }

  /** 执行器悬浮面板的舞台编辑回流：写配置 + 落盘 + 广播 WebUI（跳过 diff 回推，防环） */
  private onExecutorStageChanged(params: unknown): void {
    const rec = (params ?? {}) as Record<string, unknown>
    const stage = this.config.live2d.stage
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    if ('windX' in rec) stage.windX = num(rec.windX, stage.windX)
    if ('windY' in rec) stage.windY = num(rec.windY, stage.windY)
    if ('gravityX' in rec) stage.gravityX = num(rec.gravityX, stage.gravityX)
    if ('gravityY' in rec) stage.gravityY = num(rec.gravityY, stage.gravityY)
    if ('physicsSpeed' in rec) stage.physicsSpeed = num(rec.physicsSpeed, stage.physicsSpeed)
    if (typeof rec.bgMode === 'string' && ['transparent', 'color', 'image'].includes(rec.bgMode)) {
      stage.bgMode = rec.bgMode as typeof stage.bgMode
    }
    if (typeof rec.bgColor === 'string') stage.bgColor = rec.bgColor
    if ('bgAlpha' in rec) stage.bgAlpha = num(rec.bgAlpha, stage.bgAlpha)
    if (typeof rec.bgImage === 'string') stage.bgImage = rec.bgImage
    if (typeof rec.fpsOverlay === 'boolean') stage.fpsOverlay = rec.fpsOverlay
    // 同步快照：避免下次 onConfigChanged 把刚收到的值再推回执行器
    this.lastStageJson = JSON.stringify(stage)
    this.ws.broadcast('webui', 'live2d.stage', stage)
    if (this.stagePersistTimer) clearTimeout(this.stagePersistTimer)
    this.stagePersistTimer = setTimeout(() => {
      this.stagePersistTimer = null
      try {
        saveConfig(this.config, this.configPath)
      } catch (err) {
        console.warn('[live2d] stage persist failed:', err instanceof Error ? err.message : String(err))
      }
    }, 500)
  }

  getRoomId(): string {
    return this.config.roomId ?? ''
  }

  /** 注册表变更后重建 live2d 动态工具（描述与可用列表反映最新注册表） */
  private reregisterLive2dTools(): void {
    for (const name of LIVE2D_DYNAMIC_TOOLS) this.tools.unregister(name)
    registerLive2dTools({
      tools: this.tools,
      cpp: this.live2dCpp,
      getRegistration: () => this.config.live2d.assetRegistration,
    })
  }

  /** 待机动作调度：动作空闲且到达间隔后按 随机/顺序 取下一个下发 */
  private startIdleScheduler(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => { void this.tickIdleMotion() }, 1000)
    this.idleTimer.unref?.()
  }

  private stopIdleScheduler(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private async tickIdleMotion(): Promise<void> {
    const reg = this.config.live2d.assetRegistration
    const idle = reg && reg.idle
    if (!idle || !Array.isArray(idle.motions) || !idle.motions.length) return
    if (!this.live2dCpp.isConnected()) return
    const intervalMs = Math.max(1, idle.intervalSec || 8) * 1000
    if (Date.now() - this.lastIdleAt < intervalMs) return
    try {
      const st = await this.live2dCpp.request('live2d.status').catch(() => null) as { motionActive?: boolean } | null
      if (!st || st.motionActive) return  // 动作播放中不打扰
      const list = idle.motions
      const ref = idle.mode === 'sequential'
        ? list[this.idleSeq++ % list.length]
        : list[Math.floor(Math.random() * list.length)]
      if (!ref) return
      this.lastIdleAt = Date.now()
      if (ref.includes('#')) {
        const [group, idx] = ref.split('#')
        await this.live2dCpp.request('live2d.motion', { group, index: Number(idx) }).catch(() => {})
      } else {
        await this.live2dCpp.request('live2d.motion', { name: ref }).catch(() => {})
      }
    } catch {
      // 状态查询失败忽略本 tick
    }
  }

  onEvent(event: StandardEvent): void {
    this.eventCount++
    this.lastEventAt = Date.now()
    this.history.push(event)
    try {
      this.db.insertEventHistory({
        type: event.type,
        timestamp: event.timestamp,
        room_id: event.roomId,
        user_uid: event.user?.uid ?? null,
        user_name: event.user?.name ?? null,
        user_face: event.user?.face ?? null,
        data: JSON.stringify(event.data ?? {}),
      })
    } catch (err) {
      console.warn('[db] 事件历史写入失败:', err)
    }
    this.bus.emit('event', event)
    if (this.jukebox.tryDirectOrder(event)) return
    this.triggers.handleEvent(event)
  }

  private async onTrigger(fire: TriggerFire): Promise<void> {
    this.fireQueue.push(fire)
    if (this.firing) return
    this.firing = true
    try {
      while (this.fireQueue.length) {
        const next = this.fireQueue.shift()!
        await this.executeFire(next)
      }
    } finally {
      this.firing = false
    }
  }

  private async executeFire(fire: TriggerFire): Promise<void> {
    this.ws.broadcast('webui', 'trigger.fired', {
      id: fire.rule.id,
      reason: fire.reason,
      eventCount: fire.events.length,
    })
    try {
      const actions = fire.rule.actions?.length
        ? fire.rule.actions
        : [{ type: 'llm-request' as const }]
      for (const action of actions) {
        await this.runAction(action, fire.events)
      }
    } catch (err) {
      console.error(`[trigger] ${fire.rule.id} failed:`, err)
    }
  }

  private async runAction(action: TriggerAction, events: StandardEvent[]): Promise<void> {
    const ctx = {
      events,
      history: this.history.recent(HISTORY_CONTEXT),
      roomId: this.getRoomId(),
    }
    if (action.type === 'wait') {
      const ms = Math.max(0, action.waitMs ?? 0)
      if (ms) await new Promise((resolve) => setTimeout(resolve, ms))
      return
    }
    if (action.type === 'call-tool') {
      if (!action.tool) return
      const args = expandArgs(action.args, ctx)
      await this.tools.call(action.tool, args)
      return
    }
    if (action.type === 'llm-request') {
      const prompt = action.prompt ? expandTemplate(action.prompt, ctx) : undefined
      await this.session.run(events, prompt)
    }
  }

  private applyConfigRuntime(): void {
    this.gateway.setConfig(this.config.llm)
    this.triggers.configure(this.config.triggers)
    this.audioCpp.setConfig(this.config.audioCpp)
    this.live2dCpp.setConfig(this.config.live2dCpp)
    // 窗口配置单独 diff：改窗口参数不应触发模型重载
    const winSnap = JSON.stringify(this.config.live2d.window)
    if (winSnap !== this.lastWindowJson) {
      this.lastWindowJson = winSnap
      const win = this.config.live2d.window
      this.live2dApplyChain = this.live2dApplyChain
        .then(() => applyWindowConfig(this.live2dCpp, win))
        .catch(() => { /* 单次应用失败不阻断后续 */ })
    }
    const { window: _win, assetRegistration: _assets, stage: _stage, ...live2dRest } = this.config.live2d
    const snap = JSON.stringify(live2dRest)
    if (snap !== this.lastLive2dJson) {
      this.lastLive2dJson = snap
      // 串行队列：滑杆高频保存时旧的应用晚到会覆盖新值，按提交顺序执行
      this.live2dApplyChain = this.live2dApplyChain
        .then(() => applyLive2dConfig(this.live2dCpp, this.config.live2d))
        .catch(() => { /* 单次应用失败不阻断后续 */ })
    }
    // 舞台配置单独 diff：改物理/背景/FPS 不应触发模型重载
    const stageSnap = JSON.stringify(this.config.live2d.stage)
    if (stageSnap !== this.lastStageJson) {
      this.lastStageJson = stageSnap
      this.live2dApplyChain = this.live2dApplyChain
        .then(() => applyStageConfig(this.live2dCpp, this.config.live2d.stage))
        .catch(() => { /* 单次应用失败不阻断后续 */ })
    }
  }

  private registerModules(): void {
    const version = VERSION

    this.ws.handlers.registerAll(buildSystemModule({
      version,
      getRoomId: () => this.getRoomId(),
      audioCpp: this.audioCpp,
      live2dCpp: this.live2dCpp,
      shutdown: () => this.stop(),
      getEventCount: () => this.eventCount,
      getFilteredCount: () => this.filteredCount,
      getLastEventAt: () => this.lastEventAt,
      getTriggerCount: () => this.triggers.getRules().filter((r) => r.enabled).length,
      hasLlmKey: () => Boolean(this.config.llm.apiKey),
      getJukebox: () => {
        const state = this.jukebox.getState()
        return { running: state.running, playing: state.playing, volume: state.volume }
      },
      getTts: () => {
        const state = this.ttsEngine.getState()
        return {
          speaking: state.speaking,
          queued: state.queued,
          configured: Boolean(this.config.tts.appId && this.config.tts.token),
        }
      },
    }))

    this.ws.handlers.registerAll(buildMcpModule(this.mcp, { gateway: this.gateway }))
    this.ws.handlers.registerAll(buildLlmModelsModule({
      getConfig: () => this.config.llm,
      save: () => {
        saveConfig(this.config, this.configPath)
        this.applyConfigRuntime()
      },
    }))
    this.ws.handlers.registerAll(buildOutputFontModule({
      getConfig: () => this.config,
      configPath: this.configPath,
      save: (mutate) => {
        mutate(this.config)
        saveConfig(this.config, this.configPath)
        this.applyConfigRuntime()
        // 与 config 模块一致：通知展示板等页面即时刷新
        this.ws.broadcast('webui', 'config.changed', { ok: true })
      },
    }))
    this.ws.handlers.registerAll(buildConfigModule({
      getConfig: () => this.config,
      setConfig: (c) => { this.config = c },
      configPath: this.configPath,
      onConfigChanged: () => {
        this.applyConfigRuntime()
        this.reregisterLive2dTools()
        const mcpJson = JSON.stringify(this.config.llm.mcpServers ?? {})
        if (mcpJson !== this.lastMcpJson) {
          this.lastMcpJson = mcpJson
          void this.mcp.reconnectAll().catch(() => {})
        }
        // 歌曲信息输出配置（模板/输出列表/queue 元素格式）变更 → 立即重写输出文件
        const npJson = JSON.stringify(this.config.music.nowPlaying)
        if (npJson !== this.lastNowPlayingJson) {
          this.lastNowPlayingJson = npJson
          this.jukebox.refreshNowPlayingOutputs()
        }
        this.bus.emit('config.changed', this.config)
        void this.loginManager.restoreFrom(this.config.music.sessions)
        this.ws.broadcast('webui', 'config.changed', { ok: true })
      },
    }))

    this.ws.handlers.registerAll(buildEventModule({
      getConfig: () => this.config.events,
      onEvent: (e) => this.onEvent(e),
      onFiltered: () => { this.filteredCount++ },
      db: this.db,
    }))

    this.ws.handlers.registerAll(buildJukeboxModule(this.jukebox))
    this.ws.handlers.registerAll(buildMusicLoginModule(this.loginManager))
    this.ws.handlers.registerAll(buildTtsModule(this.ttsEngine, this.audioCpp, this.jukebox))
    this.ws.handlers.registerAll(buildCppModule(this.audioCpp, this.live2dCpp))
    this.ws.handlers.registerAll(buildLive2dModule({
      cpp: this.live2dCpp,
      getConfig: () => this.config.live2d,
    }))
    this.ws.handlers.registerAll(buildRuntimeModule({
      tools: this.tools,
      output: this.output,
      triggers: this.triggers,
      session: this.session,
      jukebox: this.jukebox,
      getRoomId: () => this.getRoomId(),
      getToolGate: () => this.config.llm.tools ?? {},
    }))

    this.bus.on('event', (e) => {
      this.ws.broadcast('plugin', 'event.received', e)
      this.ws.broadcast('webui', 'event.received', e)
    })

    // 插件回发的弹幕发送结果：失败必须可见，否则 AI 回复静默丢失无从排查
    this.ws.handlers.register('danmaku.sent', (params) => {
      const rec = (params ?? {}) as { ok?: boolean; error?: string; text?: string }
      if (!rec || rec.ok === false) {
        console.warn(`[output] 弹幕发送失败: ${rec?.text ?? ''} (${rec?.error ?? 'unknown'})`)
        this.ws.broadcast('webui', 'danmaku.failed', rec ?? {})
      }
      return null
    })
    this.ws.handlers.register('koishi.ready', (params) => {
      console.log('[vtuber] koishi 插件已就绪:', JSON.stringify(params ?? {}))
      return null
    })
  }

  private startHttp(): void {
    const rendererDir = path.resolve(__dirname, '../renderer')
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }

    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          version: VERSION,
          wsPort: this.config.server.wsPort,
          httpPort: this.config.server.httpPort,
        }))
        return
      }

      let pathname = (req.url || '/').split('?')[0]
      if (pathname === '/') pathname = '/index.html'

      // 自定义字体目录（展示板 @font-face 引用 /fonts/<file>）
      if (pathname.startsWith('/fonts/')) {
        const fontsRoot = fontsDir(this.configPath)
        const fontPath = path.join(fontsRoot, pathname.slice('/fonts/'.length).replace(/\\/g, '/'))
        if (!fontPath.startsWith(fontsRoot)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        fs.readFile(fontPath, (fontErr, fontData) => {
          if (fontErr) {
            res.writeHead(404)
            res.end('not found')
            return
          }
          const fontMime: Record<string, string> = {
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
            '.ttf': 'font/ttf',
            '.otf': 'font/otf',
          }
          res.writeHead(200, {
            'Content-Type': fontMime[path.extname(fontPath).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': 'no-cache',
          })
          res.end(fontData)
        })
        return
      }

      const filePath = path.join(rendererDir, pathname)
      if (!filePath.startsWith(rendererDir)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        // 静态资源禁用缓存，确保 CSS/JS 变更即时生效
        res.writeHead(200, {
          'Content-Type': mime[ext] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        })
        res.end(data)
      })
    })

    const { host, httpPort } = this.config.server
    // httpPort 被占时必须捕获 error，否则 uncaughtException 且 WebUI 静默死亡
    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[http] WebUI 端口 ${httpPort} 已被占用，WebUI 不可用（RPC 端口不受影响）`)
      } else {
        console.error('[http] WebUI 服务器错误:', err.message)
      }
    });
    this.retention.start()
        this.httpServer.listen(httpPort, host, () => {
      console.log(`[http] WebUI: http://${host}:${httpPort}`)
    })
  }

  async start(): Promise<void> {
    this.registerModules()
    this.triggers.start()
    this.ttsEngine.startSweeper()
    this.startIdleScheduler()
    await this.loginManager.restoreFrom(this.config.music.sessions)

    const { wsPort, host } = this.config.server
    await this.ws.start(wsPort, host)
    this.startHttp()

    // 音频执行器：常驻（autoStart 默认 true），点歌机/TTS 全依赖
    if (this.config.audioCpp.autoStart) {
      const ok = await this.audioCpp.start().catch((err) => {
        console.warn('[audio-cpp] 音频执行器启动失败:', err instanceof Error ? err.message : String(err))
        return false
      })
      if (!ok) console.warn('[audio-cpp] 音频执行器不可用（点歌/TTS/试听将无法播放）')
    } else {
      void this.audioCpp.attach()
    }

    // Live2D 执行器：手动开启（autoStart 默认 false）
    if (this.config.live2dCpp.autoStart) {
      const ok = await this.live2dCpp.start().catch((err) => {
        console.warn('[live2d-cpp] Live2D 执行器启动失败:', err instanceof Error ? err.message : String(err))
        return false
      })
      if (!ok) console.warn('[live2d-cpp] Live2D 执行器不可用（渲染/交互不可用，可稍后重试）')
    } else {
      const ok = await this.live2dCpp.attach()
      if (ok && this.live2dCpp.isConnected()) console.log('[live2d-cpp] 已连接到已运行的 Live2D 执行器')
      else console.log('[live2d-cpp] Live2D 执行器未运行（可在控制台「启动 C++ 执行器」）')
    }

    // 点歌机自动上线（执行器未就绪也安全：advance 自带退避重试，连上后 onPlayerReconnected 续播）
    if (this.config.music.autoStartJukebox) {
      const r = this.jukebox.start()
      console.log(`[jukebox] 自动上线: ${r.message}`)
    }

    console.log('[vtuber] 逻辑服务就绪')
  }

  async stop(): Promise<void> {
    try { this.retention?.stop(); this.db?.close(); } catch { /* 忽略 */ }
    this.triggers.stop()
    this.ttsEngine.stopSweeper()
    this.stopIdleScheduler()
    this.mcp.stopAll()
    await this.audioCpp.dispose()
    await this.live2dCpp.dispose()
    await this.ws.stop()
    this.httpServer?.close()
  }
}

async function main(): Promise<void> {
  const service = new VtuberService()
  await service.start()

  const shutdown = async () => {
    console.log('\n[vtuber] 正在关闭...')
    await service.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (require.main === module) {
  // 全局错误守卫：未处理的 reject / 未捕获异常只记录日志，不拖垮逻辑服务
  // （如关闭执行器时 rpc.close 会以 reject 清空进行中的请求，若未 await 会触发进程退出）
  process.on('unhandledRejection', (reason) => {
    console.warn('[vtuber] unhandled rejection:', reason instanceof Error ? reason.message : String(reason))
  })
  process.on('uncaughtException', (err) => {
    console.error('[vtuber] uncaught exception:', err.message)
  })

  main().catch((err) => {
    console.error('[vtuber] 启动失败:', err)
    process.exit(1)
  })
}

export { VtuberService }

/**
 * Vtuber 逻辑服务入口
 * 装配：配置系统 / WS RPC 服务 / HTTP WebUI / C++ 执行器客户端 / 触发器 / LLM / 输出
 */

import * as path from 'path'
import * as http from 'http'
import * as fs from 'fs'
import { loadConfig, BackendConfig, TriggerAction, backendRoot } from './config'
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
import { buildCppModule } from './modules/cpp'
import { TriggerEngine, TriggerFire } from './modules/triggers'
import { OutputRouter } from './modules/output'
import { buildRuntimeModule, registerBuiltinTools } from './modules/tools'
import { applyLive2dConfig, buildLive2dModule } from './modules/live2d'
import { TtsEngine } from './tts/engine'
import { buildTtsModule } from './modules/tts'

export const VERSION = '0.2.0'

const HISTORY_CONTEXT = 20

class VtuberService {
  config: BackendConfig
  configPath: string
  bus = new EventBus()
  ws = new WsServer()
  cpp: CppClient
  history = new EventHistory(100)
  tools = new ToolRegistry()
  triggers = new TriggerEngine()
  gateway: LLMGateway
  session: LLMSession
  output: OutputRouter
  jukebox: Jukebox
  ttsEngine: TtsEngine
  private eventCount = 0
  private httpServer: http.Server | null = null
  private fireQueue: TriggerFire[] = []
  private firing = false
  private lastLive2dJson = ''

  constructor() {
    this.configPath = path.resolve(backendRoot(), 'backend-config.json')
    this.config = loadConfig(this.configPath)
    this.cpp = new CppClient(this.config.cpp)
    this.gateway = new LLMGateway(this.config.llm)
    this.ttsEngine = new TtsEngine({
      getTts: () => this.config.tts,
      getAudio: () => this.config.audio,
      cpp: this.cpp,
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
        if (this.cpp.isConnected()) {
          this.cpp.notify('display.show', { text, style, emotion })
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
    })
    this.jukebox = new Jukebox({
      getConfig: () => this.config.music,
      cpp: this.cpp,
      broadcast: (method, params) => this.ws.broadcast('webui', method, params),
    })
    registerBuiltinTools({
      tools: this.tools,
      output: this.output,
      triggers: this.triggers,
      session: this.session,
      cpp: this.cpp,
      jukebox: this.jukebox,
      getRoomId: () => this.getRoomId(),
    })
    this.triggers.setCallback((fire) => this.onTrigger(fire))
    this.triggers.configure(this.config.triggers)
    this.lastLive2dJson = JSON.stringify(this.config.live2d)
  }

  getRoomId(): string {
    return this.config.roomId ?? ''
  }

  onEvent(event: StandardEvent): void {
    this.eventCount++
    this.history.push(event)
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
    this.cpp.setConfig(this.config.cpp)
    const snap = JSON.stringify(this.config.live2d)
    if (snap !== this.lastLive2dJson) {
      this.lastLive2dJson = snap
      void applyLive2dConfig(this.cpp, this.config.live2d)
    }
  }

  private registerModules(): void {
    const version = VERSION

    this.ws.handlers.registerAll(buildSystemModule({
      version,
      getRoomId: () => this.getRoomId(),
      cpp: this.cpp,
      getEventCount: () => this.eventCount,
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

    this.ws.handlers.registerAll(buildConfigModule({
      getConfig: () => this.config,
      setConfig: (c) => { this.config = c },
      configPath: this.configPath,
      onConfigChanged: () => {
        this.applyConfigRuntime()
        this.bus.emit('config.changed', this.config)
        this.ws.broadcast('webui', 'config.changed', { ok: true })
      },
    }))

    this.ws.handlers.registerAll(buildEventModule({
      getConfig: () => this.config.events,
      onEvent: (e) => this.onEvent(e),
    }))

    this.ws.handlers.registerAll(buildJukeboxModule(this.jukebox))
    this.ws.handlers.registerAll(buildTtsModule(this.ttsEngine, this.cpp))
    this.ws.handlers.registerAll(buildCppModule(this.cpp))
    this.ws.handlers.registerAll(buildLive2dModule({
      cpp: this.cpp,
      getConfig: () => this.config.live2d,
    }))
    this.ws.handlers.registerAll(buildRuntimeModule({
      tools: this.tools,
      output: this.output,
      triggers: this.triggers,
      session: this.session,
      cpp: this.cpp,
      jukebox: this.jukebox,
      getRoomId: () => this.getRoomId(),
    }))

    this.bus.on('event', (e) => {
      this.ws.broadcast('plugin', 'event.received', e)
      this.ws.broadcast('webui', 'event.received', e)
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
        res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' })
        res.end(data)
      })
    })

    const { host, httpPort } = this.config.server
    this.httpServer.listen(httpPort, host, () => {
      console.log(`[http] WebUI: http://${host}:${httpPort}`)
    })
  }

  async start(): Promise<void> {
    this.registerModules()
    this.triggers.start()

    const { wsPort, host } = this.config.server
    await this.ws.start(wsPort, host)
    this.startHttp()

    if (this.config.cpp.autoStart) {
      const ok = await this.cpp.start()
      if (!ok) console.warn('[cpp] C++ 执行器启动失败，Live2D/播放不可用（可稍后重试）')
      else await applyLive2dConfig(this.cpp, this.config.live2d)
    } else {
      console.log('[cpp] autoStart 已关闭，跳过执行器启动')
    }

    console.log('[vtuber] 逻辑服务就绪')
  }

  async stop(): Promise<void> {
    this.triggers.stop()
    this.cpp.dispose()
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
  main().catch((err) => {
    console.error('[vtuber] 启动失败:', err)
    process.exit(1)
  })
}

export { VtuberService }

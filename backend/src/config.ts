/**
 * Vtuber 逻辑服务配置系统
 * 覆盖全部功能：事件 / 触发器 / LLM / TTS / 输出 / 音乐 / Live2D / 音频 / 系统。
 * 配置持久化为 backend-config.json，WebUI 通过 config.get / config.schema 读写。
 */

import * as fs from 'fs'
import * as path from 'path'

// ============ 类型定义 ============

export interface ServerConfig {
  host: string
  httpPort: number
  wsPort: number
}

export interface EventReceiverConfig {
  /** 事件接收总开关（false 时阻断全部事件：历史/点歌/触发器） */
  enabled: boolean
  enabledEvents: {
    danmaku: boolean
    gift: boolean
    superchat: boolean
    enter: boolean
    follow: boolean
    like: boolean
    guard: boolean
    liveStart: boolean
    liveEnd: boolean
  }
  /** 事件过滤阈值 */
  filters: {
    minGiftPrice: number
    minSuperchatAmount: number
  }
}

export type TriggerMode = 'immediate' | 'debounce' | 'cross-merge' | 'scheduled'

export interface TriggerConfig {
  id: string
  name: string
  enabled: boolean
  mode: TriggerMode
  /** 触发的事件类型（immediate/debounce/cross-merge 用） */
  eventTypes: string[]
  /** debounce：延迟窗口(ms) */
  delayMs: number
  /** debounce：最大合并条数 */
  maxBatch: number
  /** cross-merge：合并窗口内的其他事件类型 */
  mergeEvents: string[]
  /** scheduled：cron 表达式 */
  cron: string
  /** scheduled：动作序列 */
  actions: TriggerAction[]
}

export interface TriggerAction {
  type: 'call-tool' | 'llm-request' | 'wait'
  tool?: string
  args?: Record<string, unknown>
  prompt?: string
  waitMs?: number
}

/** 思考/推理开关：anthropic/gemini 映射 canonical.thinking，openai 系映射 canonical.reasoning.effort */
export interface LlmThinkingConfig {
  enabled: boolean
  effort?: string
}

/** 注册表中的 LLM 模型档案：字段逐项覆盖内联默认配置（为空回退内联值） */
export interface LlmModelProfile {
  label: string
  provider: string
  baseURL: string
  apiKey: string
  model: string
  headers?: Record<string, string>
  thinking?: LlmThinkingConfig
  temperature?: number
  maxTokens?: number
  topP?: number
  timeoutMs?: number
  /** 上下文窗口（token），用户手填，供后续消费方（触发器等）参考 */
  contextWindow?: number
  enabled?: boolean
}

export interface LLMConfig {
  provider: string
  baseURL: string
  apiKey: string
  model: string
  customHeaders: Record<string, string>
  temperature: number
  maxTokens: number
  topP: number
  timeoutMs: number
  /** 系统提示词，支持 {{events}} / {{user}} / {{content}} / {{roomId}} 等变量 */
  systemPrompt: string
  /** 工具加载开关：name → false 表示不暴露给模型；缺失 = 启用（提示词工坊「工具加载管理」维护） */
  tools: Record<string, boolean>
  /**
   * MCP 外部服务器：name → 配置；工具注册为 mcp__<server>__<tool>。
   * command（stdio 子进程）或 url（Streamable HTTP）二选一，headers 供 HTTP 鉴权。
   */
  mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; enabled?: boolean }>
  /** 内联默认模型的思考开关 */
  thinking: LlmThinkingConfig
  /** 多模型注册表：name → 档案（LLM MODELS 面板维护） */
  models: Record<string, LlmModelProfile>
  /** 当前使用的注册表键；空 = 用上方内联字段 */
  activeModel: string
}

export interface TTSConfig {
  provider: 'volcengine' | 'clone'
  baseURL: string
  appId: string
  token: string
  cluster: string
  voiceType: string
  speed: number
  volume: number
  pitch: number
  /** 音色克隆参数 */
  voiceId: string
  /** 临时音频文件保留时长（分钟），0 = 播完立即删除 */
  tempFileTtlMinutes: number
}

export interface OutputConfig {
  /** 弹幕发送 */
  danmaku: {
    enabled: boolean
    /** 发送频率限制（条/分钟） */
    ratePerMinute: number
  }
  /** 展示板 */
  display: {
    enabled: boolean
    style: 'bubble' | 'subtitle' | 'markdown'
    fontSize: number
    /** 自定义字体文件名（存于配置目录 fonts/，经 /fonts/ 提供；空 = 系统默认） */
    fontFile: string
    /** @font-face 家族名（上传时默认取文件名去扩展名） */
    fontFamily: string
  }
  /** TTS 语音 */
  tts: {
    enabled: boolean
    /** TTS 前等待（弹幕展示的停顿）ms */
    delayBeforeSpeakMs: number
  }
}

export interface MusicSourceConfig {
  netease: { enabled: boolean; loginType: 'none' | 'qr' | 'cookie' }
  qq: { enabled: boolean; loginType: 'none' | 'qr' | 'cookie' }
  kugou: { enabled: boolean }
  kuwo: { enabled: boolean }
  bilibili: { enabled: boolean }
  bilivideo: { enabled: boolean }
}

export interface MusicConfig {
  /** 默认搜索源 */
  defaultSource: string
  /** 歌曲时长上限（秒），0 不限制 */
  maxDuration: number
  /** 队列上限 */
  maxQueueSize: number
  /** 播放列表内单用户最大点歌数（控制台/系统操作豁免） */
  maxPerUser: number
  /** 旧版平铺待机歌曲列表（仅迁移用，调度读 idlePlaylists） */
  idlePlaylist: string[]
  /** 空闲歌单分组：每组 = 一次导入的歌单或手动收录集合；待机调度跨组轮转 */
  idlePlaylists: Array<{ name: string; ref: string; songs: string[] }>
  /** 空闲歌单是否自动循环 */
  idleLoop: boolean
  /** 直接点歌（绕过 LLM） */
  directOrder: {
    enabled: boolean
    /** 通用触发词，如 "点歌"（使用默认音源） */
    keywords: string[]
    /** 按渠道触发词，如 { netease: ["点w歌", "网易点歌"] }——命中即固定该渠道检索 */
    channelCommands: Record<string, string[]>
    /** 点歌是否注册为插件指令（通过插件直接点歌） */
    pluginCommand: boolean
  }
  /** 切歌指令（Ayna 风格：观众弹幕整条精确匹配触发词即跳过当前曲目） */
  skipCommand: {
    enabled: boolean
    /** 触发词，整条弹幕精确匹配，如 "切歌" */
    keywords: string[]
    /** 仅允许切自己点的歌；空闲歌单曲目（userId=system）不受限 */
    selfOnly: boolean
  }
  /** 歌曲信息输出 */
  nowPlaying: {
    /** OBS 文本输出：每个条目渲染一个文件；file 为纯文件名，统一写入 data/music_info/ */
    outputs: Array<{ file: string; template: string }>
    /** 是否开启歌曲信息窗口 */
    windowEnabled: boolean
    /** {{queue}} 待播列表的单元素格式模板（元素级变量：index/title/artist/duration/durationSec/user/source/songId/cover） */
    queueItemTemplate: string
  }
  /** 系统启动时自动让点歌机上线 */
  autoStartJukebox: boolean
  /** 点歌去重：同一首歌（同音源同 ID）已在待播队列/播放中时拒绝重复点入；不同版本视为不同歌曲 */
  dedupe: boolean
  /** 播放输出设备 */
  outputDevice: string
  /** 登录状态（保存各音源 session） */
  sessions: Record<string, string>
}

/** 数据保留策略（仿 tts.tempFileTtlMinutes 模式：0 = 永久保留） */
export interface DataRetentionConfig {
  /** 播放记录保留天数，0 = 永久 */
  playHistoryDays: number
  /** 事件历史保留天数，0 = 永久 */
  eventHistoryDays: number
  /** 前端事件日志显示上限（条，DOM 上限非存储上限） */
  frontendLogMax: number
}

/** Live2D 资源注册：哪些表情/换装/动作注册进 LLM 工具、待机播放规律 */
export interface Live2DAssetRegistration {
  /** 表情 → 注册项（来自 expressions/ 目录） */
  expressions: Record<string, { enabled: boolean }>
  /** 换装 → 注册项（来自 costumes/ 目录，本质也是 Cubism 表情） */
  costumes: Record<string, { enabled: boolean }>
  /** 动作引用（声明动作 "组#序号"，命名动作为文件名）→ 注册项 */
  motions: Record<string, { enabled: boolean }>
  /** 待机播放 */
  idle: {
    motions: string[]
    mode: 'random' | 'sequential'
    /** 上一个动作结束后到下一个待机动作的间隔（秒） */
    intervalSec: number
  }
}

/** 舞台配置：物理（风/重力/强度）、背景（模式/色/图）、FPS 角标——与悬浮面板双向联动 */
export interface Live2DStageConfig {
  /** 风力 X 分量（-3~3，SDK 原生） */
  windX: number
  /** 风力 Y 分量（-3~3） */
  windY: number
  /** 重力 X 分量（-3~3） */
  gravityX: number
  /** 重力 Y 分量（-3~3，默认 -1 向下） */
  gravityY: number
  /** 物理强度（0~3，演算 dt 倍率近似） */
  physicsSpeed: number
  /** 背景模式：transparent | color | image */
  bgMode: 'transparent' | 'color' | 'image'
  /** 背景色（#rrggbb，bgMode=color 时生效） */
  bgColor: string
  /** 背景不透明度（0~1，透明窗下呈半透明色底） */
  bgAlpha: number
  /** 背景图绝对路径（bgMode=image 时生效） */
  bgImage: string
  /** FPS 角标显示开关 */
  fpsOverlay: boolean
}

export interface Live2DConfig {
  /** 模型路径（.model3.json） */
  modelPath: string
  /** 模型目录（可选，多个模型时） */
  modelDir: string
  /** 资源注册（LLM 工具门控 + 待机播放规律） */
  assetRegistration: Live2DAssetRegistration
  /** 窗口 */
  window: {
    width: number
    height: number
    transparent: boolean
    alwaysOnTop: boolean
  }
  /** 舞台（物理/背景/FPS 角标，悬浮面板与 WebUI 联动） */
  stage: Live2DStageConfig
  /** 默认缩放/位置 */
  scale: number
  x: number
  y: number
}

export interface AudioConfig {
  /** 输出设备（空 = 默认） */
  outputDevice: string
  /** TTS 音量 */
  ttsVolume: number
}

export interface CppConfig {
  /** C++ 执行器路径 */
  executablePath: string
  /** 配置路径 */
  configPath: string
  /** 自动启动 */
  autoStart: boolean
  /** 由后端拉起时隐藏执行器窗口（Live2D 不显示，音频功能不受影响） */
  startHidden: boolean
  /** 启动超时 ms */
  startTimeoutMs: number
  /** 本地 IPC 端口 */
  ipcPort: number
  /** IPC 重连间隔 */
  reconnectMs: number
}

export interface BackendConfig {
  roomId: string
  server: ServerConfig
  events: EventReceiverConfig
  triggers: TriggerConfig[]
  llm: LLMConfig
  tts: TTSConfig
  output: OutputConfig
  music: MusicConfig
  dataRetention: DataRetentionConfig
  live2d: Live2DConfig
  audio: AudioConfig
  audioCpp: CppConfig
  live2dCpp: CppConfig
}

// ============ 默认配置 ============

export function defaultConfig(): BackendConfig {
  return {
    roomId: '',
    server: { host: '0.0.0.0', httpPort: 19274, wsPort: 19275 },
    events: {
      // 默认未启动：仪表盘房间号卡片点击后才开始接收事件
      enabled: false,
      enabledEvents: {
        danmaku: true,
        gift: true,
        superchat: true,
        enter: false,
        follow: true,
        like: false,
        guard: true,
        liveStart: true,
        liveEnd: true,
      },
      filters: { minGiftPrice: 0, minSuperchatAmount: 0 },
    },
    triggers: [
      {
        id: 'danmaku-debounce',
        name: '弹幕合并',
        enabled: true,
        mode: 'debounce',
        eventTypes: ['danmaku'],
        delayMs: 5000,
        maxBatch: 10,
        mergeEvents: [],
        cron: '',
        actions: [],
      },
      {
        id: 'gift-debounce',
        name: '礼物合并',
        enabled: true,
        mode: 'debounce',
        eventTypes: ['gift'],
        delayMs: 3000,
        maxBatch: 5,
        mergeEvents: [],
        cron: '',
        actions: [],
      },
      {
        id: 'superchat-immediate',
        name: 'SC 立即触发',
        enabled: true,
        mode: 'immediate',
        eventTypes: ['superchat', 'guard'],
        delayMs: 0,
        maxBatch: 1,
        mergeEvents: [],
        cron: '',
        actions: [],
      },
    ],
    llm: {
      provider: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      tools: {},
      mcpServers: {},
      thinking: { enabled: false },
      models: {},
      activeModel: '',
      model: 'gpt-4o-mini',
      customHeaders: {},
      temperature: 0.7,
      maxTokens: 2000,
      topP: 1,
      timeoutMs: 60000,
      systemPrompt: [
        '你是直播间的 AI VTuber。根据事件用工具互动。',
        '回复观众时必须调用 send_reply，segments.method 只能是 danmaku / display / tts。',
        '弹幕要短；展示板可以稍长；tts 只放需要朗读的句子。',
        '不要编造未发生的礼物或上舰。',
        '可用 Live2D 工具：live2d_expression / live2d_motion / live2d_transform / live2d_status。',
        '可用点歌工具：jukebox_search_song / jukebox_add_song / jukebox_skip_song / jukebox_get_queue / jukebox_get_current_song。搜索与点歌可带 source 指定渠道：kuwo / kugou / migu / bilivideo / netease / qq（netease、qq 需扫码登录后才可用），不指定则用默认渠道。',
        '当前房间：{{roomId}}',
        '最近事件：\n{{events}}',
      ].join('\n'),
    },
    tts: {
      provider: 'volcengine',
      baseURL: 'https://openspeech.bytedance.com',
      appId: '',
      token: '',
      cluster: 'volcano_tts',
      voiceType: 'zh_female_qingxin',
      speed: 1,
      volume: 1,
      pitch: 1,
      voiceId: '',
      tempFileTtlMinutes: 30,
    },
    output: {
      danmaku: { enabled: true, ratePerMinute: 20 },
      display: { enabled: true, style: 'bubble', fontSize: 28, fontFile: '', fontFamily: '' },
      tts: { enabled: false, delayBeforeSpeakMs: 600 },
    },
    music: {
      defaultSource: 'kuwo',
      maxDuration: 360,
      maxQueueSize: 50,
      maxPerUser: 3,
      idlePlaylist: [],
      idlePlaylists: [],
      idleLoop: true,
      directOrder: {
        enabled: false,
        keywords: ['点歌'],
        channelCommands: {
          netease: ['点w歌', '网易点歌'],
          kuwo: ['点k歌', '酷我点歌'],
          kugou: ['点kg歌', '酷狗点歌'],
          migu: ['咪咕点歌'],
          bilivideo: ['点b歌', 'B站点歌'],
          qq: ['点q歌', 'QQ点歌'],
        },
        pluginCommand: false,
      },
      skipCommand: {
        enabled: false,
        keywords: ['切歌'],
        selfOnly: true,
      },
      nowPlaying: {
        outputs: [
          { file: 'nowplaying.txt', template: '🎵 {{title}} - {{artist}} ({{duration}})' },
        ],
        windowEnabled: true,
        queueItemTemplate: '{{index}}. {{title}} - {{artist}}',
      },
      autoStartJukebox: false,
      dedupe: false,
      outputDevice: '',
      sessions: {},
    },
    dataRetention: {
      playHistoryDays: 90,
      eventHistoryDays: 30,
      frontendLogMax: 200,
    },
    live2d: {
      modelPath: '../cpp-executor/build/Debug/Resources/Haru/Haru.model3.json',
      modelDir: '',
      assetRegistration: {
        expressions: {},
        costumes: {},
        motions: {},
        idle: { motions: [], mode: 'random', intervalSec: 8 },
      },
      window: { width: 800, height: 1000, transparent: true, alwaysOnTop: true },
      stage: {
        windX: 0,
        windY: 0,
        gravityX: 0,
        gravityY: -1,
        physicsSpeed: 1,
        bgMode: 'transparent',
        bgColor: '#0d1218',
        bgAlpha: 1,
        bgImage: '',
        fpsOverlay: false,
      },
      scale: 1,
      x: 0,
      y: 0,
    },
    audio: { outputDevice: '', ttsVolume: 80 },
    // 音频执行器：常驻运行（点歌机/TTS/试听全依赖），无窗口
    audioCpp: {
      executablePath: '../cpp-executor/build/Debug/audio_executor.exe',
      configPath: '../cpp-executor/config/audio-executor.json',
      autoStart: true,
      startHidden: true,
      startTimeoutMs: 15000,
      ipcPort: 19277,
      reconnectMs: 3000,
    },
    // Live2D 执行器：有窗口，手动开启
    live2dCpp: {
      executablePath: '../cpp-executor/build/Debug/vtuber_executor.exe',
      configPath: '../cpp-executor/config/executor.json',
      autoStart: false,
      startHidden: true,
      startTimeoutMs: 15000,
      ipcPort: 19276,
      reconnectMs: 3000,
    },
  }
}

// ============ 加载/保存 ============

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base) && Array.isArray(override)) return override as T
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = deepMerge((base as Record<string, unknown>)[k], v)
    }
    return out as T
  }
  return override === undefined ? base : (override as T)
}

/** 加载配置（不存在则创建默认） */
export function loadConfig(configPath = 'backend-config.json'): BackendConfig {
  const defaults = defaultConfig()
  const abs = path.resolve(configPath)
  try {
    const raw = fs.readFileSync(abs, 'utf-8')
    const user = JSON.parse(raw) as Record<string, unknown>
    // 迁移：旧版单 cpp 键 → live2dCpp（音频用新默认值）
    if (user.cpp && typeof user.cpp === 'object' && !user.live2dCpp) {
      user.live2dCpp = user.cpp
    }
    delete user.cpp
    // 迁移：旧版平铺 idlePlaylist → idlePlaylists 分组（「默认歌单」单组）
    const userMusic0 = user.music as { idlePlaylist?: unknown; idlePlaylists?: unknown } | undefined
    if (Array.isArray(userMusic0?.idlePlaylist) && userMusic0.idlePlaylist.length
      && (!Array.isArray(userMusic0?.idlePlaylists) || userMusic0.idlePlaylists.length === 0)) {
      userMusic0.idlePlaylists = [{
        name: '默认歌单',
        ref: '',
        songs: userMusic0.idlePlaylist.map(String),
      }]
    }
    // 迁移：旧版 nowPlaying 单模板/单文件 → outputs（须在 deepMerge 前处理用户侧数据，
    // 否则默认 outputs 与用户旧键并存会跳过迁移）；file 一律规范化为纯文件名（统一落 data/nowplaying/）
    const userMusic = user.music as { nowPlaying?: Record<string, unknown> } | undefined
    const userNp = userMusic?.nowPlaying
    if (userNp) {
      const outputs = userNp.outputs as Array<{ file: string; template: string }> | undefined
      if ((!outputs || !outputs.length) && userNp.template && userNp.filePath) {
        userNp.outputs = [{ file: String(userNp.filePath), template: String(userNp.template) }]
      }
      if (Array.isArray(userNp.outputs)) {
        userNp.outputs = userNp.outputs
          .filter((o) => o && typeof o.file === 'string' && o.file.trim() !== '')
          .map((o) => ({ file: path.basename(o.file.replace(/\\/g, '/')).trim(), template: String(o.template ?? '') }))
      }
      delete userNp.template
      delete userNp.filePath
    }
    return deepMerge(defaults, user)
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      saveConfig(defaults, abs)
      return defaults
    }
    throw err
  }
}

/** 保存配置 */
export function saveConfig(config: BackendConfig, configPath = 'backend-config.json'): void {
  const abs = path.resolve(configPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(config, null, 2), 'utf-8')
}

/** 深拷贝（避免外部修改内部状态） */
export function cloneConfig(config: BackendConfig): BackendConfig {
  return JSON.parse(JSON.stringify(config))
}

/** backend 包根（dist/ 的上一级），不依赖 process.cwd() */
export function backendRoot(): string {
  return path.resolve(__dirname, '..')
}

/** 相对路径相对 backend 包根解析 */
export function resolveBackendPath(p: string): string {
  if (!p) return p
  return path.isAbsolute(p) ? p : path.resolve(backendRoot(), p)
}

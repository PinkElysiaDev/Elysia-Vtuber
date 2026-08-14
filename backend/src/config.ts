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
  /** 单个用户同时可点数量 */
  maxPerUser: number
  /** 空闲歌单（Medias 的 URL 列表，如 netease:https://...） */
  idlePlaylist: string[]
  /** 空闲歌单是否自动循环 */
  idleLoop: boolean
  /** 直接点歌（绕过 LLM） */
  directOrder: {
    enabled: boolean
    /** 触发词，如 "点歌" */
    keywords: string[]
    /** 点歌是否注册为插件指令（通过插件直接点歌） */
    pluginCommand: boolean
  }
  /** 歌曲信息输出 */
  nowPlaying: {
    /** 输出模板（nowplaying.txt 文本） */
    template: string
    /** 输出文件路径 */
    filePath: string
    /** 是否开启歌曲信息窗口 */
    windowEnabled: boolean
  }
  /** 播放输出设备 */
  outputDevice: string
  /** 登录状态（保存各音源 session） */
  sessions: Record<string, string>
}

export interface Live2DConfig {
  /** 模型路径（.model3.json） */
  modelPath: string
  /** 模型目录（可选，多个模型时） */
  modelDir: string
  /** 窗口 */
  window: {
    width: number
    height: number
    transparent: boolean
    alwaysOnTop: boolean
  }
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
  live2d: Live2DConfig
  audio: AudioConfig
  cpp: CppConfig
}

// ============ 默认配置 ============

export function defaultConfig(): BackendConfig {
  return {
    roomId: '',
    server: { host: '0.0.0.0', httpPort: 19274, wsPort: 19275 },
    events: {
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
        '可用点歌工具：jukebox_search_song / jukebox_add_song / jukebox_skip_song / jukebox_get_queue / jukebox_get_current_song。',
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
    },
    output: {
      danmaku: { enabled: true, ratePerMinute: 20 },
      display: { enabled: true, style: 'bubble', fontSize: 28 },
      tts: { enabled: false, delayBeforeSpeakMs: 600 },
    },
    music: {
      defaultSource: 'kuwo',
      maxDuration: 360,
      maxQueueSize: 50,
      maxPerUser: 3,
      idlePlaylist: [],
      idleLoop: true,
      directOrder: {
        enabled: false,
        keywords: ['点歌'],
        pluginCommand: false,
      },
      nowPlaying: {
        template: '🎵 {{title}} - {{artist}} ({{duration}}s)',
        filePath: 'data/nowplaying.txt',
        windowEnabled: true,
      },
      outputDevice: '',
      sessions: {},
    },
    live2d: {
      modelPath: '../cpp-executor/build/Debug/Resources/Haru/Haru.model3.json',
      modelDir: '',
      window: { width: 800, height: 1000, transparent: true, alwaysOnTop: true },
      scale: 1,
      x: 0,
      y: 0,
    },
    audio: { outputDevice: '', ttsVolume: 80 },
    cpp: {
      executablePath: '../cpp-executor/build/Debug/vtuber_executor.exe',
      configPath: '../cpp-executor/config/executor.json',
      autoStart: false,
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
    const user = JSON.parse(raw)
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

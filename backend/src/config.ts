/**
 * Vtuber 逻辑服务配置系统
 * 覆盖全部功能：事件 / 触发器 / LLM / TTS / 输出 / 音乐 / Live2D / 音频 / 系统。
 * 配置持久化为 backend-config.json，WebUI 通过 config.get / config.schema 读写。
 */

import * as fs from 'fs'
import * as path from 'path'
import { defaultIncludeMap } from './core/event-catalog'

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
    /** 真实在线人数（仅 Web 连接模式有心跳真值） */
    online: boolean
    /** 累计看过人数（仅 Web 连接模式） */
    watchedChange: boolean
  }
  /** 事件过滤阈值 */
  filters: {
    minGiftPrice: number
    minSuperchatAmount: number
  }
}

// ============ 行为循环：上下文清单 / 密度合并 ============

/** LLM 上下文清单配置（第二层过滤：决定哪些事件呈现给模型；第一层是 events.enabledEvents 是否接收） */
export interface FeedConfig {
  /** 事件类型 → 是否进入清单（key 见 core/event-catalog.ts；未列出的类型不呈现） */
  include: Record<string, boolean>
  /** 清单最多呈现条数 */
  maxEvents: number
}

/** 密度自适应合并：普通事件攒批后统一交给模型的策略 */
export interface MergeConfig {
  enabled: boolean
  /** 静默窗口(ms)：窗口内无新事件即触发（1s~300s） */
  quietWindowMs: number
  /** 最大等待(ms)：持续有事件时封顶必发，防止热闹时段永远不触发；0 = 不设上限 */
  maxWaitMs: number
  /** 密度统计窗口（秒） */
  densityWindowSec: number
  /** 密度阈值：统计窗口内事件数达到即立即触发（刷屏时不再干等静默）；0 = 不启用 */
  densityThreshold: number
  /** 单批上限，达到立即触发；0 = 不限 */
  maxBatch: number
}

export interface BehaviorConfig {
  feed: FeedConfig
  merge: MergeConfig
}

// ============ 指令系统：弹幕直达执行（不经过模型） ============
// 能力注册表见 core/abilities.ts：指令与 LLM 工具同源对齐（可配置为指令 ⇔ 可暴露为工具）

export interface CommandPermission {
  /** all=所有人 / medal=粉丝牌等级 / guard=舰长及以上 / uids=指定用户 */
  mode: 'all' | 'medal' | 'guard' | 'uids'
  /** mode=medal：粉丝牌等级 ≥ */
  medalLevel?: number
  /** mode=uids：用户白名单 */
  uids?: string[]
}

export interface CommandItem {
  id: string
  enabled: boolean
  /** 预置能力 id（core/abilities.ts） */
  ability: string
  /** 触发词别名（多个；无参能力=整条匹配，有参能力=别名开头+尾部参数） */
  aliases: string[]
  /** 固定参数（覆盖能力默认；渠道别名 = 点歌能力 + 固定 source + 别名"点w歌"） */
  args?: Record<string, unknown>
  permission: CommandPermission
  cooldown: {
    /** 全局冷却 ms；0 = 不限 */
    globalMs: number
    /** 每人冷却 ms；0 = 不限 */
    perUserMs: number
  }
  /** 成功回执模板（{{ok}} {{message}} + 事件变量）；空 = 不回复 */
  successTemplate: string
  /** 失败回执模板；空 = 不回复 */
  failureTemplate: string
  /** 命中后是否写入清单（system.command.executed），让模型知道后台执行了什么 */
  announceToFeed: boolean
}

export interface CommandsConfig {
  /** 指令总开关 */
  enabled: boolean
  items: CommandItem[]
}

// ============ 即时应对：事件条件直达处理 ============

/** 条件字段按事件类型取用（全部可空 = 不限）；文本类字段支持数组 = 多个同类条件任一命中（OR），不同字段之间全部满足（AND） */
export interface InstantCondition {
  // —— 通用（含用户信息的事件）——
  uids?: string[]
  minMedalLevel?: number
  guardOnly?: boolean
  // —— 弹幕 ——
  keywords?: string[]
  regex?: string | string[]
  startsWith?: string | string[]
  // —— 礼物（价格单位：金瓜子）——
  giftName?: string | string[]
  giftNameContains?: string | string[]
  minPrice?: number
  minTotalPrice?: number
  minNum?: number
  // —— SC（单位：元）——
  maxPrice?: number
  // —— 点赞 / 在线 / 看过 ——
  minCount?: number
  // —— 上舰（1=总督 2=提督 3=舰长）——
  guardLevels?: number[]
  // —— 开播 / 点歌相关 ——
  titleContains?: string | string[]
  userName?: string | string[]
  minPosition?: number
  /** 仅观众点播（排除空闲歌单注入） */
  userRequestOnly?: boolean
  // —— 切歌 ——
  byContains?: string | string[]
  // —— 指令执行 ——
  ability?: string | string[]
  okOnly?: boolean
  // —— 模型加载/切换 ——
  modelName?: string | string[]
}

export type InstantAction =
  | { type: 'llm'; /** 可选定向指令（空=模型自行判断） */ directive?: string }
  | { type: 'send-text'; template: string; channels: Array<'danmaku' | 'display' | 'tts'> }
  | { type: 'run-ability'; ability: string; args?: Record<string, unknown> }

export interface InstantItem {
  id: string
  name: string
  enabled: boolean
  /** 触发事件类型（直播间事件 + 系统事件均可，见事件目录） */
  eventType: string
  condition: InstantCondition
  action: InstantAction
  /** 规则冷却 ms；0 = 不限 */
  cooldownMs: number
  /** 命中后是否写入清单（system.instant.sent） */
  announceToFeed: boolean
}

export interface InstantConfig {
  enabled: boolean
  items: InstantItem[]
}

/** 思考/推理开关：anthropic/gemini 映射 canonical.thinking，openai 系映射 canonical.reasoning.effort */
export interface LlmThinkingConfig {
  enabled: boolean
  effort?: string
}

/** 可设置提示词变量的设置（PROMPT STUDIO 变量参考「⚙设置」维护） */
export interface VariableSettings {
  /** {{history}}（event history）：进入变量的历史事件来源与条数 */
  history: {
    count: number
    sources: {
      danmaku: boolean
      gift: boolean
      superchat: boolean
      enter: boolean
      follow: boolean
      like: boolean
      guard: boolean
      liveStart: boolean
      liveEnd: boolean
      /** system.* 后台事件 */
      system: boolean
    }
  }
  /** {{now}}：详细程度 / 时区 / 自定义模板（模板优先，支持 YYYY MM DD HH mm ss 占位） */
  now: {
    detail: 'datetime' | 'date' | 'time'
    timezone: 'local' | 'utc' | 'offset'
    /** timezone=offset 时的偏移小时（-12..14） */
    offsetHours: number
    template: string
  }
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
  /** 可设置变量的设置（{{history}} / {{now}}） */
  variables: VariableSettings
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
  /** LLM 运行日志保留天数，0 = 永久 */
  llmTraceDays: number
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
  /** 行为循环：上下文清单 + 密度自适应合并 */
  behavior: BehaviorConfig
  /** 指令系统：弹幕直达执行 */
  commands: CommandsConfig
  /** 即时应对：事件条件直达处理 */
  instant: InstantConfig
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
        online: true,
        watchedChange: false,
      },
      filters: { minGiftPrice: 0, minSuperchatAmount: 0 },
    },
    behavior: {
      feed: {
        include: defaultIncludeMap(),
        maxEvents: 30,
      },
      merge: {
        enabled: true,
        quietWindowMs: 8000,
        maxWaitMs: 30000,
        densityWindowSec: 10,
        densityThreshold: 15,
        maxBatch: 50,
      },
    },
    commands: {
      enabled: true,
      items: [
        {
          id: 'cmd-order',
          enabled: true,
          ability: 'jukebox_add_song',
          aliases: ['点歌'],
          args: {},
          permission: { mode: 'all' },
          cooldown: { globalMs: 0, perUserMs: 3000 },
          successTemplate: '',
          failureTemplate: '',
          announceToFeed: true,
        },
        {
          id: 'cmd-skip',
          enabled: true,
          ability: 'jukebox_skip_song',
          aliases: ['切歌'],
          args: { selfOnly: true },
          permission: { mode: 'all' },
          cooldown: { globalMs: 2000, perUserMs: 5000 },
          successTemplate: '',
          failureTemplate: '',
          announceToFeed: true,
        },
      ],
    },
    instant: {
      enabled: true,
      items: [
        {
          id: 'instant-welcome',
          name: '入场欢迎',
          enabled: true,
          eventType: 'enter',
          condition: {},
          action: { type: 'send-text', template: '欢迎 {{user.name}} 进入直播间~', channels: ['danmaku'] },
          cooldownMs: 2000,
          announceToFeed: true,
        },
        {
          id: 'instant-sc',
          name: 'SC 立即回应',
          enabled: true,
          eventType: 'superchat',
          condition: {},
          action: { type: 'llm', directive: '收到了醒目留言，请优先真诚回应并致谢。' },
          cooldownMs: 0,
          announceToFeed: true,
        },
      ],
    },
    llm: {
      provider: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      tools: {},
      mcpServers: {},
      thinking: { enabled: false },
      variables: {
        history: {
          count: 20,
          sources: {
            danmaku: true, gift: true, superchat: true, enter: true, follow: true,
            like: false, guard: true, liveStart: true, liveEnd: true, system: true,
          },
        },
        now: { detail: 'datetime', timezone: 'local', offsetHours: 0, template: '' },
      },
      models: {},
      activeModel: '',
      model: 'gpt-4o-mini',
      customHeaders: {},
      temperature: 0.7,
      maxTokens: 2000,
      topP: 1,
      timeoutMs: 60000,
      systemPrompt: [
        '你是直播间的 AI VTuber，以主播第一视角与观众互动。',
        '每次收到的消息里有一份「直播间实时状况」清单（最新在最下），据此决定如何回应。',
        '想回应时必须调用 send_reply，segments.method 只能是 danmaku / display / tts；弹幕要短，展示板可以稍长，tts 只放需要朗读的句子。',
        '判断此刻没有值得回应的内容时，调用 stay_silent 并给出简短理由，不要强行找话；不要重复感谢同一位观众、不要重复玩同一个梗。',
        '不要编造未发生的礼物或上舰。当前房间：{{roomId}}。',
        '你最近说过的话（避免重复感谢/重复玩梗）：\n{{memory}}',
        '可用 Live2D 工具：live2d_expression / live2d_motion / live2d_transform / live2d_status。',
        '可用点歌工具：jukebox_search_song / jukebox_add_song / jukebox_skip_song / jukebox_get_queue / jukebox_get_current_song。搜索与点歌可带 source 指定渠道：kuwo / kugou / migu / bilivideo / netease / qq（netease、qq 需扫码登录后才可用），不指定则用默认渠道。',
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
      llmTraceDays: 7,
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
    // 迁移：旧触发器引擎（immediate/debounce/cross-merge/cron）已整体移除，忽略旧配置并提示一次
    if (Array.isArray(user.triggers) && user.triggers.length) {
      console.log('[config] 旧触发器配置已移除（事件驱动由行为循环接管，定时/动作链不再支持）')
      delete user.triggers
    }
    // 迁移：music.directOrder/skipCommand（旧直接点歌）→ commands.items（统一指令系统）
    // 仅在用户尚未手工配置 commands 时执行；旧字段保留在配置中不再被消费
    const userMusicCmd = user.music as {
      directOrder?: { enabled?: boolean; keywords?: string[]; channelCommands?: Record<string, string[]> }
      skipCommand?: { enabled?: boolean; keywords?: string[]; selfOnly?: boolean }
    } | undefined
    if (!user.commands && (userMusicCmd?.directOrder || userMusicCmd?.skipCommand)) {
      const items: CommandItem[] = []
      const doCfg = userMusicCmd?.directOrder
      const stamp = Date.now()
      let seq = 0
      if (doCfg?.enabled) {
        for (const [source, commands] of Object.entries(doCfg.channelCommands ?? {})) {
          for (const alias of commands ?? []) {
            if (!alias) continue
            items.push({
              id: `cmd-mig-${stamp}-${seq++}`, enabled: true,
              ability: 'jukebox_add_song', aliases: [alias], args: { source },
              permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 3000 },
              successTemplate: '', failureTemplate: '', announceToFeed: true,
            })
          }
        }
        for (const alias of doCfg.keywords ?? []) {
          if (!alias) continue
          items.push({
            id: `cmd-mig-${stamp}-${seq++}`, enabled: true,
            ability: 'jukebox_add_song', aliases: [alias], args: {},
            permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 3000 },
            successTemplate: '', failureTemplate: '', announceToFeed: true,
          })
        }
      }
      const skip = userMusicCmd?.skipCommand
      if (skip?.enabled) {
        for (const alias of skip.keywords ?? []) {
          if (!alias) continue
          items.push({
            id: `cmd-mig-${stamp}-${seq++}`, enabled: true,
            ability: 'jukebox_skip_song', aliases: [alias], args: { selfOnly: skip.selfOnly !== false },
            permission: { mode: 'all' }, cooldown: { globalMs: 2000, perUserMs: 5000 },
            successTemplate: '', failureTemplate: '', announceToFeed: true,
          })
        }
      }
      if (items.length) {
        user.commands = { enabled: true, items }
        console.log(`[config] 直接点歌配置已迁移为指令系统：${items.length} 条指令`)
      }
    }
    // 迁移：指令旧格式（keyword/match/command）→ 新格式（aliases/ability）
    if (user.commands && Array.isArray((user.commands as { items?: unknown }).items)) {
      const legacyAbilityMap: Record<string, string> = {
        'jukebox-order': 'jukebox_add_song',
        'jukebox-skip': 'jukebox_skip_song',
        'jukebox-restart': 'jukebox_restart',
        'live2d-costume': 'live2d_costume',
        'live2d-expression': 'live2d_expression',
        'live2d-motion': 'live2d_motion',
        'live2d-reload': 'live2d_reload',
      }
      const commands = user.commands as { items: Array<Record<string, unknown>> }
      for (const item of commands.items) {
        if (item && typeof item === 'object' && typeof item.ability !== 'string') {
          const legacyCommand = String(item.command ?? '')
          item.ability = legacyAbilityMap[legacyCommand] ?? String(item.ability ?? legacyCommand)
          if (!Array.isArray(item.aliases)) {
            const keyword = String(item.keyword ?? '')
            item.aliases = keyword ? [keyword] : []
          }
          delete item.command
          delete item.keyword
          delete item.match
        }
      }
    }
    // 迁移：即时应对旧格式（condition.type + action 字符串 + template/channels 顶层）→ 新格式（eventType + action 对象）
    if (user.instant && Array.isArray((user.instant as { items?: unknown }).items)) {
      const instant = user.instant as { items: Array<Record<string, unknown>> }
      for (const item of instant.items) {
        if (!item || typeof item !== 'object' || typeof item.eventType === 'string') continue
        const oldCondition = (item.condition ?? {}) as { type?: string } & Record<string, unknown>
        item.eventType = String(oldCondition.type ?? item.eventType ?? 'danmaku')
        item.condition = { ...oldCondition }
        delete (item.condition as Record<string, unknown>).type
        const oldAction = String(item.action ?? '')
        const template = String(item.template ?? '')
        const channels = Array.isArray(item.channels) ? item.channels : ['danmaku']
        if (oldAction === 'llm-immediate' || oldAction === 'llm') {
          item.action = { type: 'llm', directive: template }
        } else if (oldAction === 'run-tool' || oldAction === 'run-ability') {
          item.action = { type: 'run-ability', ability: template, args: (item.args as Record<string, unknown>) ?? {} }
        } else {
          item.action = { type: 'send-text', template, channels }
        }
        delete item.template
        delete item.channels
        delete item.args
      }
    }
    // 迁移：清理已移除的附加上下文配置键（feed.blocks / rulesAppendix）
    const userBehavior = user.behavior as { feed?: { blocks?: unknown }; rulesAppendix?: unknown } | undefined
    if (userBehavior?.feed && 'blocks' in (userBehavior.feed as object)) {
      delete (userBehavior.feed as Record<string, unknown>).blocks
    }
    if (userBehavior && 'rulesAppendix' in userBehavior) {
      delete (userBehavior as Record<string, unknown>).rulesAppendix
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

/**
 * 配置 Schema 定义
 * WebUI 控制台根据 schema 动态生成配置表单。
 * 字段类型：
 *  - string / number / boolean
 *  - select：枚举选择（options）
 *  - password：密文输入
 *  - json：JSON 编辑
 *  - object / array：嵌套
 *  - triggers：触发器专用编辑器
 */

import { defaultConfig, BackendConfig } from './config'

export type SchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'password'
  | 'json'
  | 'object'
  | 'array'
  | 'triggers'

export interface FieldSchema {
  type: SchemaType
  label?: string
  description?: string
  default?: unknown
  options?: { label: string; value: string }[]
  /** 嵌套字段（object 类型） */
  properties?: Record<string, FieldSchema>
  /** 数组元素 schema（array 类型） */
  items?: FieldSchema
  /** number 范围 */
  min?: number
  max?: number
  /** number/slider 步进 */
  step?: number
  /** 依赖：仅在父字段满足条件时显示 */
  dependsOn?: { field: string; value: unknown }
  /** 长文本用多行输入 */
  multiline?: boolean
  /** 下拉选项来源 RPC（如 audio.devices，前端异步拉取填充 select） */
  optionsSource?: string
  /** UI 控件提示：slider = 用滑杆渲染 number；stringList/channelCommands = 专用列表编辑器（免 JSON） */
  control?: 'slider' | 'stringList' | 'channelCommands'
}

export interface SectionSchema {
  key: string
  title: string
  description?: string
  fields: Record<string, FieldSchema>
  /** 归属的战术功能面板（live2d | jukebox）；不填则显示在配置中心 */
  pane?: string
}

/** 由默认配置生成 section 顺序 */
export function buildConfigSchema(): SectionSchema[] {
  const d = defaultConfig()

  return [
    {
      key: 'server',
      title: '服务网络',
      description: '逻辑服务（WebUI / RPC）监听配置；直播间房间号在「战术仪表盘」核心遥测指标处编辑',
      fields: {
        'server.host': { type: 'string', label: '监听地址', default: d.server.host },
        'server.httpPort': { type: 'number', label: 'WebUI 端口', default: d.server.httpPort },
        'server.wsPort': { type: 'number', label: 'RPC 端口', default: d.server.wsPort },
      },
    },
    {
      key: 'events',
      title: '事件接收',
      description: '配置接收哪些直播间事件（来自 adapter-bililive）；总开关在「战术仪表盘」房间号卡片处切换',
      fields: {
        'events.enabled': { type: 'boolean', label: '事件接收总开关（默认关闭，在仪表盘卡片点击启动）', default: false },
        'events.enabledEvents': {
          type: 'object',
          label: '事件开关',
          properties: {
            danmaku: { type: 'boolean', label: '弹幕', default: true },
            gift: { type: 'boolean', label: '礼物', default: true },
            superchat: { type: 'boolean', label: '醒目留言', default: true },
            enter: { type: 'boolean', label: '进入直播间', default: false },
            follow: { type: 'boolean', label: '关注', default: true },
            like: { type: 'boolean', label: '点赞', default: false },
            guard: { type: 'boolean', label: '上舰', default: true },
            liveStart: { type: 'boolean', label: '开播', default: true },
            liveEnd: { type: 'boolean', label: '下播', default: true },
          },
        },
        'events.filters.minGiftPrice': { type: 'number', label: '最小礼物价格(金瓜子)', min: 0, default: 0 },
        'events.filters.minSuperchatAmount': { type: 'number', label: '最小 SC 金额(元)', min: 0, default: 0 },
      },
    },
    {
      key: 'triggers',
      title: '触发器',
      description: '配置事件的触发逻辑：立即 / 延迟合并 / 跨类型合并 / 定时任务',
      fields: {
        triggers: {
          type: 'triggers',
          label: '触发器规则',
          default: d.triggers,
        },
      },
    },
    {
      key: 'llm',
      title: 'LLM 大模型',
      description: '模型网关：支持 chat-completions / anthropic / gemini / responses 协议；系统提示词在「提示词调试工坊」面板编辑',
      fields: {
        'llm.provider': {
          type: 'select',
          label: '协议',
          options: [
            { label: 'OpenAI Chat Completions', value: 'openai' },
            { label: 'Anthropic Messages', value: 'anthropic' },
            { label: 'Google Gemini', value: 'gemini' },
            { label: 'OpenAI Responses', value: 'responses' },
          ],
          default: d.llm.provider,
        },
        'llm.baseURL': { type: 'string', label: '接口地址 Base URL', default: d.llm.baseURL },
        'llm.apiKey': { type: 'password', label: 'API Key', default: d.llm.apiKey },
        'llm.model': { type: 'string', label: '模型名称', default: d.llm.model },
        'llm.customHeaders': { type: 'json', label: '自定义请求头 (JSON)', default: {} },
        'llm.temperature': { type: 'number', label: '温度', min: 0, max: 2, default: 0.7 },
        'llm.maxTokens': { type: 'number', label: '最大 Token', min: 1, default: 2000 },
        'llm.topP': { type: 'number', label: 'Top P', min: 0, max: 1, default: 1 },
        'llm.timeoutMs': { type: 'number', label: '超时 (ms)', min: 1000, default: 60000 },
      },
    },
    {
      key: 'tts',
      title: '语音合成',
      description: 'TTS 合成参数（火山 / 克隆）；输出设备与音量在「音频中枢路由」面板',
      fields: {
        'tts.provider': {
          type: 'select',
          label: '服务',
          options: [
            { label: '火山方舟 TTS', value: 'volcengine' },
            { label: '音色克隆', value: 'clone' },
          ],
          default: d.tts.provider,
        },
        'tts.baseURL': { type: 'string', label: '接口地址', default: d.tts.baseURL },
        'tts.appId': { type: 'string', label: 'App ID', default: d.tts.appId },
        'tts.token': { type: 'password', label: 'Token', default: d.tts.token },
        'tts.cluster': { type: 'string', label: 'Cluster', default: d.tts.cluster },
        'tts.voiceType': { type: 'string', label: '音色 ID', default: d.tts.voiceType },
        'tts.voiceId': { type: 'string', label: '克隆音色 ID', default: d.tts.voiceId },
        'tts.speed': { type: 'number', label: '语速', min: 0.5, max: 2, default: 1 },
        'tts.volume': { type: 'number', label: '音量', min: 0, max: 2, default: 1 },
        'tts.pitch': { type: 'number', label: '音调', min: 0.5, max: 2, default: 1 },
        'tts.tempFileTtlMinutes': {
          type: 'number',
          label: '临时音频保留(分钟)',
          description: 'TTS 合成的临时 mp3 在磁盘上的保留时长，到期自动删除；0 = 播完立即删除',
          min: 0,
          default: 30,
        },
      },
    },
    {
      key: 'output',
      title: '输出策略',
      description: '模型回复的分发方式：弹幕 / 展示板 / 语音',
      fields: {
        'output.danmaku.enabled': { type: 'boolean', label: '发送弹幕', default: true },
        'output.danmaku.ratePerMinute': { type: 'number', label: '弹幕频率上限(条/分)', min: 1, default: 20 },
        'output.display.enabled': { type: 'boolean', label: '渲染到展示板', default: true },
        'output.display.fontSize': { type: 'number', label: '展示板字号（未实现，暂不生效）', min: 10, max: 96, default: 28 },
        'output.display.style': {
          type: 'select',
          label: '展示板样式',
          options: [
            { label: '气泡', value: 'bubble' },
            { label: '字幕', value: 'subtitle' },
            { label: 'Markdown', value: 'markdown' },
          ],
          default: 'bubble',
        },
        'output.tts.enabled': { type: 'boolean', label: 'TTS 语音朗读', default: false },
        'output.tts.delayBeforeSpeakMs': { type: 'number', label: '语音前停顿(ms)', min: 0, default: 600 },
      },
    },
    {
      key: 'music',
      title: '点歌机',
      description: '音源、队列、直接点歌与歌曲信息输出（嵌入「点歌机运营中台」面板）',
      pane: 'jukebox',
      fields: {
        'music.defaultSource': {
          type: 'select',
          label: '默认音源',
          options: [
            { label: '网易云', value: 'netease' },
            { label: 'QQ 音乐', value: 'qq' },
            { label: '酷狗', value: 'kugou' },
            { label: '酷我', value: 'kuwo' },
            { label: '咪咕', value: 'migu' },
            { label: 'B站视频', value: 'bilivideo' },
          ],
          default: 'kuwo',
        },
        'music.maxDuration': { type: 'number', label: '歌曲时长上限(秒)', min: 0, default: 360 },
        'music.maxQueueSize': { type: 'number', label: '队列上限', min: 1, default: 50 },
        'music.maxPerUser': { type: 'number', label: '每用户点歌上限', min: 1, default: 3 },
        // 直接点歌（enabled/keywords/channelCommands）在点歌机面板「ORDER COMMANDS」专用卡片编辑
        // 空闲歌单（idlePlaylist/idleLoop）在点歌机面板「IDLE PLAYLIST」专用卡片编辑
        // 歌曲信息文本输出（多文件 + 变量模板）在点歌机面板「NOW PLAYING OUTPUTS」专用卡片编辑
        'music.nowPlaying.windowEnabled': { type: 'boolean', label: '开启歌曲信息叠加页 (nowplaying.html)', default: true },
        // 播放输出设备统一在「音频中枢路由」面板配置，避免双入口
      },
    },
    {
      key: 'live2d',
      title: 'Live2D 窗口',
      description: '执行器窗口行为（模型选择与舞台变换在上方 HUB / Gizmo 面板）',
      pane: 'live2d',
      fields: {
        'live2d.window.width': { type: 'number', label: '窗口宽', min: 200, max: 3840, default: 800 },
        'live2d.window.height': { type: 'number', label: '窗口高', min: 200, max: 2160, default: 1000 },
        'live2d.window.transparent': {
          type: 'boolean',
          label: '透明背景',
          default: true,
        },
        'live2d.window.alwaysOnTop': { type: 'boolean', label: '窗口置顶', default: true },
      },
    },
    {
      key: 'audioCpp',
      title: '音频执行器',
      description: '独立音频进程（XAudio2 播放，点歌机/TTS/试听全依赖）',
      pane: 'audio',
      fields: {
        'audioCpp.executablePath': { type: 'string', label: '可执行文件路径', default: d.audioCpp.executablePath },
        'audioCpp.configPath': { type: 'string', label: '配置路径', default: d.audioCpp.configPath },
        'audioCpp.autoStart': { type: 'boolean', label: '自动启动', default: true },
        'audioCpp.startHidden': { type: 'boolean', label: '隐藏启动', default: true },
        'audioCpp.ipcPort': { type: 'number', label: 'IPC 端口', default: 19277 },
        'audioCpp.startTimeoutMs': { type: 'number', label: '启动超时(ms)', default: 15000 },
        'audioCpp.reconnectMs': { type: 'number', label: 'IPC 重连间隔(ms)', min: 200, default: 3000 },
      },
    },
    {
      key: 'live2dCpp',
      title: 'Live2D 执行器',
      description: '独立渲染进程（Live2D 模型/窗口交互，关闭不影响音频）；启停用仪表盘开关，此处仅高级参数',
      pane: 'live2d',
      fields: {
        // autoStart 已移除：与仪表盘启停开关重复，后端默认 false（不随服务自启）
        'live2dCpp.executablePath': { type: 'string', label: '可执行文件路径', default: d.live2dCpp.executablePath },
        'live2dCpp.configPath': { type: 'string', label: '配置路径', default: d.live2dCpp.configPath },
        'live2dCpp.startHidden': { type: 'boolean', label: '隐藏启动窗口', default: true },
        'live2dCpp.ipcPort': { type: 'number', label: 'IPC 端口', default: 19276 },
        'live2dCpp.startTimeoutMs': { type: 'number', label: '启动超时(ms)', default: 15000 },
        'live2dCpp.reconnectMs': { type: 'number', label: 'IPC 重连间隔(ms)', min: 200, default: 3000 },
      },
    },
  ]
}

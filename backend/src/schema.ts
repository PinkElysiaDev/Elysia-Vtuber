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
  | 'kv'
  | 'font'
  | 'output'
  | 'npOutputs'
  | 'directOrderCard'
  | 'object'
  | 'array'
  | 'triggers'
  | 'behavior'
  | 'commands'
  | 'instant'

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
  /** kv 类型：加行按钮文案 */
  itemLabel?: string
  /** kv 类型：键/值输入框 placeholder */
  keyPlaceholder?: string
  valuePlaceholder?: string
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
    // 事件接收 / 事件上下文 / 合并策略 / 即时应对 → 「触发器」专用面板（pane-trigger）
    // 弹幕指令 → 「指令」专用面板（pane-commands）
    {
      key: 'dataRetention',
      title: '数据持久化',
      description: '数据库中的播放记录与事件历史的保留时长；0 = 永久保留。清理每 6 小时执行一次',
      fields: {
        'dataRetention.playHistoryDays': { type: 'number', label: '播放记录保留(天)', description: 'SQLite 中播放记录的保留天数，0 = 永久保留', min: 0, default: 90 },
        'dataRetention.eventHistoryDays': { type: 'number', label: '事件历史保留(天)', description: 'SQLite 中直播事件历史的保留天数，0 = 永久保留', min: 0, default: 30 },
        'dataRetention.llmTraceDays': { type: 'number', label: '大脑运行日志保留(天)', description: '每次模型调用的完整留痕保留天数，0 = 永久保留', min: 0, default: 7 },
        'dataRetention.frontendLogMax': { type: 'number', label: '前端事件日志上限(条)', description: 'WebUI 事件流面板最多显示的条数（仅影响显示，不影响存储）', min: 50, default: 200 },
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
        output: { type: 'output', label: '输出策略', default: d.output },
      },
    },
    {
      key: 'music',
      title: '点歌机配置',
      description: '点歌指令、点歌机核心参数与歌曲信息文本输出；搜索/队列/播放控制在「点歌机运营中台」面板',
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
        'music.maxPerUser': { type: 'number', label: '播放列表内单用户最大点歌数', min: 1, default: 3 },
        'music.nowPlaying.windowEnabled': { type: 'boolean', label: '开启歌曲信息叠加页 (nowplaying.html)', default: true },
        'music.autoStartJukebox': { type: 'boolean', label: '自动启动', default: false },
        'music.dedupe': { type: 'boolean', label: '点歌去重', default: false },
        // directOrder 已迁移至「弹幕指令」面板（commands），此处不再提供编辑入口
        'music.nowPlaying.outputs': { type: 'npOutputs', label: '歌曲信息文本输出' },
        // 空闲歌单（idlePlaylists/idleLoop）仍在点歌机中台「IDLE PLAYLIST」双栏卡片编辑
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

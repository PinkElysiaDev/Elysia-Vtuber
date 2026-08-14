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
  /** 依赖：仅在父字段满足条件时显示 */
  dependsOn?: { field: string; value: unknown }
  /** 长文本用多行输入 */
  multiline?: boolean
}

export interface SectionSchema {
  key: string
  title: string
  description?: string
  fields: Record<string, FieldSchema>
}

/** 由默认配置生成 section 顺序 */
export function buildConfigSchema(): SectionSchema[] {
  const d = defaultConfig()

  return [
    {
      key: 'server',
      title: '服务网络',
      description: '逻辑服务（WebUI / RPC）监听配置',
      fields: {
        roomId: { type: 'string', label: '直播间 ID', default: d.roomId },
        'server.host': { type: 'string', label: '监听地址', default: d.server.host },
        'server.httpPort': { type: 'number', label: 'WebUI 端口', default: d.server.httpPort },
        'server.wsPort': { type: 'number', label: 'RPC 端口', default: d.server.wsPort },
      },
    },
    {
      key: 'events',
      title: '事件接收',
      description: '配置接收哪些直播间事件（来自 adapter-bililive）',
      fields: {
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
      description: '模型网关：支持 chat-completions / anthropic / gemini / responses 协议',
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
        'llm.systemPrompt': {
          type: 'string',
          label: '系统提示词',
          description: '支持 {{events}} {{user}} {{content}} {{roomId}} {{history}} {{now}}',
          default: d.llm.systemPrompt,
          multiline: true,
        },
      },
    },
    {
      key: 'tts',
      title: 'TTS 语音',
      description: '火山方舟 TTS 与音色克隆',
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
        'output.display.fontSize': { type: 'number', label: '展示板字号', min: 10, max: 96, default: 28 },
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
      description: '音源、队列、直接点歌与歌曲信息输出',
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
        'music.directOrder.enabled': { type: 'boolean', label: '直接点歌（绕过 LLM）', default: false },
        'music.directOrder.keywords': { type: 'json', label: '触发词列表 (JSON)', default: ['点歌'] },
        'music.directOrder.pluginCommand': { type: 'boolean', label: '注册为插件点歌指令', default: false },
        'music.idlePlaylist': { type: 'json', label: '空闲歌单 (URL 列表)', default: [] },
        'music.idleLoop': { type: 'boolean', label: '空闲歌单循环', default: true },
        'music.nowPlaying.template': {
          type: 'string',
          label: '歌曲信息模板',
          default: '🎵 {{title}} - {{artist}} ({{duration}}s)',
          multiline: true,
        },
        'music.nowPlaying.filePath': { type: 'string', label: '信息输出文件', default: 'data/nowplaying.txt' },
        'music.nowPlaying.windowEnabled': { type: 'boolean', label: '开启歌曲信息窗口', default: true },
        'music.outputDevice': { type: 'string', label: '播放输出设备', default: '' },
      },
    },
    {
      key: 'live2d',
      title: 'Live2D',
      description: 'Live2D 模型与舞台窗口（C++ 执行器原生渲染）',
      fields: {
        'live2d.modelPath': { type: 'string', label: '模型路径 (.model3.json)', default: d.live2d.modelPath },
        'live2d.modelDir': { type: 'string', label: '模型目录', default: '' },
        'live2d.window.width': { type: 'number', label: '窗口宽', default: 800 },
        'live2d.window.height': { type: 'number', label: '窗口高', default: 1000 },
        'live2d.window.transparent': { type: 'boolean', label: '透明背景', default: true },
        'live2d.window.alwaysOnTop': { type: 'boolean', label: '置顶', default: true },
        'live2d.scale': { type: 'number', label: '默认缩放', min: 0.1, max: 10, default: 1 },
        'live2d.x': { type: 'number', label: '水平位移', default: 0 },
        'live2d.y': { type: 'number', label: '垂直位移', default: 0 },
      },
    },
    {
      key: 'audio',
      title: '音频',
      description: 'TTS 语音播放与输出设备',
      fields: {
        'audio.outputDevice': { type: 'string', label: '输出设备', default: '' },
        'audio.ttsVolume': { type: 'number', label: 'TTS 音量', min: 0, max: 100, default: 80 },
      },
    },
    {
      key: 'cpp',
      title: '执行器',
      description: 'C++ 执行后端（Live2D / 播放引擎）',
      fields: {
        'cpp.executablePath': { type: 'string', label: '可执行文件路径', default: d.cpp.executablePath },
        'cpp.configPath': { type: 'string', label: '执行器配置路径', default: d.cpp.configPath },
        'cpp.autoStart': { type: 'boolean', label: '自动启动', default: false },
        'cpp.ipcPort': { type: 'number', label: 'IPC 端口', default: 19276 },
        'cpp.startTimeoutMs': { type: 'number', label: '启动超时(ms)', default: 15000 },
        'cpp.reconnectMs': { type: 'number', label: 'IPC 重连间隔(ms)', min: 200, default: 3000 },
      },
    },
  ]
}

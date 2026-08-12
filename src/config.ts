/**
 * Koishi 插件配置定义
 */

import { Schema } from 'koishi'
import type {
  EventReceiverConfig,
  TriggerSystemConfig,
  LLMConfig,
  TTSConfig,
  OutputConfig,
  BackendConfig
} from './types'

// ==================== 主配置接口 ====================

export interface Config {
  roomId: string
  eventReceiver: EventReceiverConfig
  triggers: TriggerSystemConfig
  llm: LLMConfig
  tts: TTSConfig
  output: OutputConfig
  backend: BackendConfig
}

// ==================== Schema 定义 ====================

export const Config = Schema.object({
  roomId: Schema.string().required().description('直播间ID'),

  eventReceiver: Schema.object({
    enabledEvents: Schema.object({
      danmaku: Schema.boolean().default(true).description('接收弹幕事件'),
      gift: Schema.boolean().default(true).description('接收礼物事件'),
      superchat: Schema.boolean().default(true).description('接收醒目留言（SC）事件'),
      enter: Schema.boolean().default(false).description('接收进入直播间事件'),
      follow: Schema.boolean().default(true).description('接收关注事件'),
      like: Schema.boolean().default(false).description('接收点赞事件'),
      guard: Schema.boolean().default(true).description('接收上舰事件'),
      liveStart: Schema.boolean().default(true).description('接收开播事件'),
      liveEnd: Schema.boolean().default(true).description('接收下播事件')
    }).description('事件接收开关'),

    filters: Schema.object({
      minGiftPrice: Schema.number().description('最小礼物价格（毛），低于此价格的礼物不会触发事件'),
      minSuperchatAmount: Schema.number().description('最小SC金额（元），低于此金额的SC不会触发事件'),
      minFansMedalLevel: Schema.number().description('最小粉丝勋章等级'),
      guardLevelFilter: Schema.array(Schema.union([
        Schema.const(1).description('总督'),
        Schema.const(2).description('提督'),
        Schema.const(3).description('舰长')
      ])).description('允许的舰长等级')
    }).description('事件过滤规则'),

    historySize: Schema.number().default(50).min(10).max(500)
      .description('历史记录最大数量')
  }).description('事件接收器配置'),

  triggers: Schema.object({
    triggers: Schema.array(Schema.intersect([
      Schema.object({
        id: Schema.string().required().description('触发器 ID'),
        name: Schema.string().required().description('触发器名称'),
        enabled: Schema.boolean().default(true).description('是否启用'),
        mode: Schema.union([
          Schema.const('immediate').description('立即触发'),
          Schema.const('debounce').description('延迟合并触发')
        ]).default('immediate').description('触发模式')
      }),
      Schema.union([
        Schema.object({
          mode: Schema.const('immediate'),
          eventTypes: Schema.array(Schema.string()).default(['danmaku']).description('触发事件类型列表')
        }),
        Schema.object({
          mode: Schema.const('debounce'),
          eventTypes: Schema.array(Schema.string()).default(['danmaku']).description('触发事件类型列表'),
          delay: Schema.number().default(3000).description('延迟时间(ms)'),
          maxBatch: Schema.number().default(10).description('最大合并数量')
        })
      ])
    ])).default([]).description('触发器列表'),

    rateLimit: Schema.object({
      maxRequestsPerMinute: Schema.number().default(10).description('每分钟最大请求数'),
      cooldownAfterError: Schema.number().default(5000).description('错误后冷却时间(ms)')
    }).description('限流配置')
  }).description('触发器系统配置'),

  llm: Schema.object({
    provider: Schema.object({
      provider: Schema.union([
        Schema.const('openai').description('OpenAI'),
        Schema.const('anthropic').description('Anthropic'),
        Schema.const('gemini').description('Google Gemini')
      ]).default('openai').description('模型提供商'),
      baseURL: Schema.string().description('API 基础地址'),
      apiKey: Schema.string().role('secret').description('API 密钥'),
      model: Schema.string().description('模型名称'),
      customHeaders: Schema.dict(Schema.string()).description('自定义请求头'),
      temperature: Schema.number().min(0).max(2).default(0.7).description('温度参数'),
      maxTokens: Schema.number().min(1).default(2000).description('最大生成token数'),
      topP: Schema.number().min(0).max(1).description('Top-P采样')
    }).description('模型配置'),

    prompt: Schema.object({
      system: Schema.string().role('textarea').default(
        '你是一名B站虚拟主播，正在直播。请用自然、活泼的语气回应观众。'
      ).description('系统提示词'),
      user: Schema.string().role('textarea').default(
        '当前时间：{{time.now}}\n' +
        '最近的弹幕：\n{{history.danmaku}}\n\n' +
        '刚刚发生的事件：{{event.type}}\n' +
        '请根据以上信息回应观众。'
      ).description('用户提示词模板')
    }).description('提示词配置'),

    enableTools: Schema.boolean().default(true).description('启用工具调用'),
    maxToolCalls: Schema.number().default(5).description('最大工具调用次数'),

    session: Schema.object({
      maxMessages: Schema.number().default(20).description('会话最大消息数'),
      maxTokens: Schema.number().description('会话最大token数（可选）')
    }).description('会话配置')
  }).description('LLM 配置'),

  tts: Schema.intersect([
    Schema.object({
      provider: Schema.union([
        Schema.const('volcengine').description('火山方舟TTS'),
        Schema.const('clone').description('声音克隆')
      ]).default('volcengine').description('TTS提供商')
    }),
    Schema.union([
      Schema.object({
        provider: Schema.const('volcengine'),
        baseURL: Schema.string().default('https://openspeech.bytedance.com').description('API 地址'),
        appId: Schema.string().description('应用ID'),
        token: Schema.string().role('secret').description('Token'),
        cluster: Schema.union([
          Schema.const('volcano_tts').description('通用语音合成 (volcano_tts)'),
          Schema.const('volcano_mega').description('精品大模型语音合成 (volcano_mega)')
        ]).default('volcano_tts').description('集群类型'),
        voiceType: Schema.string().description('音色ID')
      }),
      Schema.object({
        provider: Schema.const('clone'),
        baseURL: Schema.string().description('API 地址'),
        apiKey: Schema.string().role('secret').description('API 密钥'),
        voiceId: Schema.string().description('声音ID')
      })
    ])
  ]).description('TTS 配置'),

  output: Schema.object({
    enableDanmaku: Schema.boolean().default(true).description('启用弹幕输出'),
    enableDisplay: Schema.boolean().default(true).description('启用展示板输出'),
    enableTTS: Schema.boolean().default(true).description('启用TTS输出'),
    danmakuDelay: Schema.number().default(0).description('弹幕发送延迟(ms)'),
    ttsQueueMode: Schema.union([
      Schema.const('serial').description('串行播放（等待前一段播完）'),
      Schema.const('parallel').description('并行播放')
    ]).default('serial').description('TTS队列模式')
  }).description('输出配置'),

  backend: Schema.object({
    enabled: Schema.boolean().default(false).description('启用独立后端'),
    host: Schema.string().default('localhost').description('后端地址'),
    port: Schema.number().default(19264).description('后端端口'),
    reconnectInterval: Schema.number().default(5000).description('重连间隔(ms)'),
    timeout: Schema.number().default(10000).description('请求超时(ms)')
  }).description('后端通信配置')
})

export default Config

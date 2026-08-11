/**
 * 所有类型定义集中管理
 */

// ==================== 事件相关类型 ====================

export interface StandardUser {
  uid: string
  name: string
  face?: string
  fansMedal?: {
    name: string
    level: number
  }
  guardLevel?: number  // 0无/1总督/2提督/3舰长
}

export interface StandardEvent {
  type: 'danmaku' | 'gift' | 'superchat' | 'enter' | 'follow' | 'like' | 'guard' | 'liveStart' | 'liveEnd'
  timestamp: number
  roomId: string
  user?: StandardUser
  data: any
}

// ==================== 事件接收器配置 ====================

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
  filters: {
    minGiftPrice?: number
    minSuperchatAmount?: number
    minFansMedalLevel?: number
    guardLevelFilter?: (1 | 2 | 3)[]
  }
  historySize: number
}

// ==================== 触发器配置 ====================

export type TriggerMode = 'immediate' | 'debounce' | 'cross-merge' | 'scheduled'

export interface BaseTrigger {
  id: string
  name: string
  enabled: boolean
}

export interface ImmediateTrigger extends BaseTrigger {
  mode: 'immediate'
  eventTypes: string[]
}

export interface DebounceTrigger extends BaseTrigger {
  mode: 'debounce'
  eventTypes: string[]
  delay: number
  maxBatch: number
}

export interface CrossMergeTrigger extends BaseTrigger {
  mode: 'cross-merge'
  primaryEvent: string
  mergeEvents: string[]
  window: number
}

export interface ScheduledTrigger extends BaseTrigger {
  mode: 'scheduled'
  cron: string
  actions: TriggerAction[]
}

export interface TriggerAction {
  type: 'call-tool' | 'llm-request' | 'wait'
  config: any
}

export type TriggerConfig = ImmediateTrigger | DebounceTrigger | CrossMergeTrigger | ScheduledTrigger

export interface TriggerSystemConfig {
  triggers: TriggerConfig[]
  rateLimit: {
    maxRequestsPerMinute: number
    cooldownAfterError: number
  }
}

// ==================== LLM 配置 ====================

export type ApiProtocol = 'chat-completions' | 'anthropic' | 'gemini' | 'responses'
export type ProviderType = 'openai' | 'anthropic' | 'gemini'

export interface ProviderConfig {
  provider: ProviderType
  baseURL: string
  apiKey: string
  model: string
  customHeaders?: Record<string, string>
  temperature?: number
  maxTokens?: number
  topP?: number
}

export interface LLMConfig {
  provider: ProviderConfig
  prompt: {
    system: string
    user: string
  }
  enableTools: boolean
  maxToolCalls: number
  session: {
    maxMessages: number
    maxTokens?: number
  }
}

export interface LLMRequest {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  tools?: ToolDefinition[]
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

export interface LLMResponse {
  content: string
  finishReason?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }>
}

// ==================== TTS 配置 ====================

export interface TTSConfig {
  provider: 'volcengine' | 'clone'
  volcengine: {
    baseURL: string
    appId: string
    token: string
    cluster: string
    accessToken: string
    voiceType: string
  }
  clone: {
    baseURL: string
    apiKey: string
    voiceId: string
  }
}

// ==================== 输出配置 ====================

export interface OutputConfig {
  enableDanmaku: boolean
  enableDisplay: boolean
  enableTTS: boolean
  danmakuDelay?: number
  ttsQueueMode: 'serial' | 'parallel'
}

// ==================== 后端通信配置 ====================

export interface BackendConfig {
  enabled: boolean
  host: string
  port: number
  reconnectInterval: number
  timeout: number
}

// ==================== 聊天消息类型 ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  name?: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export interface ContentPart {
  type: 'text' | 'image'
  text?: string
  imageUrl?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: any
}

export interface ChatChunk {
  content?: string
  toolCalls?: ToolCall[]
  finished: boolean
}

// ==================== 工具系统类型 ====================

export interface ToolDefinition {
  name: string
  description: string
  parameters: any  // JSON Schema
  handler: (args: any, ctx: any) => Promise<any>
}

// ==================== 会话类型 ====================

export interface ChatSession {
  id: string
  messages: ChatMessage[]
  createdAt: number
  lastActiveAt: number
}

// ==================== 回复分段类型 ====================

export interface ReplySegment {
  text: string
  method: 'danmaku' | 'display' | 'tts'
  displayStyle?: 'normal' | 'emphasis' | 'thought'
  emotion?: string
}

export interface BotReply {
  segments: ReplySegment[]
}

// ==================== 事件缓存类型 ====================

export interface LiveSessionState {
  roomId: string
  isLive: boolean
  liveStartTime: number | null
  online: number
  likes: number
  danmakuHistory: StandardEvent[]
  giftHistory: StandardEvent[]
  superChatHistory: StandardEvent[]
  recentUsers: Map<string, { name: string; lastActive: number }>
}

// ==================== JSON-RPC 协议类型 ====================

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: { code: number; message: string; data?: any }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

/**
 * LLM 网关（薄适配层）：内部 ChatMessage/ToolSpec ↔ canonical 转换，
 * 协议编码/HTTP 发送/解码全部委托 @elysia-ai/request-kit 的 chatCanonical
 * （其内部经 @elysia-ai 协议包转换、并由 request-kit 自己的 buildRequest 发送——全生态唯一一份 LLM 客户端实现）。
 */
import type { LLMConfig, LlmModelProfile, LlmThinkingConfig } from '../config'
import type { ChatMessage, ChatRequest, ChatResult, ToolCall, ToolSpec } from './types'
import {
  chatCanonical,
  chatText,
  canonicalResponseText,
  type LlmEndpointConfig,
  type LlmProvider,
  type SimpleMessage,
  type SimplePart,
} from '@elysia-ai/request-kit'

/** canonical 类型经 request-kit 导出推导，避免 CJS 直接 import ESM 包的类型声明 */
type CanonicalRequest = Parameters<typeof chatCanonical>[0]
type CanonicalResponse = Awaited<ReturnType<typeof chatCanonical>>

const DEFAULT_TIMEOUT_MS = 60000

const DEFAULT_BASE: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  responses: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

function toProvider(provider: string): LlmProvider {
  const value = (provider || 'openai').trim().toLowerCase()
  if (value === 'anthropic' || value === 'gemini' || value === 'responses') return value
  return 'openai'
}

/** 内部消息 → canonical。tool_calls 的 arguments 统一序列化为字符串（四协议编码器均接受，OpenAI 侧只认字符串）。 */
function toCanonical(request: ChatRequest, model: string): CanonicalRequest {
  const instructions: string[] = []
  const messages: CanonicalRequest['messages'] = []
  for (const msg of request.messages) {
    if (msg.role === 'system') {
      if (msg.content) instructions.push(msg.content)
      continue
    }
    if (msg.role === 'tool') {
      const callId = msg.toolCallId ?? ''
      messages.push({
        role: 'tool',
        name: msg.name,
        tool_call_id: callId,
        content: [{ type: 'tool_output', tool_call_id: callId, tool_output: msg.content }],
      })
      continue
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: msg.content ? [{ type: 'text', text: msg.content }] : [],
        tool_calls: msg.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        })),
      })
      continue
    }
    messages.push({
      role: msg.role,
      content: msg.content ? [{ type: 'text', text: msg.content }] : [],
    })
  }
  return {
    model,
    instructions: instructions.length ? instructions.join('\n\n') : undefined,
    messages,
    tools: request.tools?.length
      ? request.tools.map((tool) => ({
        type: 'function' as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }))
      : undefined,
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** canonical 响应 → 内部 ChatResult（兼容 function_call 项与 message.tool_calls 两种表示，取其一防重复）。 */
function fromCanonical(res: CanonicalResponse): ChatResult {
  const toolCalls: ToolCall[] = []
  for (const item of res.output ?? []) {
    if (item.type === 'function_call' && !item.tool_calls?.length) {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${toolCalls.length}`,
        name: item.name ?? '',
        arguments: parseArgs(item.arguments),
      })
    }
    for (const call of item.tool_calls ?? []) {
      toolCalls.push({
        id: call.id ?? `call_${toolCalls.length}`,
        name: call.name ?? '',
        arguments: parseArgs(call.arguments),
      })
    }
  }
  return {
    content: canonicalResponseText(res),
    finishReason: res.stop_reason ?? '',
    toolCalls,
  }
}

export interface RawChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** 图片（dataURL / http URL），需 vision 模型 */
  images?: string[]
}

export class LLMGateway {
  constructor(private config: LLMConfig) {}

  setConfig(config: LLMConfig): void {
    this.config = config
  }

  getConfig(): LLMConfig {
    return this.config
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const resolved = this.resolveActive()
    if (!resolved.apiKey) {
      throw new Error('LLM apiKey 未配置')
    }
    const canonical = toCanonical(request, resolved.model)
    if (resolved.topP !== undefined) canonical.top_p = resolved.topP
    // 思考开关：anthropic/gemini 走 canonical.thinking（协议包转 thinkingConfig / budget_tokens），
    // openai 系走 canonical.reasoning.effort（协议包转 reasoning_effort）
    const thinking = resolved.thinking
    if (thinking?.enabled) {
      if (resolved.provider === 'anthropic' || resolved.provider === 'gemini') {
        canonical.thinking = thinking.effort ? { enabled: true, effort: thinking.effort } : { enabled: true }
      } else {
        canonical.reasoning = { effort: thinking.effort || 'medium' }
      }
    }
    const res = await chatCanonical(canonical, this.endpointConfig(resolved))
    return fromCanonical(res)
  }

  /**
   * 简化直调（供 mcp.config.suggest 等场景）：文本 + 可选图片 → 纯文本回复。
   * 走同一 request-kit/elysia 链路，天然支持 vision 模型。
   */
  async chatRaw(messages: RawChatMessage[], opts?: { temperature?: number }): Promise<string> {
    const resolved = this.resolveActive()
    if (!resolved.apiKey) {
      throw new Error('LLM apiKey 未配置')
    }
    const simple: SimpleMessage[] = messages.map((msg) => {
      const parts: SimplePart[] = []
      if (msg.content) parts.push({ type: 'text', text: msg.content })
      for (const url of msg.images ?? []) parts.push({ type: 'image', url })
      return { role: msg.role, parts }
    })
    return chatText({
      messages: simple,
      cfg: this.endpointConfig(resolved),
      temperature: opts?.temperature ?? 0,
    })
  }

  /** 当前生效端点：activeModel 命中的档案逐字段覆盖内联配置（档案字段为空则回退内联） */
  private resolveActive(): {
    provider: LlmProvider
    baseURL: string
    apiKey: string
    model: string
    headers?: Record<string, string>
    thinking?: LlmThinkingConfig
    temperature?: number
    maxTokens?: number
    topP?: number
    timeoutMs?: number
    profileName: string
  } {
    const name = (this.config.activeModel ?? '').trim()
    let profile: LlmModelProfile | undefined = name ? this.config.models?.[name] : undefined
    // 被禁用的档案不承载流量，回退内联
    if (profile?.enabled === false) profile = undefined
    const provider = toProvider(profile?.provider || this.config.provider)
    return {
      provider,
      baseURL: (profile?.baseURL || (profile ? DEFAULT_BASE[provider] : '') || this.config.baseURL || DEFAULT_BASE[provider]).replace(/\/+$/, ''),
      apiKey: profile?.apiKey || this.config.apiKey,
      model: profile?.model || this.config.model,
      headers: profile?.headers && Object.keys(profile.headers).length > 0 ? profile.headers : this.config.customHeaders,
      thinking: profile?.thinking ?? this.config.thinking,
      temperature: profile?.temperature ?? this.config.temperature,
      maxTokens: profile?.maxTokens ?? this.config.maxTokens,
      topP: profile?.topP ?? this.config.topP,
      timeoutMs: profile?.timeoutMs ?? this.config.timeoutMs,
      profileName: profile ? name : '',
    }
  }

  private endpointConfig(resolved: ReturnType<LLMGateway['resolveActive']>): LlmEndpointConfig {
    return {
      provider: resolved.provider,
      baseURL: resolved.baseURL,
      apiKey: resolved.apiKey,
      model: resolved.model,
      headers: resolved.headers,
      timeoutMs: resolved.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxTokens: resolved.maxTokens,
      temperature: resolved.temperature,
    }
  }
}

export type { ToolSpec }

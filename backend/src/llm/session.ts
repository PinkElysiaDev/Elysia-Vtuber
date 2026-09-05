import type { LLMGateway } from '../llm/gateway'
import type { ChatMessage, ToolCall } from '../llm/types'
import type { ToolRegistry } from '../core/tools'
import type { StandardEvent } from '../modules/events'
import { expandTemplate } from '../core/variables'
import { defaultUserPrompt } from '../modules/output'

export interface SessionDeps {
  gateway: LLMGateway
  tools: ToolRegistry
  getSystemPrompt: () => string
  getRoomId: () => string
  getHistory: () => StandardEvent[]
  maxRounds?: number
  /** 工具加载开关（name → false 禁用；缺失 = 启用）。省略时全部加载 */
  getToolGate?: () => Record<string, boolean>
}

export interface SessionResult {
  content: string
  rounds: number
  /** 工具调用明细（含参数，供认知层提取 send_reply 输出与 stay_silent 理由） */
  toolCalls: Array<{ name: string; ok: boolean; args?: Record<string, unknown> }>
  finishReason: string
}

const DEFAULT_SYSTEM = [
  '你是直播间的 AI VTuber。根据事件清单用工具互动。',
  '回复观众时必须调用 send_reply，segments 的 method 只能是 danmaku / display / tts。',
  '弹幕要短；展示板可以稍长；tts 只放需要朗读的句子。',
  '判断此刻没有值得回应的内容时，调用 stay_silent 并给出简短理由，不要强行找话。',
  '不要编造未发生的礼物或上舰。点歌等能力通过对应工具完成。',
].join('\n')

const DEFAULT_MAX_ROUNDS = 6

export class LLMSession {
  constructor(private readonly deps: SessionDeps) {}

  async run(events: StandardEvent[], prompt?: string): Promise<SessionResult> {
    const ctx = {
      events,
      history: this.deps.getHistory(),
      roomId: this.deps.getRoomId(),
    }
    const system = expandTemplate(this.deps.getSystemPrompt() || DEFAULT_SYSTEM, ctx)
    const user = expandTemplate(prompt || defaultUserPrompt(events), ctx)
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
    return this.loop(messages)
  }

  async chat(messages: ChatMessage[], useTools = true): Promise<SessionResult> {
    return this.loop(messages, useTools)
  }

  private async loop(messages: ChatMessage[], useTools = true): Promise<SessionResult> {
    const maxRounds = this.deps.maxRounds ?? DEFAULT_MAX_ROUNDS
    const gate = this.deps.getToolGate?.() ?? {}
    const specs = useTools
      ? this.deps.tools.list().filter((t) => gate[t.name] !== false)
      : []
    const toolCalls: Array<{ name: string; ok: boolean; args?: Record<string, unknown> }> = []
    let content = ''
    let finishReason = ''

    for (let round = 1; round <= maxRounds; round++) {
      const result = await this.deps.gateway.chat({
        messages,
        tools: specs.length ? specs : undefined,
      })
      content = result.content || content
      finishReason = result.finishReason

      if (!result.toolCalls.length) {
        return { content, rounds: round, toolCalls, finishReason }
      }

      messages.push({
        role: 'assistant',
        content: result.content || '',
        toolCalls: result.toolCalls,
      })

      for (const call of result.toolCalls) {
        const payload = await this.invoke(call)
        toolCalls.push({ name: call.name, ok: payload.ok, args: call.arguments ?? {} })
        messages.push({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          content: payload.text,
        })
      }
    }

    return { content, rounds: maxRounds, toolCalls, finishReason: finishReason || 'max_rounds' }
  }

  private async invoke(call: ToolCall): Promise<{ ok: boolean; text: string }> {
    const result = await this.deps.tools.call(call.name, call.arguments ?? {})
    const text = typeof result === 'string' ? result : JSON.stringify(result ?? {})
    const failed = result && typeof result === 'object' && (result as any).success === false
    return { ok: !failed, text }
  }
}

/**
 * 统一认知引擎：所有"让大脑思考一次"的入口（合并器批量 / 即时应对插队 / 手动）汇到这里。
 * - 输入：直播间实时状况（事件清单）+ 可选定向指令；自我记忆经 {{memory}} 系统提示词变量注入
 * - 输出：模型经 send_reply 发言，或调用 stay_silent 行使沉默权
 * - 全程留痕（运行日志）：两端 prompt、回复、工具调用、决策、耗时
 * - 优先级串行队列：即时应对（SC 等）插队，其余按入队顺序执行
 */
import type { StandardEvent } from '../modules/events'
import type { ContextBuilder } from '../core/context'
import type { TraceRecorder } from '../core/trace'
import type { LLMGateway } from './gateway'
import type { LLMSession, SessionResult } from './session'
import { expandTemplate, eventVariables, formatNowCustom } from '../core/variables'
import type { VariableSettings } from '../config'

export type CognitionSource = 'batcher' | 'instant' | 'manual' | 'playground' | 'rule'

export interface CognitionRequest {
  source: CognitionSource
  /** 人类可读的触发原因（运行日志与广播展示） */
  reason: string
  /** 本次相关事件（合并器批 / 即时规则的单条事件） */
  events: StandardEvent[]
  /** 定向指令（即时规则 llm-immediate / 手动触发） */
  directive?: string
  /** 0 最高（即时规则插队）；默认 1 */
  priority?: number
}

export interface CognitionResult extends SessionResult {
  decision: 'replied' | 'silent' | 'error'
  silentReason: string
  error: string
  outputs: Array<{ method: string; text: string }>
  durationMs: number
}

export interface BackendState {
  jukebox: { playing: string; queue: string; running: boolean }
  live2d: { model: string; connected: boolean }
}

export interface CognitionDeps {
  session: LLMSession
  gateway: LLMGateway
  context: ContextBuilder
  trace: TraceRecorder
  getSystemPrompt: () => string
  getRoomId: () => string
  /** 自我记忆文本（系统提示词 {{memory}} 变量的数据源；用户不引用则不注入） */
  getMemory?: () => string
  /** {{history}}（event history）：按设置过滤/截断的历史事件 */
  getHistory?: () => StandardEvent[]
  /** {{state.xxx}} 后端状态变量（点歌机 / Live2D） */
  getBackendState?: () => BackendState
  /** 变量设置（{{now}} 格式等） */
  getVariableSettings?: () => VariableSettings
  /** 发言产出回调（service 记录短期记忆） */
  onOutputs?: (outputs: Array<{ method: string; text: string }>) => void
}

interface QueueEntry {
  req: CognitionRequest
  resolve: (result: CognitionResult) => void
  reject: (err: Error) => void
}

export class CognitionEngine {
  private queue: QueueEntry[] = []
  private draining = false
  /** 观测计数 */
  counts = { queued: 0, replied: 0, silent: 0, error: 0 }

  constructor(private readonly deps: CognitionDeps) {}

  /** 入队并等待结果（全局串行；priority 小者先执行） */
  request(req: CognitionRequest): Promise<CognitionResult> {
    this.counts.queued++
    return new Promise<CognitionResult>((resolve, reject) => {
      const entry: QueueEntry = { req, resolve, reject }
      const priority = req.priority ?? 1
      // 稳定插入：找到第一个比自己优先级低的入口插到它前面（同优先级保持 FIFO）
      const idx = this.queue.findIndex((e) => (e.req.priority ?? 1) > priority)
      if (idx === -1) this.queue.push(entry)
      else this.queue.splice(idx, 0, entry)
      void this.drain()
    })
  }

  queueDepth(): number {
    return this.queue.length
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length) {
        const entry = this.queue.shift()!
        try {
          const result = await this.execute(entry.req)
          entry.resolve(result)
        } catch (err) {
          entry.reject(err instanceof Error ? err : new Error(String(err)))
        }
      }
    } finally {
      this.draining = false
    }
  }

  /** 构建完整 user 消息（prompt.preview 与真实调用共用，保证所见即所得） */
  buildUserMessage(directive: string | undefined): string {
    const { feedBlock } = this.deps.context.build()
    const parts: string[] = []
    if (directive) parts.push(`【指令】${directive}`)
    parts.push('=== 直播间实时状况（最新在最下） ===')
    parts.push(feedBlock)
    return parts.join('\n\n')
  }

  private async execute(req: CognitionRequest): Promise<CognitionResult> {
    const start = Date.now()
    let systemPrompt = ''
    let userPrompt = ''
    try {
      // 系统提示词变量注入：{{memory}}（自我记忆）、{{history}}（event history 按设置）、
      // {{now}}（按设置格式化）、最近事件的 {{user.*}}/{{gift.*}}/{{sc.*}} 等、{{state.xxx}}（后端状态）
      const last = req.events[req.events.length - 1]
      const extra: Record<string, unknown> = {
        memory: this.deps.getMemory?.() ?? '',
        ...(last ? eventVariables(last) : {}),
      }
      const state = this.deps.getBackendState?.()
      if (state) extra.state = state
      const ctx = {
        events: req.events,
        history: this.deps.getHistory?.() ?? [],
        roomId: this.deps.getRoomId(),
        extra,
        nowText: formatNowCustom(this.deps.getVariableSettings?.().now ?? { detail: 'datetime', timezone: 'local', offsetHours: 0, template: '' }),
      }
      systemPrompt = expandTemplate(this.deps.getSystemPrompt(), ctx)
      userPrompt = this.buildUserMessage(req.directive)
      const result = await this.deps.session.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], true)

      const silentCall = result.toolCalls.find((c) => c.name === 'stay_silent')
      const outputs = collectOutputs(result.toolCalls)
      const durationMs = Date.now() - start
      let decision: CognitionResult['decision']
      let silentReason = ''
      if (silentCall) {
        decision = 'silent'
        silentReason = String((silentCall.args as { reason?: unknown } | undefined)?.reason ?? '')
      } else if (outputs.length) {
        decision = 'replied'
      } else {
        // 模型既没发言也没显式沉默：按沉默处理（理由入日志，便于排查提示词问题）
        decision = 'silent'
        silentReason = '模型未调用任何输出工具'
      }
      this.counts[decision]++
      if (decision === 'replied') this.deps.onOutputs?.(outputs)
      this.deps.trace.record({
        ts: start,
        source: req.source,
        reason: req.reason,
        decision,
        eventsCount: req.events.length,
        systemPrompt,
        userPrompt,
        model: this.deps.gateway.getActiveModelLabel(),
        response: result.content,
        toolCalls: result.toolCalls,
        outputs,
        silentReason,
        error: '',
        durationMs,
      })
      return { ...result, decision, silentReason, error: '', outputs, durationMs }
    } catch (err) {
      const durationMs = Date.now() - start
      const error = err instanceof Error ? err.message : String(err)
      this.counts.error++
      this.deps.trace.record({
        ts: start,
        source: req.source,
        reason: req.reason,
        decision: 'error',
        eventsCount: req.events.length,
        systemPrompt,
        userPrompt,
        model: this.deps.gateway.getActiveModelLabel(),
        response: '',
        toolCalls: [],
        outputs: [],
        silentReason: '',
        error,
        durationMs,
      })
      return {
        content: '', rounds: 0, toolCalls: [], finishReason: 'error',
        decision: 'error', silentReason: '', error, outputs: [], durationMs,
      }
    }
  }
}

/** 从工具调用中提取实际发言内容（send_reply 的 segments） */
export function collectOutputs(toolCalls: Array<{ name: string; ok: boolean; args?: Record<string, unknown> }>): Array<{ method: string; text: string }> {
  const out: Array<{ method: string; text: string }> = []
  for (const call of toolCalls) {
    if (call.name !== 'send_reply' || call.ok === false) continue
    const segments = (call.args as { segments?: unknown } | undefined)?.segments
    if (!Array.isArray(segments)) continue
    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue
      const rec = seg as Record<string, unknown>
      const text = String(rec.text ?? '').trim()
      if (!text) continue
      out.push({ method: rec.method === 'display' || rec.method === 'tts' ? String(rec.method) : 'danmaku', text })
    }
  }
  return out
}

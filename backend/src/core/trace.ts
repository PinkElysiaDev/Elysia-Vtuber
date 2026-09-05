/**
 * LLM 运行日志：每次大脑调用的完整留痕（两端 prompt / 回复 / 工具调用 / 决策 / 耗时）。
 * 落 SQLite llm_trace 表 + ws 广播摘要给 WebUI 实时时间线；解决"不知道究竟发了什么给模型"。
 */
import type { VtuberDatabase } from './database'

export interface TraceToolCall {
  name: string
  ok: boolean
  args?: Record<string, unknown>
}

export interface TraceRecord {
  ts: number
  source: string
  reason: string
  decision: 'replied' | 'silent' | 'error'
  eventsCount: number
  systemPrompt: string
  userPrompt: string
  model: string
  response: string
  toolCalls: TraceToolCall[]
  outputs: Array<{ method: string; text: string }>
  silentReason: string
  error: string
  durationMs: number
}

export interface TraceDeps {
  db: VtuberDatabase
  broadcast: (method: string, params: unknown) => void
}

export class TraceRecorder {
  constructor(private readonly deps: TraceDeps) {}

  record(rec: TraceRecord): void {
    let id = 0
    try {
      id = this.deps.db.insertTrace({
        ts: rec.ts,
        source: rec.source,
        reason: rec.reason,
        decision: rec.decision,
        events_count: rec.eventsCount,
        system_prompt: rec.systemPrompt,
        user_prompt: rec.userPrompt,
        model: rec.model,
        response: rec.response,
        tool_calls: JSON.stringify(rec.toolCalls ?? []),
        outputs: JSON.stringify(rec.outputs ?? []),
        silent_reason: rec.silentReason,
        error: rec.error,
        duration_ms: rec.durationMs,
      })
    } catch (err) {
      // 留痕失败不影响主流程
      console.warn('[trace] 写入失败:', err instanceof Error ? err.message : String(err))
    }
    // 摘要广播（不含全文，详情走 trace.list）
    this.deps.broadcast('llm.trace', {
      id,
      ts: rec.ts,
      source: rec.source,
      reason: rec.reason,
      decision: rec.decision,
      eventsCount: rec.eventsCount,
      durationMs: rec.durationMs,
      silentReason: rec.silentReason,
      error: rec.error || undefined,
      responsePreview: rec.response.slice(0, 300),
      tools: (rec.toolCalls ?? []).map((c) => c.name),
      outputs: rec.outputs,
    })
  }

  list(limit = 50, offset = 0, source?: string): { total: number; traces: unknown[] } {
    const rows = this.deps.db.getTraces(limit, offset, source)
    const total = this.deps.db.getTraceCount(source)
    return { total, traces: rows }
  }

  clear(): void {
    this.deps.db.clearTraces()
  }
}

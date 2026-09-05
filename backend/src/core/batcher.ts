/**
 * 密度自适应合并器：普通直播间事件攒批后统一交给大脑（LLM）。
 * 触发路径（按优先级）：
 *  - max-batch：单批达到 maxBatch 立即触发（硬上限）
 *  - density：densityWindowSec 窗口内事件数达到 densityThreshold 立即触发（刷屏时不再干等静默）
 *  - max-wait：批的首个事件起 maxWaitMs 封顶必发（热闹时段保证响应）
 *  - quiet：静默 quietWindowMs 后触发（默认路径）
 * 只收集 feed.include 允许进入清单的直播间事件；系统事件只进清单不触发（由 service 决定收集谓词）。
 */
import type { MergeConfig } from '../config'
import type { StandardEvent } from '../modules/events'

export type BatchReason = 'quiet' | 'density' | 'max-wait' | 'max-batch'

export interface BatchFire {
  events: StandardEvent[]
  reason: BatchReason
}

export interface BatcherDeps {
  getConfig: () => MergeConfig
  /** 事件是否应被收集（直播间事件 + feed.include 已开启） */
  shouldCollect: (event: StandardEvent) => boolean
  onFire: (fire: BatchFire) => void
}

const TICK_MS = 200

export class AdaptiveBatcher {
  private batch: StandardEvent[] = []
  private batchStartAt = 0
  private lastEventAt = 0
  /** 密度统计窗口内的事件时间戳 */
  private window: number[] = []
  private timer: NodeJS.Timeout | null = null
  private running = false
  /** 触发计数（观测用） */
  firedCounts: Record<BatchReason, number> = { quiet: 0, density: 0, 'max-wait': 0, 'max-batch': 0 }

  constructor(private readonly deps: BatcherDeps) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.batch = []
    this.window = []
  }

  /** 事件进入合并器；满足密度/上限条件时立即触发 */
  push(event: StandardEvent): void {
    if (!this.deps.shouldCollect(event)) return
    const cfg = this.deps.getConfig()
    if (!cfg.enabled) return
    const now = event.timestamp || Date.now()
    if (!this.batch.length) this.batchStartAt = now
    this.batch.push(event)
    this.lastEventAt = now
    this.window.push(now)
    this.pruneWindow(now, cfg)

    if (cfg.maxBatch > 0 && this.batch.length >= cfg.maxBatch) {
      this.fire('max-batch')
      return
    }
    if (cfg.densityThreshold > 0 && this.window.length >= cfg.densityThreshold) {
      this.fire('density')
    }
  }

  private pruneWindow(now: number, cfg: MergeConfig): void {
    const span = Math.max(1, cfg.densityWindowSec) * 1000
    this.window = this.window.filter((t) => now - t < span)
  }

  private tick(): void {
    if (!this.batch.length) return
    const cfg = this.deps.getConfig()
    if (!cfg.enabled) {
      this.batch = []
      return
    }
    const now = Date.now()
    if (cfg.maxWaitMs > 0 && now - this.batchStartAt >= cfg.maxWaitMs) {
      this.fire('max-wait')
      return
    }
    // quietWindowMs <= 0 视为立即触发（下一个 tick）
    if (now - this.lastEventAt >= Math.max(0, cfg.quietWindowMs)) {
      this.fire('quiet')
    }
  }

  private fire(reason: BatchReason): void {
    const events = this.batch
    this.batch = []
    this.window = []
    this.firedCounts[reason]++
    this.deps.onFire({ events, reason })
  }

  /** 当前批状态（system.status / WebUI 观测用） */
  pending(): { count: number; startedAt: number; quietInMs: number; maxWaitInMs: number } {
    const cfg = this.deps.getConfig()
    const now = Date.now()
    const quietIn = this.batch.length ? Math.max(0, Math.max(0, cfg.quietWindowMs) - (now - this.lastEventAt)) : 0
    const maxWaitIn = this.batch.length && cfg.maxWaitMs > 0
      ? Math.max(0, cfg.maxWaitMs - (now - this.batchStartAt))
      : 0
    return { count: this.batch.length, startedAt: this.batchStartAt, quietInMs: quietIn, maxWaitInMs: maxWaitIn }
  }
}

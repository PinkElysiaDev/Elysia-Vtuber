/**
 * 数据保留清理器：按用户可配置的天数清理 SQLite 中的过期数据。
 * 仿照 TtsEngine.sweepTempFiles 模式：启动时 + 每 6 小时执行一次。
 * 0 = 永久保留（跳过清理）。
 */
import type { VtuberDatabase } from './database'

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 小时

export interface RetentionDeps {
  db: VtuberDatabase
  getPlayHistoryDays: () => number
  getEventHistoryDays: () => number
  getLlmTraceDays?: () => number
}

export class RetentionSweeper {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: RetentionDeps) {}

  start(): void {
    this.sweep()
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // 停止时也扫一次，确保优雅退出前数据干净
    this.sweep()
  }

  private sweep(): void {
    try {
      const phDays = this.deps.getPlayHistoryDays()
      if (phDays > 0) {
        const deleted = this.deps.db.deleteOldPlayHistory(phDays)
        if (deleted > 0) console.log(`[retention] 播放记录清理：删除 ${deleted} 条（>${phDays}天）`)
      }
      const ehDays = this.deps.getEventHistoryDays()
      if (ehDays > 0) {
        const deleted = this.deps.db.deleteOldEventHistory(ehDays)
        if (deleted > 0) console.log(`[retention] 事件历史清理：删除 ${deleted} 条（>${ehDays}天）`)
      }
      const traceDays = this.deps.getLlmTraceDays?.() ?? 7
      if (traceDays > 0) {
        const deleted = this.deps.db.deleteOldTraces(traceDays)
        if (deleted > 0) console.log(`[retention] 运行日志清理：删除 ${deleted} 条（>${traceDays}天）`)
      }
    } catch (err) {
      console.warn('[retention] 清理失败:', err)
    }
  }
}

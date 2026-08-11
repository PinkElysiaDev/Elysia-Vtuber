/**
 * 触发器系统 - 决定何时触发 LLM 请求
 */

import type { Context } from 'koishi'
import type {
  StandardEvent,
  TriggerConfig,
  TriggerSystemConfig,
  ImmediateTrigger,
  DebounceTrigger
} from './types'

export interface TriggerContext {
  events: StandardEvent[]
  primaryEvent?: StandardEvent
}

export class TriggerSystem {
  private ctx: Context
  private config: TriggerSystemConfig
  private listeners: Array<(context: TriggerContext) => void> = []
  private requestCount: number = 0
  private lastRequestTime: number = 0
  private errorCooldownUntil: number = 0

  // 延迟合并触发器的状态
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private debounceBatches: Map<string, StandardEvent[]> = new Map()

  constructor(ctx: Context, config: TriggerSystemConfig) {
    this.ctx = ctx
    this.config = config
  }

  /**
   * 处理事件
   */
  handleEvent(event: StandardEvent): void {
    // 检查限流
    if (!this.checkRateLimit()) {
      this.ctx.logger('vtuber').warn('触发器限流：已达到每分钟最大请求数')
      return
    }

    // 检查错误冷却
    if (Date.now() < this.errorCooldownUntil) {
      this.ctx.logger('vtuber').warn('触发器冷却中')
      return
    }

    // 遍历所有触发器
    for (const trigger of this.config.triggers) {
      if (!trigger.enabled) continue

      try {
        if (trigger.mode === 'immediate') {
          this.handleImmediateTrigger(trigger as ImmediateTrigger, event)
        } else if (trigger.mode === 'debounce') {
          this.handleDebounceTrigger(trigger as DebounceTrigger, event)
        }
      } catch (err) {
        this.ctx.logger('vtuber').error(`触发器 ${trigger.name} 执行失败`, err)
      }
    }
  }

  /**
   * 添加触发监听器
   */
  addListener(listener: (context: TriggerContext) => void): void {
    this.listeners.push(listener)
  }

  /**
   * 移除触发监听器
   */
  removeListener(listener: (context: TriggerContext) => void): void {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }

  /**
   * 报告错误（触发冷却）
   */
  reportError(): void {
    this.errorCooldownUntil = Date.now() + this.config.rateLimit.cooldownAfterError
    this.ctx.logger('vtuber').warn(
      `触发器进入冷却期 ${this.config.rateLimit.cooldownAfterError}ms`
    )
  }

  /**
   * 处理立即触发
   */
  private handleImmediateTrigger(trigger: ImmediateTrigger, event: StandardEvent): void {
    // 检查事件类型是否匹配
    if (!trigger.eventTypes.includes(event.type)) {
      return
    }

    // 立即触发
    this.fireTrigger({
      events: [event],
      primaryEvent: event
    })
  }

  /**
   * 处理延迟合并触发
   */
  private handleDebounceTrigger(trigger: DebounceTrigger, event: StandardEvent): void {
    // 检查事件类型是否匹配
    if (!trigger.eventTypes.includes(event.type)) {
      return
    }

    const triggerId = trigger.id

    // 获取当前批次
    let batch = this.debounceBatches.get(triggerId)
    if (!batch) {
      batch = []
      this.debounceBatches.set(triggerId, batch)
    }

    // 添加事件到批次
    batch.push(event)

    // 清除旧的定时器
    const oldTimer = this.debounceTimers.get(triggerId)
    if (oldTimer) {
      clearTimeout(oldTimer)
    }

    // 检查是否达到最大批次数量
    if (batch.length >= trigger.maxBatch) {
      // 立即触发
      this.fireDebounceTrigger(triggerId)
      return
    }

    // 设置新的延迟定时器
    const timer = setTimeout(() => {
      this.fireDebounceTrigger(triggerId)
    }, trigger.delay)

    this.debounceTimers.set(triggerId, timer)
  }

  /**
   * 触发延迟合并触发器
   */
  private fireDebounceTrigger(triggerId: string): void {
    const batch = this.debounceBatches.get(triggerId)
    if (!batch || batch.length === 0) return

    // 触发
    this.fireTrigger({
      events: [...batch],
      primaryEvent: batch[batch.length - 1]
    })

    // 清理
    this.debounceBatches.delete(triggerId)
    this.debounceTimers.delete(triggerId)
  }

  /**
   * 执行触发
   */
  private fireTrigger(context: TriggerContext): void {
    // 通知所有监听器
    for (const listener of this.listeners) {
      try {
        listener(context)
      } catch (err) {
        this.ctx.logger('vtuber').error('触发器监听器执行失败', err)
      }
    }

    // 更新请求计数
    this.requestCount++
    this.lastRequestTime = Date.now()
  }

  /**
   * 检查限流
   */
  private checkRateLimit(): boolean {
    const now = Date.now()
    const { maxRequestsPerMinute } = this.config.rateLimit

    // 重置计数（每分钟）
    if (now - this.lastRequestTime > 60000) {
      this.requestCount = 0
    }

    return this.requestCount < maxRequestsPerMinute
  }

  /**
   * 停止所有触发器
   */
  dispose(): void {
    // 清除所有定时器
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
    this.debounceBatches.clear()
    this.listeners = []
  }
}

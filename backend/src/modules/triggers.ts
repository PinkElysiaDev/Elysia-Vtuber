import type { TriggerConfig } from '../config'
import { cronMatches, cronMinuteKey } from '../core/cron'
import type { StandardEvent } from './events'

export interface TriggerFire {
  rule: TriggerConfig
  events: StandardEvent[]
  reason: 'immediate' | 'debounce' | 'cross-merge' | 'scheduled' | 'manual' | 'max-batch'
}

export type TriggerCallback = (fire: TriggerFire) => void | Promise<void>

interface PendingBatch {
  events: StandardEvent[]
  deadline: number
}

const TICK_MS = 50

export class TriggerEngine {
  private rules: TriggerConfig[] = []
  private batches = new Map<string, PendingBatch>()
  private cronLast = new Map<string, string>()
  private timer: NodeJS.Timeout | null = null
  private callback: TriggerCallback | null = null
  private running = false

  configure(rules: TriggerConfig[]): void {
    this.rules = rules.map((rule) => ({ ...rule, eventTypes: [...rule.eventTypes], mergeEvents: [...rule.mergeEvents], actions: [...rule.actions] }))
  }

  getRules(): TriggerConfig[] {
    return this.rules
  }

  setCallback(callback: TriggerCallback): void {
    this.callback = callback
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.batches.clear()
  }

  pending(): Array<{ id: string; count: number; deadline: number }> {
    return [...this.batches.entries()].map(([id, batch]) => ({
      id,
      count: batch.events.length,
      deadline: batch.deadline,
    }))
  }

  handleEvent(event: StandardEvent): void {
    const now = Date.now()
    for (const rule of this.rules) {
      if (!rule.enabled) continue
      if (rule.mode === 'scheduled') continue
      if (rule.mode === 'immediate') {
        if (matchesTypes(rule.eventTypes, event.type)) {
          this.fire(rule, [event], 'immediate')
        }
        continue
      }
      if (rule.mode === 'debounce') {
        if (!matchesTypes(rule.eventTypes, event.type)) continue
        this.push(rule, event, now, true)
        continue
      }
      if (rule.mode === 'cross-merge') {
        if (matchesTypes(rule.eventTypes, event.type)) {
          this.push(rule, event, now, true)
        } else if (matchesTypes(rule.mergeEvents, event.type) && this.batches.has(rule.id)) {
          this.push(rule, event, now, false)
        }
      }
    }
  }

  fireById(id: string, events: StandardEvent[] = []): boolean {
    const rule = this.rules.find((item) => item.id === id)
    if (!rule) return false
    const pending = this.batches.get(id)
    const batch = events.length ? events : (pending?.events ?? [])
    this.batches.delete(id)
    this.fire(rule, batch, 'manual')
    return true
  }

  private push(rule: TriggerConfig, event: StandardEvent, now: number, resetDeadline: boolean): void {
    const existing = this.batches.get(rule.id)
    const events = existing ? existing.events : []
    events.push(event)
    const delay = Math.max(0, rule.delayMs)
    const deadline = resetDeadline || !existing ? now + delay : existing.deadline
    if (rule.maxBatch > 0 && events.length >= rule.maxBatch) {
      this.batches.delete(rule.id)
      this.fire(rule, events, 'max-batch')
      return
    }
    this.batches.set(rule.id, { events, deadline })
  }

  private tick(): void {
    const now = Date.now()
    for (const [id, batch] of [...this.batches.entries()]) {
      if (now < batch.deadline) continue
      const rule = this.rules.find((item) => item.id === id)
      this.batches.delete(id)
      if (rule && rule.enabled && batch.events.length) {
        this.fire(rule, batch.events, rule.mode === 'cross-merge' ? 'cross-merge' : 'debounce')
      }
    }
    this.tickCron(new Date(now))
  }

  private tickCron(date: Date): void {
    const key = cronMinuteKey(date)
    for (const rule of this.rules) {
      if (!rule.enabled || rule.mode !== 'scheduled' || !rule.cron) continue
      if (!cronMatches(rule.cron, date)) continue
      if (this.cronLast.get(rule.id) === key) continue
      this.cronLast.set(rule.id, key)
      this.fire(rule, [], 'scheduled')
    }
  }

  private fire(rule: TriggerConfig, events: StandardEvent[], reason: TriggerFire['reason']): void {
    if (!this.callback) return
    void Promise.resolve(this.callback({ rule, events, reason })).catch((err) => {
      console.error(`[trigger] ${rule.id} callback failed:`, err)
    })
  }
}

function matchesTypes(types: string[], type: string): boolean {
  return types.length === 0 || types.includes(type)
}

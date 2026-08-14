import type { StandardEvent } from '../modules/events'

export class EventHistory {
  private items: StandardEvent[] = []

  constructor(private readonly max = 100) {}

  push(event: StandardEvent): void {
    this.items.push(event)
    if (this.items.length > this.max) {
      this.items.splice(0, this.items.length - this.max)
    }
  }

  recent(n = 20): StandardEvent[] {
    if (n <= 0) return []
    return this.items.slice(-n)
  }

  clear(): void {
    this.items = []
  }

  get size(): number {
    return this.items.length
  }
}

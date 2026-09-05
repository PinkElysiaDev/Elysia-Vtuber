/**
 * 短期自我记忆：环形缓冲"我最近说过什么"。
 * 注入上下文清单后，模型可以避免重复感谢同一个人、重复玩同一个梗、保持话题连贯。
 * 长期记忆不在此实现——接入记忆类 MCP 服务器即可扩展（工具对模型自动可用）。
 */

export interface MemoryEntry {
  ts: number
  /** 一次发言的文本摘要（各通道内容拼接） */
  text: string
}

export class SelfMemory {
  private items: MemoryEntry[] = []

  constructor(private readonly max = 20) {}

  /** 记录一次自己的发言（空文本忽略） */
  record(text: string): void {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return
    this.items.push({ ts: Date.now(), text: trimmed })
    if (this.items.length > this.max) {
      this.items.splice(0, this.items.length - this.max)
    }
  }

  recent(n = this.max): MemoryEntry[] {
    if (n <= 0) return []
    return this.items.slice(-n)
  }

  count(): number {
    return this.items.length
  }

  /** 渲染为清单块内容；无记录返回空字符串 */
  format(n = 8): string {
    const items = this.recent(n)
    if (!items.length) return ''
    return items.map((item) => `- ${clock(item.ts)} ${item.text}`).join('\n')
  }
}

function clock(ts: number): string {
  const d = new Date(ts)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

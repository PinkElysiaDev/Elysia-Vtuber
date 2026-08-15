import type { OutputConfig } from '../config'
import type { StandardEvent } from './events'
import { formatEvent } from '../core/variables'

export type ReplyMethod = 'danmaku' | 'display' | 'tts'

export interface ReplySegment {
  method: ReplyMethod
  text: string
  displayStyle?: string
  emotion?: string
}

export interface OutputRouterDeps {
  getConfig: () => OutputConfig
  getRoomId: () => string
  sendDanmaku: (text: string, roomId: string) => void
  displayText: (text: string, style: string, emotion: string) => void
  speak: (text: string) => void
}

export class OutputRouter {
  private danmakuTimes: number[] = []

  constructor(private readonly deps: OutputRouterDeps) {}

  async route(segments: ReplySegment[]): Promise<{ sent: number; skipped: number }> {
    let sent = 0
    let skipped = 0
    for (const segment of segments) {
      const text = String(segment.text ?? '').trim()
      if (!text) {
        skipped++
        continue
      }
      const ok = await this.dispatch(segment.method, text, segment)
      if (ok) sent++
      else skipped++
    }
    return { sent, skipped }
  }

  routeContent(content: string): Promise<{ sent: number; skipped: number }> {
    return this.route(parseReplyContent(content))
  }

  private async dispatch(method: ReplyMethod, text: string, segment: ReplySegment): Promise<boolean> {
    const config = this.deps.getConfig()
    if (method === 'danmaku') {
      if (!config.danmaku.enabled) return false
      if (!this.allowDanmaku(config.danmaku.ratePerMinute)) return false
      this.deps.sendDanmaku(text, this.deps.getRoomId())
      return true
    }
    if (method === 'display') {
      if (!config.display.enabled) return false
      this.deps.displayText(text, segment.displayStyle || config.display.style, segment.emotion || 'neutral')
      return true
    }
    if (method === 'tts') {
      if (!config.tts.enabled) return false
      const delay = config.tts.delayBeforeSpeakMs
      if (delay > 0) await sleep(delay)
      this.deps.speak(text)
      return true
    }
    return false
  }

  private allowDanmaku(ratePerMinute: number): boolean {
    const now = Date.now()
    this.danmakuTimes = this.danmakuTimes.filter((t) => now - t < 60_000)
    if (ratePerMinute > 0 && this.danmakuTimes.length >= ratePerMinute) return false
    this.danmakuTimes.push(now)
    return true
  }
}

export function parseReplyContent(content: string): ReplySegment[] {
  const trimmed = content.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.segments)) {
      return normalizeSegments(parsed.segments)
    }
    if (Array.isArray(parsed)) return normalizeSegments(parsed)
  } catch {
    // fall through to unstructured
  }
  return [
    { method: 'display', text: trimmed },
  ]
}

export function normalizeSegments(raw: unknown): ReplySegment[] {
  if (!Array.isArray(raw)) return parseReplyContent(typeof raw === 'string' ? raw : '')
  const out: ReplySegment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const text = String(rec.text ?? '')
    const method = rec.method === 'display' || rec.method === 'tts' ? rec.method : 'danmaku'
    out.push({
      method,
      text,
      displayStyle: rec.displayStyle ? String(rec.displayStyle) : undefined,
      emotion: rec.emotion ? String(rec.emotion) : undefined,
    })
  }
  return out
}

export function defaultUserPrompt(events: StandardEvent[]): string {
  if (!events.length) return '现在没有新的直播间事件。请按需要主动互动或执行定时动作。'
  return `以下是刚收到的直播间事件，请用 send_reply 回复：\n${events.map(formatEvent).join('\n')}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

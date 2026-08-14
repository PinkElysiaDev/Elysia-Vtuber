import type { StandardEvent } from '../modules/events'

export interface VariableContext {
  events: StandardEvent[]
  history: StandardEvent[]
  roomId: string
  extra?: Record<string, unknown>
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g

export function expandTemplate(template: string, ctx: VariableContext): string {
  if (!template) return ''
  return template.replace(TOKEN, (_, raw: string) => {
    const value = resolveToken(raw.trim(), ctx)
    return stringify(value)
  })
}

export function expandArgs(
  args: Record<string, unknown> | undefined,
  ctx: VariableContext,
): Record<string, unknown> {
  if (!args) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') out[key] = expandTemplate(value, ctx)
    else out[key] = value
  }
  return out
}

export function formatEvent(event: StandardEvent): string {
  const name = event.user?.name || event.user?.uid || '匿名'
  const data = event.data ?? {}
  switch (event.type) {
    case 'danmaku':
      return `[弹幕] ${name}: ${data.content ?? data.msg ?? data.message ?? ''}`
    case 'gift':
      return `[礼物] ${name} 送出 ${data.giftName ?? '礼物'} x${data.num ?? 1}`
    case 'superchat':
      return `[SC] ${name} ¥${data.price ?? 0}: ${data.message ?? data.content ?? ''}`
    case 'enter':
      return `[进入] ${name}`
    case 'follow':
      return `[关注] ${name}`
    case 'like':
      return `[点赞] ${name} x${data.count ?? 1}`
    case 'guard':
      return `[上舰] ${name} 等级${data.guardLevel ?? event.user?.guardLevel ?? '?'} x${data.num ?? 1}`
    case 'liveStart':
      return `[开播] ${data.title ?? ''} ${data.areaName ?? ''}`.trim()
    case 'liveEnd':
      return '[下播]'
    default:
      return `[${event.type}] ${name} ${safeJson(data)}`
  }
}

export function formatEvents(events: StandardEvent[]): string {
  if (!events.length) return '（无）'
  return events.map(formatEvent).join('\n')
}

function resolveToken(token: string, ctx: VariableContext): unknown {
  if (token === 'now') return formatNow(new Date())
  if (token === 'now:iso') return new Date().toISOString()
  if (token === 'roomId') return ctx.roomId
  if (token === 'eventCount') return ctx.events.length
  if (token === 'events') return formatEvents(ctx.events)
  if (token === 'history') return formatEvents(ctx.history)

  const last = ctx.events[ctx.events.length - 1]
  if (token === 'type') return last?.type ?? ''
  if (token === 'user') return last?.user?.name || last?.user?.uid || ''
  if (token === 'content') {
    return last?.data?.content ?? last?.data?.message ?? last?.data?.msg ?? ''
  }

  if (token.startsWith('event.')) {
    return getByPath(last ?? {}, token.slice('event.'.length))
  }
  if (token.startsWith('extra.')) {
    return getByPath(ctx.extra ?? {}, token.slice('extra.'.length))
  }
  if (ctx.extra && token in ctx.extra) return ctx.extra[token]
  return ''
}

function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return safeJson(value)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatNow(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

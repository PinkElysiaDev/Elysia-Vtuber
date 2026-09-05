import type { StandardEvent } from '../modules/events'
import type { VariableSettings } from '../config'
import { catalogLabel } from './event-catalog'

export interface VariableContext {
  events: StandardEvent[]
  history: StandardEvent[]
  roomId: string
  extra?: Record<string, unknown>
  /** 覆盖 {{now}} 的预格式化文本（按用户设置生成；缺省用默认格式） */
  nowText?: string
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
  const { label, text } = describeEvent(event)
  return `[${label}] ${text}`
}

/**
 * 事件 → { 分类标签, 正文 }。全量覆盖事件目录（直播间 + 系统后台事件），
 * 是上下文清单与 {{events}} 变量的唯一格式化出口。
 */
export function describeEvent(event: StandardEvent): { label: string; text: string } {
  const name = event.user?.name || event.user?.uid || ''
  const data = event.data ?? {}
  switch (event.type) {
    case 'danmaku':
      return { label: '弹幕', text: `${name}: ${data.content ?? data.msg ?? data.message ?? ''}` }
    case 'gift':
      return { label: '礼物', text: `${name} 送出 ${data.giftName ?? '礼物'} x${data.num ?? 1}` }
    case 'superchat':
      return { label: 'SC', text: `${name} ¥${data.price ?? 0}: ${data.message ?? data.content ?? ''}` }
    case 'enter':
      return { label: '进入', text: `${name} 进入直播间` }
    case 'follow':
      return { label: '关注', text: `${name} 关注了主播` }
    case 'like':
      return { label: '点赞', text: `${name} 点了赞 x${data.count ?? 1}` }
    case 'guard':
      return { label: '上舰', text: `${name} 开通${data.guardName ?? guardNameOf(data.guardLevel ?? event.user?.guardLevel)} x${data.num ?? 1}` }
    case 'liveStart':
      return { label: '开播', text: `直播开始 ${data.title ?? ''} ${data.areaName ?? ''}`.trim() }
    case 'liveEnd':
      return { label: '下播', text: '直播结束' }
    case 'online':
      return { label: '在线', text: `当前在线 ${data.count ?? 0} 人` }
    case 'watchedChange':
      return { label: '看过', text: `累计 ${data.count ?? 0} 人看过` }
    // ===== 系统后台事件（主播视角的后台日志） =====
    case 'system.live2d.connected':
      return { label: 'Live2D', text: '执行器已连接' }
    case 'system.live2d.disconnected':
      return { label: 'Live2D', text: '执行器连接断开' }
    case 'system.live2d.loaded':
      return { label: 'Live2D', text: `模型加载完成: ${data.model ?? ''}` }
    case 'system.live2d.loadFailed':
      return { label: 'Live2D', text: `模型加载失败: ${data.model ?? ''} (${data.error ?? 'unknown'})` }
    case 'system.live2d.modelChanged':
      return { label: 'Live2D', text: `模型切换为 ${data.model ?? ''}` }
    case 'system.jukebox.playing':
      return { label: '点歌机', text: `开始播放《${data.title ?? '?'}》${data.artist ? ` - ${data.artist}` : ''}${data.userName ? `（${data.userName} 点）` : '（空闲歌单）'}` }
    case 'system.jukebox.added':
      return { label: '点歌机', text: `《${data.title ?? '?'}》已加入队列${data.position ? `（第${data.position}位）` : ''}${data.userName ? `，由 ${data.userName} 点` : ''}` }
    case 'system.jukebox.skipped':
      return { label: '点歌机', text: `《${data.title ?? '?'}》被切过${data.by ? `（${data.by} 操作）` : ''}` }
    case 'system.jukebox.restarted':
      return { label: '点歌机', text: `点歌机重启（${data.preserveQueue ? '保留队列' : '清空队列'}）` }
    case 'system.command.executed':
      return { label: '指令', text: `${name || data.userName || '观众'} 的「${data.keyword ?? data.command ?? ''}」已执行: ${data.ok === false ? `失败（${data.message ?? ''}）` : (data.message ?? '完成')}` }
    case 'system.instant.sent': {
      const sent = Number(data.sent ?? 0)
      const skipped = Number(data.skipped ?? 0)
      const base = `规则「${data.rule ?? ''}」`
      if (data.action === 'llm') return { label: '即时应对', text: `${base}调用llm立即回应` }
      if (data.action === 'run-ability') return { label: '即时应对', text: `${base}调用了工具${data.ok === false ? '（失败）' : ''}` }
      // send-text：sent=0 说明全部通道被跳过（禁用/限流），不能报"已回复"
      return { label: '即时应对', text: sent > 0 ? `${base}自动回复: ${data.text ?? ''}` : `${base}回复被跳过（${skipped} 个通道未发出）: ${data.text ?? ''}` }
    }
    default: {
      // 未登记类型：目录标签兜底 + JSON 明细
      const label = catalogLabel(event.type)
      const text = name ? `${name} ${safeJson(data)}` : safeJson(data)
      return { label, text }
    }
  }
}

/** 上下文清单行：主播视角日志样式 `[HH:mm:ss] 分类 | 内容` */
export function formatFeedLine(event: StandardEvent): string {
  const { label, text } = describeEvent(event)
  return `[${formatClock(event.timestamp)}] ${label} | ${text}`
}

function guardNameOf(level: unknown): string {
  if (level === 1) return '总督'
  if (level === 2) return '提督'
  if (level === 3) return '舰长'
  return `等级${level ?? '?'}`
}

function formatClock(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatEvents(events: StandardEvent[]): string {
  if (!events.length) return '（无）'
  return events.map(formatEvent).join('\n')
}

function resolveToken(token: string, ctx: VariableContext): unknown {
  if (token === 'now') return ctx.nowText ?? formatNow(new Date())
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
  // {{user.name}} / {{user.uid}} / {{user.fansMedal.level}} 等点路径（最后一条事件的用户信息）
  if (token.startsWith('user.')) {
    return getByPath(last?.user ?? {}, token.slice('user.'.length))
  }
  // {{message}} / {{ok}} 等规则回执变量（由指令/即时规则注入 extra）
  if (token.startsWith('extra.')) {
    return getByPath(ctx.extra ?? {}, token.slice('extra.'.length))
  }
  if (ctx.extra && token in ctx.extra) return ctx.extra[token]
  if (token.startsWith('event.')) {
    return getByPath(last ?? {}, token.slice('event.'.length))
  }
  // 事件专属变量（{{gift.name}} / {{sc.price}} / {{song.title}} / {{match.1}}…）
  if (ctx.extra) {
    const v = getByPath(ctx.extra, token)
    if (v !== undefined) return v
  }
  return ''
}

/**
 * 事件专属变量表（即时应对/指令回执模板的变量矩阵）：
 * 通用 {{user.*}}；弹幕 {{content}}/{{match.N}}；礼物 {{gift.*}}；SC {{sc.*}}；
 * 点赞 {{like.count}}；上舰 {{guard.*}}；开播 {{live.*}}；在线/看过 {{online.count}}/{{watched.count}}；
 * 点歌成功/播放 {{song.*}}；切歌 {{song.*}}/{{skip.by}}；指令执行 {{command.*}}
 */
export function eventVariables(event: StandardEvent, match?: RegExpMatchArray | null): Record<string, unknown> {
  const data = event.data ?? {}
  const extra: Record<string, unknown> = {}
  if (event.user) {
    extra.user = {
      uid: event.user.uid,
      name: event.user.name,
      fansMedal: event.user.fansMedal,
      guardLevel: event.user.guardLevel,
    }
  }
  switch (event.type) {
    case 'danmaku':
      extra.content = String(data.content ?? data.msg ?? data.message ?? '')
      if (match) {
        const groups: Record<string, string> = {}
        for (let i = 1; i < match.length; i++) groups[String(i)] = match[i] ?? ''
        extra.match = groups
      }
      break
    case 'gift': {
      const price = Number(data.price ?? 0)
      const totalPrice = Number(data.totalPrice ?? price)
      extra.gift = {
        name: String(data.giftName ?? '礼物'),
        num: Number(data.num ?? 1),
        price,
        totalPrice,
        // 金瓜子 → 元（1元 = 1000 金瓜子）
        priceYuan: Math.round(price / 10) / 100,
        totalPriceYuan: Math.round(totalPrice / 10) / 100,
        coinType: data.coinType,
      }
      break
    }
    case 'superchat':
      extra.sc = { price: Number(data.price ?? 0), message: String(data.message ?? data.content ?? '') }
      extra.content = String(data.message ?? data.content ?? '')
      break
    case 'like':
      extra.like = { count: Number(data.count ?? 1) }
      break
    case 'guard':
      extra.guard = {
        level: Number(data.guardLevel ?? event.user?.guardLevel ?? 0),
        name: String(data.guardName ?? ''),
        num: Number(data.num ?? 1),
      }
      break
    case 'liveStart':
      extra.live = { title: String(data.title ?? ''), areaName: String(data.areaName ?? '') }
      break
    case 'online':
      extra.online = { count: Number(data.count ?? 0) }
      break
    case 'watchedChange':
      extra.watched = { count: Number(data.count ?? 0) }
      break
    case 'system.jukebox.added':
    case 'system.jukebox.playing':
      extra.song = {
        title: String(data.title ?? ''),
        artist: String(data.artist ?? ''),
        source: String(data.source ?? ''),
        userName: String(data.userName ?? ''),
        position: Number(data.position ?? 0),
      }
      break
    case 'system.jukebox.skipped':
      extra.song = { title: String(data.title ?? '') }
      extra.skip = { by: String(data.by ?? '') }
      break
    case 'system.command.executed':
      extra.command = {
        id: String(data.command ?? ''),
        ok: data.ok !== false,
        message: String(data.message ?? ''),
      }
      break
    default:
      break
  }
  return extra
}

/** 为事件构建模板展开上下文（即时应对/指令回执共用） */
export function expandCtxFor(
  event: StandardEvent,
  roomId: string,
  extraVars: Record<string, unknown> = {},
  match?: RegExpMatchArray | null,
): VariableContext {
  return {
    events: [event],
    history: [event],
    roomId,
    extra: { ...eventVariables(event, match), ...extraVars },
  }
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

/**
 * 按用户设置格式化 {{now}}：
 * 模板优先（YYYY MM DD HH mm ss 占位）；否则按详细程度；时区 local/utc/offset 应用偏移。
 */
export function formatNowCustom(settings: VariableSettings['now'], date = new Date()): string {
  const tz = settings?.timezone ?? 'local'
  let shifted = date
  if (tz === 'utc') {
    shifted = new Date(date.getTime() + date.getTimezoneOffset() * 60_000)
  } else if (tz === 'offset') {
    const hours = Number.isFinite(settings?.offsetHours) ? Number(settings.offsetHours) : 0
    shifted = new Date(date.getTime() + (date.getTimezoneOffset() + hours * 60) * 60_000)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const parts = {
    YYYY: String(shifted.getFullYear()),
    MM: pad(shifted.getMonth() + 1),
    DD: pad(shifted.getDate()),
    HH: pad(shifted.getHours()),
    mm: pad(shifted.getMinutes()),
    ss: pad(shifted.getSeconds()),
  }
  const template = (settings?.template ?? '').trim()
  if (template) {
    return template.replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => parts[m as keyof typeof parts] ?? m)
  }
  const dateStr = `${parts.YYYY}-${parts.MM}-${parts.DD}`
  const timeStr = `${parts.HH}:${parts.mm}:${parts.ss}`
  const detail = settings?.detail ?? 'datetime'
  if (detail === 'date') return dateStr
  if (detail === 'time') return timeStr
  return `${dateStr} ${timeStr}`
}

import type { Context } from 'koishi'
import type { Config } from './config'
import { BackendClient } from './backend-client'

export interface StandardEvent {
  type: string
  timestamp: number
  roomId: string
  user?: {
    uid: string
    name: string
    face?: string
    fansMedal?: {
      name: string
      level: number
    }
    guardLevel?: number
  }
  data: Record<string, unknown>
}

export class EventBridge {
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly backend: BackendClient,
  ) {}

  start(): void {
    const enabled = this.config.events
    const roomId = String(this.config.roomId)

    const bind = (eventName: string, normalize: (session: any) => StandardEvent) => {
      this.ctx.on(eventName as any, (session: any) => {
        if (String(session.roomId ?? session.room_id ?? '') !== roomId) return
        const event = normalize(session)
        this.backend.request('event.ingest', { roomId, event }).catch((error) => {
          this.ctx.logger('vtuber').warn(`failed to ingest ${event.type}:`, error)
        })
      })
    }

    const bindings: Array<[keyof typeof enabled, string, (s: any) => Record<string, unknown>]> = [
      ['danmaku', 'bililive/danmaku', (s) => ({ content: s.content ?? s.msg ?? s.message ?? '' })],
      ['gift', 'bililive/gift', (s) => ({
        giftName: s.giftName ?? s.gift_name,
        // giftNum 是 web 模式连击合并后的总数，优先于单批数量
        num: s.giftNum ?? s.num ?? s.gift_num,
        price: s.price,
        totalPrice: s.totalPrice ?? s.price,
        coinType: s.coinType,
        paid: s.paid,
      })],
      ['superchat', 'bililive/superchat', (s) => ({ price: s.price ?? s.rmb, message: s.message ?? s.content ?? s.msg ?? '' })],
      ['enter', 'bililive/enter', () => ({})],
      ['follow', 'bililive/follow', () => ({})],
      // 开放平台点赞字段为 like_count
      ['like', 'bililive/like', (s) => ({ count: s.likeCount ?? s.like_count ?? s.count ?? 1 })],
      // 开放平台数量字段为 guard_num，web 模式为 num
      ['guard', 'bililive/guard', (s) => ({
        guardLevel: s.guardLevel ?? s.guard_level,
        guardName: s.guard_name,
        num: s.guard_num ?? s.num ?? s.gift_num ?? 1,
        price: s.price,
      })],
      ['liveStart', 'bililive/live-start', (s) => ({ title: s.title, areaName: s.areaName ?? s.area_name })],
      ['liveEnd', 'bililive/live-end', () => ({})],
    ]

    for (const [flag, eventName, mapper] of bindings) {
      if (enabled[flag]) bind(eventName, (s) => this.standard(s, flag as string, mapper(s)))
    }
  }

  private standard(session: any, type: string, data: Record<string, unknown>): StandardEvent {
    // 开放平台 guard 事件的用户信息嵌在 user_info 里；web 模式用 medalName/medalLevel
    const uid = String(session.userId ?? session.uid ?? session.user_info?.uid ?? session.open_id ?? '')
    const name = session.username || session.userName || session.uname || session.user_info?.uname || session.user?.name || ''
    return {
      type,
      timestamp: Date.now(),
      roomId: String(session.roomId ?? session.room_id ?? this.config.roomId),
      user: uid ? {
        uid,
        name,
        face: session.userFace || session.uface || session.user_info?.uface || session.user?.avatar,
        fansMedal: (session.fansMedal || session.fans_medal_name || session.medalName) ? {
          name: session.fansMedal?.name ?? session.fans_medal_name ?? session.medalName ?? '',
          level: session.fansMedal?.level ?? session.fans_medal_level ?? session.medalLevel ?? 0,
        } : undefined,
        guardLevel: session.guardLevel ?? session.guard_level,
      } : undefined,
      data,
    }
  }
}

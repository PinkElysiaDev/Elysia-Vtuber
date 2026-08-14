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

    if (enabled.danmaku) {
      bind('bililive/danmaku', (s) => this.standard(s, 'danmaku', {
        content: s.content ?? s.msg ?? s.message ?? '',
      }))
    }

    if (enabled.gift) {
      bind('bililive/gift', (s) => this.standard(s, 'gift', {
        giftName: s.giftName ?? s.gift_name,
        num: s.num ?? s.gift_num,
        price: s.price,
        totalPrice: s.totalPrice ?? s.price,
        coinType: s.coinType,
        paid: s.paid,
      }))
    }

    if (enabled.superchat) {
      bind('bililive/superchat', (s) => this.standard(s, 'superchat', {
        price: s.price ?? s.rmb,
        message: s.message ?? s.content ?? s.msg ?? '',
      }))
    }

    if (enabled.enter) {
      bind('bililive/enter', (s) => this.standard(s, 'enter', {}))
    }

    if (enabled.follow) {
      bind('bililive/follow', (s) => this.standard(s, 'follow', {}))
    }

    if (enabled.like) {
      bind('bililive/like', (s) => this.standard(s, 'like', {
        count: s.likeCount ?? s.count ?? 1,
      }))
    }

    if (enabled.guard) {
      bind('bililive/guard', (s) => this.standard(s, 'guard', {
        guardLevel: s.guardLevel ?? s.guard_level,
        num: s.num ?? s.gift_num ?? 1,
        price: s.price,
      }))
    }

    if (enabled.liveStart) {
      bind('bililive/live-start', (s) => this.standard(s, 'liveStart', {
        title: s.title,
        areaName: s.areaName ?? s.area_name,
      }))
    }

    if (enabled.liveEnd) {
      bind('bililive/live-end', (s) => this.standard(s, 'liveEnd', {}))
    }
  }

  private standard(session: any, type: string, data: Record<string, unknown>): StandardEvent {
    const uid = String(session.userId ?? session.uid ?? session.open_id ?? '')
    const name = session.username || session.userName || session.uname || session.user?.name || ''
    return {
      type,
      timestamp: Date.now(),
      roomId: String(session.roomId ?? session.room_id ?? this.config.roomId),
      user: uid ? {
        uid,
        name,
        face: session.userFace || session.uface || session.user?.avatar,
        fansMedal: (session.fansMedal || session.fans_medal_name) ? {
          name: session.fansMedal?.name ?? session.fans_medal_name ?? '',
          level: session.fansMedal?.level ?? session.fans_medal_level ?? 0,
        } : undefined,
        guardLevel: session.guardLevel ?? session.guard_level,
      } : undefined,
      data,
    }
  }
}

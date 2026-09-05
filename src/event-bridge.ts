import type { Context, Logger } from 'koishi'
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

/**
 * satori Session 只代理固定字段清单（type/userId/channelId/guildId...），
 * adapter dispatchCustom 附加的 roomId 以及原始载荷（msg/uname/gift_name/room_id...）
 * 都存在 session.event 内部。这里做合并视图：顶层访问器优先，原始字段兜底。
 */
function mergedView(session: any): any {
  return { ...(session?.event ?? {}), ...session }
}

/** 房间号候选（含 "live:<roomId>" 形式的 channelId），任一命中即本房间 */
function roomMatched(view: any, roomId: string): boolean {
  const candidates = [
    view?.roomId,
    view?.room_id,
    typeof view?.channelId === 'string' && view.channelId.startsWith('live:')
      ? view.channelId.slice(5)
      : typeof view?.channel?.id === 'string' && view.channel.id.startsWith('live:')
        ? view.channel.id.slice(5)
        : undefined,
  ]
  return candidates.some((value) => String(value ?? '') === roomId)
}

const DISCONNECT_QUEUE_MAX = 100

export class EventBridge {
  private lastMismatchLogAt = 0
  /** 断线期间的事件队列（重连后批量补发，上限 100 条防内存膨胀） */
  private disconnectQueue: Array<{ roomId: string; event: StandardEvent }> = []

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly backend: BackendClient,
    private readonly logger: Logger,
  ) {}

  /** 重连成功后补发断线期间积压的事件（上限 100 条，超出部分丢弃并告警） */
  flushDisconnectQueue(): void {
    if (!this.disconnectQueue.length) return
    if (!this.backend.isConnected()) return
    const batch = this.disconnectQueue.splice(0, this.disconnectQueue.length)
    let sent = 0
    for (const { roomId, event } of batch) {
      this.backend.request('event.ingest', { roomId, event }).then(() => { sent++ }).catch((error) => {
        this.logger.warn(`failed to re-ingest ${event.type}:`, error)
      })
    }
    this.logger.info(`断线事件补发：${batch.length} 条（成功 ${sent}）`)
  }

  start(): void {
    const roomId = String(this.config.roomId)

    const bind = (eventName: string, normalize: (view: any) => StandardEvent) => {
      this.ctx.on(eventName as any, (session: any) => {
        const view = mergedView(session)
        if (!roomMatched(view, roomId)) {
          // 限频告警：房间不匹配是静默丢事件的头号原因，必须可见
          const now = Date.now()
          if (now - this.lastMismatchLogAt > 5 * 60 * 1000) {
            this.lastMismatchLogAt = now
            this.logger.warn(
              `事件被丢弃：房间不匹配（配置 roomId=${roomId}，事件候选=[${[view?.roomId, view?.room_id, view?.channelId].map((v) => String(v ?? '')).join(', ')}]）。` +
              '请核对插件 roomId 与 adapter-bililive 的房间号',
            )
          }
          return
        }
        const event = normalize(view)
        if (this.backend.isConnected()) {
          this.backend.request('event.ingest', { roomId, event }).catch((error) => {
            this.logger.warn(`failed to ingest ${event.type}:`, error)
          })
        } else {
          // 断线：入队等待重连补发
          if (this.disconnectQueue.length < DISCONNECT_QUEUE_MAX) {
            this.disconnectQueue.push({ roomId, event })
          }
        }
      })
    }

    // 全部 11 类事件无条件转发（9 类直播间互动 + online/watchedChange 聚合事件），
    // 是否接收/过滤由后端 events 配置统一决定
    const bindings: Array<[string, string, (s: any) => Record<string, unknown>]> = [
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
      // 在线人数（Web 连接模式心跳真值）与看过人数（累计，仅 Web 模式）
      ['online', 'bililive/online', (s) => ({ count: s.count })],
      ['watchedChange', 'bililive/watched-change', (s) => ({ count: s.count })],
    ]

    for (const [type, eventName, mapper] of bindings) {
      bind(eventName, (view) => this.standard(view, type, mapper(view)))
    }
  }

  private standard(view: any, type: string, data: Record<string, unknown>): StandardEvent {
    // 开放平台 guard 事件的用户信息嵌在 user_info 里；web 模式用 medalName/medalLevel
    // 开放平台 enter 等事件常以 uid=0 + open_id 标识用户：0 视为缺失，回退 open_id
    const rawUid = view.userId ?? view.uid ?? view.user_info?.uid ?? view.user?.id
    const uid = rawUid === 0 || rawUid === '0' || rawUid === undefined || rawUid === null
      ? String(view.open_id ?? '')
      : String(rawUid)
    const name = String(view.username || view.userName || view.uname || view.user_info?.uname || view.user?.name || '')
    const medalName = view.fansMedal?.name ?? view.fans_medal_name ?? view.medalName
    const medalLevel = view.fansMedal?.level ?? view.fans_medal_level ?? view.medalLevel
    return {
      type,
      timestamp: Date.now(),
      roomId: String(view.roomId ?? view.room_id ?? this.config.roomId),
      user: uid ? {
        uid,
        name,
        face: String(view.userFace || view.uface || view.user_info?.uface || view.user?.avatar || ''),
        fansMedal: medalName ? {
          name: String(medalName ?? ''),
          level: Number(medalLevel ?? 0),
        } : undefined,
        guardLevel: view.guardLevel ?? view.guard_level,
      } : undefined,
      data,
    }
  }
}

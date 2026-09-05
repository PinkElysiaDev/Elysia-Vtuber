/**
 * 事件接收模块
 * 接收 koishi 插件转发的标准化直播间事件，按配置过滤后：
 *  - 写入事件历史缓存（供变量系统使用）
 *  - 推送给触发器系统
 */

import type { RpcHandler } from '../core/rpc'
import type { EventReceiverConfig } from '../config'

export interface StandardEvent {
  type: string
  timestamp: number
  roomId: string
  user?: {
    uid: string
    name: string
    face?: string
    fansMedal?: { name: string; level: number }
    guardLevel?: number
  }
  data: Record<string, unknown>
}

export interface EventReceiverDeps {
  getConfig: () => EventReceiverConfig
  /** 事件入历史（由变量系统/历史缓存实现） */
  onEvent: (event: StandardEvent) => void
  /** 事件被过滤时回调（可观测性：区分"没收到"与"收到但被过滤"） */
  onFiltered?: (event: StandardEvent) => void
  /** SQLite 数据库（事件历史持久化） */
  db?: import('../core/database').VtuberDatabase
}

/** 事件类型白名单（已知类型；system.* 为内部后台事件，另有目录见 core/event-catalog.ts） */
export const KNOWN_EVENT_TYPES = [
  'danmaku', 'gift', 'superchat', 'enter', 'follow', 'like', 'guard', 'liveStart', 'liveEnd',
  'online', 'watchedChange',
] as const

export function buildEventModule(deps: EventReceiverDeps): Record<string, RpcHandler> {
  const passesFilter = (event: StandardEvent): boolean => {
    const cfg = deps.getConfig()
    // 总开关：一处阻断 历史记录/直接点歌/全部触发器
    if (cfg.enabled === false) return false
    const { enabledEvents, filters } = cfg
    const enabled = enabledEvents as Record<string, boolean>
    // 系统后台事件（system.*）由内部发射点控制，不受直播间事件白名单约束
    if (!String(event.type).startsWith('system.') && !enabled[event.type]) return false

    // 阈值过滤
    if (event.type === 'gift') {
      const price = Number(event.data?.price ?? event.data?.totalPrice ?? 0)
      if (filters.minGiftPrice > 0 && price < filters.minGiftPrice) return false
    }
    if (event.type === 'superchat') {
      const amount = Number(event.data?.price ?? 0)
      if (filters.minSuperchatAmount > 0 && amount < filters.minSuperchatAmount) return false
    }
    return true
  }

  return {
    'event.ingest': (params) => {
      const raw = (params as any)?.event
      if (!raw || typeof raw !== 'object') throw new Error('event.ingest requires { event }')
      const event = raw as StandardEvent
      event.timestamp = event.timestamp ?? Date.now()
      if (!passesFilter(event)) {
        deps.onFiltered?.(event)
        return { success: true, filtered: true, type: event.type }
      }
      deps.onEvent(event)
      return { success: true, filtered: false, type: event.type }
    },

    'event.batch': (params) => {
      const raw = (params as any)?.events
      if (!Array.isArray(raw)) throw new Error('event.batch requires { events: [] }')
      let accepted = 0
      let filtered = 0
      for (const item of raw as StandardEvent[]) {
        item.timestamp = item.timestamp ?? Date.now()
        if (passesFilter(item)) {
          deps.onEvent(item)
          accepted++
        } else {
          filtered++
          deps.onFiltered?.(item)
        }
      }
      return { success: true, accepted, filtered, batchSize: raw.length }
    },

    'event.history': (params) => {
      const rec = (params as any) ?? {}
      const limit = Math.max(1, Math.min(500, Number(rec.limit ?? 100)))
      const db = deps.db
      if (!db) return { events: [] }
      const rows = db.getEventHistory(limit, rec.before !== undefined ? Number(rec.before) : undefined)
      return { events: rows.map((r) => ({
        id: r.id,
        type: r.type,
        timestamp: r.timestamp,
        roomId: r.room_id,
        user: r.user_uid ? { uid: r.user_uid, name: r.user_name ?? '', face: r.user_face ?? undefined } : undefined,
        data: JSON.parse(r.data || '{}'),
      })) }
    },
    'event.simulate': (params) => {
      const raw = (params as any) ?? {}
      const type = String(raw.type || 'danmaku')
      const roomId = String(raw.roomId || '123456')
      const userName = String(raw.userName || raw.user?.name || '战术观察员')
      const userUid = String(raw.userUid || raw.user?.uid || '888888')

      const event: StandardEvent = {
        type,
        timestamp: Date.now(),
        roomId,
        user: {
          uid: userUid,
          name: userName,
          fansMedal: raw.fansMedal ? {
            name: String(raw.fansMedal.name || '舰长'),
            level: Number(raw.fansMedal.level || 10),
          } : undefined,
          guardLevel: raw.guardLevel ? Number(raw.guardLevel) : undefined,
        },
        data: raw.data && typeof raw.data === 'object' ? raw.data : {},
      }

      if (type === 'danmaku' && !event.data.content) {
        event.data.content = String(raw.content || raw.text || '主播好可爱！打卡打卡~')
      } else if (type === 'gift') {
        if (!event.data.giftName) event.data.giftName = String(raw.giftName || '小心心')
        if (!event.data.num) event.data.num = Number(raw.num || 10)
        if (!event.data.totalPrice) event.data.totalPrice = Number(raw.totalPrice || raw.price || 1000)
      } else if (type === 'superchat') {
        if (!event.data.message) event.data.message = String(raw.message || raw.content || '主播加油！今日份SC支持！')
        if (!event.data.price) event.data.price = Number(raw.price || 50)
      } else if (type === 'guard') {
        if (!event.data.guardLevel) event.data.guardLevel = Number(raw.guardLevel || 3)
        if (!event.data.guardName) event.data.guardName = event.data.guardLevel === 1 ? '总督' : event.data.guardLevel === 2 ? '提督' : '舰长'
      }

      const pass = passesFilter(event)
      if (pass) {
        deps.onEvent(event)
      }
      return { success: true, simulated: true, filtered: !pass, event }
    },
  }
}

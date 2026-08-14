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
}

/** 事件类型白名单（已知类型） */
export const KNOWN_EVENT_TYPES = [
  'danmaku', 'gift', 'superchat', 'enter', 'follow', 'like', 'guard', 'liveStart', 'liveEnd',
] as const

export function buildEventModule(deps: EventReceiverDeps): Record<string, RpcHandler> {
  const passesFilter = (event: StandardEvent): boolean => {
    const { enabledEvents, filters } = deps.getConfig()
    const enabled = enabledEvents as Record<string, boolean>
    if (!enabled[event.type]) return false

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
        }
      }
      return { success: true, accepted, filtered, batchSize: raw.length }
    },
  }
}

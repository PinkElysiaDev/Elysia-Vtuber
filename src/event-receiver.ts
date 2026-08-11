/**
 * 事件接收器 - 订阅 adapter-bililive 事件并标准化
 */

import type { Context } from 'koishi'
import type { StandardEvent, EventReceiverConfig } from './types'
import { EventCache } from './event-cache'

export class EventReceiver {
  private ctx: Context
  private config: EventReceiverConfig
  private eventCache: EventCache
  private roomId: string
  private listeners: Array<(event: StandardEvent) => void> = []

  constructor(
    ctx: Context,
    roomId: string,
    config: EventReceiverConfig,
    eventCache: EventCache
  ) {
    this.ctx = ctx
    this.roomId = roomId
    this.config = config
    this.eventCache = eventCache
  }

  /**
   * 启动事件接收
   */
  start(): void {
    const { enabledEvents } = this.config

    // 订阅弹幕事件
    if (enabledEvents.danmaku) {
      this.ctx.on('bililive/danmaku' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeDanmaku(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅礼物事件
    if (enabledEvents.gift) {
      this.ctx.on('bililive/gift' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeGift(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅醒目留言事件
    if (enabledEvents.superchat) {
      this.ctx.on('bililive/superchat' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeSuperchat(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅进入直播间事件
    if (enabledEvents.enter) {
      this.ctx.on('bililive/enter' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeEnter(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅关注事件
    if (enabledEvents.follow) {
      this.ctx.on('bililive/follow' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeFollow(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅点赞事件
    if (enabledEvents.like) {
      this.ctx.on('bililive/like' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeLike(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅上舰事件
    if (enabledEvents.guard) {
      this.ctx.on('bililive/guard' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeGuard(session)
        if (this.filterEvent(event)) {
          this.handleEvent(event)
        }
      })
    }

    // 订阅开播事件
    if (enabledEvents.liveStart) {
      this.ctx.on('bililive/live-start' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeLiveStart(session)
        this.handleEvent(event)
      })
    }

    // 订阅下播事件
    if (enabledEvents.liveEnd) {
      this.ctx.on('bililive/live-end' as any, (session) => {
        if (session.roomId !== this.roomId) return
        const event = this.normalizeLiveEnd(session)
        this.handleEvent(event)
      })
    }
  }

  /**
   * 添加事件监听器
   */
  addListener(listener: (event: StandardEvent) => void): void {
    this.listeners.push(listener)
  }

  /**
   * 移除事件监听器
   */
  removeListener(listener: (event: StandardEvent) => void): void {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }

  /**
   * 处理事件
   */
  private handleEvent(event: StandardEvent): void {
    // 添加到缓存
    this.eventCache.addEvent(event)

    // 通知所有监听器
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        this.ctx.logger('vtuber').error('事件监听器执行失败', err)
      }
    }
  }

  /**
   * 过滤事件
   */
  private filterEvent(event: StandardEvent): boolean {
    const { filters } = this.config

    // 礼物价格过滤
    if (event.type === 'gift' && filters.minGiftPrice) {
      const price = event.data?.totalPrice || 0
      if (price < filters.minGiftPrice) return false
    }

    // SC金额过滤
    if (event.type === 'superchat' && filters.minSuperchatAmount) {
      const amount = event.data?.price || 0
      if (amount < filters.minSuperchatAmount) return false
    }

    // 粉丝勋章等级过滤
    if (filters.minFansMedalLevel && event.user?.fansMedal) {
      if (event.user.fansMedal.level < filters.minFansMedalLevel) return false
    }

    // 舰长等级过滤
    if (filters.guardLevelFilter && event.user?.guardLevel) {
      if (!filters.guardLevelFilter.includes(event.user.guardLevel as any)) {
        return false
      }
    }

    return true
  }

  // ==================== 事件标准化方法 ====================

  private normalizeDanmaku(session: any): StandardEvent {
    return {
      type: 'danmaku',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username,
        fansMedal: session.fansMedal ? {
          name: session.fansMedal.name,
          level: session.fansMedal.level
        } : undefined,
        guardLevel: session.guardLevel
      },
      data: {
        content: session.content
      }
    }
  }

  private normalizeGift(session: any): StandardEvent {
    return {
      type: 'gift',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username,
        guardLevel: session.guardLevel
      },
      data: {
        giftName: session.giftName,
        num: session.num,
        price: session.price,
        totalPrice: session.totalPrice,
        coinType: session.coinType
      }
    }
  }

  private normalizeSuperchat(session: any): StandardEvent {
    return {
      type: 'superchat',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username,
        face: session.userFace
      },
      data: {
        price: session.price,
        message: session.message
      }
    }
  }

  private normalizeEnter(session: any): StandardEvent {
    return {
      type: 'enter',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username,
        fansMedal: session.fansMedal ? {
          name: session.fansMedal.name,
          level: session.fansMedal.level
        } : undefined
      },
      data: {}
    }
  }

  private normalizeFollow(session: any): StandardEvent {
    return {
      type: 'follow',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username
      },
      data: {}
    }
  }

  private normalizeLike(session: any): StandardEvent {
    return {
      type: 'like',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username
      },
      data: {
        count: session.likeCount || 1
      }
    }
  }

  private normalizeGuard(session: any): StandardEvent {
    return {
      type: 'guard',
      timestamp: Date.now(),
      roomId: session.roomId,
      user: {
        uid: session.userId,
        name: session.username,
        guardLevel: session.guardLevel
      },
      data: {
        guardLevel: session.guardLevel,
        num: session.num,
        price: session.price
      }
    }
  }

  private normalizeLiveStart(session: any): StandardEvent {
    return {
      type: 'liveStart',
      timestamp: Date.now(),
      roomId: session.roomId,
      data: {
        title: session.title,
        areaName: session.areaName
      }
    }
  }

  private normalizeLiveEnd(session: any): StandardEvent {
    return {
      type: 'liveEnd',
      timestamp: Date.now(),
      roomId: session.roomId,
      data: {}
    }
  }
}

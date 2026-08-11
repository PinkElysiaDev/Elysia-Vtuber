/**
 * 事件缓存 - 维护直播间状态和历史记录
 */

import type { StandardEvent, LiveSessionState } from './types'

export class EventCache {
  private state: LiveSessionState
  private maxHistorySize: number

  constructor(roomId: string, maxHistorySize: number = 50) {
    this.maxHistorySize = maxHistorySize
    this.state = {
      roomId,
      isLive: false,
      liveStartTime: null,
      online: 0,
      likes: 0,
      danmakuHistory: [],
      giftHistory: [],
      superChatHistory: [],
      recentUsers: new Map()
    }
  }

  /**
   * 添加事件到缓存
   */
  addEvent(event: StandardEvent): void {
    // 更新用户活跃状态
    if (event.user) {
      this.state.recentUsers.set(event.user.uid, {
        name: event.user.name,
        lastActive: event.timestamp
      })
    }

    // 根据事件类型分类存储
    switch (event.type) {
      case 'danmaku':
        this.state.danmakuHistory.push(event)
        this.trimHistory(this.state.danmakuHistory)
        break

      case 'gift':
        this.state.giftHistory.push(event)
        this.trimHistory(this.state.giftHistory)
        break

      case 'superchat':
        this.state.superChatHistory.push(event)
        this.trimHistory(this.state.superChatHistory)
        break

      case 'liveStart':
        this.state.isLive = true
        this.state.liveStartTime = event.timestamp
        break

      case 'liveEnd':
        this.state.isLive = false
        this.state.liveStartTime = null
        break

      case 'like':
        if (event.data?.count) {
          this.state.likes += event.data.count
        }
        break
    }

    // 清理过期用户（30分钟未活跃）
    const now = Date.now()
    for (const [uid, user] of this.state.recentUsers) {
      if (now - user.lastActive > 30 * 60 * 1000) {
        this.state.recentUsers.delete(uid)
      }
    }
  }

  /**
   * 获取最近的弹幕历史
   */
  getDanmakuHistory(count?: number): StandardEvent[] {
    const history = this.state.danmakuHistory
    if (count) {
      return history.slice(-count)
    }
    return [...history]
  }

  /**
   * 获取最近的礼物历史
   */
  getGiftHistory(count?: number): StandardEvent[] {
    const history = this.state.giftHistory
    if (count) {
      return history.slice(-count)
    }
    return [...history]
  }

  /**
   * 获取最近的SC历史
   */
  getSuperChatHistory(count?: number): StandardEvent[] {
    const history = this.state.superChatHistory
    if (count) {
      return history.slice(-count)
    }
    return [...history]
  }

  /**
   * 获取直播间状态
   */
  getState(): LiveSessionState {
    return { ...this.state }
  }

  /**
   * 获取变量值（供模板引擎使用）
   */
  getVariable(path: string): any {
    const parts = path.split('.')

    // 处理特殊变量
    if (parts[0] === 'history') {
      if (parts[1] === 'danmaku') {
        const count = parts[2] ? parseInt(parts[2]) : undefined
        return this.formatDanmakuHistory(this.getDanmakuHistory(count))
      }
      if (parts[1] === 'gift') {
        const count = parts[2] ? parseInt(parts[2]) : undefined
        return this.formatGiftHistory(this.getGiftHistory(count))
      }
      if (parts[1] === 'superchat') {
        const count = parts[2] ? parseInt(parts[2]) : undefined
        return this.formatSuperChatHistory(this.getSuperChatHistory(count))
      }
    }

    if (parts[0] === 'state') {
      if (parts[1] === 'isLive') return this.state.isLive
      if (parts[1] === 'online') return this.state.online
      if (parts[1] === 'likes') return this.state.likes
      if (parts[1] === 'liveDuration') {
        if (!this.state.liveStartTime) return 0
        return Math.floor((Date.now() - this.state.liveStartTime) / 1000)
      }
    }

    if (parts[0] === 'time') {
      if (parts[1] === 'now') return new Date().toLocaleString('zh-CN')
      if (parts[1] === 'timestamp') return Date.now()
    }

    return undefined
  }

  /**
   * 格式化弹幕历史为文本
   */
  private formatDanmakuHistory(events: StandardEvent[]): string {
    if (events.length === 0) return '暂无弹幕'
    return events.map(e =>
      `${e.user?.name || '未知用户'}: ${e.data?.content || ''}`
    ).join('\n')
  }

  /**
   * 格式化礼物历史为文本
   */
  private formatGiftHistory(events: StandardEvent[]): string {
    if (events.length === 0) return '暂无礼物'
    return events.map(e =>
      `${e.user?.name || '未知用户'} 赠送了 ${e.data?.giftName} x${e.data?.num || 1}`
    ).join('\n')
  }

  /**
   * 格式化SC历史为文本
   */
  private formatSuperChatHistory(events: StandardEvent[]): string {
    if (events.length === 0) return '暂无醒目留言'
    return events.map(e =>
      `${e.user?.name || '未知用户'}(¥${e.data?.price || 0}): ${e.data?.message || ''}`
    ).join('\n')
  }

  /**
   * 裁剪历史记录
   */
  private trimHistory(history: StandardEvent[]): void {
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize)
    }
  }

  /**
   * 清空所有历史
   */
  clear(): void {
    this.state.danmakuHistory = []
    this.state.giftHistory = []
    this.state.superChatHistory = []
    this.state.recentUsers.clear()
  }
}

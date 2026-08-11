/**
 * 提示词模板引擎 - 变量替换系统
 */

import { EventCache } from '../event-cache'
import type { StandardEvent } from '../types'

export class TemplateEngine {
  private eventCache: EventCache

  constructor(eventCache: EventCache) {
    this.eventCache = eventCache
  }

  /**
   * 渲染模板
   * @param template 模板字符串，包含 {{variable}} 格式的变量
   * @param event 当前触发的事件
   * @returns 渲染后的字符串
   */
  render(template: string, event?: StandardEvent): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, varPath) => {
      const value = this.getVariable(varPath.trim(), event)
      return value !== undefined ? String(value) : match
    })
  }

  /**
   * 获取变量值
   */
  private getVariable(path: string, event?: StandardEvent): any {
    const parts = path.split('.')

    // event.* - 当前事件的信息
    if (parts[0] === 'event' && event) {
      return this.getEventVariable(parts.slice(1), event)
    }

    // history.* - 历史记录
    if (parts[0] === 'history') {
      return this.eventCache.getVariable(path)
    }

    // state.* - 直播间状态
    if (parts[0] === 'state') {
      return this.eventCache.getVariable(path)
    }

    // time.* - 时间相关
    if (parts[0] === 'time') {
      return this.eventCache.getVariable(path)
    }

    return undefined
  }

  /**
   * 获取事件变量
   */
  private getEventVariable(parts: string[], event: StandardEvent): any {
    if (parts.length === 0) return undefined

    // event.type
    if (parts[0] === 'type') {
      return event.type
    }

    // event.timestamp
    if (parts[0] === 'timestamp') {
      return event.timestamp
    }

    // event.user.*
    if (parts[0] === 'user' && event.user) {
      if (parts[1] === 'uid') return event.user.uid
      if (parts[1] === 'name') return event.user.name
      if (parts[1] === 'face') return event.user.face
      if (parts[1] === 'guardLevel') return event.user.guardLevel
      if (parts[1] === 'fansMedal') {
        if (!event.user.fansMedal) return undefined
        if (parts[2] === 'name') return event.user.fansMedal.name
        if (parts[2] === 'level') return event.user.fansMedal.level
        return `${event.user.fansMedal.name}(${event.user.fansMedal.level})`
      }
    }

    // event.data.*
    if (parts[0] === 'data' && event.data) {
      const dataPath = parts.slice(1).join('.')
      return this.getNestedProperty(event.data, dataPath)
    }

    return undefined
  }

  /**
   * 获取嵌套属性
   */
  private getNestedProperty(obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  /**
   * 批量渲染（用于多条消息）
   */
  renderBatch(templates: string[], event?: StandardEvent): string[] {
    return templates.map(t => this.render(t, event))
  }
}

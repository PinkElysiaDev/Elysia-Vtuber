/**
 * 会话管理 - 维护对话历史和上下文
 */

import type { ChatSession, ChatMessage } from '../types'

export class SessionManager {
  private sessions: Map<string, ChatSession> = new Map()
  private maxMessages: number
  private maxTokens?: number

  constructor(maxMessages: number = 20, maxTokens?: number) {
    this.maxMessages = maxMessages
    this.maxTokens = maxTokens
  }

  /**
   * 获取或创建会话
   */
  getOrCreate(sessionId: string): ChatSession {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  /**
   * 添加消息
   */
  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.getOrCreate(sessionId)
    session.messages.push(message)
    session.lastActiveAt = Date.now()

    // 自动裁剪
    this.trim(sessionId)
  }

  /**
   * 添加多条消息
   */
  addMessages(sessionId: string, messages: ChatMessage[]): void {
    const session = this.getOrCreate(sessionId)
    session.messages.push(...messages)
    session.lastActiveAt = Date.now()

    // 自动裁剪
    this.trim(sessionId)
  }

  /**
   * 获取消息历史
   */
  getMessages(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId)
    return session ? [...session.messages] : []
  }

  /**
   * 裁剪会话历史
   */
  trim(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // 按消息数量裁剪
    if (session.messages.length > this.maxMessages) {
      // 保留系统消息（第一条通常是系统提示词）
      const systemMessages = session.messages.filter(m => m.role === 'system')
      const otherMessages = session.messages.filter(m => m.role !== 'system')

      // 保留最近的消息
      const trimmedOthers = otherMessages.slice(-this.maxMessages + systemMessages.length)
      session.messages = [...systemMessages, ...trimmedOthers]
    }

    // 按 token 数量裁剪（简化实现，粗略估算）
    if (this.maxTokens) {
      let estimatedTokens = this.estimateTokens(session.messages)
      while (estimatedTokens > this.maxTokens && session.messages.length > 1) {
        // 移除最早的非系统消息
        const indexToRemove = session.messages.findIndex(m => m.role !== 'system')
        if (indexToRemove === -1) break
        session.messages.splice(indexToRemove, 1)
        estimatedTokens = this.estimateTokens(session.messages)
      }
    }
  }

  /**
   * 清空会话
   */
  clear(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.messages = []
      session.lastActiveAt = Date.now()
    }
  }

  /**
   * 删除会话
   */
  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * 获取所有会话 ID
   */
  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  /**
   * 清理过期会话（超过 1 小时未活跃）
   */
  cleanupExpiredSessions(maxAge: number = 3600000): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > maxAge) {
        this.sessions.delete(id)
      }
    }
  }

  /**
   * 粗略估算 token 数量
   * 简化实现：中文按字数 * 2，英文按单词数 * 1.3
   */
  private estimateTokens(messages: ChatMessage[]): number {
    let total = 0
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += this.estimateTextTokens(msg.content)
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            total += this.estimateTextTokens(part.text)
          }
        }
      }
    }
    return total
  }

  /**
   * 估算文本的 token 数量
   */
  private estimateTextTokens(text: string): number {
    // 中文字符
    const chineseChars = text.match(/[一-龥]/g)?.length || 0
    // 其他字符（粗略按单词计算）
    const otherChars = text.replace(/[一-龥]/g, '').trim()
    const words = otherChars.split(/\s+/).filter(w => w.length > 0).length

    return chineseChars * 2 + Math.ceil(words * 1.3)
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats(sessionId: string): { messageCount: number; estimatedTokens: number } | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    return {
      messageCount: session.messages.length,
      estimatedTokens: this.estimateTokens(session.messages)
    }
  }
}

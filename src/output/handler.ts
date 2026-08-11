/**
 * 输出处理器 - 处理 LLM 回复并分发
 */

import { Context } from 'koishi'
import { TTSManager } from '../tts/manager'
import { BackendClient } from '../backend/client'
import type { OutputConfig, ReplySegment } from '../types'

export class OutputHandler {
  private ctx: Context
  private config: OutputConfig
  private ttsManager?: TTSManager
  private backendClient?: BackendClient

  constructor(
    ctx: Context,
    config: OutputConfig,
    ttsManager?: TTSManager,
    backendClient?: BackendClient
  ) {
    this.ctx = ctx
    this.config = config
    this.ttsManager = ttsManager
    this.backendClient = backendClient
  }

  /**
   * 处理回复内容
   * 支持两种格式：
   * 1. 纯文本
   * 2. JSON 格式 {"segments": [{text, method, displayStyle, emotion}]}
   */
  async handleReply(content: string, roomId: string): Promise<void> {
    try {
      // 尝试解析为 JSON
      const parsed = JSON.parse(content)
      if (parsed.segments && Array.isArray(parsed.segments)) {
        await this.handleStructuredReply(parsed.segments, roomId)
        return
      }
    } catch {
      // 不是 JSON，当作纯文本处理
    }

    // 纯文本处理：根据配置分发到所有启用的渠道
    await this.handlePlainTextReply(content, roomId)
  }

  /**
   * 处理结构化回复
   */
  private async handleStructuredReply(segments: ReplySegment[], roomId: string): Promise<void> {
    for (const segment of segments) {
      if (!segment.text || !segment.text.trim()) continue

      switch (segment.method) {
        case 'danmaku':
          if (this.config.enableDanmaku) {
            await this.sendDanmaku(segment.text, roomId)
          }
          break

        case 'display':
          if (this.config.enableDisplay) {
            await this.sendToDisplay(segment.text, segment.displayStyle, segment.emotion)
          }
          break

        case 'tts':
          if (this.config.enableTTS && this.ttsManager) {
            await this.sendToTTS(segment.text)
          }
          break
      }
    }
  }

  /**
   * 处理纯文本回复
   */
  private async handlePlainTextReply(text: string, roomId: string): Promise<void> {
    const cleanText = text.trim()
    if (!cleanText) return

    // 并行发送到所有启用的渠道
    const tasks: Promise<void>[] = []

    if (this.config.enableDanmaku) {
      tasks.push(this.sendDanmaku(cleanText, roomId))
    }

    if (this.config.enableDisplay) {
      tasks.push(this.sendToDisplay(cleanText, 'normal'))
    }

    if (this.config.enableTTS && this.ttsManager) {
      tasks.push(this.sendToTTS(cleanText))
    }

    await Promise.allSettled(tasks)
  }

  /**
   * 发送弹幕到直播间
   */
  private async sendDanmaku(text: string, roomId: string): Promise<void> {
    try {
      // 延迟发送（如果配置了）
      if (this.config.danmakuDelay && this.config.danmakuDelay > 0) {
        await this.sleep(this.config.danmakuDelay)
      }

      // 使用 adapter-bililive 的 bot.sendMessage
      const bot = this.ctx.bots.find(bot => bot.platform === 'bililive')
      if (!bot) {
        this.ctx.logger('vtuber').warn('No bililive bot found')
        return
      }

      await bot.sendMessage(`bililive:${roomId}`, text)
      this.ctx.logger('vtuber').debug(`Sent danmaku: ${text}`)
    } catch (error) {
      this.ctx.logger('vtuber').error('Failed to send danmaku:', error)
    }
  }

  /**
   * 发送到展示板（后端窗口）
   */
  private async sendToDisplay(
    text: string,
    displayStyle: string = 'normal',
    emotion?: string
  ): Promise<void> {
    try {
      // 如果有后端客户端，直接调用
      if (this.backendClient && this.backendClient.isConnected()) {
        await this.backendClient.displayText(text, displayStyle, emotion)
        this.ctx.logger('vtuber').debug(`Sent to display via backend: ${text}`)
        return
      }

      // 否则通过事件系统发送（兼容模式）
      this.ctx.emit('vtuber/display', {
        text,
        displayStyle,
        emotion,
        timestamp: Date.now()
      })

      this.ctx.logger('vtuber').debug(`Sent to display via event: ${text}`)
    } catch (error) {
      this.ctx.logger('vtuber').error('Failed to send to display:', error)
    }
  }

  /**
   * 发送到 TTS 系统
   */
  private async sendToTTS(text: string): Promise<void> {
    if (!this.ttsManager) {
      this.ctx.logger('vtuber').warn('TTS manager not initialized')
      return
    }

    try {
      // 分割长文本
      const segments = this.ttsManager.splitText(text)

      if (this.config.ttsQueueMode === 'serial') {
        // 串行模式：依次合成和播放
        for (const segment of segments) {
          const result = await this.ttsManager.synthesize({ text: segment })

          // 通过后端客户端发送音频
          if (this.backendClient && this.backendClient.isConnected()) {
            await this.backendClient.playTTS(result.audio, result.duration)
          } else {
            // 兼容模式：通过事件发送
            this.ctx.emit('vtuber/tts-audio', {
              audio: result.audio,
              duration: result.duration,
              timestamp: Date.now()
            })
          }

          // 等待播放完成
          if (result.duration) {
            await this.sleep(result.duration * 1000)
          }
        }
      } else {
        // 并行模式：一次性合成所有片段
        const results = await this.ttsManager.synthesizeBatch(segments)

        for (const result of results) {
          if (this.backendClient && this.backendClient.isConnected()) {
            await this.backendClient.playTTS(result.audio, result.duration)
          } else {
            this.ctx.emit('vtuber/tts-audio', {
              audio: result.audio,
              duration: result.duration,
              timestamp: Date.now()
            })
          }
        }
      }

      this.ctx.logger('vtuber').debug(`Sent to TTS: ${text}`)
    } catch (error) {
      this.ctx.logger('vtuber').error('Failed to send to TTS:', error)
    }
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<OutputConfig>): void {
    Object.assign(this.config, config)
  }
}

/**
 * TTS 系统 - 火山方舟 TTS API
 */

import { Context } from 'koishi'
import type { TTSConfig } from '../types'

export interface TTSRequest {
  text: string
  voiceType?: string
  speed?: number
  volume?: number
  pitch?: number
}

export interface TTSResponse {
  audio: Buffer
  duration?: number
}

export class TTSManager {
  private ctx: Context
  private config: TTSConfig

  constructor(ctx: Context, config: TTSConfig) {
    this.ctx = ctx
    this.config = config
  }

  /**
   * 合成语音
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (this.config.provider === 'volcengine') {
      return await this.synthesizeVolcengine(request)
    } else if (this.config.provider === 'clone') {
      return await this.synthesizeClone(request)
    } else {
      throw new Error(`Unknown TTS provider: ${this.config.provider}`)
    }
  }

  /**
   * 火山方舟 TTS
   */
  private async synthesizeVolcengine(request: TTSRequest): Promise<TTSResponse> {
    const url = `${this.config.volcengine.baseURL}/api/v1/tts`

    const body = {
      app: {
        appid: this.config.volcengine.appId,
        token: this.config.volcengine.token,
        cluster: this.config.volcengine.cluster
      },
      user: {
        uid: 'vtuber_user'
      },
      audio: {
        voice_type: request.voiceType || this.config.volcengine.voiceType,
        encoding: 'mp3',
        speed_ratio: request.speed || 1.0,
        volume_ratio: request.volume || 1.0,
        pitch_ratio: request.pitch || 1.0
      },
      request: {
        reqid: `vtuber_${Date.now()}`,
        text: request.text,
        text_type: 'plain',
        operation: 'query'
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.volcengine.accessToken}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`TTS request failed: ${response.status} ${text}`)
    }

    const data = await response.json()

    if (data.code !== 0) {
      throw new Error(`TTS API error: ${data.message}`)
    }

    // 解码 base64 音频数据
    const audioBase64 = data.data
    const audioBuffer = Buffer.from(audioBase64, 'base64')

    return {
      audio: audioBuffer,
      duration: data.duration
    }
  }

  /**
   * 声音克隆 TTS
   */
  private async synthesizeClone(request: TTSRequest): Promise<TTSResponse> {
    const url = `${this.config.clone.baseURL}/api/v1/clone`

    const body = {
      text: request.text,
      voice_id: this.config.clone.voiceId,
      speed: request.speed || 1.0,
      volume: request.volume || 1.0,
      pitch: request.pitch || 1.0
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.clone.apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Voice clone request failed: ${response.status} ${text}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(`Voice clone API error: ${data.error}`)
    }

    // 解码 base64 音频数据
    const audioBase64 = data.audio
    const audioBuffer = Buffer.from(audioBase64, 'base64')

    return {
      audio: audioBuffer,
      duration: data.duration
    }
  }

  /**
   * 批量合成（分段合成长文本）
   */
  async synthesizeBatch(texts: string[]): Promise<TTSResponse[]> {
    const results: TTSResponse[] = []

    for (const text of texts) {
      if (!text.trim()) continue

      try {
        const result = await this.synthesize({ text })
        results.push(result)
      } catch (error) {
        this.ctx.logger('vtuber').error(`Failed to synthesize text: ${text}`, error)
        // 继续处理其他文本
      }
    }

    return results
  }

  /**
   * 测试 TTS 连接
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.synthesize({ text: 'test' })
      return true
    } catch {
      return false
    }
  }

  /**
   * 分割长文本（按标点符号分割，每段不超过 maxLength）
   */
  splitText(text: string, maxLength: number = 200): string[] {
    const segments: string[] = []
    const sentences = text.split(/([。！？.!?])/)

    let currentSegment = ''

    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i]
      const punctuation = sentences[i + 1] || ''
      const fullSentence = sentence + punctuation

      if (currentSegment.length + fullSentence.length > maxLength) {
        if (currentSegment) {
          segments.push(currentSegment)
        }
        currentSegment = fullSentence
      } else {
        currentSegment += fullSentence
      }
    }

    if (currentSegment) {
      segments.push(currentSegment)
    }

    return segments
  }
}

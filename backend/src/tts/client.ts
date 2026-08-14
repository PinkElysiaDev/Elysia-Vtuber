import { randomUUID } from 'crypto'
import { httpRequest } from '../music/http'
import type { TTSConfig } from '../config'

export interface TtsResult {
  audio: Buffer
  duration: number
  encoding: string
}

export class TtsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TtsError'
  }
}

export function splitSpeech(text: string, maxLength = 200): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < cleaned.length;) {
    const next = cleaned.slice(i).search(/[。！？.!?\n]/)
    const end = next < 0 ? cleaned.length : i + next + 1
    const sentence = cleaned.slice(i, end).trim()
    i = end
    if (!sentence) continue
    if (current && current.length + sentence.length > maxLength) {
      segments.push(current)
      current = ''
    }
    current = current ? `${current}${sentence}` : sentence
  }
  if (current) segments.push(current)
  return segments
}

export async function synthesize(text: string, config: TTSConfig): Promise<TtsResult> {
  const clipped = text.trim()
  if (!clipped) throw new TtsError('文本为空')
  if (config.provider === 'clone') return synthesizeClone(clipped, config)
  return synthesizeVolcengine(clipped, config)
}

async function synthesizeVolcengine(text: string, config: TTSConfig): Promise<TtsResult> {
  if (!config.appId || !config.token) throw new TtsError('未配置火山 TTS App ID / Token')
  const host = (config.baseURL || 'https://openspeech.bytedance.com').replace(/\/$/, '')
  const body = {
    app: {
      appid: config.appId,
      token: config.token,
      cluster: config.cluster || 'volcano_tts',
    },
    user: { uid: 'vtuber' },
    audio: {
      voice_type: config.voiceType,
      encoding: 'mp3',
      speed_ratio: config.speed || 1,
      volume_ratio: config.volume || 1,
      pitch_ratio: config.pitch || 1,
    },
    request: {
      reqid: randomUUID(),
      text,
      text_type: 'plain',
      operation: 'query',
    },
  }
  const res = await httpRequest(`${host}/api/v1/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer;${config.token}`,
    },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  })
  const data = res.json<any>()
  if (data.code !== 3000) {
    throw new TtsError(`火山 TTS ${data.code ?? res.status}: ${data.message ?? res.text.slice(0, 160)}`)
  }
  const raw = String(data.data ?? '')
  if (!raw) throw new TtsError('火山 TTS 返回空音频')
  return {
    audio: Buffer.from(raw, 'base64'),
    duration: Number(data.addition?.duration ?? data.duration ?? 0),
    encoding: 'mp3',
  }
}

async function synthesizeClone(text: string, config: TTSConfig): Promise<TtsResult> {
  if (!config.baseURL) throw new TtsError('克隆 TTS 需要配置 baseURL')
  const res = await httpRequest(config.baseURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify({
      text,
      voice_id: config.voiceId,
      speed: config.speed,
      volume: config.volume,
      pitch: config.pitch,
    }),
    timeoutMs: 30000,
  })
  const data = res.json<any>()
  const raw = String(data.audio ?? data.data ?? '')
  if (!raw) throw new TtsError(`克隆 TTS 失败: ${data.error ?? data.message ?? res.text.slice(0, 160)}`)
  return {
    audio: Buffer.from(raw, 'base64'),
    duration: Number(data.duration ?? 0),
    encoding: String(data.encoding ?? 'mp3'),
  }
}

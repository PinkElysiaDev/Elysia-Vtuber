import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { AudioConfig, TTSConfig } from '../config'
import type { CppClient } from '../cpp/client'
import { synthesize, splitSpeech, TtsError } from './client'

const MIN_ENDED_MS = 1500
const EXTRA_ENDED_MS = 1500
const MS_PER_CHAR = 220
const MIN_ESTIMATE_MS = 1200
const TITLE_MAX_CHARS = 40

export interface TtsEngineDeps {
  getTts: () => TTSConfig
  getAudio: () => AudioConfig
  cpp: CppClient
  broadcast: (method: string, params: unknown) => void
}

export interface TtsState {
  speaking: boolean
  queued: number
  lastText: string
  lastError: string
}

export class TtsEngine {
  private queue: string[] = []
  private running = false
  private lastText = ''
  private lastError = ''
  private unsub: (() => void) | null = null
  private waitEnded: (() => void) | null = null

  constructor(private deps: TtsEngineDeps) {}

  getState(): TtsState {
    return {
      speaking: this.running,
      queued: this.queue.length,
      lastText: this.lastText,
      lastError: this.lastError,
    }
  }

  speak(text: string): { queued: number } {
    const parts = splitSpeech(text)
    this.queue.push(...parts)
    this.deps.broadcast('tts.queued', { count: parts.length, text })
    void this.pump()
    return { queued: this.queue.length }
  }

  stop(): { ok: boolean } {
    this.queue = []
    this.running = false
    this.waitEnded?.()
    this.waitEnded = null
    void this.playerCall('player.stop', { channel: 'tts' })
    this.deps.broadcast('tts.state', this.getState())
    return { ok: true }
  }

  private attach(): void {
    if (this.unsub) return
    this.unsub = this.deps.cpp.onEvent('player.ended', (params) => {
      const rec = (params ?? {}) as { channel?: string }
      if (rec.channel && rec.channel !== 'tts') return
      this.waitEnded?.()
    })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    this.attach()
    this.deps.broadcast('tts.state', this.getState())
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!
        await this.playOne(next)
      }
    } finally {
      this.running = false
      this.deps.broadcast('tts.state', this.getState())
    }
  }

  private async playOne(text: string): Promise<void> {
    this.lastText = text
    try {
      const result = await synthesize(text, this.deps.getTts())
      const audio = this.deps.getAudio()
      const file = path.join(os.tmpdir(), `vtuber-tts-${Date.now()}.mp3`)
      fs.writeFileSync(file, result.audio)
      const ended = this.waitForEnded(Math.max(MIN_ENDED_MS, (result.duration || estimateMs(text)) + EXTRA_ENDED_MS))
      const play = await this.playerCall('player.play', {
        channel: 'tts',
        url: fileToUrl(file),
        title: text.slice(0, TITLE_MAX_CHARS),
        volume: audio.ttsVolume,
        device: audio.outputDevice,
      })
      if (play && typeof play === 'object' && (play as { ok?: boolean }).ok === false) {
        throw new TtsError(String((play as { error?: string }).error || 'player.play failed'))
      }
      this.deps.broadcast('tts.speaking', { text, file })
      await ended
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      console.error('[tts]', this.lastError)
      this.deps.broadcast('tts.error', { message: this.lastError, text })
    }
  }

  private waitForEnded(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waitEnded = null
        resolve()
      }, timeoutMs)
      this.waitEnded = () => {
        clearTimeout(timer)
        this.waitEnded = null
        resolve()
      }
    })
  }

  private async playerCall(method: string, args: Record<string, unknown>): Promise<unknown> {
    return this.deps.cpp.safeRequest(method, args)
  }
}

function estimateMs(text: string): number {
  return Math.max(MIN_ESTIMATE_MS, text.length * MS_PER_CHAR)
}

function fileToUrl(file: string): string {
  return 'file:///' + file.replace(/\\/g, '/')
}

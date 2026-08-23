import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { AudioConfig, TTSConfig } from '../config'
import type { CppClient } from '../cpp/client'
import { synthesize, splitSpeech, TtsError } from './client'

const MIN_ENDED_MS = 1500
const EXTRA_ENDED_MS = 1500
const MS_PER_CHAR = 220
const MIN_ESTIMATE_MS = 1200
const TITLE_MAX_CHARS = 40
const SWEEP_INTERVAL_MS = 60_000
const TEMP_FILE_PREFIX = 'vtuber-tts-'
/** TTL=0 时对崩溃残留文件的清理宽限（文件名扫描用） */
const LEFTOVER_GRACE_MS = 60 * 60_000

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
  private sweepTimer: NodeJS.Timeout | null = null
  private tempFiles = new Map<string, number>()
  /** 播放代数：stop() 自增使在飞的合成/播放请求全部过期 */
  private epoch = 0

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
    this.epoch++
    this.waitEnded?.()
    this.waitEnded = null
    void this.playerCall('player.stop', { channel: 'tts' })
    this.deps.broadcast('tts.state', this.getState())
    return { ok: true }
  }

  /** 启动临时文件清扫定时器（幂等） */
  startSweeper(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.sweepTempFiles(), SWEEP_INTERVAL_MS)
    this.sweepTimer.unref?.()
  }

  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    this.sweepTempFiles()
  }

  private tempTtlMs(): number {
    const minutes = this.deps.getTts().tempFileTtlMinutes
    if (!Number.isFinite(minutes) || minutes < 0) return 0
    return minutes * 60_000
  }

  private deleteTempFile(file: string): void {
    this.tempFiles.delete(file)
    fs.unlink(file, () => {})
  }

  private sweepTempFiles(): void {
    const ttlMs = this.tempTtlMs()
    const threshold = ttlMs > 0 ? ttlMs : LEFTOVER_GRACE_MS
    const now = Date.now()

    for (const [file, expiresAt] of this.tempFiles) {
      if (now >= expiresAt) this.deleteTempFile(file)
    }

    // 进程崩溃残留：按文件名前缀 + mtime 扫描系统临时目录
    try {
      for (const name of fs.readdirSync(os.tmpdir())) {
        if (!name.startsWith(TEMP_FILE_PREFIX) || !name.endsWith('.mp3')) continue
        const file = path.join(os.tmpdir(), name)
        try {
          const stat = fs.statSync(file)
          if (now - stat.mtimeMs >= threshold) this.deleteTempFile(file)
        } catch {
          // 文件已消失则跳过
        }
      }
    } catch {
      // 临时目录不可读则跳过
    }
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
    const epoch = this.epoch
    this.attach()
    this.deps.broadcast('tts.state', this.getState())
    try {
      while (this.queue.length) {
        // stop() 之后不再消费队列（stop 已清空队列，此处防御竞态追加）
        if (epoch !== this.epoch) break
        const next = this.queue.shift()!
        await this.playOne(next, epoch)
      }
    } finally {
      this.running = false
      this.deps.broadcast('tts.state', this.getState())
    }
  }

  private async playOne(text: string, epoch: number): Promise<void> {
    this.lastText = text
    try {
      const result = await synthesize(text, this.deps.getTts())
      // stop() 后丢弃过期合成结果，避免旧句在停止之后仍然开播
      if (epoch !== this.epoch) return
      const audio = this.deps.getAudio()
      const file = path.join(os.tmpdir(), `${TEMP_FILE_PREFIX}${Date.now()}.mp3`)
      fs.writeFileSync(file, result.audio)
      const ttlMs = this.tempTtlMs()
      this.tempFiles.set(file, Date.now() + Math.max(ttlMs, SWEEP_INTERVAL_MS))
      this.startSweeper()
      const ended = this.waitForEnded(Math.max(MIN_ENDED_MS, (result.duration || estimateMs(text)) + EXTRA_ENDED_MS))
      const play = await this.playerCall('player.play', {
        channel: 'tts',
        url: fileToUrl(file),
        title: text.slice(0, TITLE_MAX_CHARS),
        volume: audio.ttsVolume,
        device: audio.outputDevice,
      })
      if (epoch !== this.epoch) {
        // 播放请求可能已送达但用户已停止：压停兜底
        void this.playerCall('player.stop', { channel: 'tts' })
        return
      }
      if (play && typeof play === 'object' && (play as { ok?: boolean }).ok === false) {
        throw new TtsError(String((play as { error?: string }).error || 'player.play failed'))
      }
      this.deps.broadcast('tts.speaking', { text, file })
      await ended
      if (ttlMs === 0) this.deleteTempFile(file)
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
  // pathToFileURL 跨平台处理盘符/分隔符，手拼 'file:///' 在 POSIX 会产出四斜杠畸形 URL
  return pathToFileURL(file).href
}

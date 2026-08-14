import * as fs from 'fs'
import * as path from 'path'
import type { MusicConfig } from '../config'
import { resolveBackendPath } from '../config'
import type { CppClient } from '../cpp/client'
import type { StandardEvent } from '../modules/events'
import { createDefaultRegistry, type ProviderRegistry } from './registry'
import type { MediaInfo, MetaData, NowPlaying, QueueItem } from './types'
import { MusicError } from './types'
import { findLyric } from './lyric'

export interface JukeboxDeps {
  getConfig: () => MusicConfig
  cpp: CppClient
  broadcast: (method: string, params: unknown) => void
  registry?: ProviderRegistry
}

export class Jukebox {
  private registry: ProviderRegistry
  private queue: QueueItem[] = []
  private nowPlaying: NowPlaying | null = null
  private volume = 80
  private muted = false
  private running = false
  private advancing = false
  private seq = 0
  private unsubEnded: (() => void) | null = null
  private pendingPlay: QueueItem | null = null

  constructor(private deps: JukeboxDeps) {
    this.registry = deps.registry ?? createDefaultRegistry()
  }

  sources(): string[] {
    return this.registry.names()
  }

  start(): { success: boolean; message: string } {
    this.running = true
    this.attachPlayer()
    void this.ensurePlaying()
    return { success: true, message: '点歌机已启动' }
  }

  stop(): { success: boolean; message: string } {
    this.running = false
    this.nowPlaying = null
    this.pendingPlay = null
    void this.playerCall('player.stop', { channel: 'music' })
    this.writeNowPlaying(null)
    this.emitState()
    return { success: true, message: '点歌机已停止' }
  }

  restart(preserveQueue = true): { success: boolean; message: string } {
    const kept = preserveQueue ? this.queue.slice() : []
    this.stop()
    this.queue = kept
    return this.start()
  }

  getState() {
    return {
      playing: Boolean(this.nowPlaying && !this.nowPlaying.paused),
      running: this.running,
      volume: this.volume,
      muted: this.muted,
      nowPlaying: this.serializeNowPlaying(),
      queue: this.queue.map((item) => this.serializeItem(item)),
      sources: this.sources(),
    }
  }

  async search(keyword: string, source?: string, page = 1, size = 10) {
    const cfg = this.deps.getConfig()
    const results = await this.registry.search(keyword, source || cfg.defaultSource, page, size)
    return { results, source: source || cfg.defaultSource }
  }

  async add(input: {
    songId?: string
    source?: string
    keyword?: string
    title?: string
    userId?: string
    userName?: string
    idle?: boolean
  }): Promise<{ success: boolean; message: string; item?: ReturnType<Jukebox['serializeItem']> }> {
    const cfg = this.deps.getConfig()
    const userId = input.userId || 'system'
    const queued = this.activeItems().length
    if (!input.idle && queued >= cfg.maxQueueSize) {
      return { success: false, message: `队列已满（${cfg.maxQueueSize}）` }
    }
    if (!input.idle && userId !== 'system') {
      const count = this.activeItems().filter((item) => item.userId === userId).length
      if (count >= cfg.maxPerUser) {
        return { success: false, message: `每位用户最多点 ${cfg.maxPerUser} 首` }
      }
    }

    const media = await this.resolveMedia(input, cfg.defaultSource)
    if (cfg.maxDuration > 0 && media.duration > 0 && media.duration > cfg.maxDuration) {
      return { success: false, message: `歌曲过长（${media.duration}s > ${cfg.maxDuration}s）` }
    }

    const item: QueueItem = {
      id: `q${++this.seq}`,
      media,
      userId,
      userName: input.userName || userId,
      requestedAt: Date.now(),
      idle: Boolean(input.idle),
    }
    this.queue.push(item)
    this.emitState()
    if (this.running) void this.ensurePlaying()
    return { success: true, message: `已加入队列：${media.title} - ${media.artist}`, item: this.serializeItem(item) }
  }

  skip(): { success: boolean; message: string } {
    if (!this.nowPlaying && !this.pendingPlay && !this.queue.length) {
      return { success: false, message: '队列为空' }
    }
    void this.advance('skip')
    return { success: true, message: '已切歌' }
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 100)
    void this.playerCall('player.volume', { channel: 'music', volume: this.effectiveVolume() })
    this.emitState()
    return { success: true, volume: this.volume }
  }

  adjustVolume(delta: number) {
    return this.setVolume(this.volume + delta)
  }

  mute() {
    this.muted = true
    void this.playerCall('player.volume', { channel: 'music', volume: 0 })
    this.emitState()
    return { success: true, muted: true }
  }

  unmute() {
    this.muted = false
    void this.playerCall('player.volume', { channel: 'music', volume: this.volume })
    this.emitState()
    return { success: true, muted: false }
  }

  tryDirectOrder(event: StandardEvent): boolean {
    const cfg = this.deps.getConfig()
    if (!cfg.directOrder.enabled || event.type !== 'danmaku') return false
    const content = String(event.data?.content ?? '').trim()
    const keyword = cfg.directOrder.keywords.find((item) => content.startsWith(item))
    if (!keyword) return false
    const query = content.slice(keyword.length).trim()
    if (!query) return false
    void this.add({
      keyword: query,
      userId: event.user?.uid || 'anon',
      userName: event.user?.name || 'anon',
    }).then((result) => {
      this.deps.broadcast('jukebox.ordered', {
        ok: result.success,
        message: result.message,
        user: event.user,
        query,
      })
    }).catch((err) => {
      this.deps.broadcast('jukebox.ordered', {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        user: event.user,
        query,
      })
    })
    return true
  }

  lyricAt(timeSec: number) {
    if (!this.nowPlaying?.lyrics) return { lyric: '', time: timeSec }
    const line = findLyric(this.nowPlaying.lyrics, timeSec)
    return { lyric: line.lyric, time: line.time }
  }

  private async resolveMedia(input: {
    songId?: string
    source?: string
    keyword?: string
    title?: string
  }, fallback: string): Promise<MediaInfo> {
    if (input.songId) {
      const meta: MetaData = { provider: input.source || fallback, identifier: input.songId }
      if (input.title) {
        return {
          title: input.title,
          artist: '',
          artists: [],
          album: '',
          cover: '',
          duration: 0,
          meta,
        }
      }
      try {
        return await this.registry.info(meta)
      } catch {
        return {
          title: input.songId,
          artist: '',
          artists: [],
          album: '',
          cover: '',
          duration: 0,
          meta,
        }
      }
    }
    const keyword = input.keyword || input.title || ''
    if (!keyword) throw new MusicError('缺少 songId 或 keyword')
    const matched = this.registry.match(keyword, input.source)
    if (matched) return this.registry.info(matched.meta)
    const results = await this.registry.search(keyword, input.source || fallback, 1, 1)
    if (!results.length) throw new MusicError(`未找到：${keyword}`)
    return results[0]
  }

  private attachPlayer(): void {
    this.unsubEnded?.()
    this.unsubEnded = this.deps.cpp.onEvent('player.ended', (params) => {
      const rec = (params ?? {}) as { channel?: string }
      if (rec.channel && rec.channel !== 'music') return
      void this.advance('ended')
    })
  }

  private async ensurePlaying(): Promise<void> {
    if (!this.running || this.nowPlaying || this.advancing) return
    await this.advance('auto')
  }

  private async advance(reason: string): Promise<void> {
    if (this.advancing) return
    this.advancing = true
    try {
      const next = this.queue.shift() ?? await this.nextIdleItem()
      if (!next) {
        this.nowPlaying = null
        this.pendingPlay = null
        void this.playerCall('player.stop', { channel: 'music' })
        this.writeNowPlaying(null)
        this.emitState()
        return
      }
      this.pendingPlay = next
      const urls = await this.registry.url(next.media.meta)
      if (!urls.length) throw new MusicError('无法解析播放地址')
      const lyrics = (await this.registry.lyric(next.media.meta).catch(() => []))[0] ?? null
      this.nowPlaying = {
        item: next,
        url: urls[0],
        lyrics,
        startedAt: Date.now(),
        paused: false,
      }
      this.pendingPlay = null
      const cfg = this.deps.getConfig()
      await this.playerCall('player.play', {
        channel: 'music',
        url: urls[0].url,
        headers: urls[0].headers,
        volume: this.effectiveVolume(),
        device: cfg.outputDevice,
        title: next.media.title,
      })
      this.writeNowPlaying(this.nowPlaying)
      this.deps.broadcast('jukebox.nowPlaying', this.serializeNowPlaying())
      this.emitState()
    } catch (err) {
      console.error(`[jukebox] advance(${reason}) failed:`, err)
      this.nowPlaying = null
      this.pendingPlay = null
      this.emitState()
      if (this.queue.length || this.deps.getConfig().idlePlaylist.length) {
        setTimeout(() => { void this.ensurePlaying() }, 500)
      }
    } finally {
      this.advancing = false
    }
  }

  private async nextIdleItem(): Promise<QueueItem | null> {
    const cfg = this.deps.getConfig()
    if (!cfg.idlePlaylist.length) return null
    const raw = cfg.idlePlaylist[0]
    const rest = cfg.idlePlaylist.slice(1)
    if (cfg.idleLoop) rest.push(raw)
    cfg.idlePlaylist = rest
    const parsed = parseIdleRef(raw)
    try {
      const media = await this.resolveMedia(parsed, cfg.defaultSource)
      return {
        id: `idle${++this.seq}`,
        media,
        userId: 'idle',
        userName: 'idle',
        requestedAt: Date.now(),
        idle: true,
      }
    } catch (err) {
      console.warn('[jukebox] idle item failed:', err)
      return this.nextIdleItem()
    }
  }

  private async playerCall(method: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.cpp.isConnected()) return { ok: false, error: 'C++ 执行器未连接' }
    try {
      return await this.deps.cpp.request(method, args)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private activeItems(): QueueItem[] {
    const items = [...this.queue]
    if (this.pendingPlay && !this.pendingPlay.idle) items.push(this.pendingPlay)
    if (this.nowPlaying && !this.nowPlaying.item.idle) items.push(this.nowPlaying.item)
    return items
  }

  private effectiveVolume(): number {
    return this.muted ? 0 : this.volume
  }

  private serializeItem(item: QueueItem) {
    return {
      id: item.id,
      title: item.media.title,
      artist: item.media.artist,
      cover: item.media.cover,
      duration: item.media.duration,
      source: item.media.meta.provider,
      songId: item.media.meta.identifier,
      userId: item.userId,
      userName: item.userName,
      idle: item.idle,
    }
  }

  private serializeNowPlaying() {
    if (!this.nowPlaying) return null
    return {
      ...this.serializeItem(this.nowPlaying.item),
      url: this.nowPlaying.url.url,
      startedAt: this.nowPlaying.startedAt,
      paused: this.nowPlaying.paused,
      lyric: this.nowPlaying.lyrics ? findLyric(this.nowPlaying.lyrics, 0).lyric : '',
      hasLyrics: Boolean(this.nowPlaying.lyrics),
    }
  }

  private writeNowPlaying(current: NowPlaying | null): void {
    const cfg = this.deps.getConfig().nowPlaying
    if (!cfg.filePath) return
    const file = resolveBackendPath(cfg.filePath)
    const text = current
      ? cfg.template
        .replace(/\{\{title\}\}/g, current.item.media.title)
        .replace(/\{\{artist\}\}/g, current.item.media.artist)
        .replace(/\{\{duration\}\}/g, String(current.item.media.duration || ''))
        .replace(/\{\{user\}\}/g, current.item.userName)
      : ''
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text, 'utf8')
    } catch (err) {
      console.warn('[jukebox] nowplaying write failed:', err)
    }
    this.deps.broadcast('jukebox.nowPlayingText', { text, windowEnabled: cfg.windowEnabled })
  }

  private emitState(): void {
    this.deps.broadcast('jukebox.state', this.getState())
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function parseIdleRef(raw: string): { source?: string; songId?: string; keyword?: string } {
  const match = raw.match(/^([a-z0-9-]+):(.+)$/i)
  if (!match) return { keyword: raw }
  const [, source, rest] = match
  if (/^https?:\/\//i.test(rest) || /^BV/i.test(rest) || /^[0-9a-z]+$/i.test(rest)) {
    return { source, songId: rest }
  }
  return { source, keyword: rest }
}

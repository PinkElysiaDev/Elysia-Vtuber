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

const RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 10_000
const MAX_ADVANCE_RETRIES = 5

type AdvanceReason = 'auto' | 'skip' | 'ended'

export interface JukeboxDeps {
  getConfig: () => MusicConfig
  cpp: CppClient
  broadcast: (method: string, params: unknown) => void
  registry?: ProviderRegistry
}

export class Jukebox {
  readonly registry: ProviderRegistry
  private queue: QueueItem[] = []
  private nowPlaying: NowPlaying | null = null
  private volume = 80
  private muted = false
  private running = false
  private advancing = false
  private seq = 0
  private unsubEnded: (() => void) | null = null
  private pendingPlay: QueueItem | null = null
  /** 输出模板含时间相关变量时每秒重写输出文件（进度/歌词/剩余时间） */
  private nowPlayingTimer: ReturnType<typeof setInterval> | null = null
  /** 本次启动以来已开播曲目数（{{index}}） */
  private playCounter = 0
  /** advance 连续失败次数：用于退避与封顶，成功后清零 */
  private consecutiveFailures = 0
  /** 播放代数：stop/restart 自增，使进行中的 advance 全部过期 */
  private generation = 0
  /** advance 进行中收到的切歌请求，结束后接续执行而不是丢弃 */
  private skipRequested = false

  constructor(private deps: JukeboxDeps) {
    this.registry = deps.registry ?? createDefaultRegistry()
  }

  sources(): string[] {
    return this.registry.names()
  }

  start(): { success: boolean; message: string } {
    this.running = true
    this.consecutiveFailures = 0
    this.attachPlayer()
    void this.ensurePlaying()
    return { success: true, message: '点歌机已启动' }
  }

  stop(): { success: boolean; message: string } {
    this.running = false
    this.generation++
    this.skipRequested = false
    this.nowPlaying = null
    this.pendingPlay = null
    this.playCounter = 0
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

  remove(id: string): { success: boolean; message: string } {
    const idx = this.queue.findIndex(item => item.id === id)
    if (idx === -1) {
      return { success: false, message: `未找到队列项: ${id}` }
    }
    const removed = this.queue.splice(idx, 1)[0]
    this.emitState()
    return { success: true, message: `已从队列中移除: ${removed.media.title}` }
  }

  toTop(id: string): { success: boolean; message: string } {
    const idx = this.queue.findIndex(item => item.id === id)
    if (idx === -1) {
      return { success: false, message: `未找到队列项: ${id}` }
    }
    if (idx === 0) {
      return { success: true, message: '已经在队列首位' }
    }
    const item = this.queue.splice(idx, 1)[0]
    this.queue.unshift(item)
    this.emitState()
    return { success: true, message: `已将《${item.media.title}》置顶` }
  }

  clearQueue(): { success: boolean; count: number } {
    const count = this.queue.length
    this.queue = []
    this.emitState()
    return { success: true, count }
  }

  skip(): { success: boolean; message: string } {
    if (!this.running) return { success: false, message: '点歌机未启动' }
    if (!this.nowPlaying && !this.pendingPlay && !this.queue.length) {
      return { success: false, message: '队列为空' }
    }
    if (this.advancing) {
      // 正在解析/开播：静默丢弃会让切歌失效，标记待本次 advance 结束后接续
      this.skipRequested = true
      return { success: true, message: '正在切歌，即将接续下一首' }
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
    // 渠道触发词 + 通用触发词合并，最长前缀优先（避免"点歌"抢匹配"点w歌"）
    const candidates: Array<{ keyword: string; source?: string }> = []
    for (const [source, commands] of Object.entries(cfg.directOrder.channelCommands ?? {})) {
      for (const keyword of commands ?? []) {
        if (keyword) candidates.push({ keyword, source })
      }
    }
    for (const keyword of cfg.directOrder.keywords ?? []) {
      if (keyword) candidates.push({ keyword })
    }
    candidates.sort((a, b) => b.keyword.length - a.keyword.length)
    const hit = candidates.find((item) => content.startsWith(item.keyword))
    if (!hit) return false
    const query = content.slice(hit.keyword.length).trim()
    if (!query) return false
    void this.add({
      keyword: query,
      source: hit.source,
      userId: event.user?.uid || 'anon',
      userName: event.user?.name || 'anon',
    }).then((result) => {
      this.deps.broadcast('jukebox.ordered', {
        ok: result.success,
        message: result.message,
        user: event.user,
        query,
        source: hit.source || cfg.defaultSource,
      })
    }).catch((err) => {
      this.deps.broadcast('jukebox.ordered', {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        user: event.user,
        query,
        source: hit.source || cfg.defaultSource,
      })
    })
    return true
  }

  /** 空闲歌单条目批量解析（WebUI 列表显示用，只读；失败条目返回 ok:false 与原始 ref） */
  async previewIdleRefs(): Promise<Array<{ ref: string; ok: boolean; title?: string; artist?: string; provider?: string }>> {
    const cfg = this.deps.getConfig()
    const refs = (cfg.idlePlaylist ?? []).map(String)
    const results: Array<{ ref: string; ok: boolean; title?: string; artist?: string; provider?: string }> = new Array(refs.length)
    // 并发限流：歌单动辄数百条，串行逐条解析会远超 RPC 超时
    let cursor = 0
    const worker = async () => {
      while (cursor < refs.length) {
        const i = cursor++
        try {
          const media = await this.resolveMedia(parseIdleRef(refs[i]), cfg.defaultSource)
          results[i] = { ref: refs[i], ok: true, title: media.title, artist: media.artist, provider: media.meta.provider }
        } catch {
          results[i] = { ref: refs[i], ok: false }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(10, Math.max(1, refs.length)) }, worker))
    return results
  }

  lyricAt(timeSec: number) {
    if (!this.nowPlaying?.lyrics) return { lyric: '', time: timeSec }
    const line = findLyric(this.nowPlaying.lyrics, timeSec)
    return { lyric: line.lyric, time: line.time }
  }

  /**
   * 执行器重连后调用：旧播放已随进程消失，且不会再收到 ended 事件。
   * 把被打断的曲目重新入队并续播，避免 nowPlaying 永久停留在假状态。
   */
  onPlayerReconnected(): void {
    if (!this.running || this.advancing) return
    if (!this.nowPlaying) return
    console.warn('[jukebox] 执行器重启，当前曲目播放中断，重新入队续播')
    this.queue.unshift(this.nowPlaying.item)
    this.nowPlaying = null
    this.pendingPlay = null
    this.writeNowPlaying(null)
    this.emitState()
    void this.ensurePlaying()
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

  private async advance(reason: AdvanceReason): Promise<void> {
    if (this.advancing) return
    this.advancing = true
    const gen = this.generation
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
      // 解析期间已被 stop()/restart()：本次 advance 过期，不再开播
      if (this.generation !== gen) {
        this.pendingPlay = null
        this.emitState()
        return
      }
      const lyrics = (await this.registry.lyric(next.media.meta).catch(() => []))[0] ?? null
      if (this.generation !== gen) {
        this.pendingPlay = null
        this.emitState()
        return
      }
      this.nowPlaying = {
        item: next,
        url: urls[0],
        lyrics,
        startedAt: Date.now(),
        paused: false,
      }
      this.playCounter++
      this.pendingPlay = null
      const cfg = this.deps.getConfig()
      const play = await this.playerCall('player.play', {
        channel: 'music',
        url: urls[0].url,
        headers: urls[0].headers,
        volume: this.effectiveVolume(),
        device: cfg.outputDevice,
        title: next.media.title,
      }) as { ok?: boolean; error?: string }
      if (this.generation !== gen) {
        // 本次 advance 已过期（stop/restart 期间播放请求才返回）。
        // 没有更新的曲目在播时压停，防止旧请求“复活”音乐；已有新曲目
        // 在播（restart 场景）则交由新 advance 接管，不能误杀
        if (!this.nowPlaying) {
          void this.playerCall('player.stop', { channel: 'music' })
          this.nowPlaying = null
          this.writeNowPlaying(null)
          this.emitState()
        }
        return
      }
      // safeRequest 失败时返回 {ok:false} 而非抛异常，不检查会让队列
      // 卡在永远不会 ended 的“幽灵曲目”上
      if (play && play.ok === false) {
        throw new MusicError(`播放器调用失败: ${play.error ?? 'unknown'}`)
      }
      this.consecutiveFailures = 0
      this.writeNowPlaying(this.nowPlaying)
      this.deps.broadcast('jukebox.nowPlaying', this.serializeNowPlaying())
      this.emitState()
    } catch (err) {
      console.error(`[jukebox] advance(${reason}) failed:`, err)
      this.nowPlaying = null
      this.pendingPlay = null
      this.writeNowPlaying(null)
      this.emitState()
      if (this.generation === gen && (this.queue.length || this.deps.getConfig().idlePlaylist.length)) {
        this.consecutiveFailures++
        if (this.consecutiveFailures > MAX_ADVANCE_RETRIES) {
          console.warn(`[jukebox] 连续 ${MAX_ADVANCE_RETRIES} 次切歌失败，暂停自动重试（可手动切歌/重启点歌机）`)
          return
        }
        const delay = Math.min(RETRY_DELAY_MS * 2 ** (this.consecutiveFailures - 1), MAX_RETRY_DELAY_MS)
        setTimeout(() => { void this.ensurePlaying() }, delay)
      }
    } finally {
      this.advancing = false
      if (this.skipRequested) {
        this.skipRequested = false
        if (this.running) void this.advance('skip')
      }
    }
  }

  private async nextIdleItem(): Promise<QueueItem | null> {
    const cfg = this.deps.getConfig()
    if (!cfg.idlePlaylist.length) return null
    // 最多尝试一轮列表：idleLoop 会把失败项推回队尾，无上限递归会在
    // 提供商故障时把 advance 锁死并刷爆请求
    const maxAttempts = cfg.idlePlaylist.length
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const raw = cfg.idlePlaylist[0]
      if (raw === undefined) return null
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
        console.warn('[jukebox] idle item failed:', raw, err)
      }
    }
    console.warn('[jukebox] 待机列表全部解析失败，本轮放弃')
    return null
  }

  private async playerCall(method: string, args: Record<string, unknown>): Promise<unknown> {
    return this.deps.cpp.safeRequest(method, args)
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

  /** 模板变量名集合中需要逐秒刷新的（进度/歌词/剩余时间/墙钟） */
  private static TIME_VARS = /\{\{\s*(elapsed|elapsedSec|remaining|remainingSec|lyric|time)\s*\}\}/

  /** 模板渲染：{{var}} → 值，未知变量原样保留 */
  private static renderTemplate(tpl: string, ctx: Record<string, string>): string {
    return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in ctx ? ctx[key] : m))
  }

  /** 秒 → m:ss（分钟不补零，秒补零） */
  private static formatTime(totalSec: number): string {
    const s = Math.max(0, Math.floor(totalSec))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  /** 组装当前播放的模板变量上下文 */
  private nowPlayingContext(current: NowPlaying | null): Record<string, string> {
    const base: Record<string, string> = {
      status: 'idle',
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      queueLength: String(this.queue.length),
      queue: this.queue.map((q, i) => `${i + 1}. ${q.media.title} - ${q.media.artist}`).join('\n'),
    }
    if (!current) return base
    const m = current.item.media
    const duration = Math.max(0, Math.round(m.duration || 0))
    const elapsed = Math.max(0, Math.round((Date.now() - current.startedAt) / 1000))
    const remaining = Math.max(0, duration - elapsed)
    return {
      ...base,
      title: m.title ?? '',
      artist: m.artist ?? '',
      artists: (m.artists || []).join('/'),
      album: m.album ?? '',
      cover: m.cover ?? '',
      user: current.item.userName ?? '',
      source: m.meta?.provider ?? '',
      songId: m.meta?.identifier ?? '',
      duration: Jukebox.formatTime(duration),
      durationSec: String(duration),
      elapsed: Jukebox.formatTime(elapsed),
      elapsedSec: String(elapsed),
      remaining: Jukebox.formatTime(remaining),
      remainingSec: String(remaining),
      lyric: current.lyrics ? findLyric(current.lyrics, elapsed).lyric : '',
      index: String(this.playCounter),
      status: current.paused ? 'paused' : 'playing',
    }
  }

  private writeNowPlaying(current: NowPlaying | null): void {
    const cfg = this.deps.getConfig().nowPlaying
    const outputs = (cfg.outputs || []).filter((o) => o && o.file)
    if (!outputs.length) {
      this.updateNowPlayingTimer(null, outputs)
      return
    }
    const ctx = this.nowPlayingContext(current)
    let firstText = ''
    for (const o of outputs) {
      const text = current ? Jukebox.renderTemplate(o.template || '', ctx) : ''
      if (!firstText) firstText = text
      try {
        // 输出统一落 data/music_info/，file 只取纯文件名（防目录穿越）
        const file = path.join(resolveBackendPath('data/music_info'), path.basename(String(o.file).replace(/\\/g, '/')))
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, text, 'utf-8')
      } catch (err) {
        console.warn('[jukebox] nowplaying write failed:', err)
      }
    }
    // 首个输出的文本照旧广播（兼容旧消费者）
    this.deps.broadcast('jukebox.nowPlayingText', { text: firstText, windowEnabled: cfg.windowEnabled })
    this.updateNowPlayingTimer(current, outputs)
  }

  /** 模板含时间相关变量且播放中 → 每秒重写输出；否则停表 */
  private updateNowPlayingTimer(current: NowPlaying | null, outputs: Array<{ template?: string }>): void {
    const active = Boolean(current && !current.paused && outputs.some((o) => Jukebox.TIME_VARS.test(o.template || '')))
    if (active && !this.nowPlayingTimer) {
      this.nowPlayingTimer = setInterval(() => {
        this.writeNowPlaying(this.nowPlaying)
      }, 1000)
    } else if (!active && this.nowPlayingTimer) {
      clearInterval(this.nowPlayingTimer)
      this.nowPlayingTimer = null
    }
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

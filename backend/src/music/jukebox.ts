import * as fs from 'fs'
import * as path from 'path'
import type { MusicConfig } from '../config'
import { resolveBackendPath } from '../config'
import type { CppClient } from '../cpp/client'
import type { StandardEvent } from '../modules/events'
import { createDefaultRegistry, type ProviderRegistry } from './registry'
import type { MediaInfo, MetaData, NowPlaying, PlayHistoryRecord, QueueItem } from './types'
import { MusicError } from './types'
import { findLyric } from './lyric'

const RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 10_000
const MAX_ADVANCE_RETRIES = 5

type AdvanceReason = 'auto' | 'skip' | 'ended' | 'playnow' | 'prev'

export interface JukeboxDeps {
  getConfig: () => MusicConfig
  cpp: CppClient
  broadcast: (method: string, params: unknown) => void
  registry?: ProviderRegistry
  /** SQLite 数据库（播放记录持久化） */
  db?: import('../core/database').VtuberDatabase
  /** 配置持久化回调（歌单展开自愈时写回磁盘） */
  persistConfig?: () => void
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
  /** 播放记录（落盘 data/play-history.json，容量 HISTORY_MAX） */
  // 播放记录已迁移至 SQLite（this.deps.db）
  /** 待机歌单跨组扁平轮转游标（内存态，重启从头） */
  private idleCursor = 0
  /** 测试提示音挂起的断点恢复（提示音 ended 或超时后按 positionMs 续播原曲） */
  private testRestore: { np: NowPlaying; posSec: number; wasPaused: boolean; timer: ReturnType<typeof setTimeout> } | null = null

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
    this.clearTestRestore()
    this.archiveOpenRecord('interrupted')
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
    // 豁免数量限制：空闲歌单注入（idle）、系统/控制台操作（运营不受观众侧保护约束）
    const exempt = input.idle || userId === 'system' || userId === 'console'
    const queued = this.activeItems().length
    if (!exempt && queued >= cfg.maxQueueSize) {
      return { success: false, message: `队列已满（${cfg.maxQueueSize}）` }
    }
    if (!exempt) {
      const count = this.activeItems().filter((item) => item.userId === userId).length
      if (count >= cfg.maxPerUser) {
        return { success: false, message: `播放列表内每人最多点 ${cfg.maxPerUser} 首` }
      }
    }

    const media = await this.resolveMedia(input, cfg.defaultSource)
    if (cfg.maxDuration > 0 && media.duration > 0 && media.duration > cfg.maxDuration) {
      return { success: false, message: `歌曲过长（${media.duration}s > ${cfg.maxDuration}s）` }
    }
    // 点歌去重：同一首歌（同音源同 ID）已在待播队列/播放中则拒绝；不同版本 ID 不同可重复。
    // console 不豁免——目的是列表不重复（与数量类豁免不同）；仅空闲歌单自动注入（idle）不受限
    if (cfg.dedupe && !input.idle) {
      const key = `${media.meta.provider}:${media.meta.identifier}`
      const dup = this.activeItems().some((it) => `${it.media.meta.provider}:${it.media.meta.identifier}` === key)
      if (dup) return { success: false, message: `这首歌已在播放列表中：${media.title}` }
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
    // 空队列时仍允许 advance（待机模式可从 idlePlaylists 拉取歌曲）
    if (!this.nowPlaying && !this.pendingPlay && !this.queue.length && !this.flattenIdleRefs(this.deps.getConfig()).length) {
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

  /** 暂停当前曲目（执行器 voice 停止但缓冲保留；elapsed 记账冻结） */
  async pause(): Promise<{ success: boolean; message: string }> {
    const np = this.nowPlaying
    if (!np || np.paused) return { success: false, message: '当前没有播放中的曲目' }
    const res = await this.playerCall('player.pause', { channel: 'music' }) as { ok?: boolean; error?: string }
    if (res && res.ok === false) return { success: false, message: `暂停失败: ${res.error ?? 'unknown'}` }
    np.paused = true
    np.pausedAt = Date.now()
    this.writeNowPlaying(np)
    this.emitState()
    return { success: true, message: '已暂停' }
  }

  /** 恢复播放 */
  async resume(): Promise<{ success: boolean; message: string }> {
    const np = this.nowPlaying
    if (!np || !np.paused) return { success: false, message: '当前未处于暂停状态' }
    const res = await this.playerCall('player.resume', { channel: 'music' }) as { ok?: boolean; error?: string }
    if (res && res.ok === false) return { success: false, message: `恢复失败: ${res.error ?? 'unknown'}` }
    np.pausedAccumMs += Date.now() - (np.pausedAt ?? Date.now())
    np.paused = false
    np.pausedAt = undefined
    this.writeNowPlaying(np)
    this.emitState()
    return { success: true, message: '已恢复播放' }
  }

  /** 拖动进度：用当前 URL 带 positionMs 重放（需新版 audio_executor；旧版会从头播） */
  async seek(sec: number): Promise<{ success: boolean; message: string; position?: number }> {
    const np = this.nowPlaying
    if (!np) return { success: false, message: '当前没有播放中的曲目' }
    const duration = np.item.media.duration || 0
    const target = clamp(sec, 0, duration > 0 ? duration : sec)
    const wasPaused = np.paused
    const cfg = this.deps.getConfig()
    const res = await this.playerCall('player.play', {
      channel: 'music',
      url: np.url.url,
      headers: np.url.headers,
      volume: this.effectiveVolume(),
      device: cfg.outputDevice,
      title: np.item.media.title,
      positionMs: Math.round(target * 1000),
    }) as { ok?: boolean; error?: string }
    if (res && res.ok === false) {
      return { success: false, message: `进度跳转失败: ${res.error ?? 'unknown'}（旧版 audio_executor 不支持，请重编）` }
    }
    np.offsetMs = target * 1000
    np.startedAt = Date.now()
    np.pausedAccumMs = 0
    if (wasPaused) {
      np.pausedAt = Date.now()
      void this.playerCall('player.pause', { channel: 'music' })
    }
    this.writeNowPlaying(np)
    this.deps.broadcast('jukebox.nowPlaying', this.serializeNowPlaying())
    this.emitState()
    return { success: true, message: `已跳转到 ${Jukebox.formatTime(target)}`, position: target }
  }

  /**
   * 播放测试提示音（music 通道）：有歌在播时先冻结记账（外观同暂停），
   * 提示音 ended（或超时兜底）后按 positionMs 从断点续播原曲，而非切歌。
   */
  async testChime(input: { device?: string; volume?: number; bytes: number[] }): Promise<{ ok: boolean; error?: string }> {
    const np = this.nowPlaying
    if (!this.running || !np) {
      // 无歌在播：直接播（ended 过滤器保证 bytes:// 事件不会误触发 advance）
      const res = await this.playerCall('player.play', {
        channel: 'music',
        bytes: input.bytes,
        device: input.device,
        volume: input.volume,
        title: '[Audio Test] MUSIC',
      })
      return res as { ok: boolean; error?: string }
    }
    if (this.testRestore) await this.restoreAfterTest()
    const posSec = Math.max(0, this.elapsedSec(np))
    const wasPaused = np.paused
    // 冻结记账：输出文件/状态展示与暂停一致
    np.paused = true
    np.pausedAt = Date.now()
    this.writeNowPlaying(np)
    this.emitState()
    const res = await this.playerCall('player.play', {
      channel: 'music',
      bytes: input.bytes,
      device: input.device,
      volume: input.volume,
      title: '[Audio Test] MUSIC',
    }) as { ok?: boolean; error?: string }
    if (res && res.ok === false) {
      // 播放失败但原曲已被顶掉：立即断点续播
      await this.restoreAfterTest()
      return { ok: false, error: res.error ?? 'unknown' }
    }
    this.testRestore = {
      np,
      posSec,
      wasPaused,
      // ended 丢失（执行器异常等）时的兜底恢复
      timer: setTimeout(() => { void this.restoreAfterTest() }, 5000),
    }
    return { ok: true }
  }

  /** 测试音结束后断点续播：按 seek 路径带 positionMs 重放，恢复原记账状态 */
  private async restoreAfterTest(): Promise<void> {
    const pending = this.testRestore
    if (!pending) return
    this.clearTestRestore()
    const { np, posSec, wasPaused } = pending
    // 期间已被切歌/停止：原曲不再需要恢复
    if (np !== this.nowPlaying || !np) return
    const cfg = this.deps.getConfig()
    const res = await this.playerCall('player.play', {
      channel: 'music',
      url: np.url.url,
      headers: np.url.headers,
      volume: this.effectiveVolume(),
      device: cfg.outputDevice,
      title: np.item.media.title,
      positionMs: Math.round(posSec * 1000),
    }) as { ok?: boolean; error?: string }
    if (res && res.ok === false) {
      console.warn('[jukebox] 测试音后断点续播失败:', res.error)
      void this.advance('skip')
      return
    }
    np.offsetMs = posSec * 1000
    np.startedAt = Date.now()
    np.pausedAccumMs = 0
    np.paused = wasPaused
    np.pausedAt = wasPaused ? Date.now() : undefined
    if (wasPaused) void this.playerCall('player.pause', { channel: 'music' })
    this.writeNowPlaying(np)
    this.deps.broadcast('jukebox.nowPlaying', this.serializeNowPlaying())
    this.emitState()
  }

  private clearTestRestore(): void {
    if (!this.testRestore) return
    clearTimeout(this.testRestore.timer)
    this.testRestore = null
  }

  /** 输出配置（模板/输出列表/queue 元素格式）变更后立即重写输出文件 */
  refreshNowPlayingOutputs(): void {
    this.writeNowPlaying(this.nowPlaying)
  }

  /** 删除一个歌曲信息输出文件（WebUI 删除输出条目时清理 data/music_info 下的落盘文件） */
  removeNowPlayingOutput(file: string): { success: boolean; message: string } {
    const name = path.basename(String(file || '').replace(/\\/g, '/'))
    if (!name) return { success: false, message: '缺少文件名' }
    const target = path.join(resolveBackendPath('data/music_info'), name)
    try {
      fs.unlinkSync(target)
      return { success: true, message: `已删除 ${name}` }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { success: true, message: `文件不存在（视为已删除）：${name}` }
      return { success: false, message: `删除失败: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /** 上一首：从播放记录找最近一首已结束且可解析的曲目立即重播 */
  async previous(): Promise<{ success: boolean; message: string }> {
    const currentId = this.nowPlaying?.item.id
    const rec = this.getHistory(50).find((r) => r.status && r.songId && r.source && r.id !== currentId)
    if (!rec) return { success: false, message: '没有可重播的上一首记录' }
    return this.playNow({ songId: rec.songId, source: rec.source, title: rec.title, userName: 'console' })
  }

  /** 立即播放：解析后插队首并切歌（当前曲记为跳过） */
  async playNow(input: {
    songId?: string
    source?: string
    keyword?: string
    title?: string
    userId?: string
    userName?: string
  }): Promise<{ success: boolean; message: string }> {
    if (!this.running) return { success: false, message: '点歌机未启动' }
    let media: MediaInfo
    try {
      media = await this.resolveMedia(input, this.deps.getConfig().defaultSource)
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
    const item: QueueItem = {
      id: `q${++this.seq}`,
      media,
      userId: input.userId || 'console',
      userName: input.userName || 'console',
      requestedAt: Date.now(),
      idle: false,
    }
    this.queue.unshift(item)
    if (this.advancing) {
      this.skipRequested = true
    } else {
      void this.advance('playnow')
    }
    return { success: true, message: `立即播放：${media.title} - ${media.artist}` }
  }

  /** 播放记录（最新在前） */
  getHistory(limit = 100, before?: number): PlayHistoryRecord[] {
    const db = this.deps.db
    if (!db) return []
    const rows = db.getPlayHistory(limit, before)
    return rows.map((r) => ({
      id: String(r.queue_id),
      title: r.title,
      artist: r.artist,
      source: r.source,
      songId: r.song_id,
      duration: r.duration,
      cover: r.cover,
      userId: r.user_id,
      userName: r.user_name,
      requestedAt: r.requested_at,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
      status: (r.status ?? undefined) as PlayHistoryRecord['status'],
    }))
  }

  tryDirectOrder(event: StandardEvent): boolean {
    const cfg = this.deps.getConfig()
    if (event.type !== 'danmaku') return false
    const content = String(event.data?.content ?? '').trim()
    // 切歌指令：整条弹幕精确匹配即跳过当前曲目（优先于点歌前缀匹配，独立于 directOrder 开关）
    const skipCfg = cfg.skipCommand
    if (skipCfg?.enabled && (skipCfg.keywords ?? []).some((k) => k.trim() && content === k.trim())) {
      this.handleSkipCommand(event)
      return true
    }
    if (!cfg.directOrder.enabled) return false
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

  /** 弹幕切歌（Ayna 风格）：selfOnly 时他人点的歌不可切，空闲曲目（userId=system）任何人可切 */
  private handleSkipCommand(event: StandardEvent): void {
    const np = this.nowPlaying
    const uid = event.user?.uid || 'anon'
    const title = np?.item.media.title || ''
    if (np && this.deps.getConfig().skipCommand?.selfOnly && np.item.userId !== 'system' && np.item.userId !== uid) {
      this.deps.broadcast('jukebox.skipCommanded', { ok: false, message: '只能切自己点的歌', user: event.user, title })
      return
    }
    const result = this.skip()
    this.deps.broadcast('jukebox.skipCommanded', { ok: result.success, message: result.message, user: event.user, title })
  }

  /** 空闲歌单分组批量解析（WebUI 双栏展示用，只读；失败条目返回 ok:false 与原始 ref） */
  async previewIdleGroups(): Promise<Array<{
    name: string
    ref: string
    songs: Array<{ ref: string; ok: boolean; title?: string; artist?: string; duration?: number; cover?: string; provider?: string }>
  }>> {
    const cfg = this.deps.getConfig()
    const groups = cfg.idlePlaylists ?? []
    const out = groups.map((g) => ({
      name: g?.name || '未命名歌单',
      ref: g?.ref || '',
      songs: new Array(g?.songs?.length ?? 0),
    }))
    // 扁平任务表 + 并发限流：歌单动辄数百条，串行逐条解析会远超 RPC 超时
    const tasks: Array<{ g: number; s: number; ref: string }> = []
    groups.forEach((g, gi) => (g?.songs ?? []).forEach((ref, si) => tasks.push({ g: gi, s: si, ref: String(ref) })))
    let cursor = 0
    const worker = async () => {
      while (cursor < tasks.length) {
        const t = tasks[cursor++]
        try {
          const media = await this.resolveMedia(parseIdleRef(t.ref), cfg.defaultSource)
          out[t.g].songs[t.s] = {
            ref: t.ref, ok: true, title: media.title, artist: media.artist,
            duration: media.duration, cover: media.cover, provider: media.meta.provider,
          }
        } catch {
          out[t.g].songs[t.s] = { ref: t.ref, ok: false }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(10, Math.max(1, tasks.length)) }, worker))
    return out
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
    this.archiveOpenRecord('interrupted')
    this.queue.unshift(this.nowPlaying.item)
    this.nowPlaying = null
    this.pendingPlay = null
    this.writeNowPlaying(null)
    this.emitState()
    void this.ensurePlaying()
  }

  private emitHistory(): void {
    this.deps.broadcast('jukebox.history', { records: this.getHistory() })
  }

  /** 开播成功时新增一条进行中记录 */
  private pushHistoryRecord(item: QueueItem): void {
    this.deps.db?.insertPlayHistory({
      queue_id: item.id,
      title: item.media.title,
      artist: item.media.artist,
      source: item.media.meta.provider,
      song_id: item.media.meta.identifier,
      duration: item.media.duration,
      cover: item.media.cover,
      user_id: item.userId,
      user_name: item.userName,
      requested_at: item.requestedAt,
      started_at: Date.now(),
      ended_at: null,
      status: null,
    })
    this.emitHistory()
  }

  /** 归档最近一条进行中记录（无进行中记录则忽略） */
  private archiveOpenRecord(status: NonNullable<PlayHistoryRecord['status']>): void {
    this.deps.db?.archiveOpenPlayHistory(status, Date.now())
    this.emitHistory()
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
        // 调用方显式带 title（playNow 快捷路径）时信任构造，不再查 info
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
      // 无 title 时 info 失败必须抛出——静默伪造 title=songId 的曲目
      // 会让歌单号/无效 ref 被当歌曲播放（idle 调度依赖此抛出来触发跳过/歌单展开）
      return await this.registry.info(meta)
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
      const rec = (params ?? {}) as { channel?: string; url?: string }
      if (rec.channel && rec.channel !== 'music') return
      // 合成音（测试提示音等 bytes:// 源）结束：只做挂起的断点恢复，绝不当作歌曲 ended
      if (typeof rec.url === 'string' && rec.url.startsWith('bytes://')) {
        if (this.testRestore) void this.restoreAfterTest()
        return
      }
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
    // 归档上一曲：ended→播完 / skip·playnow·prev→跳过 / 其余(auto)→中断
    this.archiveOpenRecord(reason === 'ended' ? 'completed' : (reason === 'skip' || reason === 'playnow' || reason === 'prev') ? 'skipped' : 'interrupted')
    // 本次尝试开播的曲目：pendingPlay 在 playerCall 前会被清空，失败记录需从这里取
    let attemptedItem: QueueItem | null = null
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
      attemptedItem = next
      const urls = await this.registry.url(next.media.meta)
      if (!urls.length) throw new MusicError('无法解析播放地址')
      // 解析期间已被 stop()/restart()：本次 advance 过期，不再开播
      if (this.generation !== gen) {
        this.pendingPlay = null
        this.emitState()
        if (this.running) void this.ensurePlaying()
        return
      }
      const lyrics = (await this.registry.lyric(next.media.meta).catch(() => []))[0] ?? null
      if (this.generation !== gen) {
        this.pendingPlay = null
        this.emitState()
        if (this.running) void this.ensurePlaying()
        return
      }
      this.nowPlaying = {
        item: next,
        url: urls[0],
        lyrics,
        startedAt: Date.now(),
        paused: false,
        pausedAccumMs: 0,
        offsetMs: 0,
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
          if (this.running) void this.ensurePlaying()
        }
        return
      }
      // safeRequest 失败时返回 {ok:false} 而非抛异常，不检查会让队列
      // 卡在永远不会 ended 的“幽灵曲目”上
      if (play && play.ok === false) {
        throw new MusicError(`播放器调用失败: ${play.error ?? 'unknown'}`)
      }
      this.consecutiveFailures = 0
      this.pushHistoryRecord(next)
      this.writeNowPlaying(this.nowPlaying)
      this.deps.broadcast('jukebox.nowPlaying', this.serializeNowPlaying())
      this.emitState()
    } catch (err) {
      console.error(`[jukebox] advance(${reason}) failed:`, err)
      // 开播失败也留一条「失败」记录（点歌时间/歌名等信息保真）
      const failed = attemptedItem
      this.nowPlaying = null
      this.pendingPlay = null
      if (failed) {
        this.deps.db?.insertFailedPlayHistory({
          queue_id: failed.id,
          title: failed.media.title,
          artist: failed.media.artist,
          source: failed.media.meta.provider,
          song_id: failed.media.meta.identifier,
          duration: failed.media.duration,
          cover: failed.media.cover,
          user_id: failed.userId,
          user_name: failed.userName,
          requested_at: failed.requestedAt,
          started_at: Date.now(),
          ended_at: Date.now(),
          status: 'failed',
        })
        this.emitHistory()
      }
      this.writeNowPlaying(null)
      this.emitState()
      if (this.generation === gen && (this.queue.length || this.flattenIdleRefs(this.deps.getConfig()).length)) {
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

  /** 待机歌曲跨组扁平序列（分组顺序即优先序） */
  private flattenIdleRefs(cfg: MusicConfig): string[] {
    return (cfg.idlePlaylists ?? []).flatMap((g) => (g?.songs ?? []).map(String))
  }

  private async nextIdleItem(): Promise<QueueItem | null> {
    const cfg = this.deps.getConfig()
    if (!this.flattenIdleRefs(cfg).length) return null
    // 最多尝试一轮展平后的歌曲序列（歌单展开可能动态增加条目）
    for (let attempt = 0; attempt < 200; attempt++) {
      const refs = this.flattenIdleRefs(cfg)
      if (!refs.length) return null
      if (!cfg.idleLoop && this.idleCursor >= refs.length) return null
      const idx = this.idleCursor % refs.length
      const raw = refs[idx]
      try {
        const media = await this.resolveMedia(parseIdleRef(raw), cfg.defaultSource)
        this.idleCursor++
        return {
          id: `idle${++this.seq}`,
          media,
          userId: 'idle',
          userName: 'idle',
          requestedAt: Date.now(),
          idle: true,
        }
      } catch {
        // 解析失败 → 尝试按歌单展开（歌单号误存为歌曲 ref 的自愈路径）
        const expanded = await this.tryExpandPlaylistRef(cfg, raw, idx)
        if (expanded) continue // 展开成功，重取展平列表（新歌曲已替换坏 ref）
        console.warn('[jukebox] idle item failed, skipping:', raw)
        this.idleCursor++
      }
    }
    console.warn('[jukebox] 待机歌单解析反复失败，本轮放弃')
    return null
  }

  /**
   * 歌单引用自愈：把误存为歌曲 ref 的歌单号/链接展开为歌曲列表，
   * 替换分组中的该条 ref（写回 config）并返回 true。
   * 仿 AynaLivePlayer：歌单展开应在添加时完成，此处兜底已混入的脏数据。
   */
  private async tryExpandPlaylistRef(cfg: MusicConfig, raw: string, flatIdx: number): Promise<boolean> {
    try {
      const hit = await this.registry.playlist(raw)
      if (!hit || !hit.items?.length) return false
      const songRefs = hit.items.map((m) => `${m.meta.provider}:${m.meta.identifier}`)
      // 找到 flatIdx 对应的 (group, songIdx) 并替换
      let cursor = 0
      for (const group of cfg.idlePlaylists ?? []) {
        for (let si = 0; si < (group.songs ?? []).length; si++) {
          if (cursor === flatIdx && group.songs[si] === raw) {
            console.log(`[jukebox] 检测到歌单引用，展开 ${songRefs.length} 首替换: ${raw}`)
            group.songs.splice(si, 1, ...songRefs)
            try { this.deps.persistConfig?.() } catch { /* 持久化失败不影响本次播放 */ }
            return true
          }
          cursor++
        }
      }
      return false
    } catch {
      return false
    }
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

  /** 当前已播秒数（含 seek 偏移；暂停时冻结） */
  private elapsedSec(now: NowPlaying): number {
    const wallEnd = now.pausedAt ?? Date.now()
    return Math.max(0, (now.offsetMs + (wallEnd - now.startedAt) - now.pausedAccumMs) / 1000)
  }

  private serializeNowPlaying() {
    if (!this.nowPlaying) return null
    const elapsed = this.elapsedSec(this.nowPlaying)
    return {
      ...this.serializeItem(this.nowPlaying.item),
      url: this.nowPlaying.url.url,
      startedAt: this.nowPlaying.startedAt,
      paused: this.nowPlaying.paused,
      offsetMs: this.nowPlaying.offsetMs,
      elapsed,
      currentLyric: this.nowPlaying.lyrics ? findLyric(this.nowPlaying.lyrics, elapsed).lyric : '',
      lyric: this.nowPlaying.lyrics ? findLyric(this.nowPlaying.lyrics, elapsed).lyric : '',
      hasLyrics: Boolean(this.nowPlaying.lyrics),
      lyrics: this.nowPlaying.lyrics?.content ?? [],
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

  /** {{queue}} 默认元素格式（与历史行为一致） */
  private static DEFAULT_QUEUE_TPL = '{{index}}. {{title}} - {{artist}}'

  /**
   * 包裹式模板解包：开头单独一行 {{、结尾单独一行 }} 时，剥掉包裹、内部逐字保留
   * （包裹内的换行视为用户有意行为，原样渲染）。非包裹式返回 null 走旧逻辑。
   * 独立成行的判定使变量花括号（{{index}} 等）不会被误判为包裹。
   */
  private static unwrapQueueTemplate(raw: string): string | null {
    const m = raw.match(/^\{\{[ \t]*\r?\n([\s\S]*)\r?\n[ \t]*\}\}[ \t]*$/)
    return m ? m[1] : null
  }

  /** 待播队列 → 文本列表：每个元素用 queueItemTemplate 渲染（元素级变量），换行连接 */
  private renderQueueList(tpl?: string): string {
    const raw = tpl ?? ''
    const unwrapped = Jukebox.unwrapQueueTemplate(raw)
    // 包裹式：内容原样渲染（换行为有意行为）；无包裹：trim 后渲染（兼容旧配置）；空白回退默认
    const template = unwrapped !== null ? unwrapped : (raw.trim() || Jukebox.DEFAULT_QUEUE_TPL)
    return this.queue
      .map((q, i) =>
        Jukebox.renderTemplate(template, {
          index: String(i + 1),
          title: q.media.title ?? '',
          artist: q.media.artist ?? '',
          duration: Jukebox.formatTime(q.media.duration || 0),
          durationSec: String(Math.round(q.media.duration || 0)),
          user: q.userName ?? '',
          source: q.media.meta?.provider ?? '',
          songId: q.media.meta?.identifier ?? '',
          cover: q.media.cover ?? '',
        })
      )
      .join('\n')
  }

  /** 组装当前播放的模板变量上下文 */
  private nowPlayingContext(current: NowPlaying | null): Record<string, string> {
    const base: Record<string, string> = {
      status: 'idle',
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      queueLength: String(this.queue.length),
      queue: this.renderQueueList(this.deps.getConfig().nowPlaying?.queueItemTemplate),
    }
    if (!current) return base
    const m = current.item.media
    const duration = Math.max(0, Math.round(m.duration || 0))
    const elapsed = Math.max(0, Math.round(this.elapsedSec(current)))
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

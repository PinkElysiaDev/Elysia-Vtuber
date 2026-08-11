/**
 * 歌曲信息
 */
export interface SongInfo {
  id: string
  title: string
  artist: string
  album?: string
  duration: number
  source: string
  url?: string
  coverUrl?: string
  requestUser?: string
  addedAt: number
}

/**
 * 播放状态
 */
export interface PlaybackState {
  playing: boolean
  currentSong: SongInfo | null
  position: number
  volume: number
  queue: SongInfo[]
}

/**
 * 搜索结果
 */
export interface SearchResult {
  id: string
  title: string
  artist: string
  album?: string
  duration: number
  source: string
}

/**
 * 点歌机管理器
 *
 * 注意：完整实现需要集成音乐播放库和各种音源 API
 * 可以参考 AynaLivePlayer 项目的实现
 */
export class MusicPlayerManager {
  private queue: SongInfo[] = []
  private currentSong: SongInfo | null = null
  private playing: boolean = false
  private position: number = 0
  private volume: number = 1.0

  /**
   * 搜索歌曲
   */
  async search(params: {
    keyword: string
    source?: string
    limit?: number
  }): Promise<SearchResult[]> {
    console.log(`Searching: ${params.keyword} (source: ${params.source || 'all'})`)

    // TODO: 实际搜索实现
    // 需要集成网易云音乐、QQ音乐等 API
    // 参考 AynaLivePlayer 的实现

    // 模拟搜索结果
    return [
      {
        id: 'mock_1',
        title: params.keyword,
        artist: 'Mock Artist',
        duration: 240,
        source: params.source || 'netease',
      },
    ]
  }

  /**
   * 添加歌曲到队列
   */
  async addSong(params: {
    songId: string
    source: string
    requestUser?: string
  }): Promise<void> {
    console.log(`Adding song: ${params.songId} (source: ${params.source})`)

    // TODO: 获取歌曲详细信息和播放URL
    const song: SongInfo = {
      id: params.songId,
      title: 'Mock Song',
      artist: 'Mock Artist',
      duration: 240,
      source: params.source,
      requestUser: params.requestUser,
      addedAt: Date.now(),
    }

    this.queue.push(song)
    console.log(`Song added to queue. Queue length: ${this.queue.length}`)

    // 如果没有正在播放的歌曲，自动播放
    if (!this.currentSong && !this.playing) {
      await this.playNext()
    }
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    if (this.playing) {
      return
    }

    if (!this.currentSong && this.queue.length > 0) {
      await this.playNext()
      return
    }

    if (this.currentSong) {
      console.log('Resuming playback')
      this.playing = true
      // TODO: 实际恢复播放
    }
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    if (!this.playing) {
      return
    }

    console.log('Pausing playback')
    this.playing = false
    // TODO: 实际暂停播放
  }

  /**
   * 切歌
   */
  async skip(): Promise<void> {
    console.log('Skipping to next song')
    await this.playNext()
  }

  /**
   * 播放下一首
   */
  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      console.log('Queue empty, stopping playback')
      this.currentSong = null
      this.playing = false
      this.position = 0
      return
    }

    const song = this.queue.shift()!
    this.currentSong = song
    this.position = 0
    this.playing = true

    console.log(`Now playing: ${song.title} - ${song.artist}`)

    // TODO: 实际播放音频
    // 需要集成音频播放库（如 howler.js 或原生 Web Audio API）
  }

  /**
   * 移除队列中的歌曲
   */
  async removeSong(index: number): Promise<void> {
    if (index < 0 || index >= this.queue.length) {
      throw new Error('Invalid queue index')
    }

    const removed = this.queue.splice(index, 1)[0]
    console.log(`Removed from queue: ${removed.title}`)
  }

  /**
   * 清空队列
   */
  async clearQueue(): Promise<void> {
    console.log('Clearing queue')
    this.queue = []
  }

  /**
   * 获取队列
   */
  getQueue(): SongInfo[] {
    return [...this.queue]
  }

  /**
   * 获取当前播放信息
   */
  getCurrentSong(): SongInfo | null {
    return this.currentSong ? { ...this.currentSong } : null
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    if (volume < 0 || volume > 1) {
      throw new Error('Volume must be between 0 and 1')
    }

    console.log(`Setting volume: ${volume}`)
    this.volume = volume

    // TODO: 实际设置音量
  }

  /**
   * 获取播放状态
   */
  getState(): PlaybackState {
    return {
      playing: this.playing,
      currentSong: this.currentSong ? { ...this.currentSong } : null,
      position: this.position,
      volume: this.volume,
      queue: [...this.queue],
    }
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    console.log('Stopping playback')
    this.playing = false
    this.currentSong = null
    this.position = 0

    // TODO: 实际停止播放
  }
}

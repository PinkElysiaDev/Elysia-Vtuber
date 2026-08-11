import { BrowserWindow } from 'electron'
import * as path from 'path'
import { Logger } from '../../types/common'

/**
 * 歌曲信息
 */
export interface SongInfo {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  cover: string
  source: 'netease' | 'qq' | 'bilibili' | 'local'
  url?: string
}

/**
 * 播放状态
 */
export interface PlaybackState {
  playing: boolean
  currentSong: SongInfo | null
  position: number
  duration: number
  volume: number
}

/**
 * 点歌机配置
 */
export interface JukeboxConfig {
  width: number
  height: number
  x?: number
  y?: number
  alwaysOnTop: boolean
  showLyrics: boolean
  autoPlay: boolean
  maxDuration: number  // 最大歌曲时长(秒)
  idlePlaylist: string[]  // 空闲歌单
}

/**
 * 点歌机管理器
 */
export class JukeboxManager {
  private window: BrowserWindow | null = null
  private queue: SongInfo[] = []
  private currentSong: SongInfo | null = null
  private playing: boolean = false
  private config: JukeboxConfig | null = null

  constructor(private logger: Logger) {}

  /**
   * 创建点歌机窗口
   */
  async createWindow(config: JukeboxConfig): Promise<void> {
    if (this.window) {
      this.logger.warn('点歌机窗口已存在')
      return
    }

    this.config = config

    this.window = new BrowserWindow({
      width: config.width,
      height: config.height,
      x: config.x,
      y: config.y,
      alwaysOnTop: config.alwaysOnTop,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
      },
    })

    const htmlPath = path.join(__dirname, '../../../renderer/jukebox.html')
    await this.window.loadFile(htmlPath)

    this.window.webContents.send('init-config', {
      showLyrics: config.showLyrics,
      maxDuration: config.maxDuration,
    })

    this.window.on('closed', () => {
      this.window = null
    })

    // 监听播放器事件
    this.setupPlayerEvents()

    this.logger.info('点歌机窗口已创建')
  }

  /**
   * 设置播放器事件监听
   */
  private setupPlayerEvents(): void {
    if (!this.window) return

    const { ipcMain } = require('electron')

    // 歌曲播放结束
    ipcMain.on('song-ended', () => {
      this.handleSongEnded()
    })

    // 播放状态变化
    ipcMain.on('playback-state-changed', (event: any, state: PlaybackState) => {
      this.playing = state.playing
      this.currentSong = state.currentSong
    })
  }

  /**
   * 处理歌曲播放结束
   */
  private handleSongEnded(): void {
    this.currentSong = null

    if (this.queue.length > 0) {
      // 播放队列中的下一首
      const nextSong = this.queue.shift()!
      this.playSong(nextSong)
    } else if (this.config?.autoPlay && this.config.idlePlaylist.length > 0) {
      // 播放空闲歌单
      const randomIndex = Math.floor(Math.random() * this.config.idlePlaylist.length)
      const songId = this.config.idlePlaylist[randomIndex]
      // 这里需要从歌曲ID获取歌曲信息，暂时跳过
      this.logger.info(`空闲播放: ${songId}`)
    }
  }

  /**
   * 搜索歌曲
   */
  async searchSong(keyword: string, source?: string): Promise<SongInfo[]> {
    if (!this.window) {
      throw new Error('点歌机窗口未打开')
    }

    return new Promise((resolve) => {
      const handler = (_event: any, results: any) => {
        (this.window!.webContents as any).off('search-results', handler)
        resolve(results)
      }
      ;(this.window!.webContents as any).on('search-results', handler)
      this.window!.webContents.send('search-song', { keyword, source })
    })
  }

  /**
   * 添加歌曲到队列
   */
  async addSong(song: SongInfo): Promise<void> {
    // 检查时长限制
    if (this.config && song.duration > this.config.maxDuration) {
      throw new Error(`歌曲时长超过限制 (${this.config.maxDuration}秒)`)
    }

    this.queue.push(song)
    this.logger.info(`添加歌曲到队列: ${song.title} - ${song.artist}`)

    // 如果当前没有播放，开始播放
    if (!this.playing && this.config?.autoPlay) {
      const nextSong = this.queue.shift()!
      await this.playSong(nextSong)
    }
  }

  /**
   * 播放歌曲
   */
  async playSong(song: SongInfo): Promise<void> {
    if (!this.window) {
      throw new Error('点歌机窗口未打开')
    }

    this.currentSong = song
    this.playing = true

    this.window.webContents.send('play-song', song)
    this.logger.info(`播放歌曲: ${song.title} - ${song.artist}`)
  }

  /**
   * 切换下一首
   */
  async skipSong(): Promise<void> {
    if (this.queue.length === 0) {
      throw new Error('队列为空')
    }

    const nextSong = this.queue.shift()!
    await this.playSong(nextSong)
  }

  /**
   * 暂停/继续播放
   */
  togglePlayback(): void {
    if (!this.window) {
      throw new Error('点歌机窗口未打开')
    }

    this.window.webContents.send('toggle-playback')
  }

  /**
   * 设置音量
   */
  setVolume(volume: number): void {
    if (!this.window) {
      throw new Error('点歌机窗口未打开')
    }

    this.window.webContents.send('set-volume', { volume })
  }

  /**
   * 获取当前播放状态
   */
  async getPlaybackState(): Promise<PlaybackState> {
    if (!this.window) {
      throw new Error('点歌机窗口未打开')
    }

    return new Promise((resolve) => {
      const handler = (_event: any, state: any) => {
        (this.window!.webContents as any).off('playback-state', handler)
        resolve(state)
      }
      ;(this.window!.webContents as any).on('playback-state', handler)
      this.window!.webContents.send('get-playback-state')
    })
  }

  /**
   * 获取播放队列
   */
  getQueue(): SongInfo[] {
    return [...this.queue]
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queue = []
    this.logger.info('播放队列已清空')
  }

  /**
   * 获取当前歌曲
   */
  getCurrentSong(): SongInfo | null {
    return this.currentSong
  }

  /**
   * 关闭窗口
   */
  closeWindow(): void {
    if (this.window) {
      this.window.close()
      this.window = null
      this.logger.info('点歌机窗口已关闭')
    }
  }

  /**
   * 是否已打开
   */
  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }
}

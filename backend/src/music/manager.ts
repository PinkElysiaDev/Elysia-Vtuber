/**
 * 点歌机管理器
 */

import type { WindowManager } from '../window/manager'
import type { MusicConfig } from '../config'

export interface Song {
  id: string
  title: string
  artist: string
  duration: number
  cover?: string
  source: 'netease' | 'qq' | 'bilibili'
}

export interface SearchResult {
  songs: Song[]
  total: number
}

export interface NowPlaying {
  song: Song
  currentTime: number
  duration: number
  isPlaying: boolean
}

export class MusicPlayerManager {
  private windowManager: WindowManager
  private config: MusicConfig
  private queue: Song[] = []
  private currentSong?: Song
  private isPlaying: boolean = false
  private musicWindowId?: string

  constructor(windowManager: WindowManager, config: MusicConfig) {
    this.windowManager = windowManager
    this.config = config
  }

  /**
   * 搜索歌曲
   */
  async search(keyword: string, source?: string): Promise<SearchResult> {
    // TODO: 实现实际的搜索逻辑
    // 可以参考 AynaLivePlayer 项目的实现

    // 临时返回空结果
    return {
      songs: [],
      total: 0
    }
  }

  /**
   * 添加歌曲到队列
   */
  async addToQueue(songId: string, source: string): Promise<Song> {
    // TODO: 从音源获取歌曲信息并添加到队列

    const song: Song = {
      id: songId,
      title: 'Unknown',
      artist: 'Unknown',
      duration: 0,
      source: source as any
    }

    this.queue.push(song)

    // 如果当前没有播放，自动播放
    if (!this.currentSong) {
      await this.play()
    }

    return song
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    if (!this.currentSong && this.queue.length > 0) {
      this.currentSong = this.queue.shift()
    }

    if (!this.currentSong) {
      throw new Error('No song to play')
    }

    // 创建音乐播放窗口（如果不存在）
    if (!this.musicWindowId) {
      this.musicWindowId = await this.windowManager.createWindow('music', {
        title: 'Music Player',
        width: 400,
        height: 200
      })
    }

    // 发送播放命令
    this.windowManager.sendToWindow(this.musicWindowId, 'music:play', {
      song: this.currentSong
    })

    this.isPlaying = true
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    if (!this.musicWindowId) return

    this.windowManager.sendToWindow(this.musicWindowId, 'music:pause', {})
    this.isPlaying = false
  }

  /**
   * 跳过当前歌曲
   */
  async skip(): Promise<void> {
    this.currentSong = undefined

    if (this.queue.length > 0) {
      await this.play()
    } else {
      await this.pause()
    }
  }

  /**
   * 获取播放队列
   */
  async getQueue(): Promise<Song[]> {
    return [...this.queue]
  }

  /**
   * 获取当前播放信息
   */
  async getNowPlaying(): Promise<NowPlaying | null> {
    if (!this.currentSong) {
      return null
    }

    // TODO: 获取实际的播放进度
    return {
      song: this.currentSong,
      currentTime: 0,
      duration: this.currentSong.duration,
      isPlaying: this.isPlaying
    }
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    if (!this.musicWindowId) return

    this.windowManager.sendToWindow(this.musicWindowId, 'music:volume', {
      volume: Math.max(0, Math.min(1, volume))
    })
  }

  /**
   * 清空队列
   */
  async clearQueue(): Promise<void> {
    this.queue = []
  }

  /**
   * 关闭音乐播放器
   */
  async close(): Promise<void> {
    if (this.musicWindowId) {
      await this.windowManager.closeWindow(this.musicWindowId)
      this.musicWindowId = undefined
      this.currentSong = undefined
      this.isPlaying = false
    }
  }
}

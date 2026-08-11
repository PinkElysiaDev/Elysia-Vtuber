/**
 * 音频播放状态
 */
export interface AudioState {
  playing: boolean
  currentUrl: string | null
  volume: number
  queue: string[]
}

/**
 * 音频播放管理器
 *
 * 用于播放 TTS 音频和其他音效
 */
export class AudioPlayerManager {
  private queue: string[] = []
  private currentUrl: string | null = null
  private playing: boolean = false
  private volume: number = 1.0

  /**
   * 播放音频
   */
  async play(url: string, volume?: number): Promise<void> {
    console.log(`Playing audio: ${url}`)

    if (volume !== undefined) {
      this.volume = Math.max(0, Math.min(1, volume))
    }

    // 如果正在播放，添加到队列
    if (this.playing) {
      this.queue.push(url)
      console.log(`Audio queued. Queue length: ${this.queue.length}`)
      return
    }

    this.currentUrl = url
    this.playing = true

    // TODO: 实际播放音频
    // 需要集成音频播放库
    // 在 Electron 环境中可以使用：
    // 1. HTML5 Audio API
    // 2. howler.js
    // 3. node-speaker + node-lame

    // 模拟播放完成后自动播放下一个
    // 实际实现中应该在音频播放完成的回调中调用
    // setTimeout(() => this.onPlaybackEnd(), 5000)
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    console.log('Stopping audio playback')

    this.playing = false
    this.currentUrl = null
    this.queue = []

    // TODO: 实际停止音频播放
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    if (volume < 0 || volume > 1) {
      throw new Error('Volume must be between 0 and 1')
    }

    console.log(`Setting audio volume: ${volume}`)
    this.volume = volume

    // TODO: 实际设置音量
  }

  /**
   * 获取状态
   */
  getState(): AudioState {
    return {
      playing: this.playing,
      currentUrl: this.currentUrl,
      volume: this.volume,
      queue: [...this.queue],
    }
  }

  /**
   * 播放完成回调
   */
  private async onPlaybackEnd(): Promise<void> {
    this.playing = false
    this.currentUrl = null

    // 播放队列中的下一个
    if (this.queue.length > 0) {
      const nextUrl = this.queue.shift()!
      await this.play(nextUrl)
    }
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    console.log('Clearing audio queue')
    this.queue = []
  }

  /**
   * 跳过当前音频
   */
  async skip(): Promise<void> {
    if (!this.playing) {
      return
    }

    console.log('Skipping current audio')

    // TODO: 停止当前播放

    await this.onPlaybackEnd()
  }
}

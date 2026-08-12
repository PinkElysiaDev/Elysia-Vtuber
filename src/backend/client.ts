/**
 * 后端通信客户端
 * 通过 WebSocket 连接到独立后端
 */

import WebSocket from 'ws'
import { v4 as uuidv4 } from 'uuid'
import type { Logger } from 'koishi'

export interface BackendClientConfig {
  host: string
  port: number
  reconnectInterval: number
  timeout: number
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: any
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

export class BackendClient {
  private config: BackendClientConfig
  private logger: Logger
  private ws?: WebSocket
  private connected: boolean = false
  private reconnectTimer?: NodeJS.Timeout
  private pendingRequests: Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = new Map()

  constructor(config: BackendClientConfig, logger: Logger) {
    this.config = config
    this.logger = logger
  }

  /**
   * 连接到后端
   */
  async connect(): Promise<void> {
    if (this.connected) return

    const url = `ws://${this.config.host}:${this.config.port}`
    this.logger.info(`连接到后端: ${url}`)

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this.connected = true
        this.logger.success('后端连接成功')
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = undefined
        }
        resolve()
      })

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('close', () => {
        this.connected = false
        this.logger.warn('后端连接已关闭')
        this.scheduleReconnect()
      })

      this.ws.on('error', (error) => {
        this.logger.error('后端连接错误:', error)
        reject(error)
      })

      // 设置连接超时
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('连接超时'))
        }
      }, this.config.timeout)
    })
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    if (this.ws) {
      this.ws.close()
      this.ws = undefined
    }

    this.connected = false

    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('连接已关闭'))
    }
    this.pendingRequests.clear()
  }

  /**
   * 调用后端方法
   */
  async call(method: string, params?: any): Promise<any> {
    if (!this.connected) {
      throw new Error('后端未连接')
    }

    const id = uuidv4()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    return new Promise((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`请求超时: ${method}`))
      }, this.config.timeout)

      this.pendingRequests.set(id, { resolve, reject, timer })

      // 发送请求
      this.ws!.send(JSON.stringify(request))
    })
  }

  /**
   * 发送通知（无需响应）
   */
  notify(method: string, params?: any): void {
    if (!this.connected) {
      this.logger.warn('后端未连接，无法发送通知')
      return
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params
    }

    this.ws!.send(JSON.stringify(notification))
  }

  /**
   * 处理来自后端的消息
   */
  private handleMessage(message: string): void {
    try {
      const response: JsonRpcResponse = JSON.parse(message)

      // 查找对应的请求
      const pending = this.pendingRequests.get(response.id)
      if (!pending) {
        // 可能是通知消息，忽略
        return
      }

      this.pendingRequests.delete(response.id)
      clearTimeout(pending.timer)

      if (response.error) {
        pending.reject(new Error(response.error.message))
      } else {
        pending.resolve(response.result)
      }
    } catch (error) {
      this.logger.error('解析后端消息失败:', error)
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    this.reconnectTimer = setTimeout(async () => {
      this.logger.info('尝试重新连接后端...')
      try {
        await this.connect()
      } catch (error) {
        this.logger.error('重连失败:', error)
      }
    }, this.config.reconnectInterval)
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected
  }

  // ==================== 便捷方法 ====================

  /**
   * 创建窗口
   */
  async createWindow(type: string, options: any): Promise<string> {
    return await this.call('window.create', { type, ...options })
  }

  /**
   * 关闭窗口
   */
  async closeWindow(windowId: string): Promise<void> {
    await this.call('window.close', { windowId })
  }

  /**
   * 加载 Live2D 模型
   */
  async loadLive2D(modelPath: string): Promise<void> {
    await this.call('live2d.load', { modelPath })
  }

  /**
   * 设置 Live2D 表情
   */
  async setLive2DExpression(expression: string): Promise<void> {
    await this.call('live2d.setExpression', { expression })
  }

  /**
   * 播放 Live2D 动作
   */
  async playLive2DMotion(group: string, index: number): Promise<void> {
    await this.call('live2d.playMotion', { group, index })
  }

  /**
   * 显示文本到展示板
   */
  async displayText(text: string, style?: string, emotion?: string): Promise<void> {
    await this.call('display.show', { text, style, emotion })
  }

  /**
   * 播放 TTS 音频
   */
  async playTTS(audio: Buffer, duration: number): Promise<void> {
    // 将 Buffer 转换为 base64
    const audioBase64 = audio.toString('base64')
    await this.call('tts.play', { audio: audioBase64, duration })
  }

  /**
   * 搜索歌曲
   */
  async searchMusic(keyword: string, source?: string): Promise<any> {
    return await this.call('music.search', { keyword, source })
  }

  /**
   * 添加歌曲到播放队列
   */
  async addMusic(songId: string, source: string): Promise<any> {
    return await this.call('music.add', { songId, source })
  }

  /**
   * 播放音乐
   */
  async playMusic(): Promise<void> {
    await this.call('music.play', {})
  }

  /**
   * 暂停音乐
   */
  async pauseMusic(): Promise<void> {
    await this.call('music.pause', {})
  }

  /**
   * 跳过当前歌曲
   */
  async skipMusic(): Promise<void> {
    await this.call('music.skip', {})
  }

  /**
   * 获取播放队列
   */
  async getMusicQueue(): Promise<any[]> {
    return await this.call('music.getQueue', {})
  }

  /**
   * 获取当前播放信息
   */
  async getNowPlaying(): Promise<any> {
    return await this.call('music.getNowPlaying', {})
  }

  /**
   * 请求后端停止进程
   */
  async stopBackendProcess(): Promise<void> {
    await this.call('system.shutdown', {})
  }
}

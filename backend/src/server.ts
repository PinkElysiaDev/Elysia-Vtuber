/**
 * WebSocket 服务器
 */

import * as http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { JsonRpcHandler } from './jsonrpc/handler'
import type { ServerConfig } from './config'
import type { WindowManager } from './window/manager'
import type { Live2DManager } from './live2d/manager'
import type { MusicPlayerManager } from './music/manager'

export interface BackendManagers {
  windowManager: WindowManager
  live2dManager: Live2DManager
  musicPlayerManager: MusicPlayerManager
}

export class BackendServer {
  private config: ServerConfig
  private managers: BackendManagers
  private httpServer?: http.Server
  private wsServer?: WebSocketServer
  private rpcHandler: JsonRpcHandler
  private clients: Set<WebSocket> = new Set()

  constructor(config: ServerConfig, managers: BackendManagers) {
    this.config = config
    this.managers = managers
    this.rpcHandler = new JsonRpcHandler()
    this.registerMethods()
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    // 创建 HTTP 服务器
    this.httpServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Vtuber Backend Server')
    })

    // 创建 WebSocket 服务器
    this.wsServer = new WebSocketServer({ server: this.httpServer })

    this.wsServer.on('connection', (ws: WebSocket) => {
      console.log('客户端已连接')
      this.clients.add(ws)

      ws.on('message', async (data: Buffer) => {
        try {
          const message = data.toString()
          const response = await this.rpcHandler.handle(message)
          if (response) {
            ws.send(response)
          }
        } catch (error) {
          console.error('处理消息失败:', error)
        }
      })

      ws.on('close', () => {
        console.log('客户端已断开')
        this.clients.delete(ws)
      })

      ws.on('error', (error) => {
        console.error('WebSocket 错误:', error)
        this.clients.delete(ws)
      })
    })

    // 启动监听
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        resolve()
      })
      this.httpServer!.on('error', reject)
    })
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    // 关闭所有客户端连接
    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()

    // 关闭 WebSocket 服务器
    if (this.wsServer) {
      await new Promise<void>((resolve) => {
        this.wsServer!.close(() => resolve())
      })
    }

    // 关闭 HTTP 服务器
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
      })
    }
  }

  /**
   * 广播通知
   */
  broadcast(method: string, params?: any): void {
    const notification = JsonRpcHandler.createNotification(method, params)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(notification)
      }
    }
  }

  /**
   * 注册 JSON-RPC 方法
   */
  private registerMethods(): void {
    // ========== 窗口管理 ==========
    this.rpcHandler.register('window.create', async (params) => {
      const { type, title, width, height, url } = params
      return await this.managers.windowManager.createWindow(type, { title, width, height, url })
    })

    this.rpcHandler.register('window.close', async (params) => {
      const { windowId } = params
      await this.managers.windowManager.closeWindow(windowId)
      return { success: true }
    })

    this.rpcHandler.register('window.show', async (params) => {
      const { windowId } = params
      await this.managers.windowManager.showWindow(windowId)
      return { success: true }
    })

    this.rpcHandler.register('window.hide', async (params) => {
      const { windowId } = params
      await this.managers.windowManager.hideWindow(windowId)
      return { success: true }
    })

    // ========== Live2D 管理 ==========
    this.rpcHandler.register('live2d.load', async (params) => {
      const { modelPath } = params
      await this.managers.live2dManager.loadModel(modelPath)
      return { success: true }
    })

    this.rpcHandler.register('live2d.setExpression', async (params) => {
      const { expression } = params
      await this.managers.live2dManager.setExpression(expression)
      return { success: true }
    })

    this.rpcHandler.register('live2d.playMotion', async (params) => {
      const { group, index } = params
      await this.managers.live2dManager.playMotion(group, index)
      return { success: true }
    })

    this.rpcHandler.register('live2d.setScale', async (params) => {
      const { scale } = params
      await this.managers.live2dManager.setScale(scale)
      return { success: true }
    })

    this.rpcHandler.register('live2d.setPosition', async (params) => {
      const { x, y } = params
      await this.managers.live2dManager.setPosition(x, y)
      return { success: true }
    })

    // ========== 点歌机管理 ==========
    this.rpcHandler.register('music.search', async (params) => {
      const { keyword, source } = params
      return await this.managers.musicPlayerManager.search(keyword, source)
    })

    this.rpcHandler.register('music.add', async (params) => {
      const { songId, source } = params
      return await this.managers.musicPlayerManager.addToQueue(songId, source)
    })

    this.rpcHandler.register('music.play', async (params) => {
      await this.managers.musicPlayerManager.play()
      return { success: true }
    })

    this.rpcHandler.register('music.pause', async (params) => {
      await this.managers.musicPlayerManager.pause()
      return { success: true }
    })

    this.rpcHandler.register('music.skip', async (params) => {
      await this.managers.musicPlayerManager.skip()
      return { success: true }
    })

    this.rpcHandler.register('music.getQueue', async (params) => {
      return await this.managers.musicPlayerManager.getQueue()
    })

    this.rpcHandler.register('music.getNowPlaying', async (params) => {
      return await this.managers.musicPlayerManager.getNowPlaying()
    })

    // ========== 显示文本 ==========
    this.rpcHandler.register('display.show', async (params) => {
      const { text, style, emotion } = params
      this.broadcast('display.update', { text, style, emotion })
      return { success: true }
    })

    // ========== TTS 音频播放 ==========
    this.rpcHandler.register('tts.play', async (params) => {
      const { audio, duration } = params
      this.broadcast('tts.audio', { audio, duration })
      return { success: true }
    })

    // ========== 系统控制 ==========
    this.rpcHandler.register('system.shutdown', async () => {
      setTimeout(() => {
        process.exit(0)
      }, 500)
      return { success: true }
    })
  }
}

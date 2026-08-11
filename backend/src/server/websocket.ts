import WebSocket from 'ws'
import { JsonRpcHandler } from '../protocol/handler'

export interface WebSocketServerConfig {
  port: number
  host?: string
}

/**
 * WebSocket 服务器
 */
export class WebSocketServer {
  private wss: WebSocket.Server | null = null
  private clients = new Set<WebSocket>()
  private rpcHandler: JsonRpcHandler

  constructor(private config: WebSocketServerConfig) {
    this.rpcHandler = new JsonRpcHandler()
  }

  /**
   * 获取 RPC 处理器
   */
  getRpcHandler(): JsonRpcHandler {
    return this.rpcHandler
  }

  /**
   * 启动服务器
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocket.Server({
          port: this.config.port,
          host: this.config.host || '127.0.0.1',
        })

        this.wss.on('listening', () => {
          console.log(`WebSocket server listening on ${this.config.host || '127.0.0.1'}:${this.config.port}`)
          resolve()
        })

        this.wss.on('error', (error) => {
          console.error('WebSocket server error:', error)
          reject(error)
        })

        this.wss.on('connection', (ws) => {
          this.handleConnection(ws)
        })

      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 停止服务器
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve()
        return
      }

      // 关闭所有客户端连接
      this.clients.forEach(client => {
        client.close()
      })
      this.clients.clear()

      // 关闭服务器
      this.wss.close(() => {
        console.log('WebSocket server stopped')
        this.wss = null
        resolve()
      })
    })
  }

  /**
   * 处理客户端连接
   */
  private handleConnection(ws: WebSocket) {
    console.log('Client connected')
    this.clients.add(ws)

    ws.on('message', async (data) => {
      try {
        const message = data.toString()
        const response = await this.rpcHandler.handle(message)

        if (response) {
          ws.send(response)
        }
      } catch (error) {
        console.error('Error handling message:', error)
      }
    })

    ws.on('close', () => {
      console.log('Client disconnected')
      this.clients.delete(ws)
    })

    ws.on('error', (error) => {
      console.error('WebSocket client error:', error)
      this.clients.delete(ws)
    })

    // 发送欢迎消息
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'system.connected',
      params: {
        message: 'Connected to Vtuber Backend',
        version: '0.0.1',
      },
    }))
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(method: string, params?: any) {
    const notification = JsonRpcHandler.createNotification(method, params)
    const message = JSON.stringify(notification)

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  }

  /**
   * 获取连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size
  }
}

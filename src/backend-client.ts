import WebSocket from 'ws'
import type { Logger } from 'koishi'

type NotificationHandler = (method: string, params: any) => void | Promise<void>

export class BackendClient {
  private ws?: WebSocket
  private connected = false
  private manualClose = false
  private reconnectTimer?: NodeJS.Timeout
  private nextId = 1
  private pending = new Map<number, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private notificationHandlers = new Map<string, NotificationHandler[]>()

  constructor(
    private readonly host: string,
    private readonly wsPort: number,
    private readonly reconnectInterval: number,
    private readonly timeout: number,
    private readonly logger: Logger,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return
    this.manualClose = false

    const url = `ws://${this.host}:${this.wsPort}`
    this.logger.info(`connecting to backend: ${url}`)

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws

      const timeoutTimer = setTimeout(() => {
        if (!this.connected) {
          ws.terminate()
          reject(new Error('backend connection timeout'))
        }
      }, this.timeout)

      ws.on('open', () => {
        clearTimeout(timeoutTimer)
        this.connected = true
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = undefined
        }
        this.logger.success('backend connected')
        try {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'peer.declare',
            params: { kind: 'plugin' },
          }))
        } catch {}
        resolve()
      })

      ws.on('message', (data) => {
        this.handleMessage(data.toString())
      })

      ws.on('close', () => {
        this.connected = false
        this.logger.warn('backend disconnected')
        this.scheduleReconnect()
      })

      ws.on('error', (error) => {
        clearTimeout(timeoutTimer)
        this.logger.error('backend connection error:', error)
        reject(error)
      })
    })
  }

  disconnect(): void {
    this.manualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    this.connected = false
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('backend disconnected'))
    }
    this.pending.clear()
    this.ws?.close()
    this.ws = undefined
  }

  isConnected(): boolean {
    return this.connected
  }

  on(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method) ?? []
    handlers.push(handler)
    this.notificationHandlers.set(method, handlers)
  }

  request(method: string, params: any = {}): Promise<any> {
    if (!this.connected) {
      return Promise.reject(new Error('backend not connected'))
    }

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request timeout: ${method}`))
      }, this.timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }))
    })
  }

  notify(method: string, params: any = {}): void {
    if (!this.connected || !this.ws) return
    this.ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }))
  }

  private handleMessage(raw: string): void {
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      this.logger.error('invalid backend message')
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(new Error(message.error.message || 'backend error'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    const handlers = this.notificationHandlers.get(message.method) ?? []
    for (const handler of handlers) {
      Promise.resolve(handler(message.method, message.params)).catch((error) => {
        this.logger.error(`notification handler error: ${message.method}`, error)
      })
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectTimer || this.connected) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect().catch(() => {})
    }, this.reconnectInterval)
  }
}

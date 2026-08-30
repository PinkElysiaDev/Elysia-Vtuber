import WebSocket from 'ws'
import type { Logger } from 'koishi'

type NotificationHandler = (method: string, params: any) => void | Promise<void>

export class BackendClient {
  private ws?: WebSocket
  private connected = false
  private manualClose = false
  private reconnectTimer?: NodeJS.Timeout
  private connecting: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private notificationHandlers = new Map<string, NotificationHandler[]>()

  /** 重连成功后回调（插件侧用来重发 koishi.ready） */
  onReconnected: (() => void) | null = null

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly reconnectInterval: number,
    private readonly timeout: number,
    private readonly logger: Logger,
  ) {}

  isConnected(): boolean {
    return this.connected
  }

  async connect(): Promise<void> {
    if (this.connected) return
    if (this.connecting) return this.connecting
    this.manualClose = false
    this.connecting = this.doConnect()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        try { this.ws.terminate() } catch { /* 已关闭 */ }
        this.ws = undefined
      }
      const url = `ws://${this.host}:${this.port}`
      this.logger.info(`connecting to backend: ${url}`)
      const ws = new WebSocket(url)
      this.ws = ws
      const timer = setTimeout(() => {
        ws.terminate()
        reject(new Error(`连接超时 (${this.timeout}ms)`))
      }, this.timeout)
      ws.on('open', () => {
        clearTimeout(timer)
        this.connected = true
        this.send({
          jsonrpc: '2.0',
          method: 'peer.declare',
          params: { kind: 'plugin' },
        })
        this.onReconnected?.()
        resolve()
      })
      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(String(data))
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const entry = this.pending.get(msg.id)!
            this.pending.delete(msg.id)
            clearTimeout(entry.timer)
            if (msg.error) {
              entry.reject(new Error(msg.error.message ?? 'unknown error'))
            } else {
              entry.resolve(msg.result)
            }
          } else if (msg.method !== undefined) {
            const handlers = this.notificationHandlers.get(msg.method)
            if (handlers) {
              for (const handler of handlers) {
                try {
                  const result = handler(msg.method, msg.params)
                  if (result instanceof Promise) result.catch(() => undefined)
                } catch (error) {
                  this.logger.warn(`notification handler error (${msg.method}):`, error)
                }
              }
            }
          }
        } catch {
          // 非 JSON 消息忽略
        }
      })
      ws.on('close', () => {
        clearTimeout(timer)
        this.connected = false
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer)
          entry.reject(new Error('连接已断开'))
        }
        this.pending.clear()
        if (!this.manualClose) {
          this.scheduleReconnect()
        }
      })
      ws.on('error', (error: Error) => {
        clearTimeout(timer)
        this.connected = false
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
    if (this.ws) {
      try { this.ws.close() } catch { /* 已关闭 */ }
      this.ws = undefined
    }
    this.connected = false
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('连接已断开'))
    }
    this.pending.clear()
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectTimer || this.connected) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.manualClose && !this.connected) {
        this.connect().catch((error) => {
          this.logger.warn('reconnect failed:', error.message)
        })
      }
    }, this.reconnectInterval)
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(msg))
    } catch (error) {
      this.logger.warn('send error:', error)
    }
  }

  request(method: string, params?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('后端未连接'))
        return
      }
      const id = this.nextId++
      const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`请求超时 (${method}, ${this.timeout}ms)`))
      }, this.timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.ws.send(JSON.stringify(msg))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (params !== undefined) msg.params = params
    try {
      this.send(msg)
    } catch {
      // 通知失败静默（fire-and-forget）
    }
  }

  on(method: string, handler: NotificationHandler): void {
    const list = this.notificationHandlers.get(method) ?? []
    list.push(handler)
    this.notificationHandlers.set(method, list)
  }
}

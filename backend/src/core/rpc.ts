/**
 * JSON-RPC 2.0 通信核心
 * 提供：
 *  - 服务端（WebSocketServer 封装）：方法注册 / 通知广播 / 请求分发
 *  - 客户端（WebSocketClient 封装）：请求 / 通知 / 自动重连 / 事件订阅
 *
 * 协议遵循 JSON-RPC 2.0：
 *   请求  { jsonrpc: "2.0", id, method, params }
 *   响应  { jsonrpc: "2.0", id, result | error }
 *   通知  { jsonrpc: "2.0", method, params }   （无 id）
 */

import WebSocket from 'ws'
import { EventEmitter } from 'events'

export interface RpcError {
  code: number
  message: string
  data?: unknown
}

export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcError
}

export type RpcHandler = (params: unknown, context: RpcContext) => unknown | Promise<unknown>

export interface RpcContext {
  /** 发起请求的连接身份标识（如 'plugin' | 'cpp' 或连接 id） */
  peer: string
}

export class RpcMethodNotFoundError extends Error {
  constructor(method: string) {
    super(`method not found: ${method}`)
  }
}

/** JSON-RPC 消息工厂 */
export const rpc = {
  request(id: number | string, method: string, params?: unknown): RpcMessage {
    return { jsonrpc: '2.0', id, method, params }
  },
  result(id: number | string, result: unknown): RpcMessage {
    return { jsonrpc: '2.0', id, result }
  },
  error(id: number | string | null, code: number, message: string, data?: unknown): RpcMessage {
    return { jsonrpc: '2.0', id, error: { code, message, data } }
  },
  notify(method: string, params?: unknown): RpcMessage {
    return { jsonrpc: '2.0', method, params }
  },
}

/**
 * 服务端：负责 WS 连接上的请求分发与通知广播。
 * 方法注册按模块组织（namespace.method），重复注册同一方法视为异常。
 */
export class RpcServer extends EventEmitter {
  private handlers = new Map<string, RpcHandler>()

  /** 注册一个 RPC 方法处理器 */
  register(method: string, handler: RpcHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`RPC method already registered: ${method}`)
    }
    this.handlers.set(method, handler)
  }

  /** 移除已注册的方法 */
  unregister(method: string): void {
    this.handlers.delete(method)
  }

  /** 批量注册 */
  registerAll(registry: Record<string, RpcHandler>): void {
    for (const [method, handler] of Object.entries(registry)) {
      this.register(method, handler)
    }
  }

  has(method: string): boolean {
    return this.handlers.has(method)
  }

  /** 处理一条已解析的消息，返回需要回发的消息（通知返回 null） */
  async dispatch(raw: string, peer: string): Promise<string | null> {
    let message: RpcMessage
    try {
      message = JSON.parse(raw)
    } catch {
      return JSON.stringify(rpc.error(null, -32700, 'parse error'))
    }

    if (Array.isArray(message)) {
      const results: RpcMessage[] = []
      for (const item of message as unknown as RpcMessage[]) {
        const reply = await this.dispatchOne(item, peer)
        if (reply) results.push(reply)
      }
      return results.length ? JSON.stringify(results) : null
    }

    const reply = await this.dispatchOne(message, peer)
    return reply ? JSON.stringify(reply) : null
  }

  private async dispatchOne(message: RpcMessage, peer: string): Promise<RpcMessage | null> {
    const isNotification = message.id === undefined || message.id === null
    if (typeof message.method !== 'string') {
      return isNotification ? null : rpc.error(message.id ?? null, -32600, 'invalid request')
    }

    const handler = this.handlers.get(message.method)
    if (!handler) {
      return isNotification
        ? null
        : rpc.error(message.id ?? null, -32601, `method not found: ${message.method}`)
    }

    try {
      const result = await handler(message.params, { peer })
      return isNotification ? null : rpc.result(message.id as number | string, result)
    } catch (err) {
      const code = err instanceof RpcMethodNotFoundError ? -32601 : -32000
      const msg = err instanceof Error ? err.message : String(err)
      return isNotification ? null : rpc.error(message.id ?? null, code, msg)
    }
  }
}

/**
 * 客户端：JSON-RPC over WebSocket，支持自动重连、请求超时、事件订阅。
 * 用于 插件→Node、Node→C++ 两条链路的调用方。
 */
export class RpcClient extends EventEmitter {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number | string, {
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    timer: NodeJS.Timeout
  }>()
  private manualClose = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private connecting = false
  private heartbeatTimer: NodeJS.Timeout | null = null
  private gotPong = true

  constructor(
    private url: string,
    private options: {
      timeoutMs?: number
      reconnectMs?: number
      heartbeatMs?: number
      peer?: string
    } = {},
  ) {
    super()
  }

  /** 配置热更新：应用新的地址/参数；地址变化返回 true（调用方需自行触发重连） */
  reconfigure(url: string, options: { timeoutMs?: number; reconnectMs?: number; peer?: string }): boolean {
    if (options.timeoutMs !== undefined) this.options.timeoutMs = options.timeoutMs
    if (options.reconnectMs !== undefined) this.options.reconnectMs = options.reconnectMs
    if (options.peer !== undefined) this.options.peer = options.peer
    if (url === this.url) return false
    this.url = url
    return true
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  /** 建立连接；若已连接则直接返回 */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.connecting) return this.awaitOpen()

    this.connecting = true
    this.manualClose = false
    this.ws = new WebSocket(this.url)

    return new Promise((resolve, reject) => {
      const ws = this.ws!
      const onOpen = () => {
        this.connecting = false
        this.clearReconnect()
        this.startHeartbeat()
        if (this.options.peer) {
          try {
            ws.send(JSON.stringify(rpc.notify('peer.declare', { kind: this.options.peer })))
          } catch {}
        }
        this.emit('connected')
        resolve()
      }
      ws.once('open', onOpen)
      ws.on('pong', () => { this.gotPong = true })
      ws.on('message', (data) => this.handleMessage(data.toString()))
      ws.on('close', () => {
        this.connecting = false
        this.stopHeartbeat()
        this.emit('disconnected')
        this.scheduleReconnect()
      })
      ws.on('error', (err) => {
        if (this.connecting) {
          this.connecting = false
          reject(err)
        }
      })
    })
  }

  /** 半开连接探活：一个周期未 pong 即主动断开，触发正常重连流程 */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    const intervalMs = this.options.heartbeatMs ?? 30_000
    this.gotPong = true
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (!this.gotPong) {
        ws.terminate()
        return
      }
      this.gotPong = false
      ws.ping()
    }, intervalMs)
    this.heartbeatTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private awaitOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RPC connect timeout')), 5000)
      this.once('connected', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** 请求-响应调用 */
  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error('RPC not connected'))
    const id = this.nextId++
    const timeoutMs = this.options.timeoutMs ?? 10000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify(rpc.request(id, method, params)))
    })
  }

  /** 通知（无需响应） */
  notify(method: string, params?: unknown): void {
    if (!this.connected) return
    this.ws!.send(JSON.stringify(rpc.notify(method, params)))
  }

  private handleMessage(raw: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    const id = message.id
    if (id !== undefined && id !== null && this.pending.has(id)) {
      const { resolve, reject, timer } = this.pending.get(id)!
      this.pending.delete(id)
      clearTimeout(timer)
      if (message.error) {
        reject(new Error(message.error.message || `RPC error: ${message.id}`))
      } else {
        resolve(message.result)
      }
      return
    }
    if (message.method) {
      this.emit('notify', message.method, message.params)
      this.emit(message.method, message.params)
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectTimer) return
    const ms = this.options.reconnectMs ?? 3000
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => {})
    }, ms)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** 断开连接并停止重连 */
  close(): void {
    this.manualClose = true
    this.clearReconnect()
    this.stopHeartbeat()
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('RPC closed'))
    }
    this.pending.clear()
    this.ws?.close()
    this.ws = null
  }
}

/** 简易内存事件总线，模块间解耦 */
export class EventBus {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, fn: (...args: unknown[]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return () => this.listeners.get(event)?.delete(fn)
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of [...set]) {
      try {
        fn(...args)
      } catch (err) {
        console.error(`[eventbus] listener error for ${event}:`, err)
      }
    }
  }
}

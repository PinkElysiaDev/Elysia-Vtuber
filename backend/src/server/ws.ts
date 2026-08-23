/**
 * WebSocket RPC 服务端
 * 承载两类连接：
 *  - koishi 插件连接（peer: 'plugin'）
 *  - C++ 执行器连接（peer: 'cpp'）
 * 通过 method 前缀或连接身份分发，广播通知给指定类别的连接。
 */

import WebSocket, { WebSocketServer } from 'ws'
import { RpcServer } from '../core/rpc'

export interface WsPeerInfo {
  /** 连接身份：plugin | cpp | webui */
  kind: 'plugin' | 'cpp' | 'webui'
  /** 连接唯一标识 */
  id: number
}

/** 心跳间隔：超过两个周期未 pong 的连接视为半开，主动断开 */
const HEARTBEAT_INTERVAL_MS = 30_000

export class WsServer {
  private rpc = new RpcServer()
  private wss: WebSocketServer | null = null
  private peers = new Map<WebSocket, WsPeerInfo>()
  private nextPeerId = 1
  /** kind -> connections */
  private byKind = new Map<string, Set<WebSocket>>()
  private heartbeatTimer: NodeJS.Timeout | null = null
  private alivePeers = new Set<WebSocket>()

  get handlers(): RpcServer {
    return this.rpc
  }

  start(port: number, host = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host })
      this.wss.on('listening', () => {
        console.log(`[ws] RPC server listening on ws://${host}:${port}`)
        this.startHeartbeat()
        resolve()
      })
      this.wss.on('error', reject)
      this.wss.on('connection', (ws) => this.handleConnection(ws))
    })
  }

  /** 半开连接（休眠恢复/网络栈重置）不会触发 close，靠 ping/pong 探活清理 */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      for (const ws of this.peers.keys()) {
        if (!this.alivePeers.has(ws)) {
          ws.terminate()
          continue
        }
        this.alivePeers.delete(ws)
        if (ws.readyState === WebSocket.OPEN) ws.ping()
      }
    }, HEARTBEAT_INTERVAL_MS)
    this.heartbeatTimer.unref?.()
  }

  private handleConnection(ws: WebSocket): void {
    // 连接身份由首个 notify 声明（plugin.hello / cpp.hello / webui.hello）
    const info: WsPeerInfo = { kind: 'webui', id: this.nextPeerId++ }
    this.peers.set(ws, info)
    this.byKind.set('webui', this.byKind.get('webui') ?? new Set())
    this.byKind.get('webui')!.add(ws)
    this.alivePeers.add(ws)

    ws.on('pong', () => {
      this.alivePeers.add(ws)
    })
    ws.on('message', (data) => {
      this.alivePeers.add(ws)
      void this.handleMessage(ws, data.toString())
    })
    ws.on('close', () => {
      this.removePeer(ws)
    })
    ws.on('error', () => {
      this.removePeer(ws)
    })
  }

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    // 身份声明：{ jsonrpc:'2.0', method:'peer.declare', params:{ kind } }
    try {
      const probe = JSON.parse(raw)
      if (probe.method === 'peer.declare' && typeof probe.params?.kind === 'string') {
        const oldKind = this.peers.get(ws)?.kind ?? 'webui'
        this.byKind.get(oldKind)?.delete(ws)
        const kind = probe.params.kind === 'plugin' || probe.params.kind === 'cpp' ? probe.params.kind : 'webui'
        this.peers.set(ws, { kind, id: this.peers.get(ws)?.id ?? this.nextPeerId++ })
        if (!this.byKind.has(kind)) this.byKind.set(kind, new Set())
        this.byKind.get(kind)!.add(ws)
        if (probe.id !== undefined && probe.id !== null && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: probe.id, result: { ok: true, kind } }))
        }
        return
      }
    } catch {
      // 非 JSON，走正常解析
    }

    const info = this.peers.get(ws)!
    const reply = await this.rpc.dispatch(raw, info.kind)
    if (reply && ws.readyState === WebSocket.OPEN) {
      ws.send(reply)
    }
  }

  private removePeer(ws: WebSocket): void {
    const info = this.peers.get(ws)
    this.alivePeers.delete(ws)
    if (!info) return
    this.peers.delete(ws)
    this.byKind.get(info.kind)?.delete(ws)
  }

  /** 向指定类别的所有连接广播通知 */
  broadcast(kind: 'plugin' | 'cpp' | 'webui' | 'all', method: string, params?: unknown): void {
    const connections = kind === 'all'
      ? new Set([...this.peers.keys()])
      : this.byKind.get(kind) ?? new Set()
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params })
    for (const ws of connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (!this.wss) return
    const wss = this.wss
    this.wss = null
    // wss.close 的回调要等所有客户端连接关闭才触发，而插件/WebUI 会自动重连，
    // 必须先主动断开全部连接，否则关闭流程永久挂起
    for (const client of wss.clients) {
      client.terminate()
    }
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(resolve, 2000)
      wss.close(() => {
        clearTimeout(fallback)
        resolve()
      })
    })
  }
}

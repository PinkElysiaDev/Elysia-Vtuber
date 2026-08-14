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

export class WsServer {
  private rpc = new RpcServer()
  private wss: WebSocketServer | null = null
  private peers = new Map<WebSocket, WsPeerInfo>()
  private nextPeerId = 1
  /** kind -> connections */
  private byKind = new Map<string, Set<WebSocket>>()

  get handlers(): RpcServer {
    return this.rpc
  }

  start(port: number, host = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host })
      this.wss.on('listening', () => {
        console.log(`[ws] RPC server listening on ws://${host}:${port}`)
        resolve()
      })
      this.wss.on('error', reject)
      this.wss.on('connection', (ws) => this.handleConnection(ws))
    })
  }

  private handleConnection(ws: WebSocket): void {
    // 连接身份由首个 notify 声明（plugin.hello / cpp.hello / webui.hello）
    const info: WsPeerInfo = { kind: 'webui', id: this.nextPeerId++ }
    this.peers.set(ws, info)
    this.byKind.set('webui', this.byKind.get('webui') ?? new Set())
    this.byKind.get('webui')!.add(ws)

    ws.on('message', (data) => {
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

  /** 向单个连接发送 */
  sendTo(ws: WebSocket, method: string, params?: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  connectionCount(): number {
    return this.peers.size
  }

  async stop(): Promise<void> {
    if (!this.wss) return
    await new Promise<void>((resolve) => {
      this.wss!.close(() => resolve())
    })
    this.wss = null
  }
}

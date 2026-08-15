/**
 * C++ 执行器客户端
 * Node 逻辑服务通过本地 WS IPC 驱动 C++ 执行器（Live2D / 播放引擎 / 音频 / 展示板）。
 * 负责：进程启动/停止/重启、连接管理、RPC 请求、事件订阅转发。
 */

import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import { RpcClient } from '../core/rpc'
import type { CppConfig } from '../config'
import { resolveBackendPath } from '../config'

const PORT_CHECK_TIMEOUT_MS = 1000
const PORT_RECHECK_TIMEOUT_MS = 500
const SPAWN_POLL_MS = 300
const RPC_TIMEOUT_FLOOR_MS = 15000

export class CppClient {
  private child: ChildProcess | null = null
  private rpc: RpcClient
  private status: 'stopped' | 'starting' | 'running' | 'error' = 'stopped'

  constructor(private config: CppConfig) {
    this.rpc = new RpcClient(`ws://127.0.0.1:${config.ipcPort}`, {
      reconnectMs: config.reconnectMs,
      timeoutMs: Math.max(config.startTimeoutMs, RPC_TIMEOUT_FLOOR_MS),
      peer: 'node',
    })
    this.rpc.on('connected', () => {
      this.status = 'running'
    })
    this.rpc.on('disconnected', () => {
      this.status = 'stopped'
    })
  }

  setConfig(config: CppConfig): void {
    this.config = config
  }

  getStatus(): string {
    return this.status
  }

  private async isPortOpen(port: number, host: string, timeoutMs = PORT_CHECK_TIMEOUT_MS): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.once('error', () => { resolve(false) })
      socket.connect(port, host)
    })
  }

  /** 启动 C++ 执行器（若端口已开则直接连接） */
  async start(): Promise<boolean> {
    if (this.status === 'running') return true
    if (await this.isPortOpen(this.config.ipcPort, '127.0.0.1')) {
      await this.rpc.connect()
      return true
    }

    this.status = 'starting'

    const executable = resolveBackendPath(this.config.executablePath)
    const configPath = resolveBackendPath(this.config.configPath)
    console.log(`[cpp] spawn ${executable}`)

    try {
      this.child = spawn(executable, ['--config', configPath], {
        cwd: path.dirname(executable),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child.stdout?.on('data', (d) => console.log(`[cpp] ${String(d).trimEnd()}`))
      this.child.stderr?.on('data', (d) => console.error(`[cpp] ${String(d).trimEnd()}`))
      this.child.on('error', (err) => {
        this.status = 'error'
        console.error('[cpp] spawn failed:', err)
      })
      this.child.on('exit', (code) => {
        if (this.status === 'starting') this.status = 'error'
        else this.status = 'stopped'
        console.log(`[cpp] process exited: ${code}`)
      })
    } catch (err) {
      this.status = 'error'
      console.error('[cpp] spawn failed:', err)
      return false
    }

    const deadline = Date.now() + this.config.startTimeoutMs
    while (Date.now() < deadline) {
      if (await this.isPortOpen(this.config.ipcPort, '127.0.0.1', PORT_RECHECK_TIMEOUT_MS)) {
        await this.rpc.connect()
        return true
      }
      await new Promise((r) => setTimeout(r, SPAWN_POLL_MS))
    }

    this.status = 'error'
    return false
  }

  /** 停止执行器进程 */
  stop(): void {
    this.child?.kill()
    this.child = null
    this.rpc.close()
    this.status = 'stopped'
  }

  /** 重启（保留队列等内部状态由 C++ 侧决定） */
  async restart(): Promise<boolean> {
    this.stop()
    return this.start()
  }

  isConnected(): boolean {
    return this.rpc.connected
  }

  /** RPC 请求 */
  request(method: string, params?: unknown): Promise<unknown> {
    return this.rpc.request(method, params)
  }

  /** 请求并吞掉「未连接/失败」异常，统一返回 { ok, error? } */
  async safeRequest(method: string, params?: unknown): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
    if (!this.isConnected()) return { ok: false, error: 'C++ 执行器未连接' }
    try {
      const result = await this.rpc.request(method, params)
      return result && typeof result === 'object' ? (result as { ok: boolean }) : { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 通知 */
  notify(method: string, params?: unknown): void {
    this.rpc.notify(method, params)
  }

  /** 订阅 C++ 执行器的事件 */
  onEvent(event: string, fn: (params: unknown) => void): () => void {
    const handler = (params: unknown) => fn(params)
    this.rpc.on(event, handler)
    return () => {
      this.rpc.off(event, handler)
    }
  }

  dispose(): void {
    this.stop()
  }
}

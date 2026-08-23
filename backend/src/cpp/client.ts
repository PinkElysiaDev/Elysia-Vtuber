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
  /** 进行中的启动请求（并发点击复用同一 Promise，避免重复 spawn） */
  private startPromise: Promise<boolean> | null = null
  /** 执行器连接成功回调（每次连接都触发：执行器重启后内部状态清空，首连也需要推送配置） */
  private connectedHooks: Array<() => void> = []
  /** attach 失败重试定时器（执行器晚于后端启动时持续探测端口） */
  private attachRetryTimer: NodeJS.Timeout | null = null
  /** 连接状态变化回调（connected/disconnected/进程退出均会触发） */
  private stateHooks: Array<(state: { status: string; connected: boolean }) => void> = []
  /** emitState 去重：attach 重试循环 3s 一次，状态不变时不广播 */
  private lastEmittedStatus = ''
  private lastEmittedConnected: boolean | null = null

  constructor(private config: CppConfig) {
    this.rpc = new RpcClient(`ws://127.0.0.1:${config.ipcPort}`, {
      reconnectMs: config.reconnectMs,
      timeoutMs: Math.max(config.startTimeoutMs, RPC_TIMEOUT_FLOOR_MS),
      peer: 'node',
    })
    this.rpc.on('connected', () => {
      this.status = 'running'
      if (this.attachRetryTimer) {
        clearTimeout(this.attachRetryTimer)
        this.attachRetryTimer = null
      }
      console.log('[cpp] 已连接执行器 IPC')
      this.emitState()
      // 每次连接都触发重同步：执行器进程重启后模型/窗口状态全部回到默认，
      // 首连同样需要推送 Live2D 与窗口配置
      for (const hook of this.connectedHooks) {
        try { hook() } catch (err) {
          console.error('[cpp] connected hook error:', err)
        }
      }
    })
    this.rpc.on('disconnected', () => {
      if (this.status === 'running') console.warn('[cpp] 与执行器的连接已断开')
      // 子进程已退出（如手动关闭 Live2D 窗口）时是 stopped，不能仅凭引用误判成 starting
      const childAlive = Boolean(this.child && this.child.exitCode === null && !this.child.killed)
      this.status = childAlive ? 'starting' : 'stopped'
      this.emitState()
    })
  }

  /** 注册执行器重连成功回调（用于重推 Live2D 配置、恢复播放等状态同步） */
  onConnected(fn: () => void): void {
    this.connectedHooks.push(fn)
  }

  /** 注册连接状态变化回调（供 WebUI 即时刷新执行器状态徽章） */
  onStateChange(fn: (state: { status: string; connected: boolean }) => void): void {
    this.stateHooks.push(fn)
  }

  private emitState(): void {
    const state = { status: this.getStatus(), connected: this.isConnected() }
    // 去重：attach 重试每次走这里，状态没变就不广播（防日志刷屏）
    if (this.lastEmittedStatus === state.status && this.lastEmittedConnected === state.connected) return
    this.lastEmittedStatus = state.status
    this.lastEmittedConnected = state.connected
    for (const fn of this.stateHooks) {
      try { fn(state) } catch (err) {
        console.error('[cpp] state hook error:', err)
      }
    }
  }

  setConfig(config: CppConfig): void {
    // ipcPort 等参数热更新：地址变化且已连接时主动切到新地址
    const urlChanged = this.rpc.reconfigure(`ws://127.0.0.1:${config.ipcPort}`, {
      reconnectMs: config.reconnectMs,
      timeoutMs: Math.max(config.startTimeoutMs, RPC_TIMEOUT_FLOOR_MS),
      peer: 'node',
    })
    this.config = config
    if (urlChanged && this.isConnected()) {
      this.rpc.close()
      this.status = 'stopped'
      void this.attach()
    }
  }

  getStatus(): string {
    if (this.isConnected()) return 'running'
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
    // 并发复用：多次点击返回同一 Promise，不重复拉起
    if (this.startPromise) return this.startPromise
    if (this.isConnected()) return true
    this.startPromise = this.doStart().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  /**
   * 仅连接已运行的执行器，绝不 spawn。
   * 供 autoStart 关闭的场景使用：执行器未监听视为未运行，直接返回 false。
   */
  async attach(): Promise<boolean> {
    if (this.isConnected()) return true
    if (!(await this.isPortOpen(this.config.ipcPort, '127.0.0.1'))) {
      // 执行器可能晚于后端启动：安排周期探测，连上即触发 connected 钩子推送配置
      this.scheduleAttachRetry()
      return false
    }
    this.status = 'starting'
    try {
      await this.rpc.connect()
      return true
    } catch (err) {
      this.status = 'stopped'
      this.emitState()
      this.scheduleAttachRetry()
      console.warn('[cpp] attach 已运行执行器失败:', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  private scheduleAttachRetry(): void {
    if (this.attachRetryTimer || this.isConnected()) return
    this.attachRetryTimer = setTimeout(() => {
      this.attachRetryTimer = null
      void this.attach().catch(() => {})
    }, this.config.reconnectMs || 3000)
    this.attachRetryTimer.unref?.()
  }

  private async doStart(): Promise<boolean> {
    if (await this.isPortOpen(this.config.ipcPort, '127.0.0.1')) {
      console.log('[cpp] 检测到执行器端口已开，直接连接')
      this.status = 'starting'
      await this.rpc.connect()
      return true
    }

    this.status = 'starting'

    // 上一轮超时遗留的子进程可能仍在加载：先清理，避免多实例争抢 IPC 端口
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null

    const executable = resolveBackendPath(this.config.executablePath)
    const configPath = resolveBackendPath(this.config.configPath)
    console.log(`[cpp] 正在拉起执行器：${executable}（窗口${this.config.startHidden ? '隐藏' : '显示'}）`)

    try {
      const child = spawn(executable, ['--config', configPath], {
        cwd: path.dirname(executable),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: this.config.startHidden,
      })
      this.child = child
      child.stdout?.on('data', (d) => console.log(`[cpp] ${String(d).trimEnd()}`))
      child.stderr?.on('data', (d) => console.error(`[cpp] ${String(d).trimEnd()}`))
      child.on('error', (err) => {
        console.error('[cpp] 拉起失败：', err.message)
        if (this.child === child) this.child = null
        this.status = 'error'
        this.emitState()
      })
      child.on('exit', (code) => {
        console.log(`[cpp] 执行器进程退出（code=${code}）`)
        if (this.child !== child) return
        this.child = null
        this.status = this.status === 'starting' ? 'error' : 'stopped'
        this.emitState()
      })
    } catch (err) {
      this.status = 'error'
      this.emitState()
      console.error('[cpp] 拉起失败：', err instanceof Error ? err.message : String(err))
      return false
    }

    const deadline = Date.now() + this.config.startTimeoutMs
    while (Date.now() < deadline) {
      if (await this.isPortOpen(this.config.ipcPort, '127.0.0.1', PORT_RECHECK_TIMEOUT_MS)) {
        console.log('[cpp] 执行器端口已就绪，建立 IPC 连接')
        await this.rpc.connect()
        return true
      }
      await new Promise((r) => setTimeout(r, SPAWN_POLL_MS))
    }

    this.status = 'error'
    this.emitState()
    console.error('[cpp] 等待执行器启动超时（模型加载可能较慢，可稍后重试）')
    return false
  }

  /**
   * 停止执行器。
   * 优先发 system.shutdown RPC 让执行器自行优雅退出——这样无论执行器
   * 是不是本后端 spawn 的（如外部手动启动的实例），都能关掉它的窗口；
   * 再兜底 kill 本后端持有的子进程。
   */
  async stop(): Promise<void> {
    if (this.isConnected()) {
      try {
        await Promise.race([
          this.rpc.request('system.shutdown', {}),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ])
      } catch {
        // 执行器可能已退出或无响应，忽略后走兜底
      }
    }
    this.child?.kill()
    this.child = null
    try {
      this.rpc.close()
    } catch {
      // 关闭 ws 失败由全局守卫兜底，不影响停止流程
    }
    this.status = 'stopped'
    this.emitState()
  }

  /** 重启（保留队列等内部状态由 C++ 侧决定） */
  async restart(): Promise<boolean> {
    await this.stop()
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

  async dispose(): Promise<void> {
    await this.stop()
  }
}

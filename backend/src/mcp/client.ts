/**
 * 极简 MCP (Model Context Protocol) stdio 客户端。
 * 协议：换行分隔的 JSON-RPC 2.0，spawn 子进程的标准输入/输出。
 * 能力面：initialize 握手 → notifications/initialized → tools/list / tools/call。
 * 零外部依赖；HTTP/SSE 传输暂不支持。
 */
import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'

const PROTOCOL_VERSION = '2024-11-05'
const REQUEST_TIMEOUT_MS = 20000

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpClientStatus = 'connecting' | 'connected' | 'disconnected'

export class McpStdioClient {
  private child: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  status: McpClientStatus = 'disconnected'
  serverInfo: { name?: string; version?: string } = {}
  lastError = ''

  constructor(private readonly serverName: string, private readonly cfg: McpServerConfig) {}

  get name(): string {
    return this.serverName
  }

  get commandLine(): string {
    return [this.cfg.command, ...(this.cfg.args ?? [])].join(' ')
  }

  private send(method: string, params?: unknown, isNotification = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin) {
        reject(new Error('mcp: 进程未运行'))
        return
      }
      const msg: Record<string, unknown> = { jsonrpc: '2.0', method }
      if (params !== undefined) msg.params = params
      let id: number | undefined
      if (!isNotification) {
        id = this.nextId++
        msg.id = id
      }
      const payload = JSON.stringify(msg) + '\n'
      try {
        this.child.stdin.write(payload)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      if (id === undefined) {
        resolve(undefined) // 通知无需等待响应
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id!)
        reject(new Error(`mcp: 请求超时 ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const id = msg.id as number | undefined
    if (id === undefined || !this.pending.has(id)) return
    const entry = this.pending.get(id)!
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (msg.error) {
      const e = msg.error as { message?: string; code?: number }
      entry.reject(new Error(`mcp: ${e.message ?? '未知错误'} (code ${e.code ?? '?'})`))
    } else {
      entry.resolve(msg.result)
    }
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return
    this.status = 'connecting'
    this.lastError = ''
    try {
      this.child = spawn(this.cfg.command, this.cfg.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...(this.cfg.env ?? {}) },
      })
      this.child.on('error', (err) => {
        this.lastError = err.message
        this.failPending(new Error('mcp: 进程启动失败 ' + err.message))
        this.status = 'disconnected'
      })
      this.child.on('exit', () => {
        this.failPending(new Error('mcp: 服务器进程退出'))
        this.status = 'disconnected'
      })
      const stdout = this.child.stdout
      if (!stdout) throw new Error('mcp: 无标准输出流')
      const rl = createInterface({ input: stdout })
      rl.on('line', (line) => {
        line = line.trim()
        if (!line) return
        try {
          this.handleMessage(JSON.parse(line) as Record<string, unknown>)
        } catch { /* 非 JSON 行忽略 */ }
      })

      const initResult = (await this.send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'vtuber-backend', version: '0.2.0' },
      })) as { serverInfo?: { name?: string; version?: string } } | undefined
      this.serverInfo = initResult?.serverInfo ?? {}
      await this.send('notifications/initialized', undefined, true)
      this.status = 'connected'
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.disconnect()
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  private failPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(err)
    }
    this.pending.clear()
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.send('tools/list', {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }
    return (result?.tools ?? []).map((t) => ({
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    })).filter((t) => t.name !== '')
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = (await this.send('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }
    const text = (result?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
    return { success: !result?.isError, text }
  }

  disconnect(): void {
    this.failPending(new Error('mcp: 连接关闭'))
    if (this.child) {
      try { this.child.kill() } catch { /* 已退出 */ }
      this.child = null
    }
    this.status = 'disconnected'
  }
}

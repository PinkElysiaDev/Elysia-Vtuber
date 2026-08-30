/**
 * MCP (Model Context Protocol) 共用类型 + stdio 传输客户端。
 * 协议：换行分隔的 JSON-RPC 2.0，spawn 子进程的标准输入/输出。
 * 能力面：initialize 握手（协议版本协商）→ notifications/initialized → tools/list / tools/call，
 * 并向上转发 notifications/tools/list_changed 通知。
 * 零外部依赖；HTTP 传输见 http-client.ts。
 */
import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'

/** 客户端按新到旧声明；initialize 请求带第一个，服务器回任一支持版本即采用 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export const REQUEST_TIMEOUT_MS = 20000

export const CLIENT_INFO = { name: 'vtuber-backend', version: '0.2.0' }

export interface McpServerConfig {
  /** stdio 传输：启动命令 */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Streamable HTTP 传输：服务器 URL（与 command 二选一） */
  url?: string
  /** HTTP 附加请求头（鉴权等） */
  headers?: Record<string, string>
  enabled?: boolean
}

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpClientStatus = 'connecting' | 'connected' | 'disconnected'

/** 两种传输共用的客户端接口，McpManager 只依赖它 */
export interface McpClient {
  readonly name: string
  readonly status: McpClientStatus
  readonly serverInfo: { name?: string; version?: string }
  readonly lastError: string
  /** 握手协商出的协议版本，未连接时为空 */
  readonly protocolVersion: string
  /** 服务器通知 tools/list_changed 时回调（manager 负责重拉工具列表） */
  onToolsChanged: (() => void) | null
  connect(): Promise<void>
  listTools(): Promise<McpToolInfo[]>
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>
  disconnect(): void
}

/**
 * 协议版本协商：客户端声明 SUPPORTED_PROTOCOL_VERSIONS[0]，
 * 服务器返回不同版本时若客户端也支持则采用服务器版本，否则视为不兼容。
 */
export function negotiateProtocolVersion(requested: string, serverVersion: unknown): { ok: boolean; version: string } {
  // 旧服务器可能不回 protocolVersion，按客户端请求值继续
  if (serverVersion === undefined || serverVersion === null || serverVersion === '') {
    return { ok: true, version: requested }
  }
  const version = String(serverVersion)
  if (version === requested || SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return { ok: true, version }
  }
  return { ok: false, version }
}

/**
 * tools/call 结果归一化为 { success, text }：
 * text 块直出；image/audio 给占位提示（LLM 文本管线看不到二进制内容）；
 * resource 块有内嵌 text 用 text，否则只提示 uri。
 */
export function renderToolResult(result: unknown): { success: boolean; text: string } {
  const res = (result ?? {}) as { content?: unknown[]; isError?: boolean }
  const parts: string[] = []
  for (const raw of (res.content ?? []) as Array<Record<string, any>>) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.type === 'text') {
      parts.push(String(raw.text ?? ''))
    } else if (raw.type === 'image') {
      parts.push(`[image: ${raw.mimeType ?? 'embedded'}]`)
    } else if (raw.type === 'audio') {
      parts.push(`[audio: ${raw.mimeType ?? 'embedded'}]`)
    } else if (raw.type === 'resource') {
      const resource = raw.resource as { uri?: string; text?: string; mimeType?: string } | undefined
      if (resource && typeof resource.text === 'string') {
        parts.push(resource.text)
      } else {
        parts.push(`[resource: ${resource?.uri ?? 'unknown'}]`)
      }
    }
  }
  return { success: !res.isError, text: parts.filter((p) => p !== '').join('\n') }
}

export interface McpInitResult {
  serverInfo?: { name?: string; version?: string }
  protocolVersion?: string
}

export class McpStdioClient implements McpClient {
  private child: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private negotiatedVersion = ''
  status: McpClientStatus = 'disconnected'
  serverInfo: { name?: string; version?: string } = {}
  lastError = ''
  onToolsChanged: (() => void) | null = null

  constructor(private readonly serverName: string, private readonly cfg: McpServerConfig) {}

  get name(): string {
    return this.serverName
  }

  get protocolVersion(): string {
    return this.negotiatedVersion
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
    if (id === undefined) {
      this.handleNotification(msg)
      return
    }
    if (!this.pending.has(id)) return
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

  private handleNotification(msg: Record<string, unknown>): void {
    if (msg.method === 'notifications/tools/list_changed') this.onToolsChanged?.()
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return
    this.status = 'connecting'
    this.lastError = ''
    this.negotiatedVersion = ''
    try {
      this.child = spawn(this.cfg.command ?? '', this.cfg.args ?? [], {
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
      // stderr 必须消费：MCP 服务器普遍往 stderr 打日志，内核管道缓冲（约 64KB）
      // 写满后子进程的 stderr 写阻塞 → 整个服务器卡死
      this.child.stderr?.resume()
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

      const requested = SUPPORTED_PROTOCOL_VERSIONS[0]
      const initResult = (await this.send('initialize', {
        protocolVersion: requested,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      })) as McpInitResult | undefined
      const negotiation = negotiateProtocolVersion(requested, initResult?.protocolVersion)
      if (!negotiation.ok) {
        throw new Error(`mcp: 服务器协议版本不支持 ${negotiation.version}（客户端支持 ${SUPPORTED_PROTOCOL_VERSIONS.join(' / ')}）`)
      }
      this.negotiatedVersion = negotiation.version
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
    return renderToolResult(result)
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

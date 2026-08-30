/**
 * 极简 MCP Streamable HTTP 客户端（MCP 2025-03-26 传输规范）。
 * 每条 JSON-RPC 消息 POST 到同一 url，接受 application/json 单响应或
 * text/event-stream 流式响应（在流中按 id 匹配响应、顺带分发通知）。
 * 握手后携带服务器返回的 Mcp-Session-Id，并按协商版本附带
 * MCP-Protocol-Version 头（2025-06-18 规范）；另尝试 GET SSE 流接收
 * 服务器主动通知（tools/list_changed 等，服务器返回 405 则静默跳过）。
 * 零外部依赖（原生 fetch + ReadableStream 手工解析 SSE）。
 * 旧版 HTTP+SSE 传输（2024-11-05 的 http 传输）已废弃，不支持。
 */
import {
  CLIENT_INFO,
  REQUEST_TIMEOUT_MS,
  SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  renderToolResult,
  type McpClient,
  type McpClientStatus,
  type McpInitResult,
  type McpServerConfig,
  type McpToolInfo,
} from './client'

/** 解析一个 SSE 帧（空行分隔的 event/data 行集合），无 data 行返回 null */
function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue // 注释/心跳
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

interface SseDispatch {
  done: boolean
  result?: unknown
}

export class McpHttpClient implements McpClient {
  private nextId = 1
  private negotiatedVersion = ''
  private sessionId = ''
  private streamAbort: AbortController | null = null
  private streamRetryDelayMs = 1000
  private streamRetryTimer: ReturnType<typeof setTimeout> | null = null
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

  get endpoint(): string {
    return this.cfg.url ?? ''
  }

  /** 会话与鉴权公共头；正文/accept 由各请求自行补 */
  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...(this.cfg.headers ?? {}) }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    if (this.negotiatedVersion) headers['MCP-Protocol-Version'] = this.negotiatedVersion
    return headers
  }

  /** POST 一条 JSON-RPC 消息并等待其响应（json 单响应或 SSE 流中匹配 id 的帧） */
  private async post(msg: Record<string, unknown>): Promise<unknown> {
    const id = msg.id as number | undefined
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        ...this.baseHeaders(),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const session = res.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`mcp: HTTP ${res.status}${body ? ' ' + body.slice(0, 200) : ''}`)
    }
    if (id === undefined) {
      // 通知：通常 202 无正文；个别服务器回 SSE 流，直接关闭即可
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream') && res.body) {
        await res.body.cancel().catch(() => undefined)
      }
      return undefined
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (contentType.includes('text/event-stream') && res.body) {
      return await this.consumeSseBody(res.body, id)
    }
    const text = await res.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`mcp: 响应不是合法 JSON：${text.slice(0, 200)}`)
    }
    if (data.error) {
      const e = data.error as { message?: string; code?: number }
      throw new Error(`mcp: ${e.message ?? '未知错误'} (code ${e.code ?? '?'})`)
    }
    return data.result
  }

  /** 逐帧解析 SSE body，收到 expectedId 的响应时结束；途中的通知照常分发 */
  private async consumeSseBody(body: ReadableStream<Uint8Array>, expectedId: number): Promise<unknown> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        for (;;) {
          const idx = buffer.indexOf('\n\n')
          if (idx < 0) break
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const handled = this.handleSseFrame(frame, expectedId)
          if (handled.done) return handled.result
        }
      }
      throw new Error('mcp: SSE 流结束但未收到响应')
    } finally {
      reader.cancel().catch(() => undefined)
    }
  }

  private handleSseFrame(frame: string, expectedId: number): SseDispatch {
    const parsed = parseSseFrame(frame)
    if (!parsed || parsed.event !== 'message') return { done: false }
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(parsed.data) as Record<string, unknown>
    } catch {
      return { done: false }
    }
    if (msg.id === undefined) {
      this.handleNotification(msg)
      return { done: false }
    }
    if (msg.id !== expectedId) return { done: false }
    if (msg.error) {
      const e = msg.error as { message?: string; code?: number }
      throw new Error(`mcp: ${e.message ?? '未知错误'} (code ${e.code ?? '?'})`)
    }
    return { done: true, result: msg.result }
  }

  private handleNotification(msg: Record<string, unknown>): void {
    if (msg.method === 'notifications/tools/list_changed') this.onToolsChanged?.()
  }

  private scheduleStreamRetry(): void {
    if (this.status === 'disconnected') return
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer)
    this.streamRetryTimer = setTimeout(() => {
      this.streamRetryTimer = null
      if (this.status === 'connected') this.openEventStream()
    }, this.streamRetryDelayMs)
    this.streamRetryDelayMs = Math.min(this.streamRetryDelayMs * 2, 30000)
  }

  /** 服务器主动通知流（可选能力）：GET 同一 url，405 表示不支持，静默跳过 */
  private openEventStream(): void {
    const controller = new AbortController()
    this.streamAbort = controller
    void (async () => {
      try {
        const res = await fetch(this.endpoint, {
          method: 'GET',
          headers: { ...this.baseHeaders(), accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) return
        this.streamRetryDelayMs = 1000 // 成功重置退避
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          for (;;) {
            const idx = buffer.indexOf('\n\n')
            if (idx < 0) break
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            this.handleSseFrame(frame, -1)
          }
        }
      } catch {
        /* 通知流断开不影响已建立的会话；指数退避重试（1s→30s） */
        this.scheduleStreamRetry()
      }
    })()
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return
    if (!this.cfg.url) throw new Error('mcp: 缺少 url 配置')
    this.status = 'connecting'
    this.lastError = ''
    this.sessionId = ''
    this.negotiatedVersion = ''
    try {
      const requested = SUPPORTED_PROTOCOL_VERSIONS[0]
      const initResult = (await this.post({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: { protocolVersion: requested, capabilities: {}, clientInfo: CLIENT_INFO },
      })) as McpInitResult | undefined
      const negotiation = negotiateProtocolVersion(requested, initResult?.protocolVersion)
      if (!negotiation.ok) {
        throw new Error(`mcp: 服务器协议版本不支持 ${negotiation.version}（客户端支持 ${SUPPORTED_PROTOCOL_VERSIONS.join(' / ')}）`)
      }
      this.negotiatedVersion = negotiation.version
      this.serverInfo = initResult?.serverInfo ?? {}
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
      this.status = 'connected'
      this.openEventStream()
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.disconnect()
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} })) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return (result?.tools ?? []).map((t) => ({
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    })).filter((t) => t.name !== '')
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    return renderToolResult(result)
  }

  disconnect(): void {
    this.streamAbort?.abort()
    this.streamAbort = null
    if (this.status === 'disconnected') return
    this.status = 'disconnected'
    // 按规范 DELETE 终止会话（best-effort，服务器未实现也无妨）
    if (this.sessionId) {
      void fetch(this.endpoint, {
        method: 'DELETE',
        headers: this.baseHeaders(),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined)
    }
  }
}

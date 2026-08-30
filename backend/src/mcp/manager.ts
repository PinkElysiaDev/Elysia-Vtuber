/**
 * MCP 服务器管理：按 llm.mcpServers 配置连接 MCP 服务器（stdio 或 Streamable HTTP），
 * 把远端工具注册进本地 ToolRegistry（命名 mcp__<server>__<tool>）。
 * 子模块向系统注册工具 → LLM 统一检测/门控 的架构在 MCP 侧的落点。
 */
import type { ToolRegistry } from '../core/tools'
import { McpStdioClient, type McpClient, type McpServerConfig, type McpToolInfo } from './client'
import { McpHttpClient } from './http-client'

export interface McpManagerDeps {
  tools: ToolRegistry
  getConfig: () => Record<string, McpServerConfig>
  saveConfig: (servers: Record<string, McpServerConfig>) => void
}

interface ServerEntry {
  client: McpClient
  tools: McpToolInfo[]
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
}

function createClient(name: string, cfg: McpServerConfig): McpClient {
  if (cfg.url) return new McpHttpClient(name, cfg)
  if (cfg.command) return new McpStdioClient(name, cfg)
  throw new Error('mcp: 配置需要 command（stdio）或 url（HTTP）之一')
}

/** stale 校验：连接期间配置可能被改，目标（命令或 URL）变了就不得注册 */
function sameTarget(a: McpServerConfig, b: McpServerConfig): boolean {
  return (a.command ?? '') === (b.command ?? '') && (a.url ?? '') === (b.url ?? '')
}

export class McpManager {
  private entries = new Map<string, ServerEntry>()
  /** 操作串行化：connect/disconnect/reconnect 竞态会造成重复注册或复活已删服务器 */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: McpManagerDeps) {}

  /** 当前服务器配置（RPC 模块读取用） */
  get serverConfig(): Record<string, McpServerConfig> {
    return this.deps.getConfig()
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn)
    this.chain = p.catch(() => undefined)
    return p
  }

  /** 连接单个服务器并注册其工具（入串行链；完成后校验配置未被并发修改） */
  async connectServer(name: string, cfg: McpServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> {
    return this.run(() => this.connectServerLocked(name, cfg))
  }

  /** 内部使用：已在串行链上，直接连接（不再入队） */
  private async connectServerLocked(name: string, cfg: McpServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> {
    this.disconnectServer(name)
    if (cfg.enabled === false) {
      return { ok: false, toolCount: 0, error: 'disabled' }
    }
    let client: McpClient
    try {
      client = createClient(name, cfg)
    } catch (err) {
      return { ok: false, toolCount: 0, error: err instanceof Error ? err.message : String(err) }
    }
    const entry: ServerEntry = { client, tools: [] }
    this.entries.set(name, entry)
    try {
      client.onToolsChanged = () => { void this.refreshServerTools(name) }
      await client.connect()
      entry.tools = await client.listTools()
      // 过期校验：连接期间配置可能已变（被移除/禁用/改目标）——不得复活
      const latest = this.deps.getConfig()[name]
      if (!latest || !sameTarget(latest, cfg) || latest.enabled === false) {
        client.disconnect()
        this.entries.delete(name)
        return { ok: false, toolCount: 0, error: 'stale' }
      }
      this.registerTools(name, entry)
      return { ok: true, toolCount: entry.tools.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      client.disconnect()
      this.entries.delete(name)
      return { ok: false, toolCount: 0, error: msg }
    }
  }

  private registerTools(name: string, entry: ServerEntry): void {
    const client = entry.client
    for (const remote of entry.tools) {
      this.deps.tools.register({
        name: mcpToolName(name, remote.name),
        description: `[MCP:${name}] ${remote.description || remote.name}`,
        parameters: remote.inputSchema,
        handler: async (args) => {
          if (client.status !== 'connected') {
            return { success: false, error: `MCP 服务器 ${name} 未连接` }
          }
          try {
            return await client.callTool(remote.name, args)
          } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) }
          }
        },
      })
    }
  }

  private unregisterTools(name: string, tools: McpToolInfo[]): void {
    for (const tool of tools) {
      this.deps.tools.unregister(mcpToolName(name, tool.name))
    }
  }

  /** tools/list_changed 通知：重拉工具列表并重建注册（串行，防与增删配置竞态） */
  async refreshServerTools(name: string): Promise<void> {
    return this.run(async () => {
      const entry = this.entries.get(name)
      if (!entry || entry.client.status !== 'connected') return
      try {
        const tools = await entry.client.listTools()
        this.unregisterTools(name, entry.tools)
        entry.tools = tools
        this.registerTools(name, entry)
      } catch {
        // 拉取失败保留现有注册，等下一次通知
      }
    })
  }

  disconnectServer(name: string): void {
    const entry = this.entries.get(name)
    if (!entry) return
    this.unregisterTools(name, entry.tools)
    entry.client.onToolsChanged = null
    entry.client.disconnect()
    this.entries.delete(name)
  }

  /** 按当前配置重连全部（配置变更 / 启动 / 手动刷新时调用；串行） */
  async reconnectAll(): Promise<void> {
    return this.run(async () => {
      const cfg = this.deps.getConfig()
      // 先断开已不存在的
      for (const name of [...this.entries.keys()]) {
        if (!(name in cfg)) this.disconnectServer(name)
      }
      for (const [name, serverCfg] of Object.entries(cfg)) {
        if (serverCfg.enabled === false) {
          this.disconnectServer(name)
          continue
        }
        await this.connectServerLocked(name, serverCfg)
      }
    })
  }

  stopAll(): void {
    for (const name of [...this.entries.keys()]) this.disconnectServer(name)
  }

  list(): Array<{ name: string; transport: 'stdio' | 'http'; command: string; url: string; status: string; toolCount: number; error: string; serverInfo: { name?: string; version?: string } }> {
    const cfg = this.deps.getConfig()
    const out: Array<{ name: string; transport: 'stdio' | 'http'; command: string; url: string; status: string; toolCount: number; error: string; serverInfo: { name?: string; version?: string } }> = []
    for (const [name, serverCfg] of Object.entries(cfg)) {
      const entry = this.entries.get(name)
      out.push({
        name,
        transport: serverCfg.url ? 'http' : 'stdio',
        command: [serverCfg.command, ...(serverCfg.args ?? [])].join(' '),
        url: serverCfg.url ?? '',
        status: serverCfg.enabled === false ? 'disabled' : entry ? entry.client.status : 'disconnected',
        toolCount: entry?.tools.length ?? 0,
        error: entry?.client.lastError ?? '',
        serverInfo: entry?.client.serverInfo ?? {},
      })
    }
    return out
  }

  /** 增改服务器：写配置并立即连接（串行） */
  async upsertServer(name: string, cfg: McpServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> {
    if (!name || !(cfg.command || cfg.url)) throw new Error('requires { name, command | url }')
    const next = { ...this.deps.getConfig(), [name]: cfg }
    this.deps.saveConfig(next)
    return this.connectServer(name, cfg)
  }

  /** 移除服务器：写配置并断开（同样入串行链，等待在途连接结束后再删，防复活） */
  async removeServer(name: string): Promise<{ ok: boolean }> {
    return this.run(async () => {
      const next = { ...this.deps.getConfig() }
      if (!(name in next)) return { ok: false }
      delete next[name]
      this.deps.saveConfig(next)
      this.disconnectServer(name)
      return { ok: true }
    })
  }
}

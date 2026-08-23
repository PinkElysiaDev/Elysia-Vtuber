/**
 * MCP 服务器管理：按 llm.mcpServers 配置连接 stdio MCP 服务器，
 * 把远端工具注册进本地 ToolRegistry（命名 mcp__<server>__<tool>）。
 * 子模块向系统注册工具 → LLM 统一检测/门控 的架构在 MCP 侧的落点。
 */
import type { ToolRegistry } from '../core/tools'
import { McpStdioClient, type McpServerConfig, type McpToolInfo } from './client'

export interface McpManagerDeps {
  tools: ToolRegistry
  getConfig: () => Record<string, McpServerConfig>
  saveConfig: (servers: Record<string, McpServerConfig>) => void
}

interface ServerEntry {
  client: McpStdioClient
  tools: McpToolInfo[]
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
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

  /** 连接单个服务器并注册其工具（串行执行；完成后校验配置未被并发修改） */
  async connectServer(name: string, cfg: McpServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> {
    return this.run(async () => {
      this.disconnectServer(name)
      if (cfg.enabled === false) {
        return { ok: false, toolCount: 0, error: 'disabled' }
      }
      const client = new McpStdioClient(name, cfg)
      const entry: ServerEntry = { client, tools: [] }
      this.entries.set(name, entry)
      try {
        await client.connect()
        entry.tools = await client.listTools()
        // 过期校验：连接期间配置可能已变（被移除/禁用）——不得复活
        const latest = this.deps.getConfig()[name]
        if (!latest || latest.command !== cfg.command || latest.enabled === false) {
          client.disconnect()
          this.entries.delete(name)
          return { ok: false, toolCount: 0, error: 'stale' }
        }
        for (const tool of entry.tools) {
          const remote = tool
          this.deps.tools.register({
            name: mcpToolName(name, remote.name),
            description: `[MCP:${name}] ${remote.description || remote.name}`,
            parameters: remote.inputSchema,
            handler: async (args) => {
              if (client.status !== 'connected') {
                return { success: false, error: `MCP 服务器 ${name} 未连接` }
              }
              try {
                const res = await client.callTool(remote.name, args)
                return res
              } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) }
              }
            },
          })
        }
        return { ok: true, toolCount: entry.tools.length }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        client.disconnect()
        this.entries.delete(name)
        return { ok: false, toolCount: 0, error: msg }
      }
    })
  }

  disconnectServer(name: string): void {
    const entry = this.entries.get(name)
    if (!entry) return
    for (const tool of entry.tools) {
      this.deps.tools.unregister(mcpToolName(name, tool.name))
    }
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

  /** 内部使用：已在串行链上，直接连接（不再入队） */
  private async connectServerLocked(name: string, cfg: McpServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> {
    this.disconnectServer(name)
    if (cfg.enabled === false) {
      return { ok: false, toolCount: 0, error: 'disabled' }
    }
    const client = new McpStdioClient(name, cfg)
    const entry: ServerEntry = { client, tools: [] }
    this.entries.set(name, entry)
    try {
      await client.connect()
      entry.tools = await client.listTools()
      const latest = this.deps.getConfig()[name]
      if (!latest || latest.command !== cfg.command || latest.enabled === false) {
        client.disconnect()
        this.entries.delete(name)
        return { ok: false, toolCount: 0, error: 'stale' }
      }
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
      return { ok: true, toolCount: entry.tools.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      client.disconnect()
      this.entries.delete(name)
      return { ok: false, toolCount: 0, error: msg }
    }
  }

  stopAll(): void {
    for (const name of [...this.entries.keys()]) this.disconnectServer(name)
  }

  list(): Array<{ name: string; command: string; status: string; toolCount: number; error: string; serverInfo: { name?: string; version?: string } }> {
    const cfg = this.deps.getConfig()
    const out: Array<{ name: string; command: string; status: string; toolCount: number; error: string; serverInfo: { name?: string; version?: string } }> = []
    for (const [name, serverCfg] of Object.entries(cfg)) {
      const entry = this.entries.get(name)
      out.push({
        name,
        command: [serverCfg.command, ...(serverCfg.args ?? [])].join(' '),
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
    if (!name || !cfg.command) throw new Error('requires { name, command }')
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

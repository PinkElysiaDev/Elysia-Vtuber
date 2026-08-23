/** MCP 接入 RPC：服务器列表 / 增改删 / 刷新 */
import type { RpcHandler } from '../core/rpc'
import type { McpManager } from '../mcp/manager'
import type { McpServerConfig } from '../mcp/client'

export function buildMcpModule(manager: McpManager): Record<string, RpcHandler> {
  return {
    'mcp.servers.list': () => ({ servers: manager.list() }),
    'mcp.server.add': async (params) => {
      const rec = (params as { name?: string; command?: string; args?: string[]; env?: Record<string, string> }) ?? {}
      const name = String(rec.name ?? '').trim()
      const command = String(rec.command ?? '').trim()
      if (!name || !command) throw new Error('mcp.server.add requires { name, command }')
      const cfg: McpServerConfig = { command, enabled: true }
      if (Array.isArray(rec.args)) cfg.args = rec.args.map(String)
      if (rec.env && typeof rec.env === 'object') cfg.env = rec.env
      const result = await manager.upsertServer(name, cfg)
      return { ok: result.ok, name, toolCount: result.toolCount, error: result.error }
    },
    'mcp.server.update': async (params) => {
      const rec = (params as { name?: string; enabled?: boolean; command?: string; args?: string[] }) ?? {}
      const name = String(rec.name ?? '').trim()
      if (!name) throw new Error('mcp.server.update requires { name }')
      // 当前仅支持启停切换；命令修改走 remove + add
      const servers = manager.list()
      const target = servers.find((s) => s.name === name)
      if (!target) throw new Error(`mcp: 服务器不存在 ${name}`)
      const current = manager.serverConfig[name]
      const cfg: McpServerConfig = { ...current, enabled: rec.enabled !== false }
      const result = await manager.upsertServer(name, cfg)
      return { ok: result.ok, name, toolCount: result.toolCount, error: result.error }
    },
    'mcp.server.remove': (params) => {
      const name = String((params as { name?: string })?.name ?? '').trim()
      if (!name) throw new Error('mcp.server.remove requires { name }')
      return manager.removeServer(name)
    },
    'mcp.refresh': async () => {
      await manager.reconnectAll()
      return { ok: true, servers: manager.list() }
    },
  }
}

/** MCP 接入 RPC：服务器列表 / 增改删 / 刷新 / AI 文档解析 */
import type { RpcHandler } from '../core/rpc'
import type { McpManager } from '../mcp/manager'
import type { McpServerConfig } from '../mcp/client'
import { suggestMcpHttpConfig, type McpSuggestDeps } from '../mcp/suggest'

function readHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v)
  return out
}

function readEnv(value: unknown): Record<string, string> | undefined {
  return readHeaders(value)
}

export function buildMcpModule(manager: McpManager, suggestDeps?: McpSuggestDeps): Record<string, RpcHandler> {
  return {
    'mcp.servers.list': () => ({ servers: manager.list() }),
    'mcp.server.add': async (params) => {
      const rec = (params as { name?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }) ?? {}
      const name = String(rec.name ?? '').trim()
      const command = String(rec.command ?? '').trim()
      const url = String(rec.url ?? '').trim()
      if (!name || !(command || url)) throw new Error('mcp.server.add requires { name, command | url }')
      const cfg: McpServerConfig = url ? { url, enabled: true } : { command, enabled: true }
      if (rec.args && Array.isArray(rec.args)) cfg.args = rec.args.map(String)
      if (rec.env) cfg.env = readEnv(rec.env)
      if (rec.headers) cfg.headers = readHeaders(rec.headers)
      const result = await manager.upsertServer(name, cfg)
      return { ok: result.ok, name, toolCount: result.toolCount, error: result.error }
    },
    'mcp.server.update': async (params) => {
      const rec = (params as { name?: string; enabled?: boolean; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }) ?? {}
      const name = String(rec.name ?? '').trim()
      if (!name) throw new Error('mcp.server.update requires { name }')
      const current = manager.serverConfig[name]
      if (!current) throw new Error(`mcp: 服务器不存在 ${name}`)
      // 逐字段覆盖：未出现的字段保留原值；command/url 互斥，出现任一则清空另一个
      const cfg: McpServerConfig = { ...current }
      if (rec.command !== undefined || rec.url !== undefined) {
        delete cfg.command
        delete cfg.url
        delete cfg.args
        if (String(rec.command ?? '').trim()) cfg.command = String(rec.command).trim()
        if (String(rec.url ?? '').trim()) cfg.url = String(rec.url).trim()
      }
      if (rec.args !== undefined && Array.isArray(rec.args)) cfg.args = rec.args.map(String)
      if (rec.env !== undefined) cfg.env = readEnv(rec.env)
      if (rec.headers !== undefined) cfg.headers = readHeaders(rec.headers)
      cfg.enabled = rec.enabled !== undefined ? rec.enabled !== false : current.enabled !== false
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
    // AI 解析文档 → MCP HTTP 接入建议（仅返回建议，不写配置；密钥以 {{apiKey}} 占位）
    'mcp.config.suggest': async (params) => {
      if (!suggestDeps) throw new Error('mcp.config.suggest 不可用（缺少 LLM 网关）')
      const rec = (params as { mode?: string; url?: string; text?: string; images?: string[] }) ?? {}
      const result = await suggestMcpHttpConfig(suggestDeps, {
        mode: String(rec.mode ?? 'text') as 'url' | 'text' | 'images',
        url: rec.url,
        text: rec.text,
        images: Array.isArray(rec.images) ? rec.images : undefined,
      })
      return { ok: result.ok, suggestion: result.value, errors: result.errors }
    },
  }
}

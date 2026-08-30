/** LLM 多模型注册表 RPC：档案增删改 / 激活切换 */
import type { RpcHandler } from '../core/rpc'
import type { LLMConfig, LlmModelProfile } from '../config'

export interface LlmModelsModuleDeps {
  getConfig: () => LLMConfig
  /** 档案已被修改后调用：落盘并应用运行时 */
  save: () => void
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

function readProfile(params: Record<string, unknown>): LlmModelProfile {
  const thinkingRec = (params.thinking ?? {}) as Record<string, unknown>
  const thinking = {
    enabled: thinkingRec.enabled === true,
    ...(typeof thinkingRec.effort === 'string' && thinkingRec.effort ? { effort: thinkingRec.effort } : {}),
  }
  const headers: Record<string, string> = {}
  if (params.headers && typeof params.headers === 'object' && !Array.isArray(params.headers)) {
    for (const [k, v] of Object.entries(params.headers as Record<string, unknown>)) headers[k] = String(v)
  }
  return {
    label: String(params.label ?? '').trim(),
    provider: String(params.provider ?? 'openai').trim().toLowerCase(),
    baseURL: String(params.baseURL ?? '').trim(),
    apiKey: String(params.apiKey ?? ''),
    model: String(params.model ?? '').trim(),
    headers: Object.keys(headers).length ? headers : undefined,
    thinking,
    temperature: readNumber(params.temperature),
    maxTokens: readNumber(params.maxTokens),
    topP: readNumber(params.topP),
    timeoutMs: readNumber(params.timeoutMs),
    contextWindow: readNumber(params.contextWindow),
    enabled: params.enabled !== false,
  }
}

export function buildLlmModelsModule(deps: LlmModelsModuleDeps): Record<string, RpcHandler> {
  return {
    'llm.models.list': () => {
      const llm = deps.getConfig()
      return {
        models: Object.entries(llm.models ?? {}).map(([name, profile]) => ({ name, ...profile })),
        activeModel: llm.activeModel ?? '',
      }
    },
    'llm.models.upsert': (params) => {
      const rec = (params as { name?: string } & Record<string, unknown>) ?? {}
      const name = String(rec.name ?? '').trim()
      if (!name) throw new Error('llm.models.upsert requires { name }')
      const profile = readProfile(rec)
      if (!profile.model) throw new Error('llm.models.upsert requires profile.model')
      const llm = deps.getConfig()
      const wasEmpty = Object.keys(llm.models ?? {}).length === 0
      llm.models = { ...(llm.models ?? {}), [name]: profile }
      // 注册表从空到有且尚未激活任何模型：自动设为当前使用，保证新装环境开箱即用
      if (wasEmpty && !(llm.activeModel ?? '').trim()) {
        llm.activeModel = name
      }
      deps.save()
      return { ok: true, name, activeModel: llm.activeModel }
    },
    'llm.models.remove': (params) => {
      const name = String((params as { name?: string })?.name ?? '').trim()
      if (!name) throw new Error('llm.models.remove requires { name }')
      const llm = deps.getConfig()
      if (!llm.models || !(name in llm.models)) return { ok: false }
      const next = { ...llm.models }
      delete next[name]
      llm.models = next
      if (llm.activeModel === name) llm.activeModel = ''
      deps.save()
      return { ok: true }
    },
    'llm.models.activate': (params) => {
      const name = String((params as { name?: string })?.name ?? '').trim()
      const llm = deps.getConfig()
      if (name && !(name in (llm.models ?? {}))) throw new Error(`模型不存在：${name}`)
      llm.activeModel = name
      deps.save()
      return { ok: true, activeModel: name }
    },
  }
}

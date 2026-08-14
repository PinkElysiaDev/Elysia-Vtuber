/**
 * 配置模块：config.get / config.schema / config.update / config.updateSection / config.reset
 * WebUI 与插件均通过 RPC 读写配置。
 */

import type { RpcHandler } from '../core/rpc'
import type { BackendConfig } from '../config'
import { cloneConfig, loadConfig, saveConfig } from '../config'
import { buildConfigSchema } from '../schema'

export interface ConfigModuleDeps {
  getConfig: () => BackendConfig
  setConfig: (config: BackendConfig) => void
  configPath: string
  /** 配置变更回调（如触发器热重载、C++ 重启） */
  onConfigChanged?: () => void
}

/** 按点路径读取嵌套值，如 'llm.baseURL' */
export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return cur
}

/** 按点路径写入嵌套值 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.')
  let cur = obj
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    if (!cur[seg] || typeof cur[seg] !== 'object') cur[seg] = {}
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segs[segs.length - 1]] = value
}

export function buildConfigModule(deps: ConfigModuleDeps): Record<string, RpcHandler> {
  const persistAndNotify = () => {
    saveConfig(deps.getConfig(), deps.configPath)
    deps.onConfigChanged?.()
  }

  return {
    'config.get': () => cloneConfig(deps.getConfig()),

    'config.schema': () => buildConfigSchema(),

    'config.update': (params) => {
      const patch = (params as any)?.config
      if (!patch || typeof patch !== 'object') {
        throw new Error('config.update requires an object param { config }')
      }
      const merged = cloneConfig(deps.getConfig()) as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
        merged[key] = value
      }
      deps.setConfig(merged as unknown as BackendConfig)
      persistAndNotify()
      return cloneConfig(deps.getConfig())
    },

    'config.updateSection': (params) => {
      const { section, value } = (params as any) ?? {}
      if (!section || typeof section !== 'string') {
        throw new Error('config.updateSection requires { section, value }')
      }
      const merged = cloneConfig(deps.getConfig()) as unknown as Record<string, unknown>
      merged[section] = value
      deps.setConfig(merged as unknown as BackendConfig)
      persistAndNotify()
      return { success: true, section, value }
    },

    'config.updatePath': (params) => {
      const { path: p, value } = (params as any) ?? {}
      if (!p || typeof p !== 'string') {
        throw new Error('config.updatePath requires { path, value }')
      }
      const merged = cloneConfig(deps.getConfig()) as unknown as Record<string, unknown>
      setByPath(merged, p, value)
      deps.setConfig(merged as unknown as BackendConfig)
      persistAndNotify()
      return cloneConfig(deps.getConfig())
    },

    'config.updatePaths': (params) => {
      const entries = (params as any)?.entries
      if (!Array.isArray(entries)) {
        throw new Error('config.updatePaths requires { entries: [{ path, value }] }')
      }
      const merged = cloneConfig(deps.getConfig()) as unknown as Record<string, unknown>
      for (const entry of entries) {
        if (!entry || typeof entry.path !== 'string') continue
        setByPath(merged, entry.path, entry.value)
      }
      deps.setConfig(merged as unknown as BackendConfig)
      persistAndNotify()
      return cloneConfig(deps.getConfig())
    },

    'config.reload': () => {
      deps.setConfig(loadConfig(deps.configPath))
      deps.onConfigChanged?.()
      return cloneConfig(deps.getConfig())
    },
  }
}

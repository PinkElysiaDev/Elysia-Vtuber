import type { RpcHandler } from '../core/rpc'
import type { CppClient } from '../cpp/client'
import type { Live2DConfig } from '../config'
import { resolveBackendPath } from '../config'

function resolveModelPath(modelPath: string): string {
  return resolveBackendPath(modelPath)
}

export interface Live2DModuleDeps {
  cpp: CppClient
  getConfig: () => Live2DConfig
}

export function buildLive2dModule(deps: Live2DModuleDeps): Record<string, RpcHandler> {
  const call = async (method: string, args: Record<string, unknown> = {}) => {
    if (!deps.cpp.isConnected()) {
      return { ok: false, error: 'C++ 执行器未连接' }
    }
    return deps.cpp.request(method, args)
  }

  return {
    'live2d.status': async () => {
      const remote = await call('live2d.status')
      return {
        connected: deps.cpp.isConnected(),
        config: deps.getConfig(),
        remote,
      }
    },
    'live2d.list': async () => call('live2d.list'),
    'live2d.load': async (params) => {
      const rec = (params as { path?: string }) ?? {}
      const modelPath = rec.path || deps.getConfig().modelPath
      if (!modelPath) throw new Error('live2d.load requires { path } or live2d.modelPath')
      return call('live2d.load', { path: resolveModelPath(modelPath) })
    },
    'live2d.expression': async (params) => {
      const name = String((params as { name?: string })?.name ?? '')
      if (!name) throw new Error('live2d.expression requires { name }')
      return call('live2d.expression', { name })
    },
    'live2d.resetExpression': async () => call('live2d.resetExpression'),
    'live2d.motion': async (params) => {
      const rec = (params as { group?: string; index?: number }) ?? {}
      return call('live2d.motion', {
        group: rec.group || 'Idle',
        index: Number(rec.index ?? 0),
      })
    },
    'live2d.transform': async (params) => {
      const rec = (params as { scale?: number; x?: number; y?: number }) ?? {}
      const cfg = deps.getConfig()
      return call('live2d.transform', {
        scale: rec.scale ?? cfg.scale,
        x: rec.x ?? cfg.x,
        y: rec.y ?? cfg.y,
      })
    },
  }
}

export async function applyLive2dConfig(cpp: CppClient, config: Live2DConfig): Promise<void> {
  if (!cpp.isConnected()) return
  if (config.modelPath) {
    await cpp.request('live2d.load', { path: resolveModelPath(config.modelPath) }).catch((err) => {
      console.warn('[live2d] load from config failed:', err)
    })
  }
  await cpp.request('live2d.transform', {
    scale: config.scale,
    x: config.x,
    y: config.y,
  }).catch((err) => {
    console.warn('[live2d] transform from config failed:', err)
  })
}

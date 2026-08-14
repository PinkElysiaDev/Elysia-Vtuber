import type { RpcHandler } from '../core/rpc'
import type { CppClient } from '../cpp/client'

export function buildCppModule(cpp: CppClient): Record<string, RpcHandler> {
  return {
    'cpp.status': () => ({
      status: cpp.getStatus(),
      connected: cpp.isConnected(),
    }),
    'cpp.start': async () => {
      const ok = await cpp.start()
      return { ok, status: cpp.getStatus(), connected: cpp.isConnected() }
    },
    'cpp.stop': () => {
      cpp.stop()
      return { ok: true, status: cpp.getStatus() }
    },
    'cpp.restart': async () => {
      const ok = await cpp.restart()
      return { ok, status: cpp.getStatus(), connected: cpp.isConnected() }
    },
    'cpp.call': async (params) => {
      const { method, args } = (params as { method?: string; args?: unknown }) ?? {}
      if (!method) throw new Error('cpp.call requires { method }')
      return cpp.request(method, args)
    },
  }
}

/**
 * C++ 执行器控制模块：状态 / 启动 / 停止 / 通用 RPC 透传
 * 双执行器（audio + live2d），通过 target 参数路由
 */

import type { RpcHandler } from '../core/rpc'
import type { CppClient } from '../cpp/client'

export function buildCppModule(audioCpp: CppClient, live2dCpp: CppClient): Record<string, RpcHandler> {
  const pick = (target?: string): CppClient => {
    return target === 'audio' ? audioCpp : live2dCpp
  }
  return {
    'cpp.status': async (params) => {
      const rec = (params as { target?: string }) ?? {}
      if (rec.target) {
        const c = pick(rec.target)
        return { status: c.getStatus(), connected: c.isConnected() }
      }
      // 无 target：返回两个执行器的合并状态
      return {
        audio: { status: audioCpp.getStatus(), connected: audioCpp.isConnected() },
        live2d: { status: live2dCpp.getStatus(), connected: live2dCpp.isConnected() },
      }
    },
    'cpp.start': async (params) => {
      const rec = (params as { target?: string }) ?? {}
      if (rec.target) {
        const c = pick(rec.target)
        const ok = await c.start()
        return { ok, status: c.getStatus(), connected: c.isConnected() }
      }
      const audioOk = await audioCpp.start().catch(() => false)
      const live2dOk = await live2dCpp.start().catch(() => false)
      return { ok: audioOk || live2dOk, audio: { connected: audioCpp.isConnected() }, live2d: { connected: live2dCpp.isConnected() } }
    },
    'cpp.stop': async (params) => {
      const rec = (params as { target?: string }) ?? {}
      if (rec.target) {
        const c = pick(rec.target)
        await c.stop()
        return { ok: true, status: c.getStatus() }
      }
      await audioCpp.stop()
      await live2dCpp.stop()
      return { ok: true }
    },
    'cpp.restart': async (params) => {
      const rec = (params as { target?: string }) ?? {}
      if (rec.target) {
        const c = pick(rec.target)
        const ok = await c.restart()
        return { ok, status: c.getStatus(), connected: c.isConnected() }
      }
      await audioCpp.restart()
      await live2dCpp.restart()
      return { ok: true }
    },
    'cpp.call': async (params) => {
      const { method, args, target } = (params as { method?: string; args?: unknown; target?: string }) ?? {}
      if (!method) throw new Error('cpp.call requires { method, target: "audio" | "live2d" }')
      const client = pick(target)
      return client.request(method, args)
    },
  }
}

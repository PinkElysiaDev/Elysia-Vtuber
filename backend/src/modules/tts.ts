import type { RpcHandler } from '../core/rpc'
import type { TtsEngine } from '../tts/engine'
import type { CppClient } from '../cpp/client'

export function buildTtsModule(engine: TtsEngine, cpp: CppClient): Record<string, RpcHandler> {
  return {
    'tts.speak': async (params) => {
      const text = String((params as any)?.text ?? '')
      if (!text.trim()) throw new Error('tts.speak requires { text }')
      return engine.speakNow(text)
    },
    'tts.stop': () => engine.stop(),
    'tts.status': () => engine.getState(),
    'audio.devices': async () => {
      if (!cpp.isConnected()) return { ok: false, devices: [], error: 'C++ 执行器未连接' }
      return cpp.request('player.devices', {})
    },
  }
}

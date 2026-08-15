import type { RpcHandler } from '../core/rpc'
import type { TtsEngine } from '../tts/engine'
import type { CppClient } from '../cpp/client'

export function buildTtsModule(engine: TtsEngine, cpp: CppClient): Record<string, RpcHandler> {
  return {
    'tts.speak': async (params) => {
      const text = String((params as any)?.text ?? '')
      if (!text.trim()) throw new Error('tts.speak requires { text }')
      const result = engine.speak(text)
      return { ok: true, message: '已加入语音队列', ...result }
    },
    'tts.stop': () => engine.stop(),
    'tts.status': () => engine.getState(),
    'audio.devices': async () => {
      const result = await cpp.safeRequest('player.devices', {})
      return result.ok ? result : { ok: false, devices: [], error: result.error ?? 'C++ 执行器未连接' }
    },
  }
}

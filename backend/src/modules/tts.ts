import type { RpcHandler } from '../core/rpc'
import type { TtsEngine } from '../tts/engine'
import type { CppClient } from '../cpp/client'

/**
 * 生成约 0.7s 的双音阶提示音（A5→D6，指数衰减包络）。
 * SourceReader 不支持 data: URI，走 player.play 的 bytes 参数：
 * C++ 侧写入自己的临时文件并在该通道下次播放/停止时自动删除，Node 侧零文件管理。
 */
function buildTestChime(): number[] {
  const sampleRate = 22050
  const durationSec = 0.7
  const samples = Math.floor(sampleRate * durationSec)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    const freq = t < 0.25 ? 880 : 1174.66
    const envelope = Math.exp(-4 * t) * (1 - Math.exp(-80 * t))
    const value = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.8 * envelope * 32767)
    data.writeInt16LE(value, i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return [...Buffer.concat([header, data])]
}

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
    'audio.test': async (params) => {
      const rec = (params as any) ?? {}
      const channel = String(rec.channel || 'tts')
      const device = rec.device ? String(rec.device) : undefined
      const volume = Number(rec.volume ?? 80)

      if (!cpp.isConnected()) {
        return { ok: false, error: 'C++ 执行器未连接，无法播放测试音' }
      }

      return cpp.safeRequest('player.play', {
        channel,
        device,
        volume,
        bytes: buildTestChime(),
        title: `[Audio Test] ${channel.toUpperCase()}`,
      }).catch(err => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
    },
  }
}

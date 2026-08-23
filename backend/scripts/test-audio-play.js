#!/usr/bin/env node
/**
 * C++ 执行器播放链路回归测试（直连 IPC :19276，不经后端）：
 *  1. bytes 提示音（tts 模块同款）→ 断言收到 player.ended（OnBufferEnd 只有
 *     缓冲被真实渲染消费才会触发——这是“声音确实在出”的强证据）
 *  2. 真实曲目文件（url 播放）→ 断言 playing 且播完收到 ended
 *
 * 前置：vtuber_executor.exe 已运行并监听 19276；$TEMP/test-song.wav 已下载
 * 用法：node scripts/test-audio-play.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const IPC = 'ws://127.0.0.1:19276'

function buildTestChime() {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function main() {
  return new Promise(async (resolve, reject) => {
    const ws = new WebSocket(IPC)
    let nextId = 1
    const endedWaiters = []
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg.method === 'player.ended') {
        console.log(`[test] 收到 player.ended (channel=${msg.params?.channel} title=${msg.params?.title || ''})`)
        for (const w of endedWaiters.splice(0)) w(msg.params)
      }
    })
    ws.on('error', reject)

    const call = (method, params) => new Promise((res, rej) => {
      const id = nextId++
      const timer = setTimeout(() => rej(new Error(`RPC 超时: ${method}`)), 20000)
      ws.on('message', (raw) => {
        let m
        try { m = JSON.parse(String(raw)) } catch { return }
        if (m.id === id) {
          clearTimeout(timer)
          if (m.error) rej(new Error(m.error.message || method))
          else res(m.result)
        }
      })
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
    const waitEnded = (timeoutMs) => new Promise((res) => {
      const timer = setTimeout(() => res(null), timeoutMs)
      endedWaiters.push((params) => { clearTimeout(timer); res(params) })
    })

    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
    console.log('[test] 已连接执行器 IPC')

    // —— 测试 1：bytes 提示音（0.7s）——
    let t0 = Date.now()
    let ended = waitEnded(5000)
    const r1 = await call('player.play', { channel: 'music', bytes: buildTestChime(), volume: 80, title: '[test] chime' })
    if (!r1.ok) throw new Error('bytes 播放请求失败: ' + JSON.stringify(r1))
    const e1 = await ended
    const chimeMs = e1 ? Date.now() - t0 : -1
    console.log(`[test] 提示音 ended 耗时 ${chimeMs}ms（期望 ~700ms，旧 bug 下永不到达）`)
    if (!e1) throw new Error('提示音未收到 ended —— 缓冲未被渲染，播放链路仍无声')

    // —— 测试 2：真实曲目文件 ——
    const song = path.join(os.tmpdir(), 'test-song.wav')
    if (!fs.existsSync(song)) throw new Error('缺少测试曲目: ' + song)
    t0 = Date.now()
    ended = waitEnded(60000)
    const r2 = await call('player.play', { channel: 'music', url: song, volume: 80, title: '[test] piano' })
    if (!r2.ok) throw new Error('url 播放请求失败: ' + JSON.stringify(r2))
    await sleep(2500)
    const st = await call('player.status')
    const music = st.music || st
    console.log(`[test] 曲目播放中状态: playing=${music.playing} url=${(music.url || '').slice(-20)}`)
    const e2 = await ended
    const songMs = e2 ? Date.now() - t0 : -1
    console.log(`[test] 曲目 ended 耗时 ${(songMs / 1000).toFixed(1)}s`)
    if (!music.playing) throw new Error('曲目未进入 playing 状态')
    if (!e2) throw new Error('曲目未收到 ended —— 渲染未发生或超长')

    console.log('[test] PASS: 播放链路真实渲染（ended 事件随缓冲消费到达）')
    ws.terminate()
    resolve()
  })
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

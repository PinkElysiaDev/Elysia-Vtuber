#!/usr/bin/env node
/**
 * 执行器窗口配置与实时电平回归测试（直连 IPC :19276）：
 *  1. window.apply 改宽高/置顶 → system.status 回读生效
 *  2. window.apply 切透明 → status.transparent=true（视觉由人工确认）
 *  3. 播放提示音期间收到 player.levels 电平流（rms>0）
 * 用法：node scripts/test-window-levels.js （需执行器已运行）
 */
const WebSocket = require('ws')
const os = require('os')
const path = require('path')
const fs = require('fs')

const IPC = 'ws://127.0.0.1:19276'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildTestChime() {
  const sr = 22050, n = Math.floor(sr * 1.2)
  const d = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    d.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 880 * t) * 0.8 * 32767 * (1 - t / 1.2)), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(d.length, 40)
  return [...Buffer.concat([h, d])]
}

async function main() {
  const ws = new WebSocket(IPC)
  let nextId = 1
  const levels = []
  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(String(raw)) } catch { return }
    if (m.method === 'player.levels' && m.params && m.params.channel === 'music') levels.push(m.params)
  })
  const call = (method, params) => new Promise((res, rej) => {
    const id = nextId++
    const timer = setTimeout(() => rej(new Error(`RPC 超时: ${method}`)), 15000)
    ws.on('message', (raw) => {
      let m
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m.id === id) { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result) }
    })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })

  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  console.log('[test] 已连接执行器')

  // —— 1. 宽高/置顶 ——
  let st = await call('system.status')
  const before = { w: st.window.width, h: st.window.height, top: st.window.alwaysOnTop }
  const r1 = await call('window.apply', { width: 620, height: 940, alwaysOnTop: !before.top })
  if (!r1.ok) throw new Error('window.apply 失败: ' + JSON.stringify(r1))
  await sleep(400)
  st = await call('system.status')
  if (st.window.width !== 620 || st.window.height !== 940) throw new Error(`尺寸未生效: ${st.window.width}x${st.window.height}`)
  if (st.window.alwaysOnTop === before.top) throw new Error('置顶未切换')
  console.log(`[test] 宽高/置顶 OK: ${st.window.width}x${st.window.height} alwaysOnTop=${st.window.alwaysOnTop}`)

  // —— 2. 透明切换（窗口重建）——
  const r2 = await call('window.apply', { transparent: true })
  if (!r2.ok) throw new Error('透明切换失败: ' + JSON.stringify(r2))
  await sleep(400)
  st = await call('system.status')
  if (!st.window.transparent) throw new Error('transparent 状态未生效')
  console.log('[test] 透明模式 OK: transparent=true, recreated=' + r2.recreated)
  // 回到不透明 + 原尺寸
  await call('window.apply', { transparent: false, width: before.w, height: before.h, alwaysOnTop: before.top })
  await sleep(300)
  st = await call('system.status')
  if (st.window.transparent) throw new Error('回退不透明失败')
  console.log('[test] 回退不透明 OK')

  // —— 3. 播放电平流 ——
  levels.length = 0
  const r3 = await call('player.play', { channel: 'music', bytes: buildTestChime(), volume: 80, title: 'levels-probe' })
  if (!r3.ok) throw new Error('播放失败')
  await sleep(1500)
  const withSound = levels.filter((l) => l.rms > 0.01)
  console.log(`[test] player.levels 共 ${levels.length} 条，rms>0.01 的 ${withSound.length} 条，示例 rms=${(levels[0] || {}).rms} peak=${(levels[0] || {}).peak}`)
  if (levels.length < 5) throw new Error('电平流未到达（计量线程未工作）')
  if (!withSound.length) throw new Error('电平全为静音值（RMS 计算或对齐有误）')
  await call('player.stop', { channel: 'music' }).catch(() => {})

  console.log('[test] PASS: window.apply 与 player.levels 均正常')
  ws.terminate()
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

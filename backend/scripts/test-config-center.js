#!/usr/bin/env node
/**
 * 配置中心改造回归测试（RPC 级，离线自包含）：
 *  1. config.schema 返回 7 个合并后的分区，字段归属正确
 *  2. config.updatePaths 单字段写入后 config.get 立即反映（自动保存的后端通道）
 *
 * 用法：node scripts/test-config-center.js  （需先 npx tsc 构建 dist/）
 */
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const WebSocket = require('ws')

const WS_PORT = 19275
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
    socket.connect(port, '127.0.0.1')
  })
}

async function stopExistingBackend() {
  if (!(await isPortOpen(WS_PORT))) return
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`)
    const done = () => { try { ws.terminate() } catch {}; resolve() }
    ws.on('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system.shutdown' }))
      setTimeout(done, 1500)
    })
    ws.on('error', done)
    setTimeout(done, 5000)
  })
  for (let i = 0; i < 20; i++) {
    if (!(await isPortOpen(WS_PORT))) return
    await sleep(300)
  }
  throw new Error('已有后端实例未能退出')
}

function rpcCall(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC 超时: ${method}`)), 10000)
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg.id === id) {
        clearTimeout(timer)
        if (msg.error) reject(new Error(msg.error.message || method))
        else resolve(msg.result)
      }
    })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }))
  })
}

async function main() {
  await stopExistingBackend()

  const backendRoot = path.resolve(__dirname, '..')
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: backendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const relay = (d) => process.stdout.write(`[svc] ${String(d).trimEnd()}\n`)
  child.stdout.on('data', relay)
  child.stderr.on('data', relay)

  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !(await isPortOpen(WS_PORT))) await sleep(300)
  if (!(await isPortOpen(WS_PORT))) throw new Error('后端 15s 内未开始监听')

  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`)
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { kind: 'webui' } }))
  await sleep(300)

  // —— 断言 1：分区结构（9 个分区，其中 live2d/music 带 pane 归属战术面板，不进配置中心导航）——
  const schema = await rpcCall(ws, 10, 'config.schema')
  const keys = schema.map((s) => s.key)
  const expect = ['server', 'events', 'triggers', 'llm', 'tts', 'output', 'music', 'live2d', 'cpp']
  if (JSON.stringify(keys) !== JSON.stringify(expect)) {
    throw new Error(`分区不符: ${JSON.stringify(keys)}（期望 ${JSON.stringify(expect)}）`)
  }
  const byKey = Object.fromEntries(schema.map((s) => [s.key, s]))
  if (byKey.music.pane !== 'jukebox') throw new Error('music 分区应带 pane=jukebox')
  if (byKey.live2d.pane !== 'live2d') throw new Error('live2d 分区应带 pane=live2d')
  if (byKey.tts.pane || byKey.output.pane || byKey.cpp.pane) throw new Error('配置中心分区不应带 pane')
  const mustContain = {
    tts: ['tts.provider', 'tts.voiceType'],
    output: ['output.danmaku.enabled'],
    music: ['music.defaultSource', 'music.idlePlaylist'],
    live2d: ['live2d.window.width', 'live2d.window.transparent'],
    cpp: ['cpp.executablePath'],
  }
  for (const [sec, fields] of Object.entries(mustContain)) {
    for (const f of fields) {
      if (!byKey[sec].fields[f]) throw new Error(`分区 ${sec} 缺少字段 ${f}`)
    }
  }
  // 单入口收敛：这些字段应已从 schema 移除
  const mustAbsent = [
    ['server', 'roomId'],            // → 仪表盘核心遥测编辑
    ['llm', 'llm.systemPrompt'],     // → 提示词调试工坊编辑
    ['music', 'music.outputDevice'], // → 音频中枢路由
    ['live2d', 'live2d.modelPath'],  // → 模型 HUB
    ['live2d', 'live2d.modelDir'],   // → 模型 HUB
    ['live2d', 'live2d.scale'],      // → Gizmo 面板
  ]
  for (const [sec, field] of mustAbsent) {
    if (byKey[sec].fields[field]) throw new Error(`${field} 应从 ${sec} 分区移除（单入口收敛）`)
  }
  console.log('[test] 分区归属 OK：', keys.join(', '))

  // —— 断言 2：单字段写入立即生效（自动保存通道）——
  const before = await rpcCall(ws, 11, 'config.get')
  const newVal = !before.output.display.enabled
  await rpcCall(ws, 12, 'config.updatePaths', { entries: [{ path: 'output.display.enabled', value: newVal }] })
  const after = await rpcCall(ws, 13, 'config.get')
  if (after.output.display.enabled !== newVal) throw new Error('单字段写入未生效')
  // 还原
  await rpcCall(ws, 14, 'config.updatePaths', { entries: [{ path: 'output.display.enabled', value: before.output.display.enabled }] })
  console.log('[test] 单字段即写即读 OK')

  // —— 断言 3：设备字段写入持久化（音频路由保存通道）——
  await rpcCall(ws, 15, 'config.updatePaths', { entries: [{ path: 'music.outputDevice', value: 'test-device' }] })
  const cfg3 = await rpcCall(ws, 16, 'config.get')
  if (cfg3.music.outputDevice !== 'test-device') throw new Error('music.outputDevice 写入失败')
  await rpcCall(ws, 17, 'config.updatePaths', { entries: [{ path: 'music.outputDevice', value: before.music.outputDevice || '' }] })
  console.log('[test] 设备字段写入/还原 OK')

  console.log('[test] PASS: 配置中心分区合并与即写即生效通道正常')
  await rpcCall(ws, 18, 'system.shutdown').catch(() => {})
  await Promise.race([
    new Promise((resolve) => child.on('exit', resolve)),
    sleep(8000).then(() => null),
  ])
  try { ws.terminate() } catch {}
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

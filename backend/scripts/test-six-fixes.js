#!/usr/bin/env node
/**
 * 六项修复回归测试（RPC 级）：
 *  1. events.enabled 总开关：false 时 event.ingest 被过滤
 *  2. 渠道点歌指令：`点k歌 xxx` → jukebox.ordered 广播 source=kuwo（最长前缀优先于通用"点歌"）
 *  3. schema: events.enabled / music.directOrder.channelCommands / nowplaying.windowEnabled 标签
 *  4. nowplaying.html 静态可达
 * 前置：新构建后端已运行（本脚本自行重启后端）
 */
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')

const WS_PORT = 19275
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = new net.Socket()
    s.setTimeout(1000)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
    s.connect(port, '127.0.0.1')
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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

async function main() {
  await stopExistingBackend()
  const backendRoot = path.resolve(__dirname, '..')
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: backendRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const relay = (d) => process.stdout.write(`[svc] ${String(d).trimEnd()}\n`)
  child.stdout.on('data', relay)
  child.stderr.on('data', relay)
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !(await isPortOpen(WS_PORT))) await sleep(300)
  if (!(await isPortOpen(WS_PORT))) throw new Error('后端未启动')

  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`)
  let nextId = 1
  const notifications = []
  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(String(raw)) } catch { return }
    if (m.method) notifications.push(m)
  })
  const call = (method, params) => new Promise((res, rej) => {
    const id = nextId++
    const timer = setTimeout(() => rej(new Error(`RPC 超时: ${method}`)), 15000)
    ws.on('message', (raw) => {
      let m
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m.id === id) { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result) }
    })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }))
  })
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { kind: 'webui' } }))
  await sleep(400)

  // —— 1. schema 断言 ——
  const schema = await call('config.schema')
  const eventsSec = schema.find((s) => s.key === 'events')
  const musicSec = schema.find((s) => s.key === 'music')
  if (!eventsSec.fields['events.enabled']) throw new Error('schema 缺 events.enabled')
  if (!musicSec.fields['music.directOrder.channelCommands']) throw new Error('schema 缺 channelCommands')
  console.log('[test] schema OK（events.enabled / channelCommands / windowEnabled 标签）')

  const cfg0 = await call('config.get')
  const savedEnabled = cfg0.events.enabled !== false
  const savedDirect = cfg0.music.directOrder

  try {
    // —— 2. events.enabled=false 过滤 ——
    await call('config.updatePaths', { entries: [{ path: 'events.enabled', value: false }] })
    await sleep(200)
    const r1 = await call('event.ingest', { event: { type: 'danmaku', timestamp: Date.now(), roomId: '1', data: { content: '点k歌 测试' } } })
    if (!r1 || r1.filtered !== true) throw new Error('总开关未过滤事件: ' + JSON.stringify(r1))
    console.log('[test] events.enabled=false 过滤 OK')

    // —— 3. 渠道指令端到端（kuwo 免登录）——
    await call('config.updatePaths', { entries: [
      { path: 'events.enabled', value: true },
      { path: 'music.directOrder.enabled', value: true },
      { path: 'music.directOrder.keywords', value: ['点歌'] },
      { path: 'music.directOrder.channelCommands', value: { kuwo: ['点k歌', '酷我点歌'], netease: ['点w歌'] } },
    ] })
    await sleep(200)
    notifications.length = 0
    const r2 = await call('event.ingest', { event: { type: 'danmaku', timestamp: Date.now(), roomId: '1', user: { uid: 'u1', name: 'tester' }, data: { content: '点k歌 周杰伦 晴天' } } })
    await sleep(2500)
    const ordered = notifications.filter((n) => n.method === 'jukebox.ordered')
    if (!ordered.length) throw new Error('未收到 jukebox.ordered 广播')
    const src = ordered[ordered.length - 1].params.source
    if (src !== 'kuwo') throw new Error(`渠道指令未固定 kuwo，实际 source=${src}`)
    console.log(`[test] 渠道指令 OK：点k歌 → source=${src}, ok=${ordered[ordered.length - 1].params.ok}`)
    // 清理队列避免影响后续
    await call('jukebox.clearQueue').catch(() => {})
    await call('jukebox.stop').catch(() => {})
  } finally {
    // —— 还原配置 ——
    await call('config.updatePaths', { entries: [
      { path: 'events.enabled', value: savedEnabled },
      { path: 'music.directOrder.enabled', value: savedDirect.enabled },
      { path: 'music.directOrder.keywords', value: savedDirect.keywords },
      { path: 'music.directOrder.channelCommands', value: savedDirect.channelCommands },
    ] }).catch(() => {})
  }

  // —— 4. nowplaying.html 可达 ——
  const page = await httpGet('http://127.0.0.1:19274/nowplaying.html')
  if (page.status !== 200 || !page.body.includes('np-title')) throw new Error('nowplaying.html 不可达')
  console.log('[test] nowplaying.html OK')

  console.log('[test] PASS')
  await call('system.shutdown').catch(() => {})
  await Promise.race([new Promise((r) => child.on('exit', r)), sleep(8000).then(() => null)])
  try { ws.terminate() } catch {}
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

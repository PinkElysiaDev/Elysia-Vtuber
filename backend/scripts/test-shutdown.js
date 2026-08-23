#!/usr/bin/env node
/**
 * 关机回归测试（离线，自包含）：
 *  1. 若 19275 已被旧实例占用，先通过 system.shutdown 让其退出
 *  2. 启动新编译的后端，连一个保持连接的 WS 客户端（旧挂死 bug 的触发条件）
 *  3. 发送 system.shutdown，验证进程在时限内退出（优雅路径：terminate 客户端 → exit）
 *
 * 用法：node scripts/test-shutdown.js  （需先 npx tsc 构建 dist/）
 */
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const WebSocket = require('ws')

const WS_PORT = 19275
const EXIT_BUDGET_MS = 8000

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

async function stopExisting() {
  if (!(await isPortOpen(WS_PORT))) return
  console.log('[test] 19275 被已有实例占用，先请求其退出')
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
  throw new Error('已有实例未能退出，请手动处理后重试')
}

async function main() {
  await stopExisting()

  const backendRoot = path.resolve(__dirname, '..')
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: backendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const relay = (tag) => (d) => process.stdout.write(`[svc] ${tag}${String(d).trimEnd()}\n`)
  child.stdout.on('data', relay(''))
  child.stderr.on('data', relay(''))
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))

  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !(await isPortOpen(WS_PORT))) await sleep(300)
  if (!(await isPortOpen(WS_PORT))) throw new Error('后端 15s 内未开始监听 19275')
  console.log('[test] 后端已就绪')

  // 模拟插件：保持连接的同时请求关机——旧代码会永久挂死在这里
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { kind: 'plugin' } }))
  await sleep(500)
  console.log('[test] 客户端已连接（peer=plugin），发送 system.shutdown')
  const startedAt = Date.now()
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'system.shutdown' }))

  const timer = setTimeout(() => {
    console.error(`[test] FAIL: ${EXIT_BUDGET_MS}ms 内未退出（挂死依旧）`)
    child.kill('SIGKILL')
    process.exit(1)
  }, EXIT_BUDGET_MS)
  const code = await exited
  clearTimeout(timer)
  const elapsed = Date.now() - startedAt
  try { ws.terminate() } catch {}
  console.log(`[test] 后端 ${elapsed}ms 内退出 (code=${code})`)
  if (elapsed > EXIT_BUDGET_MS) throw new Error('退出过慢')
  console.log('[test] PASS: 有客户端连接时优雅关机不再挂死')
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

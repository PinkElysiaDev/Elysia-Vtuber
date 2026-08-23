#!/usr/bin/env node
/**
 * 执行器状态推送回归测试（离线，自包含，不启动真实执行器 UI）：
 *  1. 在 19276 起一个"假执行器"（最小 JSON-RPC ws 服务端）
 *  2. 启动后端（autoStart=false 走 attach）→ webui 客户端应收到 cpp.state connected:true
 *  3. 关闭假执行器（模拟手动关闭 Live2D 窗口）→ 应收到 cpp.state connected:false 且 status=stopped
 *
 * 用法：node scripts/test-cpp-state.js  （需先 npx tsc 构建 dist/）
 */
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const WebSocket = require('ws')

const WS_PORT = 19275
const IPC_PORT = 19276

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
  throw new Error('已有后端实例未能退出，请手动处理后重试')
}

/** 最小假执行器：应答 peer.declare 与任意带 id 的请求 */
function startFakeExecutor() {
  return new Promise((resolve) => {
    const server = new WebSocket.Server({ port: IPC_PORT, host: '127.0.0.1' })
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        let msg
        try { msg = JSON.parse(String(raw)) } catch { return }
        if (msg.id === undefined || msg.id === null) return
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }))
        }
      })
    })
    server.on('listening', () => resolve(server))
  })
}

function waitForNotification(ws, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待通知 ${method} 超时`)), timeoutMs)
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg.method === method && msg.id === undefined) {
        clearTimeout(timer)
        resolve(msg.params)
      }
    })
  })
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
  if (await isPortOpen(IPC_PORT)) {
    throw new Error('19276 已被占用（真实执行器在运行？），请先关闭后重试')
  }
  await stopExistingBackend()

  console.log('[test] 启动假执行器 :19276')
  const fake = await startFakeExecutor()

  const backendRoot = path.resolve(__dirname, '..')
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: backendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const relay = (d) => process.stdout.write(`[svc] ${String(d).trimEnd()}\n`)
  child.stdout.on('data', relay)
  child.stderr.on('data', relay)
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))

  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !(await isPortOpen(WS_PORT))) await sleep(300)
  if (!(await isPortOpen(WS_PORT))) throw new Error('后端 15s 内未开始监听 19275')

  // 以 webui 身份连入，等一拍让 attach 完成后再触发状态翻转
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`)
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { kind: 'webui' } }))
  await sleep(1000)

  const status1 = await rpcCall(ws, 10, 'cpp.status')
  console.log('[test] 初始状态:', JSON.stringify(status1))
  if (!status1.connected) throw new Error('后端未连上假执行器（attach 失败）')

  // 模拟手动关闭 Live2D 窗口：假执行器直接下线
  const disconnected = waitForNotification(ws, 'cpp.state', 8000)
  console.log('[test] 关闭假执行器（模拟手动关窗）')
  for (const client of fake.clients) client.terminate()
  await new Promise((resolve) => fake.close(resolve))
  const state = await disconnected
  console.log('[test] 收到推送:', JSON.stringify(state))
  if (state.connected !== false) throw new Error('推送 connected 应为 false')
  if (state.status !== 'stopped') throw new Error(`status 应为 stopped（不再是幽灵 starting/error），实际 ${state.status}`)

  const status2 = await rpcCall(ws, 11, 'cpp.status')
  if (status2.connected || status2.status === 'running') throw new Error('cpp.status 仍显示已连接')

  console.log('[test] PASS: 执行器下线后 cpp.state 即时推送，状态正确回到 stopped')
  await rpcCall(ws, 12, 'system.shutdown').catch(() => {})
  const code = await Promise.race([exited, sleep(8000).then(() => null)])
  if (code === null) {
    console.error('[test] 后端未在时限内退出')
    child.kill()
    process.exit(1)
  }
  try { ws.terminate() } catch {}
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

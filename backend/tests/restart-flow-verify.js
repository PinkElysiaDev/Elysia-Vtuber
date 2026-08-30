/**
 * 验证新重启序列对外部拉起的进程有效：
 * 外部 spawn 后端 → WS 请求 system.shutdown → 轮询端口释放 → 断言进程退出。
 */
const { spawn } = require('child_process')
const net = require('net')
const { WebSocket } = require('ws')

const PORT = 19279

function isPortOpen() {
  return new Promise((resolve) => {
    const s = new net.Socket()
    s.setTimeout(800)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('timeout', () => { s.destroy(); resolve(false) })
    s.once('error', () => resolve(false))
    s.connect(PORT, '127.0.0.1')
  })
}

async function waitPort(open, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await isPortOpen()) === open) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function main() {
  // 1. 外部拉起（模拟"非本插件拉起"的进程）
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, VTUBER_CONFIG: 'data/test-instance/config.json' },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  if (!(await waitPort(true, 20000))) { console.error('--- FAIL --- 外部实例未监听'); process.exit(1) }
  console.log('✓ 外部拉起的后端已监听 :19279（pid=%s，非插件 spawn）', child.pid)

  // 2. 模拟插件 restart 序列：WS 连接 → system.shutdown → 轮询端口释放
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
  const reply = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('shutdown 响应超时')), 5000)
    ws.once('message', (d) => { clearTimeout(to); resolve(JSON.parse(String(d))) })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system.shutdown' }))
  }).catch((e) => ({ error: e.message }))
  if (!reply.result) { console.error('--- FAIL --- system.shutdown 响应异常:', JSON.stringify(reply)); process.exit(1) }
  console.log('✓ system.shutdown RPC 已受理')

  const drained = await waitPort(false, 10000)
  const exitCode = await new Promise((resolve) => { if (child.exitCode !== null) resolve(child.exitCode); else child.once('exit', resolve) })
  if (!drained) { console.error('--- FAIL --- 端口 10s 内未释放'); process.exit(1) }
  console.log(`✓ 外部进程优雅退出（code=${exitCode}），端口已释放——restart 可继续拉起新实例`)

  // 3. 端口释放后可立即重新拉起（模拟 processManager.start()）
  const child2 = spawn(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, VTUBER_CONFIG: 'data/test-instance/config.json' },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  if (!(await waitPort(true, 20000))) { console.error('--- FAIL --- 新实例未接管端口'); process.exit(1) }
  console.log('✓ 新实例已接管端口（restart 全链路成立）')

  // 清理：优雅关闭新实例
  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}`)
  await new Promise((r) => ws2.once('open', r))
  ws2.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system.shutdown' }))
  await waitPort(false, 10000)
  child2.kill(); child.kill()
  console.log('--- PASS ---')
  setTimeout(() => process.exit(0), 300).unref()
}

main().catch((e) => { console.error('--- FAIL ---', e); process.exit(1) })

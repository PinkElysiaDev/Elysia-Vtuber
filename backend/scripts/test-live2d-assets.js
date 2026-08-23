#!/usr/bin/env node
/**
 * Live2D 资源注册体系 + 窗口交互回归测试：
 *  1. 夹具目录（未声明 exp3/motion3 + 声明资源）→ live2d.assets.scan 嗅探断言
 *  2. loadExtra 注入（真执行器）：加载夹具模型 → status.namedMotions/expressions 含注入项
 *  3. 工具门控：tool.call live2d_expression 未注册被拒 / 注册后放行；config.changed 重注册生效
 *  4. idle 调度：配置待机动作 + intervalSec=1 → 观察执行器 lastMotion 变化
 * 前置：vtuber_executor.exe 可用（脚本会通过 cpp.start 拉起）；夹具模型使用真实 Haru + 附加未声明资源副本
 */
const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const WebSocket = require('ws')

const WS_PORT = 19275
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const backendRoot = path.resolve(__dirname, '..');

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

/** 递归复制目录（夹具用） */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

/** 构造夹具：复制 Haru 模型目录 + 附加未声明的 expressions/motions */
function buildFixture() {
  const src = path.resolve(backendRoot, '../cpp-executor/build/Debug/Resources/Haru')
  const fixtureRoot = path.resolve(backendRoot, 'data/test-models')
  const dst = path.join(fixtureRoot, 'HaruFixture')
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  copyDir(src, dst)
  fs.mkdirSync(path.join(dst, 'expressions'), { recursive: true })
  fs.mkdirSync(path.join(dst, 'motions', 'Wave'), { recursive: true })
  // 未声明表情：从 Haru 的 expressions 子目录取一个复制改名
  const exprDir = path.join(src, 'expressions')
  const srcExps = fs.existsSync(exprDir) ? fs.readdirSync(exprDir).filter(f => f.endsWith('.exp3.json')) : []
  if (srcExps[0]) fs.copyFileSync(path.join(exprDir, srcExps[0]), path.join(dst, 'expressions', 'extra_smile.exp3.json'))
  // 未声明动作：复制一个声明 motion
  const modelJson = JSON.parse(fs.readFileSync(path.join(dst, 'Haru.model3.json'), 'utf8'))
  const motionFile = modelJson.FileReferences.Motions.Idle[0].File
  fs.copyFileSync(path.join(dst, motionFile), path.join(dst, 'motions', 'Wave', 'extra_wave.motion3.json'))
  return path.join(dst, 'Haru.model3.json').replace(/\\/g, '/')
}

async function main() {
  const fixtureModel = buildFixture()
  await stopExistingBackend()
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
    const timer = setTimeout(() => rej(new Error(`RPC 超时: ${method}`)), 20000)
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

  const cfg0 = await call('config.get')
  const saved = {
    modelPath: cfg0.live2d.modelPath,
    assetRegistration: cfg0.live2d.assetRegistration,
  }

  try {
    // 切到夹具模型
    await call('config.updatePaths', { entries: [{ path: 'live2d.modelPath', value: fixtureModel }] })
    await sleep(1500)

    // —— 1. assets.scan 嗅探 ——
    const scan = await call('live2d.assets.scan', { modelPath: fixtureModel })
    const discExpr = scan.expressions.filter(e => e.discovered)
    const discMotion = scan.motions.filter(m => m.discovered)
    if (!discExpr.some(e => e.name === 'extra_smile')) throw new Error('未发现未声明表情 extra_smile')
    if (!discMotion.some(m => m.name === 'extra_wave')) throw new Error('未发现未声明动作 extra_wave')
    if (!scan.motions.some(m => m.name === 'Idle#0')) throw new Error('未列出声明动作 Idle#0')
    console.log(`[test] 嗅探 OK：表情 ${scan.expressions.length}（目录发现 ${discExpr.length}），动作 ${scan.motions.length}（目录发现 ${discMotion.length}）`)

    // —— 2. loadExtra 注入（真执行器）——
    const start = await call('cpp.start')
    if (!start.ok) throw new Error('执行器启动失败: ' + JSON.stringify(start))
    await sleep(7000)  // 默认模型加载 + onConnected → fixture 加载 + loadExtra
    const st = await call('cpp.call', { method: 'live2d.status' })
    if (!st.namedMotions || !st.namedMotions.includes('extra_wave')) {
      throw new Error('loadExtra 未注入命名动作 extra_wave: ' + JSON.stringify(st.namedMotions))
    }
    if (!st.expressions || !st.expressions.includes('extra_smile')) {
      throw new Error('loadExtra 未注入表情 extra_smile')
    }
    if (typeof st.motionActive !== 'boolean') throw new Error('status 缺 motionActive')
    console.log('[test] loadExtra 注入 OK（extra_wave / extra_smile 已可用），motionActive=' + st.motionActive)

    // 命名动作播放
    const play = await call('live2d.motion', { name: 'extra_wave' })
    if (!play.ok) throw new Error('命名动作播放失败: ' + JSON.stringify(play))
    console.log('[test] 命名动作播放 OK')

    // —— 3. 工具门控 ——
    const reg = {
      expressions: { f01: { enabled: true, category: 'expression' }, extra_smile: { enabled: true, category: 'costume' } },
      motions: { 'Idle#0': { enabled: true } },
      idle: { motions: ['Idle#0'], mode: 'sequential', intervalSec: 1 },
    }
    await call('config.updatePaths', { entries: [{ path: 'live2d.assetRegistration', value: reg }] })
    await sleep(600)  // config.changed → 重注册工具
    const denied = await call('tool.call', { tool: 'live2d_expression', args: { name: 'f03' } })
    if (!denied.error || !denied.available) throw new Error('未注册表情未被拒: ' + JSON.stringify(denied))
    const allowed = await call('tool.call', { tool: 'live2d_expression', args: { name: 'f01' } })
    if (allowed.success === false) throw new Error('已注册表情被拒: ' + JSON.stringify(allowed))
    const costume = await call('tool.call', { tool: 'live2d_costume', args: { name: 'extra_smile' } })
    if (costume.success === false) throw new Error('换装工具失败: ' + JSON.stringify(costume))
    const motionTool = await call('tool.call', { tool: 'live2d_motion', args: { motion: 'Idle#0' } })
    if (motionTool.success === false) throw new Error('动作工具失败: ' + JSON.stringify(motionTool))
    console.log('[test] 工具门控 OK（未注册拒 / 已注册放行 / 换装 / 动作引用）')

    // —— 4. idle 调度 ——
    await sleep(3500)  // intervalSec=1，模型无动作时应被调度若干次
    const st2 = await call('cpp.call', { method: 'live2d.status' })
    if (st2.lastMotion.group !== 'Idle') throw new Error('待机调度未生效: ' + JSON.stringify(st2.lastMotion))
    console.log('[test] 待机调度 OK（lastMotion=' + st2.lastMotion.group + '#' + st2.lastMotion.index + '）')

    console.log('[test] PASS')
  } finally {
    await call('config.updatePaths', { entries: [
      { path: 'live2d.modelPath', value: saved.modelPath },
      { path: 'live2d.assetRegistration', value: saved.assetRegistration },
    ] }).catch(() => {})
    await sleep(500)
  }

  await call('system.shutdown').catch(() => {})
  await Promise.race([new Promise((r) => child.on('exit', r)), sleep(8000).then(() => null)])
  try { ws.terminate() } catch {}
}

main().catch((err) => {
  console.error('[test] FAIL:', err.message)
  process.exit(1)
})

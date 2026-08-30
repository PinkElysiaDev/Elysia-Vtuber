/**
 * E2E：MCP Streamable HTTP 接入——mock HTTP 服务器连接 → 工具注册 → tools/call 往返
 * → tools/list_changed 自动刷新 → 传输类型/移除
 * 运行：npx ts-node tests/e2e-mcp-http.ts
 */
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

interface WsRpc {
  call: (method: string, params?: unknown) => Promise<any>
  close: () => void
}

function connectWs(port: number): Promise<WsRpc> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let nextId = 1
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
    ws.on('open', () => {
      resolve({
        call: (method, params = {}) => new Promise((res2, rej2) => {
          const id = nextId++
          pending.set(id, { resolve: res2, reject: rej2 })
          ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
        }),
        close: () => ws.close(),
      })
    })
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d))
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) entry.reject(new Error(msg.error.message))
        else entry.resolve(msg.result)
      }
    })
    ws.on('error', reject)
  })
}

function startMockHttpServer(): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'mock-mcp-http-server.js')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('mock HTTP 服务器启动超时')), 10000)
    child.stdout!.on('data', (chunk) => {
      buffer += String(chunk)
      const match = buffer.match(/READY (\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve({ child, port: Number(match[1]) })
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function pollUntil(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  fail('等待超时: ' + what)
}

async function main() {
  const configPath = path.join(__dirname, '..', 'data', 'test-instance', 'config.json')
  process.env.VTUBER_CONFIG = configPath
  const svc = new VtuberService()
  await svc.start()
  const port = (svc.config as any).server?.wsPort ?? 19279
  const rpc = await connectWs(port)
  const mock = await startMockHttpServer()

  try {
    // 1. 以 url 添加 mock HTTP MCP 服务器
    const added = await rpc.call('mcp.server.add', { name: 'mockhttp', url: `http://127.0.0.1:${mock.port}/` })
    if (!added.ok || added.toolCount !== 2) fail('mockhttp 连接失败: ' + JSON.stringify(added))
    console.log('✓ MCP 连接: HTTP mock 服务器注册 2 个工具')

    // 2. 传输类型与状态
    const servers = (await rpc.call('mcp.servers.list')).servers
    const entry = servers.find((s: any) => s.name === 'mockhttp')
    if (!entry || entry.transport !== 'http' || entry.status !== 'connected') {
      fail('servers.list 条目不对: ' + JSON.stringify(entry))
    }
    console.log('✓ mcp.servers.list: transport=http, status=connected')

    // 3. llm.tools 自动检测
    const tools = await rpc.call('llm.tools')
    const names = tools.tools.map((t: any) => t.name)
    if (!names.includes('mcp__mockhttp__echo') || !names.includes('mcp__mockhttp__add')) fail('llm.tools 缺少 mcp 工具: ' + names.join(','))
    console.log('✓ llm.tools 自动检测: mcp__mockhttp__echo / mcp__mockhttp__add 已注册')

    // 4. tools/call 往返
    const echoRes = await rpc.call('tool.call', { name: 'mcp__mockhttp__echo', args: { text: '你好' } })
    if (!echoRes.success || echoRes.text !== 'echo: 你好') fail('echo 调用失败: ' + JSON.stringify(echoRes))
    const addRes = await rpc.call('tool.call', { name: 'mcp__mockhttp__add', args: { a: 5, b: 6 } })
    if (!addRes.success || addRes.text !== '11') fail('add 调用失败: ' + JSON.stringify(addRes))
    console.log('✓ tools/call 往返: echo 原样返回 / add 计算 5+6=11')

    // 5. tools/list_changed 自动刷新：mock 动态加工具并广播通知
    const controlRes = await fetch(`http://127.0.0.1:${mock.port}/__control/add-late-tool`, { method: 'POST' }).then((r) => r.json())
    if (!controlRes.ok) fail('触发 list_changed 失败')
    await pollUntil(async () => {
      const t = await rpc.call('llm.tools')
      return t.tools.some((x: any) => x.name === 'mcp__mockhttp__late')
    }, 8000, 'list_changed 自动刷新出 mcp__mockhttp__late')
    const lateRes = await rpc.call('tool.call', { name: 'mcp__mockhttp__late', args: { text: '后来者' } })
    if (!lateRes.success || lateRes.text !== 'late: 后来者') fail('late 调用失败: ' + JSON.stringify(lateRes))
    console.log('✓ list_changed 自动刷新: 通知后 mcp__mockhttp__late 出现且可调用')

    // 6. 移除
    const removed = await rpc.call('mcp.server.remove', { name: 'mockhttp' })
    if (!removed.ok) fail('移除失败')
    const after = await rpc.call('llm.tools')
    if (after.tools.some((t: any) => t.name.startsWith('mcp__mockhttp__'))) fail('移除后工具仍在')
    console.log('✓ 移除服务器: mcp__mockhttp__* 全部反注册')

    console.log('--- PASS ---')
    rpc.close()
    await svc.stop()
    mock.child.kill()
    setTimeout(() => process.exit(0), 300).unref()
  } catch (e) {
    console.error('--- FAIL ---', e)
    try { await svc.stop() } catch { /* 忽略 */ }
    mock.child.kill()
    process.exit(1)
  }
}

void main()

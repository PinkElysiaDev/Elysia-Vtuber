/**
 * E2E：MCP 接入——mock 服务器连接 → 工具注册 → tools/call 往返 → llm.tools 可见 → 门控 → 移除
 * 运行：npx ts-node tests/e2e-mcp.ts
 */
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

async function main() {
  const configPath = path.join(__dirname, '..', 'data', 'test-instance', 'config.json')
  process.env.VTUBER_CONFIG = configPath
  const svc = new VtuberService()
  await svc.start()
  const port = (svc.config as any).server?.wsPort ?? 19279
  const rpc = await connectWs(port)

  try {
    // 1. 添加 mock MCP 服务器
    const mockServer = path.join(__dirname, 'fixtures', 'mock-mcp-server.js')
    const added = await rpc.call('mcp.server.add', { name: 'mock', command: process.execPath, args: [mockServer] })
    if (!added.ok || added.toolCount !== 2) fail('mock 连接失败: ' + JSON.stringify(added))
    console.log('✓ MCP 连接: mock 服务器注册 2 个工具')

    // 2. llm.tools 自动检测
    const tools = await rpc.call('llm.tools')
    const names = tools.tools.map((t: any) => t.name)
    if (!names.includes('mcp__mock__echo') || !names.includes('mcp__mock__add')) fail('llm.tools 缺少 mcp 工具: ' + names.join(','))
    const echoTool = tools.tools.find((t: any) => t.name === 'mcp__mock__echo')
    if (echoTool.description !== '[MCP:mock] 回声工具：原样返回 text 参数') fail('工具描述不对: ' + echoTool.description)
    console.log('✓ llm.tools 自动检测: mcp__mock__echo / mcp__mock__add 已注册（含 [MCP:mock] 前缀描述）')

    // 3. tools/call 往返
    const echoRes = await rpc.call('tool.call', { name: 'mcp__mock__echo', args: { text: '你好' } })
    if (!echoRes.success || echoRes.text !== 'echo: 你好') fail('echo 调用失败: ' + JSON.stringify(echoRes))
    const addRes = await rpc.call('tool.call', { name: 'mcp__mock__add', args: { a: 3, b: 4 } })
    if (!addRes.success || addRes.text !== '7') fail('add 调用失败: ' + JSON.stringify(addRes))
    console.log('✓ tools/call 往返: echo 原样返回 / add 计算 3+4=7')

    // 4. 门控：禁用后 llm.tools 反映 enabled=false
    await rpc.call('config.updatePaths', { entries: [{ path: 'llm.tools', value: { 'mcp__mock__echo': false } }] })
    const gated = await rpc.call('llm.tools')
    const gatedEcho = gated.tools.find((t: any) => t.name === 'mcp__mock__echo')
    if (gatedEcho.enabled !== false) fail('门控未生效')
    console.log('✓ 门控生效: mcp__mock__echo 被禁用，其余仍启用')

    // 5. 移除
    const removed = await rpc.call('mcp.server.remove', { name: 'mock' })
    if (!removed.ok) fail('移除失败')
    const after = await rpc.call('llm.tools')
    if (after.tools.some((t: any) => t.name.startsWith('mcp__mock__'))) fail('移除后工具仍在')
    console.log('✓ 移除服务器: mcp__mock__* 全部反注册')

    console.log('--- PASS ---')
    rpc.close()
    await svc.stop()
    setTimeout(() => process.exit(0), 200).unref()
  } catch (e) {
    console.error('--- FAIL ---', e)
    try { await svc.stop() } catch { /* 忽略 */ }
    process.exit(1)
  }
}

void main()

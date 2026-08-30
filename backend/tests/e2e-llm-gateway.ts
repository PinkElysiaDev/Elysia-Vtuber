/**
 * E2E：LLM 网关（request-kit chatCanonical 薄适配）——mock OpenAI/Anthropic 服务器，
 * 经 llm.chat 走通 agent 循环：第一轮返回 tool_calls → 执行 jukebox_get_queue → 第二轮收敛文本。
 * 运行：npx ts-node tests/e2e-llm-gateway.ts
 */
import * as http from 'http'
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

interface Captured {
  headers: Record<string, string>
  body: any
}

function startMockLlm(): Promise<{ server: http.Server; port: number; captured: Captured[] }> {
  const captured: Captured[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      captured.push({ headers: req.headers as Record<string, string>, body })
      const send = (obj: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      const isToolResultRound = JSON.stringify(body).includes('"tool_result"') || (body.messages ?? []).some((m: any) => m.role === 'tool')
      if (req.url === '/v1/chat/completions') {
        if (isToolResultRound) {
          send({ id: 'c2', object: 'chat.completion', created: 2, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '队列空闲，openai 链路测试完成' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } })
        } else {
          send({ id: 'c1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_gw_1', type: 'function', function: { name: 'jukebox_get_queue', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
        }
        return
      }
      if (req.url === '/v1/messages') {
        if (isToolResultRound) {
          send({ id: 'm2', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: '队列空闲，anthropic 链路测试完成' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 2 } })
        } else {
          send({ id: 'm1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_gw_1', name: 'jukebox_get_queue', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })
        }
        return
      }
      res.writeHead(404)
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, captured })
    })
  })
}

function connectWs(port: number): Promise<{ call: (method: string, params?: unknown) => Promise<any>; close: () => void }> {
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
  const mock = await startMockLlm()
  const base = `http://127.0.0.1:${mock.port}`

  try {
    // 1. openai 链路：agent 循环 tool_calls 往返
    mock.captured.length = 0
    await rpc.call('config.updatePaths', {
      entries: [
        { path: 'llm.provider', value: 'openai' },
        { path: 'llm.baseURL', value: `${base}/v1` },
        { path: 'llm.apiKey', value: 'sk-gw-test' },
        { path: 'llm.model', value: 'mock-model' },
      ],
    })
    const r1 = await rpc.call('llm.chat', { messages: [{ role: 'user', content: '查询点歌队列' }] })
    if (r1.content !== '队列空闲，openai 链路测试完成') fail('openai 最终内容不对: ' + JSON.stringify(r1))
    if (r1.rounds !== 2) fail('openai 应为 2 轮: ' + r1.rounds)
    if (!r1.toolCalls?.some((t: any) => t.name === 'jukebox_get_queue' && t.ok)) fail('工具调用缺失: ' + JSON.stringify(r1.toolCalls))
    const reqA1 = mock.captured[0]
    if (reqA1.headers['authorization'] !== 'Bearer sk-gw-test') fail('openai 认证头不对: ' + reqA1.headers['authorization'])
    const sentTools = reqA1.body.tools?.map((t: any) => t.function?.name) ?? []
    if (!sentTools.includes('jukebox_get_queue')) fail('请求未携带工具: ' + JSON.stringify(sentTools))
    const reqA2 = mock.captured[1]
    const toolMsg = (reqA2.body.messages ?? []).find((m: any) => m.role === 'tool')
    if (!toolMsg || toolMsg.tool_call_id !== 'call_gw_1') fail('第二轮缺 tool 消息: ' + JSON.stringify(reqA2.body.messages))
    console.log('✓ openai 链路: Bearer + tools 编码 + 2 轮 agent 循环 + tool 消息回传')

    // 2. anthropic 链路：x-api-key + tool_use/tool_result 往返
    mock.captured.length = 0
    await rpc.call('config.updatePaths', {
      entries: [
        { path: 'llm.provider', value: 'anthropic' },
        { path: 'llm.baseURL', value: `${base}/v1` },
      ],
    })
    const r2 = await rpc.call('llm.chat', { messages: [{ role: 'user', content: '查询点歌队列' }] })
    if (r2.content !== '队列空闲，anthropic 链路测试完成') fail('anthropic 最终内容不对: ' + JSON.stringify(r2))
    if (!r2.toolCalls?.some((t: any) => t.name === 'jukebox_get_queue')) fail('anthropic 工具调用缺失')
    const reqB1 = mock.captured[0]
    if (reqB1.headers['x-api-key'] !== 'sk-gw-test') fail('anthropic 认证头不对')
    if (reqB1.headers['anthropic-version'] !== '2023-06-01') fail('anthropic-version 头缺失')
    if (!reqB1.body.tools?.some((t: any) => t.name === 'jukebox_get_queue')) fail('anthropic 工具未编码')
    const reqB2 = mock.captured[1]
    if (!JSON.stringify(reqB2.body.messages).includes('"tool_result"') || !JSON.stringify(reqB2.body.messages).includes('toolu_gw_1')) {
      fail('第二轮缺 tool_result: ' + JSON.stringify(reqB2.body.messages))
    }
    console.log('✓ anthropic 链路: x-api-key/version + tool_use 编码 + tool_result 回传')

    console.log('--- PASS ---')
    rpc.close()
    await svc.stop()
    mock.server.close()
    setTimeout(() => process.exit(0), 300).unref()
  } catch (e) {
    console.error('--- FAIL ---', e)
    try { await svc.stop() } catch { /* 忽略 */ }
    mock.server.close()
    process.exit(1)
  }
}

void main()

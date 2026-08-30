/**
 * E2E：LLM 多模型注册表（朴素注册）—— 首个档案自动激活；激活后 llm.chat 走档案端点，
 * 档案级生成参数（maxTokens/temperature）与思考开关生效；取消激活回退内联；移除。
 * 运行：npx ts-node tests/e2e-llm-models.ts
 */
import * as http from 'http'
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

function startMockLlm(): Promise<{ server: http.Server; port: number; requests: Array<{ headers: Record<string, string>; body: any }> }> {
  const requests: Array<{ headers: Record<string, string>; body: any }> = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      requests.push({ headers: req.headers as Record<string, string>, body: raw ? JSON.parse(raw) : null })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'c1', object: 'chat.completion', created: 1, model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, requests })
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
    // 0. 内联基线（注册前走内联端点与内联生成参数）
    await rpc.call('config.updatePaths', {
      entries: [
        { path: 'llm.provider', value: 'openai' },
        { path: 'llm.baseURL', value: `${base}/v1` },
        { path: 'llm.apiKey', value: 'sk-inline' },
        { path: 'llm.model', value: 'inline-model' },
        { path: 'llm.temperature', value: 0.9 },
        { path: 'llm.maxTokens', value: 1111 },
      ],
    })
    mock.requests.length = 0
    let r = await rpc.call('llm.chat', { messages: [{ role: 'user', content: 'hi' }] })
    if (r.content !== 'ok') fail('基线对话失败: ' + JSON.stringify(r))
    if (mock.requests[0].headers['authorization'] !== 'Bearer sk-inline') fail('基线认证头不对')
    if (mock.requests[0].body.temperature !== 0.9 || mock.requests[0].body.max_tokens !== 1111) {
      fail('基线生成参数不对: ' + JSON.stringify(mock.requests[0].body))
    }
    console.log('✓ 基线：注册前走内联端点与内联生成参数')

    // 1. upsert 首个档案（含档案级生成参数/思考/请求头）→ 自动激活
    const up = await rpc.call('llm.models.upsert', {
      name: 'main',
      label: '主力模型',
      provider: 'openai',
      baseURL: `${base}/v1`,
      apiKey: 'sk-profile',
      model: 'profile-model',
      headers: { 'X-Profile': '1' },
      thinking: { enabled: true },
      temperature: 0.2,
      maxTokens: 512,
      contextWindow: 200000,
    })
    if (!up.ok) fail('upsert 失败: ' + JSON.stringify(up))
    if (up.activeModel !== 'main') fail('注册表为空时首个档案应自动激活: ' + JSON.stringify(up))
    const list = await rpc.call('llm.models.list')
    const saved = list.models.find((m: any) => m.name === 'main')
    if (!saved || saved.contextWindow !== 200000) fail('contextWindow 未保存: ' + JSON.stringify(saved))
    console.log('✓ upsert：首档案自动激活，contextWindow 等字段保存')

    // 2. 激活档案生效：端点 + 档案级参数 + 思考映射
    mock.requests.length = 0
    r = await rpc.call('llm.chat', { messages: [{ role: 'user', content: 'hi' }] })
    const req = mock.requests[0]
    if (req.headers['authorization'] !== 'Bearer sk-profile') fail('应走档案 apiKey')
    if (req.body.model !== 'profile-model') fail('应走档案 model')
    if (req.headers['x-profile'] !== '1') fail('档案 headers 未生效')
    if (req.body.temperature !== 0.2 || req.body.max_tokens !== 512) fail('档案级生成参数未生效: ' + JSON.stringify(req.body))
    if (req.body.reasoning_effort !== 'medium') fail('思考开关应映射 reasoning_effort(默认 medium): ' + JSON.stringify(req.body))
    console.log('✓ 激活档案：端点/headers/档案级参数(温度0.2, max 512)/思考映射全部生效')

    // 3. 取消激活 → 回退内联（含内联生成参数）
    await rpc.call('llm.models.activate', { name: '' })
    mock.requests.length = 0
    r = await rpc.call('llm.chat', { messages: [{ role: 'user', content: 'hi' }] })
    const req2 = mock.requests[0]
    if (req2.headers['authorization'] !== 'Bearer sk-inline') fail('取消激活应回退内联')
    if (req2.body.temperature !== 0.9 || req2.body.max_tokens !== 1111) fail('应回退内联生成参数')
    console.log('✓ 取消激活：端点与生成参数回退内联')

    // 4. remove（移除后注册表与 activeModel 复位）
    const rm = await rpc.call('llm.models.remove', { name: 'main' })
    if (!rm.ok) fail('remove 失败')
    const list2 = await rpc.call('llm.models.list')
    if (list2.models.length !== 0) fail('remove 后注册表未清空: ' + JSON.stringify(list2))
    console.log('✓ remove：档案删除')

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

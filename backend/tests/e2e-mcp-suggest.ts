/**
 * E2E：mcp.config.suggest —— mock 文档页 + mock LLM，
 * 验证 抓取文档 → 剥 HTML → chatRaw（elysia 链路）→ parseSuggestion 全链路。
 * 运行：npx ts-node tests/e2e-mcp-suggest.ts
 */
import * as http from 'http'
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

const DOCS_HTML = `<html><head><style>body{color:red}</style><script>alert(1)</script></head>
<body><h1>Example MCP Server</h1>
<p>Streamable HTTP endpoint: https://mcp.example.com/api/mcp</p>
<p>Authentication: Bearer token in Authorization header.</p></body></html>`

function startHttpMock(): Promise<{ server: http.Server; port: number; llmBodies: any[] }> {
  const llmBodies: any[] = []
  const server = http.createServer((req, res) => {
    if (req.url === '/docs.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(DOCS_HTML)
      return
    }
    if (req.url === '/v1/chat/completions') {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        llmBodies.push(JSON.parse(raw))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'c1', object: 'chat.completion', created: 1, model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: '说明如下```json\n{"url": "https://mcp.example.com/api/mcp", "headers": {"Authorization": "Bearer {{apiKey}}"}, "notes": "Bearer Token 鉴权"}\n```' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, llmBodies })
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
  const mock = await startHttpMock()
  const base = `http://127.0.0.1:${mock.port}`

  try {
    await rpc.call('config.updatePaths', {
      entries: [
        { path: 'llm.provider', value: 'openai' },
        { path: 'llm.baseURL', value: `${base}/v1` },
        { path: 'llm.apiKey', value: 'sk-suggest' },
        { path: 'llm.model', value: 'mock-model' },
      ],
    })

    // url 模式：抓文档 → 剥 HTML → LLM → 建议
    const r = await rpc.call('mcp.config.suggest', { mode: 'url', url: `${base}/docs.html` })
    if (!r.ok) fail('suggest 失败: ' + JSON.stringify(r))
    if (r.suggestion.url !== 'https://mcp.example.com/api/mcp') fail('url 提取不对: ' + JSON.stringify(r.suggestion))
    if ((r.suggestion.headers ?? {}).Authorization !== 'Bearer {{apiKey}}') fail('headers 占位不对: ' + JSON.stringify(r.suggestion))
    if (!String(r.suggestion.notes ?? '').includes('Bearer')) fail('notes 缺失')
    const llmBody = mock.llmBodies[0]
    const systemMsg = llmBody.messages.find((m: any) => m.role === 'system')
    const userMsg = llmBody.messages.find((m: any) => m.role === 'user')
    if (!String(systemMsg?.content ?? '').includes('Streamable HTTP 接入') || !String(systemMsg?.content ?? '').includes('仅输出一个 JSON 对象')) fail('系统提示词未包含目标声明与输出约束')
    if (String(systemMsg?.content ?? '').includes('{{prompt}}') || String(systemMsg?.content ?? '').includes('视频')) fail('系统提示词混入了领域预设字段')
    if (!String(userMsg?.content ?? '').includes('https://mcp.example.com/api/mcp')) fail('用户消息未包含文档文本')
    if (String(userMsg?.content ?? '').includes('alert(1)') || String(userMsg?.content ?? '').includes('color:red')) fail('HTML 未剥干净')
    console.log('✓ url 模式: 文档抓取/HTML 剥离/声明式提示词/占位符密钥/建议返回')

    // text 模式
    const r2 = await rpc.call('mcp.config.suggest', { mode: 'text', text: 'endpoint 是 https://x.dev/mcp，用 X-Api-Key 头，值为你的密钥' })
    if (!r2.ok) fail('text 模式失败: ' + JSON.stringify(r2))
    console.log('✓ text 模式: 直接文本输入返回建议')

    // 非法输入结构化失败
    const r3 = await rpc.call('mcp.config.suggest', { mode: 'text', text: '' })
    if (r3.ok !== false || !r3.errors.length) fail('空文本应结构化失败: ' + JSON.stringify(r3))
    console.log('✓ 输入校验: 空文本结构化失败不抛错')

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

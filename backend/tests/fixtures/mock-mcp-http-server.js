/**
 * Mock MCP 服务器（Streamable HTTP 传输）：用于 e2e 验证 McpHttpClient。
 * 实现 initialize（带 Mcp-Session-Id）/ notifications（202）/ tools/list / tools/call，
 * GET 打开 SSE 通知流；POST /__control/add-late-tool 会动态加工具并向 SSE 流广播
 * notifications/tools/list_changed（验证客户端自动刷新）。
 * 运行：node mock-mcp-http-server.js（端口 0 = 随机，就绪后 stdout 打印 READY <port>）
 */
const http = require('http')

const LATE_TOOL = {
  name: 'late',
  description: '动态工具：list_changed 后才出现',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
}

let tools = [
  {
    name: 'echo',
    description: '回声工具：原样返回 text 参数',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'add',
    description: '加法：a + b',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
]

const sseClients = new Set()
let sessionCounter = 0

function sendSse(res, obj) {
  res.write('event: message\ndata: ' + JSON.stringify(obj) + '\n\n')
}

function handleRpc(msg, res, sessionId) {
  if (msg.method === 'initialize') {
    sessionCounter += 1
    res.setHeader('Mcp-Session-Id', 'mock-session-' + sessionCounter)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'mock-mcp-http', version: '1.0.0' },
      },
    }))
    return
  }
  if (msg.id === undefined) {
    // 客户端→服务器通知：按规范回 202
    res.writeHead(202)
    res.end()
    return
  }
  let result
  if (msg.method === 'tools/list') {
    result = { tools }
  } else if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name
    const args = (msg.params && msg.params.arguments) || {}
    if (name === 'echo') {
      result = { content: [{ type: 'text', text: 'echo: ' + String(args.text ?? '') }] }
    } else if (name === 'add') {
      result = { content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }] }
    } else if (name === 'late') {
      result = { content: [{ type: 'text', text: 'late: ' + String(args.text ?? '') }] }
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool: ' + name } }))
      return
    }
  } else {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown method: ' + msg.method } }))
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__control/add-late-tool') {
    if (!tools.some((t) => t.name === 'late')) tools = [...tools, LATE_TOOL]
    for (const client of sseClients) sendSse(client, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  if (req.method === 'GET') {
    // 服务器→客户端通知流（SSE）
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return
  }
  if (req.method === 'DELETE') {
    res.writeHead(204)
    res.end()
    return
  }
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        handleRpc(JSON.parse(body), res, req.headers['mcp-session-id'])
      } catch {
        res.writeHead(400)
        res.end('bad json')
      }
    })
    return
  }
  res.writeHead(405)
  res.end()
})

server.listen(0, '127.0.0.1', () => {
  console.log('READY ' + server.address().port)
})

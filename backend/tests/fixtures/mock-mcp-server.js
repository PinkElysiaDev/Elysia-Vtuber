/**
 * Mock MCP 服务器（stdio 传输）：用于 e2e 验证 McpStdioClient。
 * 实现 initialize / notifications/initialized / tools/list / tools/call。
 * 运行：node mock-mcp-server.js
 */
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin })

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

rl.on('line', (line) => {
  line = line.trim()
  if (!line) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-mcp', version: '1.0.0' },
    })
  } else if (msg.method === 'notifications/initialized') {
    // 通知无需响应
  } else if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [
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
      ],
    })
  } else if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name
    const args = (msg.params && msg.params.arguments) || {}
    if (name === 'echo') {
      reply(msg.id, { content: [{ type: 'text', text: 'echo: ' + String(args.text ?? '') }] })
    } else if (name === 'add') {
      reply(msg.id, { content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }] })
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool: ' + name } }) + '\n')
    }
  }
})

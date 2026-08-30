/**
 * MCP HTTP 接入配置的 LLM 文档提取：消费方声明提取目标（字段不进 request-kit，保持包零预设），
 * LLM 通道注入网关 chatRaw（同一 request-kit/elysia 链路，vision 模型可读截图）。
 * 安全约定：结果仅作建议返回前端，不写配置；密钥只用 {{apiKey}} 占位，LLM 提示词明令禁止编造凭据。
 */
import { defineTarget, extractFromDocs, type SuggestionResult } from '@elysia-ai/request-kit'
import type { LLMGateway, RawChatMessage } from '../llm/gateway'

/** 从 MCP 服务器文档（README / 官方文档页）提取 Streamable HTTP 接入信息 */
export const MCP_HTTP_DOCS_TARGET = defineTarget({
  name: 'mcp-http-endpoint',
  description: 'MCP 服务器 Streamable HTTP 接入',
  fields: [
    {
      key: 'url',
      type: 'string',
      required: true,
      description: 'MCP endpoint 的完整 URL（如 https://host/mcp）。stdio 命令型部署（npx/uvx）无法转为 HTTP，此时省略 url。',
    },
    {
      key: 'headers',
      type: 'object',
      description: '连接所需的请求头对象。鉴权值用占位符写法（如 {"Authorization": "Bearer {{apiKey}}"}），绝不编造真实密钥；普通自定义头（如 X-Api-Version）可用文档给出的真实值。',
    },
    {
      key: 'notes',
      type: 'string',
      description: '一句话说明认证方式与注意事项（该服务是否仅支持 stdio、密钥名、特殊要求等）。',
    },
  ],
  variables: [{ name: 'apiKey', description: '用户稍后自行填入的 API Key / Token' }],
})

export interface SuggestInput {
  mode: 'url' | 'text' | 'images'
  url?: string
  text?: string
  images?: string[]
}

const DOCS_FETCH_TIMEOUT_MS = 15000
const DOCS_MAX_BYTES = 512 * 1024

/** 抓取文档 URL 并粗提取文本（剥 script/style 与标签）。失败抛错由 RPC 层转错误响应。 */
async function fetchDocsText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { accept: 'text/html,application/json,text/plain,*/*', 'user-agent': 'vtuber-backend-mcp-suggest/0.2' },
    signal: AbortSignal.timeout(DOCS_FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`文档抓取失败：HTTP ${res.status}`)
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
    if (out.length > DOCS_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('html')) {
    // Guard: truncation may leave unclosed script/style tags, leaking JS/CSS to LLM
    const lowerOut = out.toLowerCase()
    const lastScript = lowerOut.lastIndexOf('<script')
    const lastScriptClose = lowerOut.lastIndexOf('</script>')
    if (lastScript >= 0 && lastScript > lastScriptClose) out = out.slice(0, lastScript)
    const lastStyle = lowerOut.lastIndexOf('<style')
    const lastStyleClose = lowerOut.lastIndexOf('</style>')
    if (lastStyle >= 0 && lastStyle > lastStyleClose) out = out.slice(0, lastStyle)
    return out
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
  }
  return out.trim()
}

export interface McpSuggestDeps {
  gateway: LLMGateway
}

export async function suggestMcpHttpConfig(deps: McpSuggestDeps, input: SuggestInput): Promise<SuggestionResult> {
  let text: string | undefined
  let images: string[] | undefined
  if (input.mode === 'url') {
    const target = String(input.url ?? '').trim()
    if (!/^https?:\/\//i.test(target)) {
      return { ok: false, value: {}, errors: ['url 需要是 http(s) 地址'] }
    }
    text = await fetchDocsText(target)
    if (!text) return { ok: false, value: {}, errors: ['文档抓取结果为空'] }
  } else if (input.mode === 'text') {
    text = String(input.text ?? '')
    if (!text.trim()) return { ok: false, value: {}, errors: ['text 不能为空'] }
  } else if (input.mode === 'images') {
    images = (input.images ?? []).map(String).filter((v) => v !== '')
    if (!images.length) return { ok: false, value: {}, errors: ['images 不能为空'] }
  } else {
    return { ok: false, value: {}, errors: ['mode 必须是 url / text / images'] }
  }
  return extractFromDocs({
    input: { text, images },
    target: MCP_HTTP_DOCS_TARGET,
    llm: (messages) => {
      const raw: RawChatMessage[] = messages.map((msg) => {
        const textParts: string[] = []
        const urls: string[] = []
        for (const part of msg.parts) {
          if (part.type === 'text') textParts.push(part.text)
          else if (part.type === 'image') urls.push(part.url)
        }
        return { role: msg.role, content: textParts.join('\n'), images: urls.length ? urls : undefined }
      })
      return deps.gateway.chatRaw(raw, { temperature: 0 })
    },
  })
}

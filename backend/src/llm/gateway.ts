import type { LLMConfig } from '../config'
import type { ChatMessage, ChatRequest, ChatResult, ToolCall, ToolSpec } from './types'

export class LLMGateway {
  constructor(private config: LLMConfig) {}

  setConfig(config: LLMConfig): void {
    this.config = config
  }

  getConfig(): LLMConfig {
    return this.config
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (!this.config.apiKey) {
      throw new Error('LLM apiKey 未配置')
    }
    const provider = (this.config.provider || 'openai').toLowerCase()
    if (provider === 'anthropic') return this.chatAnthropic(request)
    if (provider === 'gemini') return this.chatGemini(request)
    if (provider === 'responses') return this.chatResponses(request)
    return this.chatOpenAI(request)
  }

  private async chatOpenAI(request: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: request.messages.map(toOpenAIMessage),
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      top_p: this.config.topP,
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        },
      }))
    }

    const data = await this.postJson(this.joinUrl(this.base('https://api.openai.com/v1'), '/chat/completions'), body, {
      Authorization: `Bearer ${this.config.apiKey}`,
    })
    const choice = data?.choices?.[0] ?? {}
    const message = choice.message ?? {}
    const toolCalls: ToolCall[] = []
    for (const call of message.tool_calls ?? []) {
      toolCalls.push({
        id: String(call.id ?? `call_${toolCalls.length}`),
        name: String(call.function?.name ?? ''),
        arguments: parseArgs(call.function?.arguments),
      })
    }
    return {
      content: typeof message.content === 'string' ? message.content : '',
      finishReason: String(choice.finish_reason ?? ''),
      toolCalls,
      raw: data,
    }
  }

  private async chatResponses(request: ChatRequest): Promise<ChatResult> {
    const input: unknown[] = []
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        input.push({ role: 'system', content: msg.content })
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls?.length) {
          input.push({
            type: 'function_call',
            call_id: msg.toolCalls[0].id,
            name: msg.toolCalls[0].name,
            arguments: JSON.stringify(msg.toolCalls[0].arguments ?? {}),
          })
          for (const extra of msg.toolCalls.slice(1)) {
            input.push({
              type: 'function_call',
              call_id: extra.id,
              name: extra.name,
              arguments: JSON.stringify(extra.arguments ?? {}),
            })
          }
        } else {
          input.push({ role: 'assistant', content: msg.content })
        }
      } else if (msg.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: msg.toolCallId ?? '',
          output: msg.content,
        })
      } else {
        input.push({ role: 'user', content: msg.content })
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      input,
      temperature: this.config.temperature,
      max_output_tokens: this.config.maxTokens,
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? { type: 'object', properties: {} },
      }))
    }

    const data = await this.postJson(this.joinUrl(this.base('https://api.openai.com/v1'), '/responses'), body, {
      Authorization: `Bearer ${this.config.apiKey}`,
    })

    let content = ''
    const toolCalls: ToolCall[] = []
    const output = Array.isArray(data?.output) ? data.output : []
    for (const item of output) {
      if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text' || part.type === 'text') content += part.text ?? ''
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          id: String(item.call_id ?? item.id ?? `call_${toolCalls.length}`),
          name: String(item.name ?? ''),
          arguments: parseArgs(item.arguments),
        })
      }
    }
    if (!content && typeof data?.output_text === 'string') content = data.output_text

    return {
      content,
      finishReason: String(data?.status ?? ''),
      toolCalls,
      raw: data,
    }
  }

  private async chatAnthropic(request: ChatRequest): Promise<ChatResult> {
    let system = ''
    const messages: Array<{ role: string; content: unknown }> = []
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system += (system ? '\n' : '') + msg.content
        continue
      }
      if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: msg.content,
          }],
        })
        continue
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const blocks: unknown[] = []
        if (msg.content) blocks.push({ type: 'text', text: msg.content })
        for (const call of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          })
        }
        messages.push({ role: 'assistant', content: blocks })
        continue
      }
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages,
    }
    if (system) body.system = system
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters ?? { type: 'object', properties: {} },
      }))
    }

    const data = await this.postJson(this.joinUrl(this.base('https://api.anthropic.com/v1'), '/messages'), body, {
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    })

    let content = ''
    const toolCalls: ToolCall[] = []
    for (const block of data?.content ?? []) {
      if (block.type === 'text') content += block.text ?? ''
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: String(block.id ?? `call_${toolCalls.length}`),
          name: String(block.name ?? ''),
          arguments: (block.input && typeof block.input === 'object') ? block.input : {},
        })
      }
    }
    return {
      content,
      finishReason: String(data?.stop_reason ?? ''),
      toolCalls,
      raw: data,
    }
  }

  private async chatGemini(request: ChatRequest): Promise<ChatResult> {
    let system = ''
    const contents: unknown[] = []
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system += (system ? '\n' : '') + msg.content
        continue
      }
      if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name ?? '',
              response: parseJsonOrText(msg.content),
            },
          }],
        })
        continue
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const parts: unknown[] = []
        if (msg.content) parts.push({ text: msg.content })
        for (const call of msg.toolCalls) {
          parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } })
        }
        contents.push({ role: 'model', parts })
        continue
      }
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
        topP: this.config.topP,
      },
    }
    if (system) body.systemInstruction = { parts: [{ text: system }] }
    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        })),
      }]
    }

    const base = this.base('https://generativelanguage.googleapis.com/v1beta')
    const url = `${this.joinUrl(base, `/models/${this.config.model}:generateContent`)}?key=${encodeURIComponent(this.config.apiKey)}`
    const data = await this.postJson(url, body, {})
    const candidate = data?.candidates?.[0] ?? {}
    let content = ''
    const toolCalls: ToolCall[] = []
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === 'string') content += part.text
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}`,
          name: String(part.functionCall.name ?? ''),
          arguments: (part.functionCall.args && typeof part.functionCall.args === 'object')
            ? part.functionCall.args
            : {},
        })
      }
    }
    return {
      content,
      finishReason: String(candidate.finishReason ?? ''),
      toolCalls,
      raw: data,
    }
  }

  private base(fallback: string): string {
    return (this.config.baseURL || fallback).replace(/\/+$/, '')
  }

  private joinUrl(base: string, suffix: string): string {
    if (suffix.startsWith('http')) return suffix
    return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
  }

  private async postJson(
    url: string,
    body: unknown,
    extraHeaders: Record<string, string>,
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
      ...extraHeaders,
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs || 60000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await res.text()
      if (!res.ok) {
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`)
      }
      return text ? JSON.parse(text) : {}
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`LLM timeout after ${this.config.timeoutMs}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

function toOpenAIMessage(msg: ChatMessage): Record<string, unknown> {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: msg.toolCallId ?? '',
      content: msg.content,
    }
  }
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    return {
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    }
  }
  return { role: msg.role, content: msg.content }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function parseJsonOrText(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return { result: raw }
  }
}

export type { ToolSpec }

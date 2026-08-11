/**
 * Anthropic API 适配器
 * 支持 Claude 系列模型
 */

import { BaseLLMAdapter } from './base'
import type { LLMRequest, LLMResponse, ToolDefinition, ChatMessage } from '../../types'

export class AnthropicAdapter extends BaseLLMAdapter {
  readonly name = 'Anthropic'

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = this.buildRequestBody(request)

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      await this.handleHttpError(response)
    }

    const data = await response.json()
    return this.parseResponse(data)
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<LLMResponse, void, unknown> {
    const body = this.buildRequestBody(request, true)

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      await this.handleHttpError(response)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const chunk = this.parseStreamChunk(json)
          if (chunk) {
            yield chunk
          }
        } catch (e) {
          console.error('Failed to parse SSE chunk:', e)
        }
      }
    }
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(request: LLMRequest, stream: boolean = false): any {
    // Anthropic 的格式：system 消息单独提取
    const { system, messages } = this.convertMessages(request.messages)

    const body: any = {
      model: this.model,
      messages,
      max_tokens: request.maxTokens || 4096,
      stream
    }

    if (system) {
      body.system = system
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = this.convertTools(request.tools)
    }

    return body
  }

  /**
   * 转换消息格式（提取 system 消息）
   */
  private convertMessages(messages: ChatMessage[]): { system?: string; messages: any[] } {
    let system: string | undefined
    const convertedMessages: any[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic 的 system 是单独字段
        system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      } else {
        convertedMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        })
      }
    }

    return { system, messages: convertedMessages }
  }

  /**
   * 转换工具定义
   */
  protected convertTools(tools?: ToolDefinition[]): any {
    if (!tools || tools.length === 0) return undefined

    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }))
  }

  /**
   * 解析工具调用
   */
  protected parseToolCalls(response: any): Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }> | undefined {
    const content = response.content
    if (!Array.isArray(content)) return undefined

    const toolUseBlocks = content.filter((block: any) => block.type === 'tool_use')
    if (toolUseBlocks.length === 0) return undefined

    return toolUseBlocks.map((block: any) => ({
      id: block.id,
      name: block.name,
      arguments: block.input
    }))
  }

  /**
   * 解析响应
   */
  private parseResponse(data: any): LLMResponse {
    const response: LLMResponse = {
      content: '',
      finishReason: data.stop_reason,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      } : undefined
    }

    // 提取文本内容
    if (Array.isArray(data.content)) {
      const textBlocks = data.content.filter((block: any) => block.type === 'text')
      response.content = textBlocks.map((block: any) => block.text).join('')
    }

    // 解析工具调用
    const toolCalls = this.parseToolCalls(data)
    if (toolCalls) {
      response.toolCalls = toolCalls
    }

    return response
  }

  /**
   * 解析流式响应块
   */
  private parseStreamChunk(data: any): LLMResponse | null {
    if (data.type === 'content_block_delta') {
      if (data.delta?.type === 'text_delta') {
        return {
          content: data.delta.text || '',
          finishReason: undefined
        }
      }
    }

    if (data.type === 'message_delta') {
      return {
        content: '',
        finishReason: data.delta?.stop_reason
      }
    }

    return null
  }
}

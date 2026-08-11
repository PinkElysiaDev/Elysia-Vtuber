/**
 * OpenAI API 适配器
 * 支持 OpenAI / Azure OpenAI / 兼容 OpenAI 格式的 API
 */

import { BaseLLMAdapter } from './base'
import type { LLMRequest, LLMResponse, ToolDefinition, ChatMessage } from '../../types'

export class OpenAIAdapter extends BaseLLMAdapter {
  readonly name = 'OpenAI'

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = this.buildRequestBody(request)

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'Authorization': `Bearer ${this.apiKey}`
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

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'Authorization': `Bearer ${this.apiKey}`
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
        if (!trimmed || trimmed === 'data: [DONE]') continue

        if (trimmed.startsWith('data: ')) {
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
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(request: LLMRequest, stream: boolean = false): any {
    const body: any = {
      model: this.model,
      messages: this.convertMessages(request.messages),
      stream
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = this.convertTools(request.tools)
      if (request.toolChoice) {
        body.tool_choice = request.toolChoice
      }
    }

    return body
  }

  /**
   * 转换消息格式
   */
  private convertMessages(messages: ChatMessage[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.name && { name: msg.name }),
      ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
      ...(msg.toolCalls && { tool_calls: msg.toolCalls })
    }))
  }

  /**
   * 转换工具定义
   */
  protected convertTools(tools?: ToolDefinition[]): any {
    if (!tools || tools.length === 0) return undefined

    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
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
    const toolCalls = response.choices?.[0]?.message?.tool_calls
    if (!toolCalls || toolCalls.length === 0) return undefined

    return toolCalls.map((call: any) => ({
      id: call.id,
      name: call.function.name,
      arguments: JSON.parse(call.function.arguments)
    }))
  }

  /**
   * 解析响应
   */
  private parseResponse(data: any): LLMResponse {
    const choice = data.choices?.[0]
    if (!choice) {
      throw new Error('No choices in response')
    }

    const response: LLMResponse = {
      content: choice.message?.content || '',
      finishReason: choice.finish_reason,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
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
    const choice = data.choices?.[0]
    if (!choice) return null

    const delta = choice.delta
    if (!delta) return null

    const response: LLMResponse = {
      content: delta.content || '',
      finishReason: choice.finish_reason
    }

    // 流式工具调用
    if (delta.tool_calls) {
      response.toolCalls = delta.tool_calls.map((call: any) => ({
        id: call.id || '',
        name: call.function?.name || '',
        arguments: call.function?.arguments || ''
      }))
    }

    return response
  }
}

/**
 * Google Gemini API 适配器
 */

import { BaseLLMAdapter } from './base'
import type { LLMRequest, LLMResponse, ToolDefinition, ChatMessage } from '../../types'

export class GeminiAdapter extends BaseLLMAdapter {
  readonly name = 'Gemini'

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = this.buildRequestBody(request)
    const baseURL = this.baseURL || 'https://generativelanguage.googleapis.com/v1beta'
    const url = `${baseURL}/models/${this.model || 'gemini-pro'}:generateContent?key=${this.apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      await this.handleHttpError(response)
    }

    const data = await response.json()
    return this.parseResponse(data)
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<LLMResponse, void, unknown> {
    const body = this.buildRequestBody(request)
    const baseURL = this.baseURL || 'https://generativelanguage.googleapis.com/v1beta'
    const url = `${baseURL}/models/${this.model || 'gemini-pro'}:streamGenerateContent?key=${this.apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
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

        try {
          const json = JSON.parse(trimmed)
          const chunk = this.parseStreamChunk(json)
          if (chunk) {
            yield chunk
          }
        } catch (e) {
          console.error('Failed to parse chunk:', e)
        }
      }
    }
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(request: LLMRequest): any {
    const body: any = {
      contents: this.convertMessages(request.messages),
      generationConfig: {}
    }

    if (request.temperature !== undefined) {
      body.generationConfig.temperature = request.temperature
    }

    if (request.maxTokens !== undefined) {
      body.generationConfig.maxOutputTokens = request.maxTokens
    }

    if (request.topP !== undefined) {
      body.generationConfig.topP = request.topP
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [{ functionDeclarations: this.convertTools(request.tools) }]
    }

    return body
  }

  /**
   * 转换消息格式
   */
  private convertMessages(messages: ChatMessage[]): any[] {
    const converted: any[] = []
    let systemInstruction = ''

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini 将 system 消息合并到第一条 user 消息
        systemInstruction += (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)) + '\n'
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user'
        const content = typeof msg.content === 'string'
          ? { text: msg.content }
          : msg.content

        converted.push({
          role,
          parts: Array.isArray(content) ? content : [content]
        })
      }
    }

    // 将 system 指令插入到第一条 user 消息
    if (systemInstruction && converted.length > 0 && converted[0].role === 'user') {
      converted[0].parts.unshift({ text: systemInstruction.trim() })
    }

    return converted
  }

  /**
   * 转换工具定义
   */
  protected convertTools(tools?: ToolDefinition[]): any {
    if (!tools || tools.length === 0) return undefined

    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
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
    const candidates = response.candidates
    if (!candidates || candidates.length === 0) return undefined

    const parts = candidates[0].content?.parts
    if (!parts) return undefined

    const functionCalls = parts.filter((part: any) => part.functionCall)
    if (functionCalls.length === 0) return undefined

    return functionCalls.map((part: any, index: number) => ({
      id: `call_${index}`,
      name: part.functionCall.name,
      arguments: part.functionCall.args || {}
    }))
  }

  /**
   * 解析响应
   */
  private parseResponse(data: any): LLMResponse {
    const candidate = data.candidates?.[0]
    if (!candidate) {
      throw new Error('No candidates in response')
    }

    const response: LLMResponse = {
      content: '',
      finishReason: candidate.finishReason?.toLowerCase(),
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount
      } : undefined
    }

    // 提取文本内容
    const parts = candidate.content?.parts || []
    const textParts = parts.filter((part: any) => part.text)
    response.content = textParts.map((part: any) => part.text).join('')

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
    const candidate = data.candidates?.[0]
    if (!candidate) return null

    const parts = candidate.content?.parts || []
    const textParts = parts.filter((part: any) => part.text)
    const content = textParts.map((part: any) => part.text).join('')

    return {
      content,
      finishReason: candidate.finishReason?.toLowerCase()
    }
  }
}

/**
 * LLM 适配器基类
 */

import type { ChatMessage, LLMRequest, LLMResponse, ToolDefinition } from '../../types'

export interface LLMAdapter {
  /**
   * 适配器名称
   */
  readonly name: string

  /**
   * 发送聊天请求
   */
  chat(request: LLMRequest): Promise<LLMResponse>

  /**
   * 流式聊天请求
   */
  chatStream(request: LLMRequest): AsyncGenerator<LLMResponse, void, unknown>

  /**
   * 测试连接
   */
  testConnection(): Promise<boolean>
}

/**
 * 适配器工厂
 */
export abstract class BaseLLMAdapter implements LLMAdapter {
  abstract readonly name: string

  protected apiKey: string
  protected baseURL: string
  protected model: string
  protected customHeaders: Record<string, string>

  constructor(config: {
    apiKey?: string
    baseURL?: string
    model?: string
    customHeaders?: Record<string, string>
  }) {
    this.apiKey = config.apiKey || ''
    this.baseURL = config.baseURL || ''
    this.model = config.model || ''
    this.customHeaders = config.customHeaders || {}
  }

  abstract chat(request: LLMRequest): Promise<LLMResponse>
  abstract chatStream(request: LLMRequest): AsyncGenerator<LLMResponse, void, unknown>

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.chat({
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        maxTokens: 5
      })
      return !!response.content
    } catch {
      return false
    }
  }

  /**
   * 构建通用请求头
   */
  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.customHeaders
    }
  }

  /**
   * 处理 HTTP 错误
   */
  protected async handleHttpError(response: Response): Promise<never> {
    const text = await response.text()
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`

    try {
      const json = JSON.parse(text)
      if (json.error) {
        errorMessage = typeof json.error === 'string'
          ? json.error
          : json.error.message || JSON.stringify(json.error)
      }
    } catch {
      errorMessage = text || errorMessage
    }

    throw new Error(errorMessage)
  }

  /**
   * 转换工具定义（每个适配器可能格式不同）
   */
  protected abstract convertTools(tools?: ToolDefinition[]): any

  /**
   * 解析工具调用响应（每个适配器格式不同）
   */
  protected abstract parseToolCalls(response: any): Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }> | undefined
}

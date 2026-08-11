/**
 * LLM 请求管理器 - 整合模板、会话、适配器
 */

import { Context } from 'koishi'
import { TemplateEngine } from './template'
import { SessionManager } from './session'
import { createLLMAdapter, type LLMAdapter } from './adapters'
import { EventCache } from '../event-cache'
import type { LLMConfig, StandardEvent, ChatMessage, LLMResponse, ToolDefinition } from '../types'

export class LLMRequestManager {
  private ctx: Context
  private config: LLMConfig
  private adapter: LLMAdapter
  private templateEngine: TemplateEngine
  private sessionManager: SessionManager
  private tools: Map<string, ToolDefinition> = new Map()

  constructor(ctx: Context, config: LLMConfig, eventCache: EventCache) {
    this.ctx = ctx
    this.config = config
    this.templateEngine = new TemplateEngine(eventCache)
    this.sessionManager = new SessionManager(
      config.session.maxMessages,
      config.session.maxTokens
    )

    // 创建适配器
    this.adapter = createLLMAdapter(config.provider)
  }

  /**
   * 注册工具
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
    this.ctx.logger('vtuber').debug(`Tool registered: ${tool.name}`)
  }

  /**
   * 取消注册工具
   */
  unregisterTool(name: string): void {
    this.tools.delete(name)
    this.ctx.logger('vtuber').debug(`Tool unregistered: ${name}`)
  }

  /**
   * 获取所有工具
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * 发送请求
   */
  async request(
    sessionId: string,
    event?: StandardEvent,
    stream: boolean = false
  ): Promise<LLMResponse> {
    // 渲染系统提示词
    const systemPrompt = this.templateEngine.render(this.config.prompt.system, event)

    // 渲染用户提示词（如果有事件）
    let userPrompt = ''
    if (event) {
      userPrompt = this.templateEngine.render(this.config.prompt.user, event)
    }

    // 获取会话历史
    const session = this.sessionManager.getOrCreate(sessionId)

    // 如果是新会话，添加系统提示词
    if (session.messages.length === 0) {
      this.sessionManager.addMessage(sessionId, {
        role: 'system',
        content: systemPrompt
      })
    }

    // 如果有用户提示词，添加到会话
    if (userPrompt) {
      this.sessionManager.addMessage(sessionId, {
        role: 'user',
        content: userPrompt
      })
    }

    // 构建请求
    const messages = this.sessionManager.getMessages(sessionId)
    const tools = this.config.enableTools ? this.getTools() : []

    try {
      let response: LLMResponse

      if (stream) {
        // 流式请求（累积完整响应）
        response = await this.handleStreamRequest(messages, tools)
      } else {
        // 普通请求
        response = await this.adapter.chat({
          messages,
          temperature: this.config.provider.temperature,
          maxTokens: this.config.provider.maxTokens,
          topP: this.config.provider.topP,
          tools: tools.length > 0 ? tools : undefined
        })
      }

      // 保存助手回复到会话
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      })

      // 如果有工具调用，执行工具并继续对话
      if (response.toolCalls && response.toolCalls.length > 0) {
        return await this.handleToolCalls(sessionId, response.toolCalls, event, stream)
      }

      return response
    } catch (error) {
      this.ctx.logger('vtuber').error('LLM request failed:', error)
      throw error
    }
  }

  /**
   * 处理流式请求
   */
  private async handleStreamRequest(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    let fullContent = ''
    let lastResponse: LLMResponse | null = null

    const stream = this.adapter.chatStream({
      messages,
      temperature: this.config.provider.temperature,
      maxTokens: this.config.provider.maxTokens,
      topP: this.config.provider.topP,
      tools: tools.length > 0 ? tools : undefined
    })

    for await (const chunk of stream) {
      fullContent += chunk.content
      lastResponse = chunk

      // 发送流式输出块
      this.ctx.emit('vtuber/llm-stream-chunk', {
        chunk: chunk.content || '',
        finished: !!chunk.finishReason
      })
    }

    return {
      content: fullContent,
      finishReason: lastResponse?.finishReason,
      usage: lastResponse?.usage,
      toolCalls: lastResponse?.toolCalls
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(
    sessionId: string,
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }>,
    event?: StandardEvent,
    stream: boolean = false
  ): Promise<LLMResponse> {
    this.ctx.logger('vtuber').debug(`Handling ${toolCalls.length} tool calls`)

    // 执行所有工具调用
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        const tool = this.tools.get(call.name)
        if (!tool) {
          return {
            id: call.id,
            name: call.name,
            result: { error: `Tool not found: ${call.name}` }
          }
        }

        try {
          const result = await tool.handler(call.arguments, this.ctx)
          return {
            id: call.id,
            name: call.name,
            result
          }
        } catch (error) {
          return {
            id: call.id,
            name: call.name,
            result: { error: String(error) }
          }
        }
      })
    )

    // 将工具结果添加到会话
    for (const result of results) {
      this.sessionManager.addMessage(sessionId, {
        role: 'tool',
        content: JSON.stringify(result.result),
        name: result.name,
        toolCallId: result.id
      })
    }

    // 继续请求（让模型根据工具结果生成回复）
    return await this.request(sessionId, event, stream)
  }

  /**
   * 清空会话
   */
  clearSession(sessionId: string): void {
    this.sessionManager.clear(sessionId)
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId: string) {
    return this.sessionManager.getSessionStats(sessionId)
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions(): void {
    this.sessionManager.cleanupExpiredSessions()
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    return await this.adapter.testConnection()
  }
}

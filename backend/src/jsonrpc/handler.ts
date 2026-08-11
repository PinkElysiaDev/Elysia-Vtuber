/**
 * JSON-RPC 2.0 协议实现
 */

import { v4 as uuidv4 } from 'uuid'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

/**
 * 方法处理器类型
 */
export type MethodHandler = (params: any) => Promise<any>

/**
 * JSON-RPC 错误码
 */
export enum JsonRpcErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603
}

/**
 * JSON-RPC 处理器
 */
export class JsonRpcHandler {
  private methods: Map<string, MethodHandler> = new Map()

  /**
   * 注册方法
   */
  register(method: string, handler: MethodHandler): void {
    this.methods.set(method, handler)
  }

  /**
   * 处理请求
   */
  async handle(message: string): Promise<string | null> {
    let request: JsonRpcRequest

    // 解析请求
    try {
      request = JSON.parse(message)
    } catch {
      return JSON.stringify(this.createErrorResponse(
        null,
        JsonRpcErrorCode.ParseError,
        'Parse error'
      ))
    }

    // 验证请求格式
    if (!this.isValidRequest(request)) {
      return JSON.stringify(this.createErrorResponse(
        (request as any)?.id || null,
        JsonRpcErrorCode.InvalidRequest,
        'Invalid request'
      ))
    }

    // 检查是否是通知（无需响应）
    if (!('id' in request)) {
      await this.handleNotification(request as JsonRpcNotification)
      return null
    }

    // 查找方法
    const handler = this.methods.get(request.method)
    if (!handler) {
      return JSON.stringify(this.createErrorResponse(
        request.id,
        JsonRpcErrorCode.MethodNotFound,
        `Method not found: ${request.method}`
      ))
    }

    // 执行方法
    try {
      const result = await handler(request.params || {})
      return JSON.stringify(this.createSuccessResponse(request.id, result))
    } catch (error) {
      return JSON.stringify(this.createErrorResponse(
        request.id,
        JsonRpcErrorCode.InternalError,
        error instanceof Error ? error.message : 'Internal error',
        error
      ))
    }
  }

  /**
   * 处理通知
   */
  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    const handler = this.methods.get(notification.method)
    if (handler) {
      try {
        await handler(notification.params || {})
      } catch (error) {
        console.error(`Notification handler error for ${notification.method}:`, error)
      }
    }
  }

  /**
   * 验证请求格式
   */
  private isValidRequest(request: any): request is JsonRpcRequest {
    return (
      request &&
      request.jsonrpc === '2.0' &&
      typeof request.method === 'string'
    )
  }

  /**
   * 创建成功响应
   */
  private createSuccessResponse(id: string | number, result: any): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result
    }
  }

  /**
   * 创建错误响应
   */
  private createErrorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: any
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id!,
      error: {
        code,
        message,
        data
      }
    }
  }

  /**
   * 创建通知消息
   */
  static createNotification(method: string, params?: any): string {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params
    }
    return JSON.stringify(notification)
  }

  /**
   * 创建请求消息
   */
  static createRequest(method: string, params?: any): string {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: uuidv4(),
      method,
      params
    }
    return JSON.stringify(request)
  }
}

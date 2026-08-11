import { v4 as uuid } from 'uuid'
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
} from './types'

/**
 * JSON-RPC 错误码
 */
export enum RpcErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
}

/**
 * 方法处理器类型
 */
export type MethodHandler = (params: any) => Promise<any> | any

/**
 * JSON-RPC 处理器
 */
export class JsonRpcHandler {
  private handlers = new Map<string, MethodHandler>()

  /**
   * 注册方法处理器
   */
  register(method: string, handler: MethodHandler) {
    this.handlers.set(method, handler)
  }

  /**
   * 批量注册方法
   */
  registerBatch(methods: Record<string, MethodHandler>) {
    Object.entries(methods).forEach(([method, handler]) => {
      this.register(method, handler)
    })
  }

  /**
   * 处理请求
   */
  async handle(message: string): Promise<string | null> {
    try {
      const data = JSON.parse(message)

      // 处理批量请求
      if (Array.isArray(data)) {
        const responses = await Promise.all(
          data.map(req => this.handleSingle(req))
        )
        return JSON.stringify(responses.filter(r => r !== null))
      }

      // 处理单个请求
      const response = await this.handleSingle(data)
      return response ? JSON.stringify(response) : null

    } catch (error) {
      return JSON.stringify(this.createErrorResponse(
        null,
        RpcErrorCode.PARSE_ERROR,
        'Parse error'
      ))
    }
  }

  /**
   * 处理单个请求
   */
  private async handleSingle(data: any): Promise<JsonRpcResponse | null> {
    // 验证 JSON-RPC 格式
    if (data.jsonrpc !== '2.0') {
      return this.createErrorResponse(
        data.id,
        RpcErrorCode.INVALID_REQUEST,
        'Invalid JSON-RPC version'
      )
    }

    // 通知消息不返回响应
    if (!data.id) {
      this.handleNotification(data as JsonRpcNotification)
      return null
    }

    const request = data as JsonRpcRequest

    // 检查方法是否存在
    const handler = this.handlers.get(request.method)
    if (!handler) {
      return this.createErrorResponse(
        request.id,
        RpcErrorCode.METHOD_NOT_FOUND,
        `Method not found: ${request.method}`
      )
    }

    // 执行方法
    try {
      const result = await handler(request.params)
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      }
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        RpcErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error',
        error
      )
    }
  }

  /**
   * 处理通知消息
   */
  private handleNotification(notification: JsonRpcNotification) {
    const handler = this.handlers.get(notification.method)
    if (handler) {
      handler(notification.params).catch((err: any) => {
        console.error(`Notification handler error: ${notification.method}`, err)
      })
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
      id: id as any,
      error: { code, message, data },
    }
  }

  /**
   * 创建请求
   */
  static createRequest(method: string, params?: any): JsonRpcRequest {
    return {
      jsonrpc: '2.0',
      id: uuid(),
      method,
      params,
    }
  }

  /**
   * 创建通知
   */
  static createNotification(method: string, params?: any): JsonRpcNotification {
    return {
      jsonrpc: '2.0',
      method,
      params,
    }
  }
}

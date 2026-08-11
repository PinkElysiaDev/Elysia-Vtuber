import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcErrorCode,
  JsonRpcNotification,
} from './types'

/**
 * JSON-RPC 方法处理函数类型
 */
export type JsonRpcHandler = (params: any) => Promise<any>

/**
 * JSON-RPC 处理器
 * 实现 JSON-RPC 2.0 协议
 */
export class JsonRpcProcessor {
  private handlers: Map<string, JsonRpcHandler> = new Map()

  /**
   * 注册方法处理器
   */
  register(method: string, handler: JsonRpcHandler): void {
    this.handlers.set(method, handler)
  }

  /**
   * 处理 JSON-RPC 请求
   */
  async process(message: string): Promise<string | null> {
    try {
      const request = JSON.parse(message)

      // 检查是否是通知（无需响应）
      if (this.isNotification(request)) {
        await this.processNotification(request)
        return null
      }

      // 处理请求并返回响应
      const response = await this.processRequest(request)
      return JSON.stringify(response)
    } catch (error) {
      // 解析错误
      return JSON.stringify(this.createErrorResponse(null, {
        code: JsonRpcErrorCode.PARSE_ERROR,
        message: 'Parse error',
        data: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  /**
   * 判断是否是通知
   */
  private isNotification(request: any): request is JsonRpcNotification {
    return request.jsonrpc === '2.0' &&
           typeof request.method === 'string' &&
           !('id' in request)
  }

  /**
   * 处理通知
   */
  private async processNotification(notification: JsonRpcNotification): Promise<void> {
    const handler = this.handlers.get(notification.method)
    if (handler) {
      try {
        await handler(notification.params)
      } catch (error) {
        console.error(`Error processing notification ${notification.method}:`, error)
      }
    }
  }

  /**
   * 处理请求
   */
  private async processRequest(request: any): Promise<JsonRpcResponse> {
    // 验证请求格式
    if (!this.isValidRequest(request)) {
      return this.createErrorResponse(request.id || null, {
        code: JsonRpcErrorCode.INVALID_REQUEST,
        message: 'Invalid Request',
      })
    }

    const { method, params, id } = request as JsonRpcRequest

    // 查找处理器
    const handler = this.handlers.get(method)
    if (!handler) {
      return this.createErrorResponse(id, {
        code: JsonRpcErrorCode.METHOD_NOT_FOUND,
        message: `Method not found: ${method}`,
      })
    }

    // 执行处理器
    try {
      const result = await handler(params)
      return this.createSuccessResponse(id, result)
    } catch (error) {
      return this.createErrorResponse(id, {
        code: JsonRpcErrorCode.INTERNAL_ERROR,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 验证请求格式
   */
  private isValidRequest(request: any): boolean {
    return (
      request &&
      request.jsonrpc === '2.0' &&
      typeof request.method === 'string' &&
      (request.id === null ||
       typeof request.id === 'string' ||
       typeof request.id === 'number')
    )
  }

  /**
   * 创建成功响应
   */
  private createSuccessResponse(id: string | number | null, result: any): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      result,
      id,
    }
  }

  /**
   * 创建错误响应
   */
  private createErrorResponse(
    id: string | number | null,
    error: JsonRpcError
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      error,
      id,
    }
  }
}

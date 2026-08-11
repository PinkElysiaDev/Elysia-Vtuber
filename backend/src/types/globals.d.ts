/**
 * 全局类型声明
 * 补充缺少类型声明的第三方模块
 *
 * 说明：uuid v9 和 ws v8 的 package.json exports 字段
 * 未包含 types 条件，在 node16 解析模式下无法自动解析类型，
 * 因此在此显式声明。
 */

declare module 'uuid' {
  export function v4(): string
  export function v1(): string
  export function v3(name: string | Uint8Array, namespace: string | Uint8Array): string
  export function v5(name: string | Uint8Array, namespace: string | Uint8Array): string
  export function validate(uuid: string): boolean
  export function version(uuid: string): number
  export function parse(uuid: string): Uint8Array
  export function stringify(arr: Uint8Array): string

  const _default: {
    v4: typeof v4
    v1: typeof v1
    v3: typeof v3
    v5: typeof v5
    validate: typeof validate
    version: typeof version
    parse: typeof parse
    stringify: typeof stringify
  }
  export default _default
}

// ws v8 支持命名导入 { WebSocket, WebSocketServer }，
// 但 @types/ws 只声明了 export = WebSocket。
// 这里补充命名导出以兼容代码中的 import { WebSocketServer, WebSocket } from 'ws'
declare module 'ws' {
  import WsType = require('@types/ws')
  export import WebSocket = WsType
  export import WebSocketServer = WsType.Server
  export default WsType
}
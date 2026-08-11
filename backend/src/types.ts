// JSON-RPC 2.0 协议类型定义

/**
 * JSON-RPC 2.0 请求
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: any
  id: string | number | null
}

/**
 * JSON-RPC 2.0 响应
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: any
  error?: JsonRpcError
  id: string | number | null
}

/**
 * JSON-RPC 2.0 错误
 */
export interface JsonRpcError {
  code: number
  message: string
  data?: any
}

/**
 * JSON-RPC 2.0 通知（无需响应）
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

// 错误代码常量
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

// ============================================
// 窗口相关类型
// ============================================

/**
 * 窗口模块类型
 */
export type WindowModule = 'live2d' | 'textDisplay' | 'musicPlayer'

/**
 * 窗口配置
 */
export interface WindowConfig {
  id: string
  title: string
  width: number
  height: number
  x?: number
  y?: number
  alwaysOnTop?: boolean
  transparent?: boolean
  frame?: boolean
  modules: WindowModule[]
}

/**
 * 窗口创建参数
 */
export interface WindowCreateParams {
  config: WindowConfig
}

/**
 * 窗口更新参数
 */
export interface WindowUpdateParams {
  windowId: string
  module: WindowModule
  action: string
  data: any
}

/**
 * 窗口关闭参数
 */
export interface WindowCloseParams {
  windowId: string
}

// ============================================
// Live2D 模块相关类型
// ============================================

/**
 * Live2D 动作
 */
export interface Live2DAction {
  loadModel?: {
    modelPath: string
  }
  setExpression?: {
    expressionId: string
  }
  playMotion?: {
    motionGroup: string
    motionIndex?: number
  }
  setScale?: {
    scale: number
  }
  setPosition?: {
    x: number
    y: number
  }
}

// ============================================
// 文本展示模块相关类型
// ============================================

/**
 * 文本展示动作
 */
export interface TextDisplayAction {
  showText?: {
    content: string
    duration?: number
    style?: TextStyle
  }
  clear?: {}
}

/**
 * 文本样式
 */
export interface TextStyle {
  fontSize?: number
  fontFamily?: string
  color?: string
  backgroundColor?: string
  padding?: number
}

// ============================================
// 音乐播放器模块相关类型
// ============================================

/**
 * 音乐播放器动作
 */
export interface MusicPlayerAction {
  play?: {
    url: string
    title?: string
    artist?: string
    cover?: string
  }
  pause?: {}
  resume?: {}
  stop?: {}
  seek?: {
    position: number
  }
  setVolume?: {
    volume: number
  }
  showLyric?: {
    lyric: string
    timestamp: number
  }
}

// ============================================
// TTS 相关类型
// ============================================

/**
 * TTS 请求参数
 */
export interface TTSPlayParams {
  text: string
  voiceType?: string
  speed?: number
  volume?: number
  outputDevice?: string
}

// ============================================
// 后端配置类型
// ============================================

/**
 * 后端服务器配置
 */
export interface BackendConfig {
  port: number
  host: string
  webUIEnabled: boolean
  webUIPort?: number
}

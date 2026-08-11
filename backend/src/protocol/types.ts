/**
 * JSON-RPC 2.0 协议类型定义
 */

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
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

export interface JsonRpcError {
  code: number
  message: string
  data?: any
}

/**
 * 后端支持的方法
 */
export enum BackendMethod {
  // Live2D 控制
  LIVE2D_LOAD_MODEL = 'live2d.loadModel',
  LIVE2D_SET_EXPRESSION = 'live2d.setExpression',
  LIVE2D_SET_MOTION = 'live2d.setMotion',
  LIVE2D_SET_SCALE = 'live2d.setScale',
  LIVE2D_SET_POSITION = 'live2d.setPosition',
  LIVE2D_GET_STATE = 'live2d.getState',

  // 点歌机控制
  MUSIC_SEARCH = 'music.search',
  MUSIC_ADD = 'music.add',
  MUSIC_PLAY = 'music.play',
  MUSIC_PAUSE = 'music.pause',
  MUSIC_SKIP = 'music.skip',
  MUSIC_GET_QUEUE = 'music.getQueue',
  MUSIC_GET_CURRENT = 'music.getCurrent',
  MUSIC_REMOVE = 'music.remove',
  MUSIC_CLEAR = 'music.clear',

  // 窗口管理
  WINDOW_CREATE = 'window.create',
  WINDOW_CLOSE = 'window.close',
  WINDOW_SHOW = 'window.show',
  WINDOW_HIDE = 'window.hide',
  WINDOW_SET_CONTENT = 'window.setContent',

  // 展示板
  DISPLAY_SHOW_TEXT = 'display.showText',
  DISPLAY_SHOW_HTML = 'display.showHTML',
  DISPLAY_CLEAR = 'display.clear',

  // TTS 音频播放
  AUDIO_PLAY = 'audio.play',
  AUDIO_STOP = 'audio.stop',
  AUDIO_SET_VOLUME = 'audio.setVolume',
  AUDIO_GET_STATE = 'audio.getState',

  // 系统
  SYSTEM_GET_INFO = 'system.getInfo',
  SYSTEM_PING = 'system.ping',
}

/**
 * 参数类型定义
 */
export interface Live2DLoadModelParams {
  modelPath: string
  scale?: number
  x?: number
  y?: number
}

export interface Live2DSetExpressionParams {
  expression: string
}

export interface Live2DSetMotionParams {
  group: string
  index: number
  priority?: number
}

export interface Live2DSetScaleParams {
  scale: number
}

export interface Live2DSetPositionParams {
  x: number
  y: number
}

export interface MusicSearchParams {
  keyword: string
  source?: string
  limit?: number
}

export interface MusicAddParams {
  songId: string
  source: string
  requestUser?: string
}

export interface MusicRemoveParams {
  index: number
}

export interface WindowCreateParams {
  type: 'live2d' | 'display' | 'music'
  title?: string
  width?: number
  height?: number
  x?: number
  y?: number
  transparent?: boolean
  alwaysOnTop?: boolean
}

export interface WindowCloseParams {
  windowId: string
}

export interface WindowSetContentParams {
  windowId: string
  content: string
  type?: 'html' | 'text'
}

export interface DisplayShowTextParams {
  text: string
  duration?: number
  style?: {
    fontSize?: number
    color?: string
    backgroundColor?: string
  }
}

export interface DisplayShowHTMLParams {
  html: string
  duration?: number
}

export interface AudioPlayParams {
  url: string
  volume?: number
}

export interface AudioSetVolumeParams {
  volume: number
}

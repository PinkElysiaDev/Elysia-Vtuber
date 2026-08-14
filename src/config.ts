import { Schema } from 'koishi'

export interface Config {
  roomId: string
  backend: {
    host: string
    wsPort: number
    autoStart: boolean
    nodePath: string
    entryPath: string
    workingDir: string
    startTimeout: number
    reconnectInterval: number
    timeout: number
  }
  events: {
    danmaku: boolean
    gift: boolean
    superchat: boolean
    enter: boolean
    follow: boolean
    like: boolean
    guard: boolean
    liveStart: boolean
    liveEnd: boolean
  }
}

export const Config: Schema<Config> = Schema.object({
  roomId: Schema.string().required().description('直播间 ID'),
  backend: Schema.object({
    host: Schema.string().default('localhost').description('Node 逻辑服务地址'),
    wsPort: Schema.number().default(19275).description('Node 逻辑服务 WebSocket 端口'),
    autoStart: Schema.boolean().default(true).description('服务未运行时自动启动 Node 进程'),
    nodePath: Schema.string().default('node').description('Node 可执行文件'),
    entryPath: Schema.string().default('backend/dist/index.js').description('逻辑服务入口（相对插件根目录）'),
    workingDir: Schema.string().default('backend').description('逻辑服务工作目录（相对插件根目录）'),
    startTimeout: Schema.number().default(15000).description('等待服务启动的超时(ms)'),
    reconnectInterval: Schema.number().default(5000).description('重连间隔(ms)'),
    timeout: Schema.number().default(10000).description('请求超时(ms)'),
  }).description('逻辑服务连接配置'),
  events: Schema.object({
    danmaku: Schema.boolean().default(true),
    gift: Schema.boolean().default(true),
    superchat: Schema.boolean().default(true),
    enter: Schema.boolean().default(false),
    follow: Schema.boolean().default(true),
    like: Schema.boolean().default(false),
    guard: Schema.boolean().default(true),
    liveStart: Schema.boolean().default(true),
    liveEnd: Schema.boolean().default(true),
  }).description('需要转发的事件'),
})

export default Config

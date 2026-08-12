/**
 * 后端进程管理器
 * 负责自动检测、分离启动 (detached)、停止、重启后端进程
 */

import { spawn } from 'child_process'
import * as path from 'path'
import * as net from 'net'
import type { Logger } from 'koishi'
import type { BackendConfig } from '../types'

export class BackendProcessManager {
  constructor(
    private config: BackendConfig,
    private logger: Logger
  ) {}

  /**
   * 检查端口是否被占用/服务是否已在运行
   */
  async isPortOpen(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      const timeout = 1000

      socket.setTimeout(timeout)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })

      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })

      socket.once('error', () => {
        resolve(false)
      })

      socket.connect(this.config.port, this.config.host)
    })
  }

  /**
   * 启动后端独立进程
   * 使用 detached: true 和 stdio: 'ignore' + unref()
   * 确保当 Koishi 退出时，后端进程不会被一同关闭
   */
  async startBackend(): Promise<boolean> {
    // 先检查是否已经运行
    const running = await this.isPortOpen()
    if (running) {
      this.logger.info(`后端服务已在 ${this.config.host}:${this.config.port} 运行中，无需重新启动`)
      return true
    }

    this.logger.info('正在以独立后台进程启动后端服务...')

    // 定位后端入口：后端在 external/vtuber/backend 目录下
    // 在开发环境 (src/backend/process.ts) 或 打包后 (lib/index.js) 中运行：
    // 如果 __dirname 是 lib/，向上一级就是 vtuber/；
    // 如果 __dirname 是 src/backend/，向上两级也是 vtuber/。
    const vtuberRootDir = __dirname.endsWith('lib')
      ? path.resolve(__dirname, '..')
      : path.resolve(__dirname, '../..')
    const backendDir = path.join(vtuberRootDir, 'backend')
    // 定位后端入口脚本：运行纯 Node.js 服务 dist/index.js
    // 注意：dist/main.js 是 Electron 入口，直接用 node 执行会报错 electron_1.app.whenReady is undefined
    const scriptToRun = path.join(backendDir, 'dist/index.js')

    if (!require('fs').existsSync(scriptToRun)) {
      this.logger.error(`找不到后端入口文件: ${scriptToRun}，请确保先构建后端`)
      return false
    }

    try {
      const child = spawn(process.execPath, [scriptToRun], {
        cwd: backendDir,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          VTUBER_PORT: String(this.config.port),
          VTUBER_HOST: this.config.host,
        }
      })

      // 让子进程脱离父进程独立运行
      child.unref()

      // 等待服务启动（最多等待 10 秒）
      const startTime = Date.now()
      while (Date.now() - startTime < 10000) {
        await new Promise(r => setTimeout(r, 500))
        if (await this.isPortOpen()) {
          this.logger.success(`后端服务已在 ${this.config.host}:${this.config.port} 启动`)
          return true
        }
      }

      this.logger.error('启动后端服务超时')
      return false
    } catch (error) {
      this.logger.error('启动后端服务进程失败:', error)
      return false
    }
  }

  /**
   * 停止后端服务（通过发送系统的请求或关闭）
   */
  async stopBackend(): Promise<boolean> {
    const running = await this.isPortOpen()
    if (!running) {
      this.logger.info('后端服务未运行')
      return true
    }

    this.logger.info('正在请求停止后端服务...')
    // 实际关闭通过给后端发送 JSON-RPC 或通用端口命令
    return false
  }
}

import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import type { Logger } from 'koishi'
import type { Config } from './config'

const PORT_TIMEOUT_MS = 1000
const POLL_MS = 300

export class BackendProcessManager {
  private child: ChildProcess | null = null

  constructor(
    private readonly config: Config['backend'],
    private readonly logger: Logger,
  ) {}

  async isPortOpen(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(PORT_TIMEOUT_MS)
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
      socket.connect(this.config.wsPort, this.config.host)
    })
  }

  async start(): Promise<boolean> {
    if (await this.isPortOpen()) {
      this.logger.info(`backend already running at ${this.config.host}:${this.config.wsPort}`)
      return true
    }

    const pluginRoot = path.resolve(__dirname, '..')
    const entry = path.isAbsolute(this.config.entryPath)
      ? this.config.entryPath
      : path.resolve(pluginRoot, this.config.entryPath)
    const cwd = path.isAbsolute(this.config.workingDir)
      ? this.config.workingDir
      : path.resolve(pluginRoot, this.config.workingDir)

    // npm 安装版插件不随附 backend/，缺入口时直接报清楚，避免误导性的 15s 启动超时
    if (!fs.existsSync(entry)) {
      this.logger.error(`backend entry not found: ${entry}（若为 npm 安装版插件，请手动启动 vtuber-backend，或将 backend.entryPath 指向现有服务入口）`)
      return false
    }

    this.logger.info(`starting node backend: ${this.config.nodePath} ${entry}`)

    try {
      this.child = spawn(this.config.nodePath, [entry], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child.stdout?.setEncoding('utf8')
      this.child.stdout?.on('data', (d) => this.logger.info(String(d).trimEnd()))
      this.child.stderr?.setEncoding('utf8')
      this.child.stderr?.on('data', (d) => this.logger.warn(String(d).trimEnd()))
      // spawn 失败（如 nodePath 无效）以异步 error 事件发出，缺监听会导致
      // uncaughtException 拖垮整个 Koishi 进程
      this.child.on('error', (error) => {
        this.logger.error(`backend process error: ${error.message}`)
        this.child = null
      })
      this.child.on('exit', (code) => {
        this.logger.warn(`backend process exited: ${code}`)
        this.child = null
      })
    } catch (error) {
      this.logger.error('failed to spawn backend:', error)
      return false
    }

    const deadline = Date.now() + this.config.startTimeout
    while (Date.now() < deadline) {
      if (await this.isPortOpen()) {
        this.logger.success(`backend started at ${this.config.host}:${this.config.wsPort}`)
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }

    this.logger.error('backend start timeout')
    if (this.child) { try { this.child.kill() } catch { /* already exited */ } this.child = null }
    return false
  }

  stop(): void {
    if (!this.child) return
    this.child.kill()
    this.child = null
  }
}

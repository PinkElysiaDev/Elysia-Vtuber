import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import type { Logger } from 'koishi'
import type { Config } from './config'

const PORT_TIMEOUT_MS = 1000
const POLL_MS = 300
const RESTART_SETTLE_MS = 400

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

    this.logger.info(`starting node backend: ${this.config.nodePath} ${entry}`)

    try {
      this.child = spawn(this.config.nodePath, [entry], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child.stdout?.on('data', (d) => this.logger.info(String(d).trimEnd()))
      this.child.stderr?.on('data', (d) => this.logger.warn(String(d).trimEnd()))
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
    return false
  }

  stop(): void {
    if (!this.child) return
    this.child.kill()
    this.child = null
  }

  async restart(): Promise<boolean> {
    this.stop()
    await new Promise((resolve) => setTimeout(resolve, RESTART_SETTLE_MS))
    return this.start()
  }
}

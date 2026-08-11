import { BrowserWindow } from 'electron'
import * as path from 'path'
import { Logger } from '../../types/common'

/**
 * Live2D 配置
 */
export interface Live2DConfig {
  modelPath: string
  width: number
  height: number
  x?: number
  y?: number
  transparent: boolean
  alwaysOnTop: boolean
}

/**
 * Live2D 窗口管理器
 */
export class Live2DManager {
  private window: BrowserWindow | null = null
  private currentModel: string | null = null

  constructor(private logger: Logger) {}

  /**
   * 创建 Live2D 窗口
   */
  async createWindow(config: Live2DConfig): Promise<void> {
    if (this.window) {
      this.logger.warn('Live2D 窗口已存在，先关闭旧窗口')
      this.closeWindow()
    }

    this.window = new BrowserWindow({
      width: config.width,
      height: config.height,
      x: config.x,
      y: config.y,
      transparent: config.transparent,
      frame: false,
      alwaysOnTop: config.alwaysOnTop,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
      },
    })

    // 加载 Live2D 渲染页面
    const htmlPath = path.join(__dirname, '../../../renderer/live2d.html')
    await this.window.loadFile(htmlPath)

    this.currentModel = config.modelPath

    // 发送加载模型消息
    this.window.webContents.send('load-model', {
      modelPath: config.modelPath,
    })

    this.window.on('closed', () => {
      this.window = null
      this.currentModel = null
    })

    this.logger.info(`Live2D 窗口已创建: ${config.modelPath}`)
  }

  /**
   * 关闭窗口
   */
  closeWindow(): void {
    if (this.window) {
      this.window.close()
      this.window = null
      this.currentModel = null
      this.logger.info('Live2D 窗口已关闭')
    }
  }

  /**
   * 设置表情
   */
  setExpression(expressionId: string): void {
    if (!this.window) {
      throw new Error('Live2D 窗口未打开')
    }

    this.window.webContents.send('set-expression', { expressionId })
    this.logger.info(`设置表情: ${expressionId}`)
  }

  /**
   * 播放动作
   */
  playMotion(group: string, index: number, priority?: number): void {
    if (!this.window) {
      throw new Error('Live2D 窗口未打开')
    }

    this.window.webContents.send('play-motion', {
      group,
      index,
      priority: priority || 2,
    })
    this.logger.info(`播放动作: ${group}[${index}]`)
  }

  /**
   * 设置缩放
   */
  setScale(scale: number): void {
    if (!this.window) {
      throw new Error('Live2D 窗口未打开')
    }

    this.window.webContents.send('set-scale', { scale })
    this.logger.info(`设置缩放: ${scale}`)
  }

  /**
   * 设置位置偏移
   */
  setOffset(x: number, y: number): void {
    if (!this.window) {
      throw new Error('Live2D 窗口未打开')
    }

    this.window.webContents.send('set-offset', { x, y })
    this.logger.info(`设置位置: (${x}, ${y})`)
  }

  /**
   * 获取当前模型
   */
  getCurrentModel(): string | null {
    return this.currentModel
  }

  /**
   * 是否已打开
   */
  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  /**
   * 获取可用的表情列表
   */
  async getExpressions(): Promise<string[]> {
    if (!this.window) {
      throw new Error('Live2D 窗口未打开')
    }

    return new Promise((resolve) => {
      const handler = (_event: any, expressions: any) => {
        (this.window!.webContents as any).off('expressions-list', handler)
        resolve(expressions)
      }
      ;(this.window!.webContents as any).on('expressions-list', handler)
      this.window!.webContents.send('get-expressions')
    })
  }

  /**
   * 获取可用的动作组列表
   */
  async getMotionGroups(): Promise<string[]> {
    if (!this.window) {
      throw new Error('Live2D 窗口未打开')
    }

    return new Promise((resolve) => {
      const handler = (_event: any, groups: any) => {
        (this.window!.webContents as any).off('motion-groups-list', handler)
        resolve(groups)
      }
      ;(this.window!.webContents as any).on('motion-groups-list', handler)
      this.window!.webContents.send('get-motion-groups')
    })
  }
}

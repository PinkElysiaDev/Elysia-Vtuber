/**
 * 通用窗口管理器
 */

import { BrowserWindow } from 'electron'
import * as path from 'path'

export type WindowType = 'live2d' | 'display' | 'music' | 'custom'

export interface WindowOptions {
  title?: string
  width?: number
  height?: number
  url?: string
  transparent?: boolean
  frame?: boolean
  alwaysOnTop?: boolean
}

export interface ManagedWindow {
  id: string
  type: WindowType
  window: BrowserWindow
  options: WindowOptions
}

export class WindowManager {
  private windows: Map<string, ManagedWindow> = new Map()
  private nextId: number = 1

  /**
   * 创建窗口
   */
  async createWindow(type: WindowType, options: WindowOptions = {}): Promise<string> {
    const id = `window_${this.nextId++}`

    const defaultOptions: WindowOptions = {
      title: 'Vtuber Window',
      width: 800,
      height: 600,
      transparent: false,
      frame: true,
      alwaysOnTop: false,
      ...options
    }

    const browserWindow = new BrowserWindow({
      title: defaultOptions.title,
      width: defaultOptions.width,
      height: defaultOptions.height,
      transparent: defaultOptions.transparent,
      frame: defaultOptions.frame,
      alwaysOnTop: defaultOptions.alwaysOnTop,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js')
      }
    })

    // 加载内容
    if (options.url) {
      await browserWindow.loadURL(options.url)
    } else {
      // 加载默认页面
      const htmlPath = this.getDefaultHtmlPath(type)
      await browserWindow.loadFile(htmlPath)
    }

    const managedWindow: ManagedWindow = {
      id,
      type,
      window: browserWindow,
      options: defaultOptions
    }

    this.windows.set(id, managedWindow)

    // 窗口关闭时清理
    browserWindow.on('closed', () => {
      this.windows.delete(id)
    })

    return id
  }

  /**
   * 关闭窗口
   */
  async closeWindow(windowId: string): Promise<void> {
    const managed = this.windows.get(windowId)
    if (!managed) {
      throw new Error(`Window not found: ${windowId}`)
    }

    managed.window.close()
    this.windows.delete(windowId)
  }

  /**
   * 显示窗口
   */
  async showWindow(windowId: string): Promise<void> {
    const managed = this.windows.get(windowId)
    if (!managed) {
      throw new Error(`Window not found: ${windowId}`)
    }

    managed.window.show()
  }

  /**
   * 隐藏窗口
   */
  async hideWindow(windowId: string): Promise<void> {
    const managed = this.windows.get(windowId)
    if (!managed) {
      throw new Error(`Window not found: ${windowId}`)
    }

    managed.window.hide()
  }

  /**
   * 获取窗口
   */
  getWindow(windowId: string): BrowserWindow | undefined {
    return this.windows.get(windowId)?.window
  }

  /**
   * 向窗口发送消息
   */
  sendToWindow(windowId: string, channel: string, data: any): void {
    const managed = this.windows.get(windowId)
    if (managed) {
      managed.window.webContents.send(channel, data)
    }
  }

  /**
   * 广播消息到所有窗口
   */
  broadcast(channel: string, data: any): void {
    for (const managed of this.windows.values()) {
      managed.window.webContents.send(channel, data)
    }
  }

  /**
   * 获取默认 HTML 路径
   */
  private getDefaultHtmlPath(type: WindowType): string {
    const basePath = path.join(__dirname, '../renderer')

    switch (type) {
      case 'live2d':
        return path.join(basePath, 'live2d.html')
      case 'display':
        return path.join(basePath, 'display.html')
      case 'music':
        return path.join(basePath, 'music.html')
      default:
        return path.join(basePath, 'index.html')
    }
  }

  /**
   * 关闭所有窗口
   */
  closeAll(): void {
    for (const managed of this.windows.values()) {
      managed.window.close()
    }
    this.windows.clear()
  }

  /**
   * 获取所有窗口 ID
   */
  getAllWindowIds(): string[] {
    return Array.from(this.windows.keys())
  }

  /**
   * 获取指定类型的窗口
   */
  getWindowsByType(type: WindowType): ManagedWindow[] {
    return Array.from(this.windows.values()).filter(w => w.type === type)
  }
}

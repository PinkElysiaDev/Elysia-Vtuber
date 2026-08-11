import { v4 as uuid } from 'uuid'

export interface WindowConfig {
  id: string
  type: 'live2d' | 'display' | 'music'
  title: string
  width: number
  height: number
  x?: number
  y?: number
  transparent: boolean
  alwaysOnTop: boolean
  visible: boolean
}

export interface WindowInfo {
  id: string
  type: string
  title: string
  visible: boolean
}

/**
 * 窗口管理器基类
 *
 * 注意：完整实现需要 Electron，这里提供基础架构
 */
export class WindowManager {
  private windows = new Map<string, WindowConfig>()

  /**
   * 创建窗口
   */
  async createWindow(params: {
    type: 'live2d' | 'display' | 'music'
    title?: string
    width?: number
    height?: number
    x?: number
    y?: number
    transparent?: boolean
    alwaysOnTop?: boolean
  }): Promise<string> {
    const id = uuid()

    const config: WindowConfig = {
      id,
      type: params.type,
      title: params.title || `${params.type} Window`,
      width: params.width || 800,
      height: params.height || 600,
      x: params.x,
      y: params.y,
      transparent: params.transparent ?? false,
      alwaysOnTop: params.alwaysOnTop ?? false,
      visible: false,
    }

    this.windows.set(id, config)

    console.log(`Window created: ${id} (${config.type})`)

    // TODO: 实际创建 Electron 窗口
    // const win = new BrowserWindow({ ... })

    return id
  }

  /**
   * 关闭窗口
   */
  async closeWindow(windowId: string): Promise<void> {
    const config = this.windows.get(windowId)
    if (!config) {
      throw new Error(`Window not found: ${windowId}`)
    }

    this.windows.delete(windowId)
    console.log(`Window closed: ${windowId}`)

    // TODO: 关闭 Electron 窗口
  }

  /**
   * 显示窗口
   */
  async showWindow(windowId: string): Promise<void> {
    const config = this.windows.get(windowId)
    if (!config) {
      throw new Error(`Window not found: ${windowId}`)
    }

    config.visible = true
    console.log(`Window shown: ${windowId}`)

    // TODO: 显示 Electron 窗口
  }

  /**
   * 隐藏窗口
   */
  async hideWindow(windowId: string): Promise<void> {
    const config = this.windows.get(windowId)
    if (!config) {
      throw new Error(`Window not found: ${windowId}`)
    }

    config.visible = false
    console.log(`Window hidden: ${windowId}`)

    // TODO: 隐藏 Electron 窗口
  }

  /**
   * 设置窗口内容
   */
  async setWindowContent(windowId: string, content: string, type: 'html' | 'text' = 'html'): Promise<void> {
    const config = this.windows.get(windowId)
    if (!config) {
      throw new Error(`Window not found: ${windowId}`)
    }

    console.log(`Set window content: ${windowId} (${type})`)

    // TODO: 向 Electron 窗口发送内容
  }

  /**
   * 获取所有窗口
   */
  getWindows(): WindowInfo[] {
    return Array.from(this.windows.values()).map(config => ({
      id: config.id,
      type: config.type,
      title: config.title,
      visible: config.visible,
    }))
  }

  /**
   * 获取窗口配置
   */
  getWindow(windowId: string): WindowConfig | undefined {
    return this.windows.get(windowId)
  }

  /**
   * 关闭所有窗口
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.windows.keys())
    await Promise.all(ids.map(id => this.closeWindow(id)))
  }
}

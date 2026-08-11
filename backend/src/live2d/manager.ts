/**
 * Live2D 管理器
 */

import type { WindowManager } from '../window/manager'

export interface Live2DModel {
  path: string
  expressions: string[]
  motions: Record<string, number>
}

export class Live2DManager {
  private windowManager: WindowManager
  private currentModel?: Live2DModel
  private live2dWindowId?: string

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager
  }

  /**
   * 加载模型
   */
  async loadModel(modelPath: string): Promise<void> {
    // 创建 Live2D 窗口（如果不存在）
    if (!this.live2dWindowId) {
      this.live2dWindowId = await this.windowManager.createWindow('live2d', {
        title: 'Live2D',
        width: 600,
        height: 800,
        transparent: true,
        frame: false,
        alwaysOnTop: true
      })
    }

    // 向窗口发送加载模型命令
    this.windowManager.sendToWindow(this.live2dWindowId, 'live2d:load', {
      modelPath
    })

    // TODO: 解析模型配置，获取表情和动作列表
    this.currentModel = {
      path: modelPath,
      expressions: [],
      motions: {}
    }
  }

  /**
   * 设置表情
   */
  async setExpression(expression: string): Promise<void> {
    if (!this.live2dWindowId) {
      throw new Error('Live2D window not created')
    }

    this.windowManager.sendToWindow(this.live2dWindowId, 'live2d:expression', {
      expression
    })
  }

  /**
   * 播放动作
   */
  async playMotion(group: string, index: number): Promise<void> {
    if (!this.live2dWindowId) {
      throw new Error('Live2D window not created')
    }

    this.windowManager.sendToWindow(this.live2dWindowId, 'live2d:motion', {
      group,
      index
    })
  }

  /**
   * 设置缩放
   */
  async setScale(scale: number): Promise<void> {
    if (!this.live2dWindowId) {
      throw new Error('Live2D window not created')
    }

    this.windowManager.sendToWindow(this.live2dWindowId, 'live2d:scale', {
      scale
    })
  }

  /**
   * 设置位置
   */
  async setPosition(x: number, y: number): Promise<void> {
    if (!this.live2dWindowId) {
      throw new Error('Live2D window not created')
    }

    this.windowManager.sendToWindow(this.live2dWindowId, 'live2d:position', {
      x,
      y
    })
  }

  /**
   * 获取当前模型信息
   */
  getCurrentModel(): Live2DModel | undefined {
    return this.currentModel
  }

  /**
   * 关闭 Live2D 窗口
   */
  async close(): Promise<void> {
    if (this.live2dWindowId) {
      await this.windowManager.closeWindow(this.live2dWindowId)
      this.live2dWindowId = undefined
      this.currentModel = undefined
    }
  }
}

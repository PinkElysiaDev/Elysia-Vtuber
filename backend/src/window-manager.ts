import {
  WindowConfig,
  WindowModule,
  WindowCreateParams,
  WindowUpdateParams,
  WindowCloseParams,
  Live2DAction,
  TextDisplayAction,
  MusicPlayerAction,
} from './types'

/**
 * 窗口实例
 */
interface WindowInstance {
  id: string
  config: WindowConfig
  modules: Map<WindowModule, any>
  createdAt: number
}

/**
 * 通用窗口管理器
 * 管理所有窗口实例，支持动态模块组合
 */
export class WindowManager {
  private windows: Map<string, WindowInstance> = new Map()

  /**
   * 创建窗口
   */
  async createWindow(params: WindowCreateParams): Promise<{ windowId: string }> {
    const { config } = params

    // 检查窗口ID是否已存在
    if (this.windows.has(config.id)) {
      throw new Error(`Window with id ${config.id} already exists`)
    }

    // 创建窗口实例
    const instance: WindowInstance = {
      id: config.id,
      config,
      modules: new Map(),
      createdAt: Date.now(),
    }

    // 初始化模块
    for (const moduleName of config.modules) {
      const module = this.createModule(moduleName)
      instance.modules.set(moduleName, module)
    }

    this.windows.set(config.id, instance)

    console.log(`[WindowManager] Created window: ${config.id}`, {
      title: config.title,
      modules: config.modules,
      size: `${config.width}x${config.height}`,
    })

    return { windowId: config.id }
  }

  /**
   * 更新窗口模块
   */
  async updateWindow(params: WindowUpdateParams): Promise<{ success: boolean }> {
    const { windowId, module, action, data } = params

    // 检查窗口是否存在
    const window = this.windows.get(windowId)
    if (!window) {
      throw new Error(`Window not found: ${windowId}`)
    }

    // 检查模块是否存在
    const moduleInstance = window.modules.get(module)
    if (!moduleInstance) {
      throw new Error(`Module ${module} not found in window ${windowId}`)
    }

    // 执行模块动作
    await this.executeModuleAction(module, moduleInstance, action, data)

    console.log(`[WindowManager] Updated window: ${windowId}`, {
      module,
      action,
    })

    return { success: true }
  }

  /**
   * 关闭窗口
   */
  async closeWindow(params: WindowCloseParams): Promise<{ success: boolean }> {
    const { windowId } = params

    const window = this.windows.get(windowId)
    if (!window) {
      throw new Error(`Window not found: ${windowId}`)
    }

    // 清理所有模块
    for (const [moduleName, moduleInstance] of window.modules) {
      await this.cleanupModule(moduleName, moduleInstance)
    }

    this.windows.delete(windowId)

    console.log(`[WindowManager] Closed window: ${windowId}`)

    return { success: true }
  }

  /**
   * 获取所有窗口
   */
  getWindows(): Array<{ id: string; config: WindowConfig }> {
    return Array.from(this.windows.values()).map(w => ({
      id: w.id,
      config: w.config,
    }))
  }

  /**
   * 创建模块实例
   */
  private createModule(moduleName: WindowModule): any {
    switch (moduleName) {
      case 'live2d':
        return this.createLive2DModule()
      case 'textDisplay':
        return this.createTextDisplayModule()
      case 'musicPlayer':
        return this.createMusicPlayerModule()
      default:
        throw new Error(`Unknown module: ${moduleName}`)
    }
  }

  /**
   * 创建 Live2D 模块
   */
  private createLive2DModule() {
    return {
      modelPath: null,
      expression: null,
      scale: 1.0,
      position: { x: 0, y: 0 },
    }
  }

  /**
   * 创建文本展示模块
   */
  private createTextDisplayModule() {
    return {
      content: '',
      style: {},
    }
  }

  /**
   * 创建音乐播放器模块
   */
  private createMusicPlayerModule() {
    return {
      currentTrack: null,
      playing: false,
      volume: 1.0,
      position: 0,
    }
  }

  /**
   * 执行模块动作
   */
  private async executeModuleAction(
    moduleName: WindowModule,
    moduleInstance: any,
    action: string,
    data: any
  ): Promise<void> {
    switch (moduleName) {
      case 'live2d':
        await this.executeLive2DAction(moduleInstance, action, data)
        break
      case 'textDisplay':
        await this.executeTextDisplayAction(moduleInstance, action, data)
        break
      case 'musicPlayer':
        await this.executeMusicPlayerAction(moduleInstance, action, data)
        break
    }
  }

  /**
   * 执行 Live2D 动作
   */
  private async executeLive2DAction(
    module: any,
    action: string,
    data: any
  ): Promise<void> {
    switch (action) {
      case 'loadModel':
        module.modelPath = data.modelPath
        console.log(`[Live2D] Load model: ${data.modelPath}`)
        break
      case 'setExpression':
        module.expression = data.expressionId
        console.log(`[Live2D] Set expression: ${data.expressionId}`)
        break
      case 'playMotion':
        console.log(`[Live2D] Play motion: ${data.motionGroup}`)
        break
      case 'setScale':
        module.scale = data.scale
        console.log(`[Live2D] Set scale: ${data.scale}`)
        break
      case 'setPosition':
        module.position = { x: data.x, y: data.y }
        console.log(`[Live2D] Set position: (${data.x}, ${data.y})`)
        break
    }
  }

  /**
   * 执行文本展示动作
   */
  private async executeTextDisplayAction(
    module: any,
    action: string,
    data: any
  ): Promise<void> {
    switch (action) {
      case 'showText':
        module.content = data.content
        module.style = data.style || {}
        console.log(`[TextDisplay] Show text: ${data.content}`)
        break
      case 'clear':
        module.content = ''
        console.log(`[TextDisplay] Clear`)
        break
    }
  }

  /**
   * 执行音乐播放器动作
   */
  private async executeMusicPlayerAction(
    module: any,
    action: string,
    data: any
  ): Promise<void> {
    switch (action) {
      case 'play':
        module.currentTrack = {
          url: data.url,
          title: data.title,
          artist: data.artist,
          cover: data.cover,
        }
        module.playing = true
        console.log(`[MusicPlayer] Play: ${data.title || data.url}`)
        break
      case 'pause':
        module.playing = false
        console.log(`[MusicPlayer] Pause`)
        break
      case 'resume':
        module.playing = true
        console.log(`[MusicPlayer] Resume`)
        break
      case 'stop':
        module.playing = false
        module.currentTrack = null
        console.log(`[MusicPlayer] Stop`)
        break
      case 'seek':
        module.position = data.position
        console.log(`[MusicPlayer] Seek to: ${data.position}`)
        break
      case 'setVolume':
        module.volume = data.volume
        console.log(`[MusicPlayer] Set volume: ${data.volume}`)
        break
    }
  }

  /**
   * 清理模块
   */
  private async cleanupModule(moduleName: WindowModule, moduleInstance: any): Promise<void> {
    // 这里可以添加模块清理逻辑
    console.log(`[WindowManager] Cleanup module: ${moduleName}`)
  }
}

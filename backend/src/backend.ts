import { WebSocketServer } from './server/websocket'
import { WindowManager } from './modules/window-manager'
import { Live2DManager } from './modules/live2d-manager'
import { MusicPlayerManager } from './modules/music-player'
import { AudioPlayerManager } from './modules/audio-player'
import { DisplayManager } from './modules/display-manager'
import { BackendMethod } from './protocol/types'

export interface BackendConfig {
  port: number
  host?: string
}

/**
 * Vtuber 后端主应用
 */
export class VtuberBackend {
  private server: WebSocketServer
  private windowManager: WindowManager
  private live2dManager: Live2DManager
  private musicPlayer: MusicPlayerManager
  private audioPlayer: AudioPlayerManager
  private displayManager: DisplayManager

  constructor(private config: BackendConfig) {
    this.server = new WebSocketServer({
      port: config.port,
      host: config.host,
    })

    this.windowManager = new WindowManager()
    this.live2dManager = new Live2DManager()
    this.musicPlayer = new MusicPlayerManager()
    this.audioPlayer = new AudioPlayerManager()
    this.displayManager = new DisplayManager()

    this.registerHandlers()
  }

  /**
   * 注册所有 RPC 方法处理器
   */
  private registerHandlers(): void {
    const rpc = this.server.getRpcHandler()

    // Live2D 方法
    rpc.register(BackendMethod.LIVE2D_LOAD_MODEL, (params) =>
      this.live2dManager.loadModel(params)
    )
    rpc.register(BackendMethod.LIVE2D_SET_EXPRESSION, (params) =>
      this.live2dManager.setExpression(params.expression)
    )
    rpc.register(BackendMethod.LIVE2D_SET_MOTION, (params) =>
      this.live2dManager.setMotion(params)
    )
    rpc.register(BackendMethod.LIVE2D_SET_SCALE, (params) =>
      this.live2dManager.setScale(params.scale)
    )
    rpc.register(BackendMethod.LIVE2D_SET_POSITION, (params) =>
      this.live2dManager.setPosition(params.x, params.y)
    )
    rpc.register(BackendMethod.LIVE2D_GET_STATE, () =>
      this.live2dManager.getState()
    )

    // 点歌机方法
    rpc.register(BackendMethod.MUSIC_SEARCH, (params) =>
      this.musicPlayer.search(params)
    )
    rpc.register(BackendMethod.MUSIC_ADD, (params) =>
      this.musicPlayer.addSong(params)
    )
    rpc.register(BackendMethod.MUSIC_PLAY, () =>
      this.musicPlayer.play()
    )
    rpc.register(BackendMethod.MUSIC_PAUSE, () =>
      this.musicPlayer.pause()
    )
    rpc.register(BackendMethod.MUSIC_SKIP, () =>
      this.musicPlayer.skip()
    )
    rpc.register(BackendMethod.MUSIC_GET_QUEUE, () =>
      this.musicPlayer.getQueue()
    )
    rpc.register(BackendMethod.MUSIC_GET_CURRENT, () =>
      this.musicPlayer.getCurrentSong()
    )
    rpc.register(BackendMethod.MUSIC_REMOVE, (params) =>
      this.musicPlayer.removeSong(params.index)
    )
    rpc.register(BackendMethod.MUSIC_CLEAR, () =>
      this.musicPlayer.clearQueue()
    )

    // 窗口管理方法
    rpc.register(BackendMethod.WINDOW_CREATE, (params) =>
      this.windowManager.createWindow(params)
    )
    rpc.register(BackendMethod.WINDOW_CLOSE, (params) =>
      this.windowManager.closeWindow(params.windowId)
    )
    rpc.register(BackendMethod.WINDOW_SHOW, (params) =>
      this.windowManager.showWindow(params.windowId)
    )
    rpc.register(BackendMethod.WINDOW_HIDE, (params) =>
      this.windowManager.hideWindow(params.windowId)
    )
    rpc.register(BackendMethod.WINDOW_SET_CONTENT, (params) =>
      this.windowManager.setWindowContent(params.windowId, params.content, params.type)
    )

    // 展示板方法
    rpc.register(BackendMethod.DISPLAY_SHOW_TEXT, (params) =>
      this.displayManager.showText(params)
    )
    rpc.register(BackendMethod.DISPLAY_SHOW_HTML, (params) =>
      this.displayManager.showHTML(params)
    )
    rpc.register(BackendMethod.DISPLAY_CLEAR, () =>
      this.displayManager.clear()
    )

    // 音频播放方法
    rpc.register(BackendMethod.AUDIO_PLAY, (params) =>
      this.audioPlayer.play(params.url, params.volume)
    )
    rpc.register(BackendMethod.AUDIO_STOP, () =>
      this.audioPlayer.stop()
    )
    rpc.register(BackendMethod.AUDIO_SET_VOLUME, (params) =>
      this.audioPlayer.setVolume(params.volume)
    )
    rpc.register(BackendMethod.AUDIO_GET_STATE, () =>
      this.audioPlayer.getState()
    )

    // 系统方法
    rpc.register(BackendMethod.SYSTEM_GET_INFO, () => ({
      version: '0.0.1',
      modules: {
        live2d: this.live2dManager.getState().modelLoaded,
        music: this.musicPlayer.getState().playing,
        audio: this.audioPlayer.getState().playing,
        windows: this.windowManager.getWindows().length,
      },
    }))
    rpc.register(BackendMethod.SYSTEM_PING, () => ({ pong: Date.now() }))
  }

  /**
   * 启动后端
   */
  async start(): Promise<void> {
    console.log('Starting Vtuber Backend...')
    await this.server.start()
    console.log('Vtuber Backend started successfully')
  }

  /**
   * 停止后端
   */
  async stop(): Promise<void> {
    console.log('Stopping Vtuber Backend...')

    await this.windowManager.closeAll()
    await this.musicPlayer.stop()
    await this.audioPlayer.stop()
    await this.live2dManager.unloadModel()
    await this.server.stop()

    console.log('Vtuber Backend stopped')
  }

  /**
   * 获取服务器实例
   */
  getServer(): WebSocketServer {
    return this.server
  }
}

/**
 * 创建并启动后端
 */
export async function createBackend(config: BackendConfig): Promise<VtuberBackend> {
  const backend = new VtuberBackend(config)
  await backend.start()
  return backend
}

/**
 * Electron 主进程入口
 */

import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { BackendServer } from './server'
import { WindowManager } from './window/manager'
import { Live2DManager } from './live2d/manager'
import { MusicPlayerManager } from './music/manager'
import { loadConfig } from './config'

let server: BackendServer
let mainWindow: BrowserWindow | null = null

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.js')
    },
    icon: path.join(__dirname, '../icon.png')
  })

  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function initialize() {
  console.log('Vtuber Backend 启动中...')

  // 加载配置
  const config = await loadConfig()

  // 创建窗口管理器
  const windowManager = new WindowManager()

  // 创建 Live2D 管理器
  const live2dManager = new Live2DManager(windowManager)

  // 创建点歌机管理器
  const musicPlayerManager = new MusicPlayerManager(windowManager, config.music)

  // 创建服务器
  server = new BackendServer(config.server, {
    windowManager,
    live2dManager,
    musicPlayerManager
  })

  // 启动服务器
  await server.start()

  console.log(`Vtuber Backend 已启动`)
  console.log(`JSON-RPC 服务: ws://${config.server.host}:${config.server.port}`)

  // 创建主窗口
  await createMainWindow()
}

// Electron 应用就绪
app.whenReady().then(() => {
  initialize().catch(error => {
    console.error('启动失败:', error)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

// 所有窗口关闭
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理
app.on('before-quit', async () => {
  if (server) {
    await server.stop()
  }
})

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason)
})

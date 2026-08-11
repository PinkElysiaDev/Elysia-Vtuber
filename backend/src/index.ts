/**
 * Vtuber Backend - 独立后端入口
 */

import { BackendServer } from './server'
import { WindowManager } from './window/manager'
import { Live2DManager } from './live2d/manager'
import { MusicPlayerManager } from './music/manager'
import { loadConfig } from './config'

async function main() {
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
  const server = new BackendServer(config.server, {
    windowManager,
    live2dManager,
    musicPlayerManager
  })

  // 启动服务器
  await server.start()

  console.log(`Vtuber Backend 已启动`)
  console.log(`JSON-RPC 服务: ws://${config.server.host}:${config.server.port}`)

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('\n正在关闭 Vtuber Backend...')
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n正在关闭 Vtuber Backend...')
    await server.stop()
    process.exit(0)
  })
}

main().catch(error => {
  console.error('启动失败:', error)
  process.exit(1)
})

import { Context, Logger } from 'koishi'
import { Config } from './config'
import { BackendClient } from './backend-client'
import { EventBridge } from './event-bridge'
import { BackendProcessManager } from './backend-process'

export const name = 'vtuber'

export { Config }

// lib/index.js 运行时 require('../package.json') 解析到插件包根，避免版本号双份维护
const packageInfo = require('../package.json') as { version: string }

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('vtuber')

  const backend = new BackendClient(
    config.backend.host,
    config.backend.wsPort,
    config.backend.reconnectInterval,
    config.backend.timeout,
    logger,
  )

  const processManager = new BackendProcessManager(config.backend, logger)

  const bridge = new EventBridge(ctx, config, backend, logger)
  bridge.start()

  backend.on('danmaku.send', async (_method, params) => {
    const roomId = params?.roomId || config.roomId
    const text = String(params?.text || '')
    if (!text) return

    const platform = config.danmaku.platform
    const bot: any = ctx.bots.find((item) => item.platform === platform)
    if (!bot) {
      logger.warn(`no ${platform} bot available`)
      backend.notify('danmaku.sent', {
        roomId,
        text,
        ok: false,
        error: `no ${platform} bot available`,
      })
      return
    }

    try {
      if (typeof bot.sendDanmaku === 'function') {
        await bot.sendDanmaku(text)
      } else {
        await bot.sendMessage(`${platform}:${roomId}`, text)
      }
      backend.notify('danmaku.sent', { roomId, text, ok: true })
    } catch (error) {
      backend.notify('danmaku.sent', {
        roomId,
        text,
        ok: false,
        error: String(error),
      })
    }
  })

  void (async () => {
    if (config.backend.autoStart) {
      await processManager.start().catch((error) => {
        logger.error('backend auto-start failed:', error)
      })
    }
    await backend.connect().catch((error) => {
      logger.error('backend connection failed:', error)
    })
    if (backend.isConnected()) {
      backend.notify('koishi.ready', {
        roomId: config.roomId,
        pluginVersion: packageInfo.version,
      })
    }
  })()

  /**
   * 优雅停机并等端口释放：经 WS 请求 system.shutdown（对非本插件拉起的外部进程同样有效，
   * 后端会先通知 C++ 执行器退出再自行退出），轮询至多 10s；返回端口是否已释放。
   */
  const gracefulShutdownAndDrain = async (): Promise<boolean> => {
    if (backend.isConnected()) {
      await backend.request('system.shutdown').catch(() => {})
    }
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && await processManager.isPortOpen()) {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return !(await processManager.isPortOpen())
  }

  ctx.command('vtuber.status', '查看逻辑服务状态')
    .action(async () => formatResult(await backend.request('system.status')))

  ctx.command('vtuber.start', '启动逻辑服务')
    .action(async () => {
      const ok = await processManager.start()
      if (ok && !backend.isConnected()) await backend.connect().catch(() => {})
      return ok ? '逻辑服务已启动' : '逻辑服务启动失败'
    })

  ctx.command('vtuber.stop', '停止逻辑服务')
    .action(async () => {
      // 优雅退出（含通知 C++ 执行器退出），避免硬杀把执行器/后端变成孤儿进程
      await gracefulShutdownAndDrain()
      backend.disconnect()
      processManager.stop()
      return '已停止逻辑服务'
    })

  ctx.command('vtuber.restart', '重启逻辑服务')
    .action(async () => {
      // 先经 RPC 优雅关闭旧实例——对外部启动的进程同样有效，不要求由本插件拉起
      const drained = await gracefulShutdownAndDrain()
      backend.disconnect()
      processManager.stop()
      if (!drained) {
        logger.error(
          `restart aborted: ${config.backend.host}:${config.backend.wsPort} 仍被占用且无法经 RPC 关闭。` +
          `请手动结束：netstat -ano | findstr :${config.backend.wsPort} 查 PID，再 taskkill /PID <PID> /F`,
        )
        return '逻辑服务重启失败：旧进程未能退出，处理指引见 Koishi 控制台日志'
      }
      const ok = await processManager.start()
      if (ok && !backend.isConnected()) await backend.connect().catch(() => {})
      if (backend.isConnected()) {
        backend.notify('koishi.ready', {
          roomId: config.roomId,
          pluginVersion: packageInfo.version,
        })
      }
      return ok ? '逻辑服务已重启' : '逻辑服务启动失败'
    })

  ctx.command('vtuber.jukebox status', '查看点歌机状态')
    .action(async () => formatResult(await backend.request('jukebox.getState')))

  ctx.command('vtuber.jukebox start', '启动点歌机')
    .action(async () => formatResult(await backend.request('jukebox.start')))

  ctx.command('vtuber.jukebox stop', '停止点歌机')
    .action(async () => formatResult(await backend.request('jukebox.stop')))

  ctx.command('vtuber.jukebox restart', '重启点歌机')
    .action(async () => formatResult(await backend.request('jukebox.restart', { preserveQueue: true })))

  ctx.command('vtuber.jukebox volume <value:text>', '设置或调整点歌机音量')
    .action(async (_argv, value: string) => {
      const num = Number(value)
      // NaN 会被后端 clamp 成 0（静音），必须先挡下
      if (!Number.isFinite(num)) return `无效的音量值：${value}`
      if (value.startsWith('+') || value.startsWith('-')) {
        return formatResult(await backend.request('jukebox.adjustVolume', { delta: num }))
      }
      return formatResult(await backend.request('jukebox.setVolume', { volume: num }))
    })

  ctx.command('vtuber.jukebox mute', '静音点歌机')
    .action(async () => formatResult(await backend.request('jukebox.mute')))

  ctx.command('vtuber.jukebox unmute', '取消静音')
    .action(async () => formatResult(await backend.request('jukebox.unmute')))

  ctx.command('vtuber.jukebox queue', '查看点歌队列')
    .action(async () => formatResult(await backend.request('jukebox.getQueue')))

  ctx.command('vtuber.jukebox now', '查看当前播放')
    .action(async () => formatResult(await backend.request('jukebox.getNowPlaying')))

  ctx.command('vtuber.jukebox skip', '切歌')
    .action(async () => formatResult(await backend.request('jukebox.skip')))

  ctx.on('dispose', () => {
    backend.disconnect()
  })
}

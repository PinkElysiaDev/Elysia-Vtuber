import { Context, Logger } from 'koishi'
import { Config } from './config'
import { BackendClient } from './backend-client'
import { EventBridge } from './event-bridge'
import { BackendProcessManager } from './backend-process'

export const name = 'vtuber'

export { Config }

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

  const bridge = new EventBridge(ctx, config, backend)
  bridge.start()

  backend.on('danmaku.send', async (_method, params) => {
    const roomId = params?.roomId || config.roomId
    const text = String(params?.text || '')
    if (!text) return

    const bot: any = ctx.bots.find((item) => item.platform === 'bililive')
    if (!bot) {
      logger.warn('no bililive bot available')
      backend.notify('danmaku.sent', {
        roomId,
        text,
        ok: false,
        error: 'no bililive bot available',
      })
      return
    }

    try {
      if (typeof bot.sendDanmaku === 'function') {
        await bot.sendDanmaku(text)
      } else {
        await bot.sendMessage(`bililive:${roomId}`, text)
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
        pluginVersion: '0.2.0',
      })
    }
  })()

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
      if (backend.isConnected()) {
        await backend.request('system.shutdown').catch(() => {})
      }
      processManager.stop()
      return '已请求停止逻辑服务'
    })

  ctx.command('vtuber.restart', '重启逻辑服务')
    .action(async () => {
      backend.disconnect()
      const ok = await processManager.restart()
      if (ok) await backend.connect().catch(() => {})
      return ok ? '逻辑服务已重启' : '逻辑服务重启失败'
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
      if (value.startsWith('+') || value.startsWith('-')) {
        return formatResult(await backend.request('jukebox.adjustVolume', { delta: Number(value) }))
      }
      return formatResult(await backend.request('jukebox.setVolume', { volume: Number(value) }))
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

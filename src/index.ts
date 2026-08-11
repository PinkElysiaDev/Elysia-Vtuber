/**
 * Koishi Vtuber 插件入口
 */

import { Context, Logger } from 'koishi'
import { Config } from './config'
import { EventReceiver } from './event-receiver'
import { EventCache } from './event-cache'
import { TriggerSystem } from './trigger'
import { LLMRequestManager } from './llm/manager'
import { TTSManager } from './tts/manager'
import { OutputHandler } from './output/handler'
import { BackendClient } from './backend/client'
import { registerAllTools } from './llm/tools'

export const name = 'vtuber'
export const inject = ['bililive']

export { Config }

// 声明自定义事件
declare module 'koishi' {
  interface Events {
    'vtuber/display'(data: { text: string; displayStyle: string; emotion?: string; timestamp: number }): void
    'vtuber/tts-audio'(data: { audio: Buffer; duration: number; timestamp: number }): void
    'vtuber/llm-stream-chunk'(data: { chunk: string; finished: boolean }): void
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('vtuber')

  logger.info('Koishi Vtuber 插件启动中...')

  // 创建后端客户端
  let backendClient: BackendClient | undefined
  if (config.backend?.enabled) {
    backendClient = new BackendClient({
      host: config.backend.host || 'localhost',
      port: config.backend.port || 19264,
      reconnectInterval: config.backend.reconnectInterval || 5000,
      timeout: config.backend.timeout || 30000
    }, logger)

    // 连接到后端
    backendClient.connect().catch(error => {
      logger.error('连接后端失败:', error)
      logger.warn('将在后台自动重连')
    })

    logger.info('后端客户端已初始化')
  }

  // 创建事件缓存
  const eventCache = new EventCache(config.roomId, config.eventReceiver.historySize)

  // 创建 TTS 管理器
  let ttsManager: TTSManager | undefined
  if (config.output.enableTTS) {
    ttsManager = new TTSManager(ctx, config.tts)
    logger.info('TTS 系统已初始化')
  }

  // 创建输出处理器
  const outputHandler = new OutputHandler(ctx, config.output, ttsManager, backendClient)

  // 创建 LLM 请求管理器
  const llmManager = new LLMRequestManager(ctx, config.llm, eventCache)
  logger.info('LLM 系统已初始化')

  // 注册工具
  if (config.llm.enableTools) {
    const tools = registerAllTools(ctx, backendClient)
    tools.forEach(tool => llmManager.registerTool(tool))
    logger.info(`已注册 ${tools.length} 个工具`)
  }

  // 创建触发器系统
  const triggerSystem = new TriggerSystem(ctx, config.triggers)

  // 创建事件接收器
  const eventReceiver = new EventReceiver(
    ctx,
    config.roomId,
    config.eventReceiver,
    eventCache
  )

  // 连接事件流：EventReceiver -> TriggerSystem
  eventReceiver.addListener((event) => {
    logger.debug('收到事件', event.type, event.user?.name)
    triggerSystem.handleEvent(event)
  })

  // 监听触发器触发 -> 调用 LLM -> 处理输出
  triggerSystem.addListener(async (triggerContext) => {
    logger.info(
      `触发器触发: 事件数 ${triggerContext.events.length}, ` +
      `主事件类型 ${triggerContext.primaryEvent?.type}`
    )

    try {
      // 使用房间 ID 作为会话 ID
      const sessionId = config.roomId

      // 请求 LLM
      const response = await llmManager.request(
        sessionId,
        triggerContext.primaryEvent,
        false // TODO: 支持配置是否启用流式
      )

      logger.info(`LLM 响应: ${response.content.substring(0, 100)}...`)

      // 处理输出
      await outputHandler.handleReply(response.content, config.roomId)

    } catch (error) {
      logger.error('处理触发器失败:', error)
    }
  })

  // 启动事件接收
  eventReceiver.start()

  logger.success('Koishi Vtuber 插件启动完成')
  logger.info(`正在监听直播间: ${config.roomId}`)

  // 定期清理过期会话
  const cleanupInterval = setInterval(() => {
    llmManager.cleanupExpiredSessions()
  }, 3600000) // 每小时清理一次

  // 插件卸载时的清理
  ctx.on('dispose', () => {
    logger.info('Koishi Vtuber 插件停止中...')
    clearInterval(cleanupInterval)
    triggerSystem.dispose()
    eventCache.clear()
    if (backendClient) {
      backendClient.disconnect()
    }
  })

  // 注册调试命令
  ctx.command('vtuber', 'Vtuber 插件管理')
    .action(() => {
      return 'Koishi Vtuber 插件运行中'
    })

  ctx.command('vtuber.status', '查看插件状态')
    .action(() => {
      const state = eventCache.getState()
      const sessionStats = llmManager.getSessionStats(config.roomId)
      return [
        `直播间: ${state.roomId}`,
        `直播状态: ${state.isLive ? '直播中' : '未开播'}`,
        `在线人数: ${state.online}`,
        `点赞数: ${state.likes}`,
        `弹幕历史: ${state.danmakuHistory.length}条`,
        `礼物历史: ${state.giftHistory.length}条`,
        `SC历史: ${state.superChatHistory.length}条`,
        sessionStats ? `会话消息: ${sessionStats.messageCount}条` : '',
        sessionStats ? `预估Token: ${sessionStats.estimatedTokens}` : ''
      ].filter(Boolean).join('\n')
    })

  ctx.command('vtuber.clear', '清空事件缓存')
    .action(() => {
      eventCache.clear()
      return '事件缓存已清空'
    })

  ctx.command('vtuber.clear-session', '清空会话历史')
    .action(() => {
      llmManager.clearSession(config.roomId)
      return '会话历史已清空'
    })

  ctx.command('vtuber.test-llm', '测试 LLM 连接')
    .action(async () => {
      try {
        const result = await llmManager.testConnection()
        return result ? 'LLM 连接正常' : 'LLM 连接失败'
      } catch (error) {
        return `LLM 连接错误: ${error.message}`
      }
    })

  ctx.command('vtuber.test-tts <text:text>', '测试 TTS')
    .action(async (_, text) => {
      if (!ttsManager) {
        return 'TTS 未启用'
      }
      try {
        await outputHandler.handleReply(text, config.roomId)
        return 'TTS 测试完成'
      } catch (error) {
        return `TTS 测试失败: ${error.message}`
      }
    })

  ctx.command('vtuber.backend-status', '查看后端状态')
    .action(() => {
      if (!backendClient) {
        return '后端未启用'
      }
      return backendClient.isConnected() ? '后端已连接' : '后端未连接'
    })

  ctx.command('vtuber.test-backend', '测试后端连接')
    .action(async () => {
      if (!backendClient) {
        return '后端未启用'
      }
      try {
        await backendClient.displayText('测试消息', 'plain', 'neutral')
        return '后端测试成功'
      } catch (error) {
        return `后端测试失败: ${error.message}`
      }
    })
}

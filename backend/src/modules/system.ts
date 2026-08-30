/**
 * 系统模块：状态查询 / 信息 / 关闭
 */

import type { RpcHandler } from '../core/rpc'
import type { CppClient } from '../cpp/client'

export interface SystemModuleDeps {
  version: string
  getRoomId: () => string
  audioCpp: CppClient
  live2dCpp: CppClient
  getEventCount: () => number
  getFilteredCount?: () => number
  getLastEventAt?: () => number
  getTriggerCount?: () => number
  hasLlmKey?: () => boolean
  getJukebox?: () => { running: boolean; playing: boolean; volume: number }
  getTts?: () => { speaking: boolean; queued: number; configured: boolean }
  /** 优雅关闭回调：先释放资源（含通知 C++ 执行器退出）再退出进程 */
  shutdown?: () => Promise<void> | void
}

export function buildSystemModule(deps: SystemModuleDeps): Record<string, RpcHandler> {
  return {
    'system.status': () => ({
      version: deps.version,
      roomId: deps.getRoomId(),
      eventCount: deps.getEventCount(),
      filteredCount: deps.getFilteredCount?.() ?? 0,
      lastEventAt: deps.getLastEventAt?.() ?? 0,
      // 兼容旧 WebUI 徽章：cpp 字段仍可用（取音频执行器状态）
      cpp: {
        status: deps.audioCpp.getStatus(),
        connected: deps.audioCpp.isConnected(),
      },
      // 新增：两个执行器的独立状态
      audio: {
        status: deps.audioCpp.getStatus(),
        connected: deps.audioCpp.isConnected(),
      },
      live2d: {
        status: deps.live2dCpp.getStatus(),
        connected: deps.live2dCpp.isConnected(),
      },
      triggers: deps.getTriggerCount?.() ?? 0,
      llmConfigured: deps.hasLlmKey?.() ?? false,
      jukebox: deps.getJukebox?.() ?? null,
      tts: deps.getTts?.() ?? null,
      uptime: process.uptime(),
    }),

    'system.info': () => ({
      version: deps.version,
      platform: 'node-service',
      roomId: deps.getRoomId(),
      node: process.version,
      audioCppStatus: deps.audioCpp.getStatus(),
      live2dCppStatus: deps.live2dCpp.getStatus(),
    }),

    'system.shutdown': () => {
      // 延迟关闭，让响应先送达；优先走优雅路径（含 cpp.dispose 通知
      // 执行器退出），避免硬 exit 把执行器孤儿化
      setTimeout(() => {
        if (deps.shutdown) {
          Promise.resolve(deps.shutdown())
            .catch(() => {})
            .then(() => process.exit(0))
        } else {
          process.exit(0)
        }
      }, 100)
      return { success: true, message: 'shutdown requested' }
    },
  }
}

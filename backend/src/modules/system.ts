/**
 * 系统模块：状态查询 / 信息 / 关闭
 */

import type { RpcHandler } from '../core/rpc'
import type { CppClient } from '../cpp/client'

export interface SystemModuleDeps {
  version: string
  getRoomId: () => string
  cpp: CppClient
  getEventCount: () => number
  getTriggerCount?: () => number
  hasLlmKey?: () => boolean
  getJukebox?: () => { running: boolean; playing: boolean; volume: number }
  getTts?: () => { speaking: boolean; queued: number; configured: boolean }
}

export function buildSystemModule(deps: SystemModuleDeps): Record<string, RpcHandler> {
  return {
    'system.status': () => ({
      version: deps.version,
      roomId: deps.getRoomId(),
      eventCount: deps.getEventCount(),
      cpp: {
        status: deps.cpp.getStatus(),
        connected: deps.cpp.isConnected(),
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
      cppStatus: deps.cpp.getStatus(),
    }),

    'system.shutdown': () => {
      // 延迟关闭，让响应先送达
      setTimeout(() => process.exit(0), 100)
      return { success: true, message: 'shutdown requested' }
    },
  }
}

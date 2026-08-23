import type { RpcHandler } from '../core/rpc'
import { objectSchema, ToolRegistry } from '../core/tools'
import type { OutputRouter } from './output'
import { normalizeSegments } from './output'
import type { TriggerEngine } from './triggers'
import type { LLMSession } from '../llm/session'
import type { StandardEvent } from './events'
import type { CppClient } from '../cpp/client'
import type { Jukebox } from '../music/jukebox'

export interface ToolModuleDeps {
  tools: ToolRegistry
  output: OutputRouter
  triggers: TriggerEngine
  session: LLMSession
  /** Live2D 执行器（仅 registerBuiltinTools 使用 live2d.* 方法） */
  cpp?: CppClient
  jukebox: Jukebox
  getRoomId: () => string
  /** 工具加载开关（name → false 禁用）；省略时视为全部启用 */
  getToolGate?: () => Record<string, boolean>
}

/** 注册表驱动的 live2d 表情/换装/动作工具；注册表变更时先 unregister 再调用本函数 */
export const LIVE2D_DYNAMIC_TOOLS = ['live2d_expression', 'live2d_costume', 'live2d_motion'] as const

export interface Live2DToolDeps {
  tools: ToolRegistry
  cpp: CppClient
  getRegistration: () => import('../config').Live2DAssetRegistration
}

export function registerLive2dTools(deps: Live2DToolDeps): void {
  const { tools, cpp, getRegistration } = deps
  const reg = getRegistration()

  const enabledExpressions = Object.entries(reg.expressions ?? {})
    .filter(([, v]) => v && v.enabled)
    .map(([name]) => name)
  const costumes = Object.entries(reg.costumes ?? {})
    .filter(([, v]) => v && v.enabled)
    .map(([name]) => name)
  const enabledMotions = Object.entries(reg.motions ?? {})
    .filter(([, v]) => v && v.enabled)
    .map(([ref]) => ref)

  // 无注册项时仍保留工具但描述说明为空，模型不会误调用
  tools.register({
    name: 'live2d_expression',
    description: enabledExpressions.length
      ? `切换 Live2D 表情。可用：${enabledExpressions.join(' / ')}；空字符串重置。`
      : '切换 Live2D 表情（当前没有已注册的表情，返回错误说明）。',
    parameters: objectSchema({
      name: { type: 'string', description: enabledExpressions.length ? `表情名，可选：${enabledExpressions.join(' / ')}；空则重置` : '表情名（当前无已注册表情）' },
    }, ['name']),
    handler: async (args) => {
      const name = String(args.name ?? '')
      if (name && !enabledExpressions.includes(name)) {
        return { success: false, error: `表情未注册: ${name}`, available: enabledExpressions }
      }
      return cppCall(cpp, 'live2d.expression', { name })
    },
  })

  // 换装 = Cubism 表情（引擎为替换制：换装会替换当前表情）
  tools.register({
    name: 'live2d_costume',
    description: costumes.length
      ? `切换 Live2D 换装（本质是表情，会替换当前表情）。可用：${costumes.join(' / ')}。恢复默认用 live2d_expression 传空串。`
      : '切换 Live2D 换装（当前没有已注册的换装）。',
    parameters: objectSchema({
      name: { type: 'string', description: costumes.length ? `换装名，可选：${costumes.join(' / ')}` : '换装名（当前无已注册换装）' },
    }, ['name']),
    handler: async (args) => {
      const name = String(args.name ?? '')
      if (!name || !costumes.includes(name)) {
        return { success: false, error: `换装未注册: ${name}`, available: costumes }
      }
      return cppCall(cpp, 'live2d.expression', { name })
    },
  })

  tools.register({
    name: 'live2d_motion',
    description: enabledMotions.length
      ? `播放 Live2D 动作。可用（"组#序号" 为声明动作，其余为命名动作）：${enabledMotions.join(' / ')}。`
      : '播放 Live2D 动作（当前没有已注册的动作）。',
    parameters: objectSchema({
      motion: { type: 'string', description: enabledMotions.length ? `动作引用，可选：${enabledMotions.join(' / ')}` : '动作引用（当前无已注册动作）' },
    }, ['motion']),
    handler: async (args) => {
      const ref = String(args.motion ?? args.name ?? '')
      if (!ref || !enabledMotions.includes(ref)) {
        return { success: false, error: `动作未注册: ${ref}`, available: enabledMotions }
      }
      if (ref.includes('#')) {
        const [group, idx] = ref.split('#')
        return cppCall(cpp, 'live2d.motion', { group, index: Number(idx) })
      }
      return cppCall(cpp, 'live2d.motion', { name: ref })
    },
  })
}

export function registerBuiltinTools(deps: ToolModuleDeps): void {
  const { tools, output, jukebox } = deps
  const cpp = deps.cpp!  // 仅 live2d 工具使用；调用方（index.ts）始终传入 live2dCpp

  tools.register({
    name: 'send_reply',
    description: '向直播间输出回复。segments.method 只能是 danmaku / display / tts。',
    parameters: objectSchema({
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['danmaku', 'display', 'tts'] },
            text: { type: 'string' },
            displayStyle: { type: 'string' },
            emotion: { type: 'string' },
          },
          required: ['method', 'text'],
        },
      },
    }, ['segments']),
    handler: async (args) => {
      const segments = normalizeSegments(args.segments)
      const result = await output.route(segments)
      return { success: true, ...result }
    },
  })

  tools.register({
    name: 'live2d_transform',
    description: '调整 Live2D 缩放和位移。scale 默认 1，x/y 为相对平移。',
    parameters: objectSchema({
      scale: { type: 'number', description: '缩放，>0' },
      x: { type: 'number', description: '水平位移' },
      y: { type: 'number', description: '垂直位移' },
    }),
    handler: async (args) => cppCall(cpp, 'live2d.transform', {
      scale: Number(args.scale ?? 1),
      x: Number(args.x ?? 0),
      y: Number(args.y ?? 0),
    }),
  })

  tools.register({
    name: 'live2d_status',
    description: '查询当前 Live2D 模型、可用表情和动作组',
    parameters: objectSchema(),
    handler: async () => cppCall(cpp, 'live2d.status', {}),
  })

  const musicSources = jukebox.sources()
  const sourceSchema = {
    type: 'string' as const,
    enum: musicSources,
    description: '检索渠道，不填用默认渠道。netease / qq 需扫码登录后可用',
  }
  tools.register({
    name: 'jukebox_search_song',
    description: '搜索歌曲，可用 source 指定渠道：' + musicSources.join(' / ') + '（netease、qq 需扫码登录）',
    parameters: objectSchema(
      { keyword: { type: 'string' }, source: sourceSchema },
      ['keyword'],
    ),
    handler: async (args) => jukebox.search(String(args.keyword ?? ''), args.source ? String(args.source) : undefined),
  })
  tools.register({
    name: 'jukebox_add_song',
    description: '把歌曲加入播放队列。可给 songId+source，或 keyword 搜索后加入第一首；source 可指定渠道让模型选源。',
    parameters: objectSchema({
      songId: { type: 'string' },
      source: sourceSchema,
      keyword: { type: 'string' },
      title: { type: 'string' },
      userId: { type: 'string' },
      userName: { type: 'string' },
    }),
    handler: async (args) => jukebox.add({
      songId: args.songId ? String(args.songId) : undefined,
      source: args.source ? String(args.source) : undefined,
      keyword: args.keyword ? String(args.keyword) : undefined,
      title: args.title ? String(args.title) : undefined,
      userId: args.userId ? String(args.userId) : undefined,
      userName: args.userName ? String(args.userName) : undefined,
    }),
  })
  tools.register({
    name: 'jukebox_skip_song',
    description: '切到下一首',
    parameters: objectSchema(),
    handler: async () => jukebox.skip(),
  })
  tools.register({
    name: 'jukebox_get_queue',
    description: '查看点歌队列',
    parameters: objectSchema(),
    handler: async () => ({ queue: jukebox.getState().queue }),
  })
  tools.register({
    name: 'jukebox_get_current_song',
    description: '查看正在播放的歌',
    parameters: objectSchema(),
    handler: async () => ({ nowPlaying: jukebox.getState().nowPlaying }),
  })
}

export function buildRuntimeModule(deps: ToolModuleDeps): Record<string, RpcHandler> {
  return {
    'trigger.list': () => deps.triggers.getRules(),
    'trigger.pending': () => deps.triggers.pending(),
    'trigger.fire': async (params) => {
      const id = String((params as any)?.id ?? '')
      if (!id) throw new Error('trigger.fire requires { id }')
      const events = Array.isArray((params as any)?.events) ? (params as any).events as StandardEvent[] : []
      const ok = deps.triggers.fireById(id, events)
      if (!ok) throw new Error(`trigger not found: ${id}`)
      return { ok: true, id }
    },
    'llm.chat': async (params) => {
      const rec = (params as any) ?? {}
      if (Array.isArray(rec.messages)) {
        return deps.session.chat(rec.messages, rec.useTools !== false)
      }
      const events = Array.isArray(rec.events) ? rec.events as StandardEvent[] : []
      return deps.session.run(events, rec.prompt)
    },
    'llm.playground': async (params) => {
      const rec = (params as any) ?? {}
      const prompt = String(rec.prompt || '你好，向大家做个自我介绍吧！')
      const systemPrompt = rec.systemPrompt ? String(rec.systemPrompt) : undefined
      const events = Array.isArray(rec.events) ? rec.events as StandardEvent[] : []
      const useTools = rec.useTools !== false

      const ctx = {
        events,
        history: [],
        roomId: deps.getRoomId(),
      }

      const rawSystem = systemPrompt || '你是直播间的 AI VTuber。根据事件用工具互动。'
      const system = rawSystem.replace(/\{\{roomId\}\}/g, ctx.roomId)

      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: prompt },
      ]

      const start = Date.now()
      const result = await deps.session.chat(messages, useTools)
      const durationMs = Date.now() - start

      return {
        ok: true,
        prompt,
        result,
        durationMs,
      }
    },
    'llm.tools': () => {
      const gate = deps.getToolGate?.() ?? {}
      return { tools: deps.tools.list().map((t) => ({ ...t, enabled: gate[t.name] !== false })) }
    },
    'tool.call': async (params) => {
      const rec = (params as any) ?? {}
      const name = String(rec.name ?? rec.tool ?? '')
      if (!name) throw new Error('tool.call requires { name }')
      return deps.tools.call(name, rec.args ?? rec.arguments ?? {})
    },
    'output.route': async (params) => {
      const rec = (params as any) ?? {}
      if (Array.isArray(rec.segments)) {
        return deps.output.route(normalizeSegments(rec.segments))
      }
      return deps.output.routeContent(String(rec.content ?? rec.text ?? ''))
    },
  }
}

async function cppCall(cpp: CppClient, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (!cpp.isConnected()) {
    return { success: false, error: 'C++ 执行器未连接' }
  }
  try {
    return await cpp.request(method, args)
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

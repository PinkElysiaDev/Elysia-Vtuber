import type { RpcHandler } from '../core/rpc'
import { objectSchema, ToolRegistry } from '../core/tools'
import type { OutputRouter, ReplySegment } from './output'
import { parseReplyContent } from './output'
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
  cpp: CppClient
  jukebox: Jukebox
  getRoomId: () => string
}

export function registerBuiltinTools(deps: ToolModuleDeps): void {
  const { tools, output, cpp, jukebox } = deps

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
    name: 'live2d_expression',
    description: '切换 Live2D 表情。Haru 可用 F01-F08；空字符串重置。',
    parameters: objectSchema({
      name: { type: 'string', description: '表情名，如 F01；空则重置' },
    }, ['name']),
    handler: async (args) => cppCall(cpp, 'live2d.expression', { name: String(args.name ?? '') }),
  })

  tools.register({
    name: 'live2d_motion',
    description: '播放 Live2D 动作。Haru 组：Idle(2) / TapBody(4)。',
    parameters: objectSchema({
      group: { type: 'string', description: '动作组，如 Idle / TapBody' },
      index: { type: 'integer', description: '组内序号，从 0 开始', minimum: 0 },
    }, ['group']),
    handler: async (args) => cppCall(cpp, 'live2d.motion', {
      group: String(args.group ?? 'Idle'),
      index: Number(args.index ?? 0),
    }),
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

  tools.register({
    name: 'jukebox_search_song',
    description: '搜索歌曲。source 可选：kuwo / kugou / migu / bilivideo',
    parameters: objectSchema({ keyword: { type: 'string' }, source: { type: 'string' } }, ['keyword']),
    handler: async (args) => jukebox.search(String(args.keyword ?? ''), args.source ? String(args.source) : undefined),
  })
  tools.register({
    name: 'jukebox_add_song',
    description: '把歌曲加入播放队列。可给 songId+source，或 keyword 搜索后加入第一首。',
    parameters: objectSchema({
      songId: { type: 'string' },
      source: { type: 'string' },
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
    'llm.tools': () => deps.tools.list(),
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

function normalizeSegments(raw: unknown): ReplySegment[] {
  if (!Array.isArray(raw)) return parseReplyContent(typeof raw === 'string' ? raw : '')
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return { method: 'danmaku' as const, text: String(item ?? '') }
    const rec = item as Record<string, unknown>
    const method = rec.method === 'display' || rec.method === 'tts' ? rec.method : 'danmaku'
    return {
      method,
      text: String(rec.text ?? ''),
      displayStyle: rec.displayStyle ? String(rec.displayStyle) : undefined,
      emotion: rec.emotion ? String(rec.emotion) : undefined,
    }
  })
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

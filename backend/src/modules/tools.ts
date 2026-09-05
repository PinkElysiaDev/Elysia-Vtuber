import type { RpcHandler } from '../core/rpc'
import { objectSchema, ToolRegistry } from '../core/tools'
import type { OutputRouter } from './output'
import { normalizeSegments } from './output'
import type { LLMSession } from '../llm/session'
import type { StandardEvent } from './events'
import type { TraceRecorder } from '../core/trace'

// 能力型工具（点歌机/Live2D 全部功能）统一注册于 core/abilities.ts 能力注册表；
// 此文件只保留认知循环的元工具（send_reply / stay_silent）与运行时 RPC。

export interface ToolModuleDeps {
  tools: ToolRegistry
  output: OutputRouter
  session: LLMSession
  getRoomId: () => string
  /** 工具加载开关（name → false 禁用）；省略时视为全部启用 */
  getToolGate?: () => Record<string, boolean>
  /** 运行日志（playground 调用留痕）；省略时不记录 */
  trace?: TraceRecorder
  /** 当前生效模型标识（trace 用） */
  getActiveModelLabel?: () => string
}

export function registerBuiltinTools(deps: ToolModuleDeps): void {
  const { tools, output } = deps

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

  // 沉默权：模型判断此刻无需说话时的显式出口（理由进运行日志）
  tools.register({
    name: 'stay_silent',
    description: '判断当前没有值得回应的内容时选择沉默。给出简短理由。',
    parameters: objectSchema({
      reason: { type: 'string', description: '简短的沉默理由，如"只是打卡弹幕，无需回应"' },
    }, ['reason']),
    handler: async (args) => {
      return { success: true, silent: true, reason: String(args.reason ?? '') }
    },
  })
}

export function buildRuntimeModule(deps: ToolModuleDeps): Record<string, RpcHandler> {
  return {
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

      // playground 也留痕：source=playground，运行日志统一可回看
      deps.trace?.record({
        ts: start,
        source: 'playground',
        reason: 'Playground 试运行',
        decision: result.toolCalls.some((c) => c.name === 'send_reply') ? 'replied' : 'silent',
        eventsCount: 0,
        systemPrompt: system,
        userPrompt: prompt,
        model: deps.getActiveModelLabel?.() ?? '',
        response: result.content,
        toolCalls: result.toolCalls,
        outputs: [],
        silentReason: '',
        error: '',
        durationMs,
      })

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
      const name = String(rec.name ?? rec.tool ?? rec.ability ?? '')
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

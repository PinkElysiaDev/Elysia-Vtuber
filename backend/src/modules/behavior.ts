/**
 * 行为模块 RPC：事件目录 / 清单预览 / 完整 prompt 预演 / 手动唤醒大脑 / 运行日志查询。
 * 预览与真实认知调用共用同一构建器（ContextBuilder / CognitionEngine.buildUserMessage），所见即所得。
 */
import type { RpcHandler } from '../core/rpc'
import type { FeedConfig } from '../config'
import { EVENT_CATALOG } from '../core/event-catalog'
import { INSTANT_CONDITION_SCHEMA, INSTANT_VARIABLE_SCHEMA } from '../core/instant'
import type { ContextBuilder } from '../core/context'
import type { TraceRecorder } from '../core/trace'
import type { CognitionEngine } from '../llm/cognition'
import type { AdaptiveBatcher } from '../core/batcher'
import type { ViewerTable } from '../core/viewers'
import type { SelfMemory } from '../core/memory'
import type { Ability } from '../core/abilities'
import type { StandardEvent } from './events'
import { expandTemplate } from '../core/variables'

export interface BehaviorModuleDeps {
  context: ContextBuilder
  cognition: CognitionEngine
  trace: TraceRecorder
  batcher: AdaptiveBatcher
  viewers: ViewerTable
  memory: SelfMemory
  /** 预置能力注册表（指令页「从预置能力新增指令」选择器） */
  getAbilities: () => Ability[]
  /** 音源列表（能力固定参数 source 的下拉选项） */
  getJukeboxSources?: () => string[]
  getFeedConfig: () => FeedConfig
  getSystemPrompt: () => string
  getRoomId: () => string
}

export function buildBehaviorModule(deps: BehaviorModuleDeps): Record<string, RpcHandler> {
  return {
    /** 事件目录（触发器面板：接收/清单勾选；即时应对：事件类型下拉） */
    'behavior.catalog': () => ({
      catalog: EVENT_CATALOG.map(({ key, group, label, description, defaultInclude }) => ({
        key, group, label, description, defaultInclude,
      })),
    }),

    /** 预置能力列表（指令页选择器 + 即时应对 run-ability 下拉）；动态参数选项服务端解析 */
    'abilities.list': () => {
      const sources = deps.getJukeboxSources?.() ?? []
      return {
        abilities: deps.getAbilities().map((a) => ({
          id: a.id, name: a.name, group: a.group,
          description: a.description, arg: a.arg, argKey: a.argKey,
          params: (a.params ?? []).map((p) => p.dynamic === 'music-sources' ? { ...p, options: sources } : p),
          registeredAsTool: true,
        })),
      }
    },

    /** 即时应对的条件/变量矩阵（前端动态渲染单一来源） */
    'instant.schema': () => ({
      conditions: INSTANT_CONDITION_SCHEMA,
      variables: INSTANT_VARIABLE_SCHEMA,
    }),

    /** 清单预览：纯样式示例（每个开启类型一条，不含真实事件）；接受未保存配置 override 实时预览 */
    'feed.preview': (params) => {
      const rec = (params as any) ?? {}
      const include = rec.include && typeof rec.include === 'object' ? rec.include as Record<string, boolean> : undefined
      const maxEvents = Number.isFinite(Number(rec.maxEvents)) && Number(rec.maxEvents) > 0 ? Number(rec.maxEvents) : undefined
      const result = deps.context.preview(include, maxEvents)
      return { lines: result.lines, count: result.count, sample: true }
    },

    /** 完整 prompt 预演：当前配置 + 近期数据渲染 system/user 全文（不调用模型） */
    'prompt.preview': (params) => {
      const directive = (params as any)?.directive ? String((params as any).directive) : undefined
      const ctx = { events: [] as StandardEvent[], history: [], roomId: deps.getRoomId() }
      const system = expandTemplate(deps.getSystemPrompt(), ctx)
      const user = deps.cognition.buildUserMessage(directive)
      return { system, user }
    },

    /** 手动唤醒大脑（Sandbox / 调试用）：可带定向指令与模拟事件 */
    'cognition.fire': async (params) => {
      const rec = (params as any) ?? {}
      const directive = rec.directive ? String(rec.directive) : undefined
      const events = Array.isArray(rec.events) ? rec.events as StandardEvent[] : []
      const start = Date.now()
      const result = await deps.cognition.request({
        source: 'manual',
        reason: directive ? `手动触发：${directive.slice(0, 50)}` : '手动触发',
        events,
        directive,
        priority: 1,
      })
      return { ok: result.decision !== 'error', result, durationMs: Date.now() - start }
    },

    /** 当前批状态（合并器观测） */
    'batcher.pending': () => deps.batcher.pending(),

    /** 行为观测总览 */
    'behavior.status': () => ({
      batch: deps.batcher.pending(),
      batchFired: { ...deps.batcher.firedCounts },
      viewers: deps.viewers.count(),
      online: deps.viewers.online(),
      memoryCount: deps.memory.count(),
      cognitionQueue: deps.cognition.queueDepth(),
      counts: { ...deps.cognition.counts },
    }),

    /** 运行日志查询（含完整 prompt 详情） */
    'trace.list': (params) => {
      const rec = (params as any) ?? {}
      const limit = Math.max(1, Math.min(200, Number(rec.limit ?? 50)))
      const offset = Math.max(0, Number(rec.offset ?? 0))
      const source = rec.source ? String(rec.source) : undefined
      return deps.trace.list(limit, offset, source)
    },

    'trace.clear': () => {
      deps.trace.clear()
      return { ok: true }
    },
  }
}

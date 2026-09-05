/**
 * 上下文清单构建：以主播视角把"最近发生了什么"渲染给模型。
 * 只产出事件清单块（viewer 表/自我记忆/规则附录已移除——自我记忆改经 {{memory}} 提示词变量注入）。
 * feed.preview 为纯样式示例（不取真实事件），用未保存的配置 override 实时预览；
 * prompt.preview 与真实认知调用共用 build()，保证预演所见即所得。
 */
import type { FeedConfig } from '../config'
import type { StandardEvent } from '../modules/events'
import { EVENT_CATALOG } from './event-catalog'
import { formatFeedLine } from './variables'

export interface ContextDeps {
  getFeedConfig: () => FeedConfig
  /** 近期事件（含系统事件；由 service 的 history 提供） */
  getHistory: () => StandardEvent[]
}

/** 事件类型是否进入清单（目录默认值 + 用户覆写） */
export function isFeedIncluded(type: string, cfg: FeedConfig): boolean {
  if (Object.prototype.hasOwnProperty.call(cfg.include, type)) return cfg.include[type] !== false
  const entry = EVENT_CATALOG.find((e) => e.key === type)
  return entry ? entry.defaultInclude : !type.startsWith('system.')
}

/** 事件清单行（按配置过滤 + 截断），最新在最后 */
export function buildFeedLines(events: StandardEvent[], cfg: FeedConfig): string[] {
  const included = events.filter((e) => isFeedIncluded(e.type, cfg))
  const capped = cfg.maxEvents > 0 ? included.slice(-cfg.maxEvents) : included
  return capped.map(formatFeedLine)
}

export class ContextBuilder {
  constructor(private readonly deps: ContextDeps) {}

  /** 完整上下文（认知调用与 prompt.preview 共用） */
  build(): { feedBlock: string } {
    const cfg = this.deps.getFeedConfig()
    const lines = buildFeedLines(this.deps.getHistory(), cfg)
    return { feedBlock: lines.length ? lines.join('\n') : '（暂无事件）' }
  }

  /**
   * 纯样式示例预览：按 override 配置对每个开启的类型渲染一条目录内置示例，
   * 不取真实事件——只给用户看"清单长这个样子"，与实际发送内容无关。
   */
  preview(includeOverride?: Record<string, boolean>, maxEventsOverride?: number): { lines: string[]; count: number } {
    const base = this.deps.getFeedConfig()
    const cfg: FeedConfig = {
      maxEvents: typeof maxEventsOverride === 'number' && maxEventsOverride > 0 ? maxEventsOverride : base.maxEvents,
      include: includeOverride ? { ...base.include, ...includeOverride } : base.include,
    }
    const now = Date.now()
    const lines = EVENT_CATALOG
      .filter((entry) => isFeedIncluded(entry.key, cfg))
      .map((entry) => {
        const sample = entry.sample()
        sample.timestamp = now
        return formatFeedLine(sample)
      })
    if (cfg.maxEvents > 0 && lines.length > cfg.maxEvents) {
      return { lines: lines.slice(-cfg.maxEvents), count: cfg.maxEvents }
    }
    return { lines, count: lines.length }
  }
}

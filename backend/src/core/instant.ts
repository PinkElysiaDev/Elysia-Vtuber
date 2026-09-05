/**
 * 即时应对：特定事件满足条件时直达处理，不等待合并器（省 token、秒回）。
 * 条件矩阵：按事件类型字段化判分（全部可空 = 不限），定义见 INSTANT_CONDITION_SCHEMA。
 * 动作矩阵：llm（交给大脑，可选定向指令）/ send-text（模板直发，事件变量展开）/
 *           run-ability（执行预置能力，与指令/LLM 工具同源）。
 * 触发源 = 直播间事件 + 系统事件（如"点歌成功"）；命中写入清单让模型知情。
 */
import type { InstantCondition, InstantConfig, InstantItem } from '../config'
import type { StandardEvent } from '../modules/events'
import { expandArgs, expandTemplate, expandCtxFor } from './variables'

export interface InstantDeps {
  getConfig: () => InstantConfig
  getRoomId: () => string
  /** send-text 出口（service：OutputRouter + 记忆）；返回实际发送结果（sent/skipped） */
  route: (segments: Array<{ method: string; text: string }>) => Promise<{ sent: number; skipped: number } | void>
  /** llm：交给大脑插队处理 */
  onLlm: (event: StandardEvent, directive: string | undefined, ruleName: string) => void
  /** run-ability 执行体（经 ToolRegistry，与指令/LLM 工具同一路径） */
  runAbility: (ability: string, args: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>
  /** 写入清单 system.instant.sent */
  emit: (data: Record<string, unknown>, event: StandardEvent) => void
}

// ================= 条件矩阵（前端动态渲染的单一来源，经 instant.schema RPC 下发） =================

export type ConditionFieldKind = 'text' | 'number' | 'boolean' | 'stringList' | 'regex' | 'guardLevels'

export interface ConditionField {
  key: keyof InstantCondition
  label: string
  kind: ConditionFieldKind
  placeholder?: string
  hint?: string
}

/** 通用条件（含用户信息的事件） */
const USER_FIELDS: ConditionField[] = [
  { key: 'uids', label: '指定用户（UID 白名单）', kind: 'stringList', placeholder: '逗号分隔，可空' },
  { key: 'minMedalLevel', label: '粉丝牌等级 ≥', kind: 'number', hint: '未佩戴粉丝牌不满足' },
  { key: 'guardOnly', label: '仅舰长及以上', kind: 'boolean' },
]

export const INSTANT_CONDITION_SCHEMA: Record<string, { label: string; fields: ConditionField[] }> = {
  danmaku: {
    label: '弹幕',
    fields: [
      { key: 'keywords', label: '内容包含任一关键词', kind: 'stringList', placeholder: '如：晚安,下播' },
      { key: 'regex', label: '正则匹配', kind: 'regex', placeholder: '如：^(.+?)几点播$', hint: '捕获组可用 {{match.1}} 等变量' },
      { key: 'startsWith', label: '以…开头', kind: 'text' },
      ...USER_FIELDS,
    ],
  },
  gift: {
    label: '礼物',
    fields: [
      { key: 'giftName', label: '礼物名等于', kind: 'text' },
      { key: 'giftNameContains', label: '礼物名包含', kind: 'text' },
      { key: 'minPrice', label: '单价 ≥（金瓜子）', kind: 'number', hint: '1000 金瓜子 = 1 元' },
      { key: 'minTotalPrice', label: '总价 ≥（金瓜子）', kind: 'number' },
      { key: 'minNum', label: '数量 ≥', kind: 'number' },
      ...USER_FIELDS,
    ],
  },
  superchat: {
    label: '醒目留言',
    fields: [
      { key: 'minPrice', label: '金额 ≥（元）', kind: 'number' },
      { key: 'maxPrice', label: '金额 ≤（元）', kind: 'number' },
      { key: 'keywords', label: '内容包含任一关键词', kind: 'stringList' },
      { key: 'regex', label: '内容正则匹配', kind: 'regex' },
      ...USER_FIELDS,
    ],
  },
  enter: { label: '进入直播间', fields: [...USER_FIELDS] },
  follow: { label: '关注', fields: [] },
  like: {
    label: '点赞',
    fields: [{ key: 'minCount', label: '点赞次数 ≥', kind: 'number' }, ...USER_FIELDS],
  },
  guard: {
    label: '上舰',
    fields: [
      { key: 'guardLevels', label: '舰长等级为', kind: 'guardLevels', hint: '不选 = 任何等级' },
      { key: 'minNum', label: '连击数量 ≥', kind: 'number' },
      ...USER_FIELDS,
    ],
  },
  liveStart: { label: '开播', fields: [{ key: 'titleContains', label: '标题包含', kind: 'text' }] },
  liveEnd: { label: '下播', fields: [] },
  online: { label: '在线人数', fields: [{ key: 'minCount', label: '在线人数 ≥', kind: 'number' }] },
  watchedChange: { label: '看过人数', fields: [{ key: 'minCount', label: '累计看过 ≥', kind: 'number' }] },
  'system.jukebox.added': {
    label: '点歌成功',
    fields: [
      { key: 'titleContains', label: '歌名包含', kind: 'text' },
      { key: 'userName', label: '点歌人等于', kind: 'text' },
      { key: 'minPosition', label: '队列位置 ≥', kind: 'number' },
      { key: 'userRequestOnly', label: '仅观众点播', kind: 'boolean', hint: '排除空闲歌单自动注入' },
    ],
  },
  'system.jukebox.playing': {
    label: '开始播放',
    fields: [
      { key: 'titleContains', label: '歌名包含', kind: 'text' },
      { key: 'userRequestOnly', label: '仅观众点播', kind: 'boolean' },
    ],
  },
  'system.jukebox.skipped': {
    label: '切歌',
    fields: [{ key: 'byContains', label: '操作者包含', kind: 'text' }],
  },
  'system.command.executed': {
    label: '指令执行',
    fields: [
      { key: 'ability', label: '能力等于', kind: 'text', placeholder: '如 jukebox_add_song' },
      { key: 'okOnly', label: '仅成功', kind: 'boolean' },
    ],
  },
  'system.live2d.loaded': { label: '模型加载完成', fields: [{ key: 'modelName', label: '模型名等于', kind: 'text' }] },
  'system.live2d.modelChanged': { label: '模型切换', fields: [{ key: 'modelName', label: '模型名等于', kind: 'text' }] },
}

// ================= 变量矩阵（send-text 编辑器的变量说明，经 instant.schema 下发） =================

export interface VariableDoc {
  token: string
  desc: string
}

export const INSTANT_VARIABLE_SCHEMA: Record<string, VariableDoc[]> = {
  common: [
    { token: '{{user.uid}}', desc: '用户 UID' },
    { token: '{{user.name}}', desc: '用户昵称' },
    { token: '{{user.fansMedal.name}}', desc: '粉丝牌名称' },
    { token: '{{user.fansMedal.level}}', desc: '粉丝牌等级' },
    { token: '{{user.guardLevel}}', desc: '舰长等级（1总督 2提督 3舰长，空 = 非舰长）' },
    { token: '{{now}}', desc: '当前时间' },
    { token: '{{roomId}}', desc: '直播间房间号' },
  ],
  danmaku: [
    { token: '{{content}}', desc: '弹幕全文' },
    { token: '{{match.1}}', desc: '正则条件第 1 个捕获组' },
    { token: '{{match.2}}', desc: '正则条件第 2 个捕获组' },
  ],
  gift: [
    { token: '{{gift.name}}', desc: '礼物名称' },
    { token: '{{gift.num}}', desc: '礼物数量' },
    { token: '{{gift.price}}', desc: '单价（金瓜子）' },
    { token: '{{gift.totalPrice}}', desc: '总价（金瓜子）' },
    { token: '{{gift.priceYuan}}', desc: '单价（元）' },
    { token: '{{gift.totalPriceYuan}}', desc: '总价（元）' },
  ],
  superchat: [
    { token: '{{sc.price}}', desc: 'SC 金额（元）' },
    { token: '{{sc.message}}', desc: 'SC 留言内容' },
    { token: '{{content}}', desc: 'SC 留言内容（同上）' },
  ],
  like: [{ token: '{{like.count}}', desc: '点赞次数' }],
  guard: [
    { token: '{{guard.level}}', desc: '舰长等级数字（1总督 2提督 3舰长）' },
    { token: '{{guard.name}}', desc: '舰长等级名称' },
    { token: '{{guard.num}}', desc: '开通/连击数量' },
  ],
  liveStart: [
    { token: '{{live.title}}', desc: '直播标题' },
    { token: '{{live.areaName}}', desc: '直播分区' },
  ],
  online: [{ token: '{{online.count}}', desc: '当前在线人数' }],
  watchedChange: [{ token: '{{watched.count}}', desc: '累计看过人数' }],
  'system.jukebox.added': [
    { token: '{{song.title}}', desc: '歌名' },
    { token: '{{song.artist}}', desc: '歌手' },
    { token: '{{song.source}}', desc: '音源渠道' },
    { token: '{{song.userName}}', desc: '点歌人昵称' },
    { token: '{{song.position}}', desc: '队列位置' },
  ],
  'system.jukebox.playing': [
    { token: '{{song.title}}', desc: '歌名' },
    { token: '{{song.artist}}', desc: '歌手' },
    { token: '{{song.source}}', desc: '音源渠道' },
    { token: '{{song.userName}}', desc: '点歌人昵称' },
  ],
  'system.jukebox.skipped': [
    { token: '{{song.title}}', desc: '被切掉的歌名' },
    { token: '{{skip.by}}', desc: '切歌操作者' },
  ],
  'system.command.executed': [
    { token: '{{command.id}}', desc: '执行的能力 id' },
    { token: '{{command.ok}}', desc: '是否成功' },
    { token: '{{command.message}}', desc: '执行结果消息' },
  ],
}

// ================= 引擎 =================

interface MatchInfo {
  regexMatch?: RegExpMatchArray
}

/** 单值归一为数组：文本类条件支持多同类条件（任一命中） */
function asArray(v: unknown): string[] {
  if (v === undefined || v === null) return []
  return (Array.isArray(v) ? v : [v]).map(String).filter((s) => s !== '')
}

export class InstantEngine {
  private lastAt = new Map<string, number>()
  /** 正则缓存（按 规则id#模式 缓存） */
  private regexCache = new Map<string, RegExp>()

  constructor(private readonly deps: InstantDeps) {}

  /** 事件处理；返回 true = 已被即时应对消费（不再进入合并器） */
  async handle(event: StandardEvent): Promise<boolean> {
    const cfg = this.deps.getConfig()
    if (!cfg.enabled) return false
    for (const item of cfg.items ?? []) {
      if (!item || item.enabled === false) continue
      const info = this.matches(item, event)
      if (!info) continue
      if (!this.passCooldown(item)) continue
      await this.execute(item, event, info)
      return true
    }
    return false
  }

  /** 条件判分：文本类同 key 多值任一命中（OR），不同 key 之间全部满足（AND） */
  private matches(item: InstantItem, event: StandardEvent): MatchInfo | null {
    if ((item.eventType ?? '') !== event.type) return null
    const c = item.condition ?? {}
    const data = event.data ?? {}
    const content = String(data.content ?? data.message ?? '')
    const info: MatchInfo = {}

    // 正则：多条任一命中，以命中那条的捕获组作为 {{match.N}}
    const patterns = asArray(c.regex)
    if (patterns.length) {
      let hit: RegExpMatchArray | null = null
      for (const pattern of patterns) {
        const regex = this.getRegex(item.id, pattern)
        if (!regex) continue
        const m = content.match(regex)
        if (m) { hit = m; break }
      }
      if (!hit) return null
      info.regexMatch = hit
    } else if (c.regex !== undefined) {
      return null  // 配置了正则但全部非法：视为不命中，避免误触发
    }
    if (c.keywords?.length && content) {
      if (!c.keywords.some((k) => k && content.includes(k))) return null
    }
    const prefixes = asArray(c.startsWith)
    if (prefixes.length && !prefixes.some((p) => content.startsWith(p))) return null

    switch (event.type) {
      case 'danmaku':
        break
      case 'gift': {
        const giftName = String(data.giftName ?? '')
        const names = asArray(c.giftName)
        if (names.length && !names.includes(giftName)) return null
        const subs = asArray(c.giftNameContains)
        if (subs.length && !subs.some((s) => giftName.includes(s))) return null
        if (this.positive(c.minPrice) && Number(data.price ?? 0) < c.minPrice!) return null
        if (this.positive(c.minTotalPrice) && Number(data.totalPrice ?? data.price ?? 0) < c.minTotalPrice!) return null
        if (this.positive(c.minNum) && Number(data.num ?? 1) < c.minNum!) return null
        break
      }
      case 'superchat': {
        const price = Number(data.price ?? 0)
        if (this.positive(c.minPrice) && price < c.minPrice!) return null
        if (this.positive(c.maxPrice) && price > c.maxPrice!) return null
        break
      }
      case 'like':
        if (this.positive(c.minCount) && Number(data.count ?? 1) < c.minCount!) return null
        break
      case 'guard': {
        if (c.guardLevels?.length) {
          const level = Number(data.guardLevel ?? event.user?.guardLevel ?? 0)
          if (!c.guardLevels.includes(level)) return null
        }
        if (this.positive(c.minNum) && Number(data.num ?? 1) < c.minNum!) return null
        break
      }
      case 'liveStart': {
        const titles = asArray(c.titleContains)
        if (titles.length && !titles.some((t) => String(data.title ?? '').includes(t))) return null
        break
      }
      case 'online':
        if (this.positive(c.minCount) && Number(data.count ?? 0) < c.minCount!) return null
        break
      case 'watchedChange':
        if (this.positive(c.minCount) && Number(data.count ?? 0) < c.minCount!) return null
        break
      case 'system.jukebox.added':
      case 'system.jukebox.playing': {
        const titles = asArray(c.titleContains)
        if (titles.length && !titles.some((t) => String(data.title ?? '').includes(t))) return null
        const users = asArray(c.userName)
        if (users.length && !users.includes(String(data.userName ?? ''))) return null
        if (this.positive(c.minPosition) && Number(data.position ?? 0) < c.minPosition!) return null
        if (c.userRequestOnly && !String(data.userName ?? '')) return null
        break
      }
      case 'system.jukebox.skipped': {
        const bys = asArray(c.byContains)
        if (bys.length && !bys.some((b) => String(data.by ?? '').includes(b))) return null
        break
      }
      case 'system.command.executed': {
        const abilities = asArray(c.ability)
        if (abilities.length && !abilities.includes(String(data.command ?? ''))) return null
        if (c.okOnly && data.ok === false) return null
        break
      }
      case 'system.live2d.loaded':
      case 'system.live2d.modelChanged': {
        const models = asArray(c.modelName)
        if (models.length && !models.includes(String(data.model ?? ''))) return null
        break
      }
      default:
        break
    }

    // 通用用户条件（事件带用户信息才有意义）
    if (c.uids?.length && !event.user?.uid) return null
    if (c.uids?.length && event.user && !c.uids.includes(event.user.uid)) return null
    if (this.positive(c.minMedalLevel)) {
      const level = event.user?.fansMedal?.level ?? 0
      if (level < c.minMedalLevel!) return null
    }
    if (c.guardOnly) {
      const guard = event.user?.guardLevel ?? 0
      if (!(guard >= 1 && guard <= 3)) return null
    }
    return info
  }

  private positive(v: number | undefined): boolean {
    return typeof v === 'number' && v > 0
  }

  private getRegex(ruleId: string, pattern: string): RegExp | null {
    const key = `${ruleId}#${pattern}`
    const cached = this.regexCache.get(key)
    if (cached) return cached
    try {
      const regex = new RegExp(pattern)
      this.regexCache.set(key, regex)
      return regex
    } catch {
      return null
    }
  }

  private passCooldown(item: InstantItem): boolean {
    const ms = item.cooldownMs ?? 0
    if (ms <= 0) return true
    const now = Date.now()
    return now - (this.lastAt.get(item.id) ?? 0) >= ms
  }

  private async execute(item: InstantItem, event: StandardEvent, info: MatchInfo): Promise<void> {
    const action = item.action ?? { type: 'send-text', template: '', channels: ['danmaku'] }

    if (action.type === 'llm') {
      this.lastAt.set(item.id, Date.now())
      if (item.announceToFeed !== false) {
        this.deps.emit({ rule: item.name, action: 'llm' }, event)
      }
      this.deps.onLlm(event, action.directive?.trim() || undefined, item.name)
      return
    }

    if (action.type === 'run-ability') {
      this.lastAt.set(item.id, Date.now())
      const ctx = expandCtxFor(event, this.deps.getRoomId(), {}, info.regexMatch)
      const args = expandArgs(action.args ?? {}, ctx)
      const result = await this.deps.runAbility(action.ability, args)
      if (item.announceToFeed !== false) {
        this.deps.emit({ rule: item.name, action: 'run-ability', ok: result.ok, message: result.message }, event)
      }
      return
    }

    // send-text（默认）：携带实际发送结果（sent/skipped），全部被跳过不消耗冷却
    const ctx = expandCtxFor(event, this.deps.getRoomId(), {}, info.regexMatch)
    const text = expandTemplate(action.template ?? '', ctx).trim()
    if (!text) return
    const channels = action.channels?.length ? action.channels : ['danmaku']
    const result = (await this.deps.route(channels.map((method) => ({ method, text })))) ?? { sent: 0, skipped: 0 }
    if (result.sent > 0) {
      this.lastAt.set(item.id, Date.now())
    }
    if (item.announceToFeed !== false) {
      this.deps.emit({ rule: item.name, action: 'send-text', text, sent: result.sent, skipped: result.skipped }, event)
    }
  }
}

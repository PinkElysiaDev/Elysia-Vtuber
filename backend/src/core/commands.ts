/**
 * 指令系统：弹幕直达执行，不经过模型（省 token、零延迟）。
 * 匹配语义（参考 Koishi 指令）：
 *  - 无参能力（arg=none，如切歌/重启）：整条弹幕 trim 后 === 任一别名
 *  - 有参能力（arg=rest，如点歌/换装）：弹幕以别名开头且尾部非空，尾部（trim）为参数
 *  - 全部指令的所有别名放在一起按长度优先匹配（防"点歌"抢先"点w歌"）
 * 执行体 = 能力注册表（core/abilities.ts）的同一 handler（与 LLM 工具同源）。
 */
import type { CommandItem, CommandsConfig } from '../config'
import type { Ability } from './abilities'
import type { StandardEvent } from '../modules/events'

export interface CommandDeps {
  getConfig: () => CommandsConfig
  getAbility: (id: string) => Ability | undefined
  /** 模板展开（事件上下文 + extra 变量） */
  expand: (template: string, event: StandardEvent, extra: Record<string, unknown>) => string
  /** 能力执行（经 ToolRegistry，与 LLM 工具同一路径） */
  run: (ability: Ability, args: Record<string, unknown>, event: StandardEvent) => Promise<{ ok: boolean; message: string }>
  /** 回执发送（走 OutputRouter 弹幕通道，受全局限频保护） */
  reply: (text: string) => void
  /** 写入清单 system.command.executed */
  emit: (data: Record<string, unknown>, event: StandardEvent) => void
}

interface AliasCandidate {
  item: CommandItem
  ability: Ability
  alias: string
}

export class CommandSystem {
  /** 别名候选缓存（配置变更时按签名重建） */
  private candidates: AliasCandidate[] = []
  private signature = ''
  private globalLast = new Map<string, number>()
  private userLast = new Map<string, Map<string, number>>()

  constructor(private readonly deps: CommandDeps) {}

  /** 弹幕事件处理；返回 true = 已被指令消费（不再进入即时应对/合并器） */
  async handle(event: StandardEvent): Promise<boolean> {
    if (event.type !== 'danmaku') return false
    const cfg = this.deps.getConfig()
    if (!cfg.enabled) return false
    const content = String(event.data?.content ?? '').trim()
    if (!content) return false

    const hit = this.match(content, cfg)
    if (!hit) return false
    if (!this.hasPermission(hit.item, event)) return false   // 无权限 → 交给大脑（它能看见这条弹幕）
    if (!this.passCooldown(hit.item, event)) return false    // 冷却中 → 同上

    const { item, ability } = hit
    // 组装参数：固定参数 + 弹幕尾部参数（按能力声明）
    const args: Record<string, unknown> = { ...(item.args ?? {}) }
    if (ability.arg === 'rest' && ability.argKey) {
      args[ability.argKey] = hit.param
    }
    const result = await this.deps.run(ability, args, event)
    this.markCooldown(item, event)
    this.sendReceipt(item, event, result)
    if (item.announceToFeed !== false) {
      this.deps.emit({
        command: ability.id,
        keyword: hit.alias,
        ok: result.ok,
        message: result.message,
      }, event)
    }
    return true
  }

  /** 全别名长度优先匹配；有参能力要求尾部非空 */
  private match(content: string, cfg: CommandsConfig): (AliasCandidate & { param: string }) | null {
    const signature = JSON.stringify(cfg.items?.map((i) => [i?.id, i?.enabled, i?.ability, i?.aliases]) ?? [])
    if (signature !== this.signature) {
      this.signature = signature
      this.candidates = []
      for (const item of cfg.items ?? []) {
        if (!item || item.enabled === false) continue
        const ability = this.deps.getAbility(item.ability)
        if (!ability) continue
        for (const alias of item.aliases ?? []) {
          if (alias && alias.trim()) this.candidates.push({ item, ability, alias: alias.trim() })
        }
      }
      this.candidates.sort((a, b) => b.alias.length - a.alias.length)
    }
    for (const candidate of this.candidates) {
      if (candidate.ability.arg === 'rest') {
        // 别名开头且尾部非空（"点歌晴天"与"点歌 晴天"均可）
        if (content.startsWith(candidate.alias)) {
          const param = content.slice(candidate.alias.length).trim()
          if (param) return { ...candidate, param }
        }
      } else if (content === candidate.alias) {
        return { ...candidate, param: '' }
      }
    }
    return null
  }

  private hasPermission(item: CommandItem, event: StandardEvent): boolean {
    const perm = item.permission ?? { mode: 'all' }
    if (perm.mode === 'all') return true
    const user = event.user
    if (!user) return false
    if (perm.mode === 'medal') {
      return Boolean(user.fansMedal) && user.fansMedal!.level >= (perm.medalLevel ?? 1)
    }
    if (perm.mode === 'guard') {
      return Boolean(user.guardLevel && user.guardLevel >= 1 && user.guardLevel <= 3)
    }
    if (perm.mode === 'uids') {
      return (perm.uids ?? []).includes(user.uid)
    }
    return false
  }

  private passCooldown(item: CommandItem, event: StandardEvent): boolean {
    const now = Date.now()
    const globalMs = item.cooldown?.globalMs ?? 0
    if (globalMs > 0) {
      const last = this.globalLast.get(item.id) ?? 0
      if (now - last < globalMs) return false
    }
    const perUserMs = item.cooldown?.perUserMs ?? 0
    if (perUserMs > 0 && event.user?.uid) {
      const userMap = this.userLast.get(item.id)
      const last = userMap?.get(event.user.uid) ?? 0
      if (now - last < perUserMs) return false
    }
    return true
  }

  private markCooldown(item: CommandItem, event: StandardEvent): void {
    const now = Date.now()
    this.globalLast.set(item.id, now)
    if (event.user?.uid) {
      let userMap = this.userLast.get(item.id)
      if (!userMap) {
        userMap = new Map()
        this.userLast.set(item.id, userMap)
      }
      userMap.set(event.user.uid, now)
    }
  }

  private sendReceipt(item: CommandItem, event: StandardEvent, result: { ok: boolean; message: string }): void {
    const template = result.ok ? item.successTemplate : item.failureTemplate
    const text = template ? this.deps.expand(template, event, { message: result.message, ok: result.ok }).trim() : ''
    if (text) this.deps.reply(text)
  }
}

/**
 * 活跃观众表：用"最后活跃时间"近似"是否在场"（B站协议没有退出直播间事件）。
 * - 任何带用户信息的事件（进入/弹幕/礼物/SC/点赞/上舰…）都会建档并刷新 lastSeen
 * - 滑动窗口（默认 30 分钟）内活跃的观众视为在场，超时自动移出
 * - online 真值（Web 连接模式心跳）可校准显示，覆盖活跃数口径
 */
import type { StandardEvent } from '../modules/events'

export interface ViewerRecord {
  uid: string
  name: string
  fansMedal?: { name: string; level: number }
  guardLevel?: number
  /** 首次出现（进入事件优先，否则首次任意事件） */
  firstSeen: number
  /** 最后活跃 */
  lastSeen: number
  /** 本场弹幕数 */
  danmakuCount: number
  /** 本场礼物总额（金瓜子） */
  giftTotal: number
}

const GUARD_ORDER: Record<number, number> = { 1: 3, 2: 2, 3: 1 }

export class ViewerTable {
  private map = new Map<string, ViewerRecord>()
  /** 最近一次 online 真值（无则 0） */
  private onlineCount = 0
  private onlineAt = 0

  constructor(
    private readonly windowMs = 30 * 60 * 1000,
    private readonly maxRecords = 500,
  ) {}

  /** 任何事件都刷新观众活跃；online 事件校准在线人数 */
  touch(event: StandardEvent): void {
    if (event.type === 'online') {
      const count = Number(event.data?.count ?? 0)
      if (count > 0) {
        this.onlineCount = count
        this.onlineAt = event.timestamp || Date.now()
      }
      return
    }
    const user = event.user
    if (!user?.uid) return
    const now = event.timestamp || Date.now()
    const existing = this.map.get(user.uid)
    if (existing) {
      existing.lastSeen = now
      if (user.name) existing.name = user.name
      if (user.fansMedal) existing.fansMedal = user.fansMedal
      if (user.guardLevel) existing.guardLevel = user.guardLevel
    } else {
      this.map.set(user.uid, {
        uid: user.uid,
        name: user.name || user.uid,
        fansMedal: user.fansMedal,
        guardLevel: user.guardLevel,
        // enter 事件的语义即"刚进入"；其他事件首次出现视为"首次被注意到"
        firstSeen: event.type === 'enter' ? now : now,
        lastSeen: now,
        danmakuCount: 0,
        giftTotal: 0,
      })
    }
    const rec = this.map.get(user.uid)!
    if (event.type === 'danmaku') rec.danmakuCount++
    if (event.type === 'gift') {
      rec.giftTotal += Number(event.data?.totalPrice ?? event.data?.price ?? 0)
    }
    this.prune(now)
  }

  private prune(now: number): void {
    if (this.map.size <= this.maxRecords) return
    // 按 lastSeen 升序淘汰最久未活跃者
    const sorted = [...this.map.values()].sort((a, b) => a.lastSeen - b.lastSeen)
    const remove = this.map.size - this.maxRecords
    for (let i = 0; i < remove; i++) this.map.delete(sorted[i].uid)
  }

  /** 窗口内活跃观众（按最后活跃倒序） */
  active(now = Date.now()): ViewerRecord[] {
    const cutoff = now - this.windowMs
    return [...this.map.values()]
      .filter((r) => r.lastSeen >= cutoff)
      .sort((a, b) => b.lastSeen - a.lastSeen)
  }

  count(): number {
    return this.active().length
  }

  /** online 真值（10 分钟内有效） */
  online(now = Date.now()): number {
    return now - this.onlineAt < 10 * 60 * 1000 ? this.onlineCount : 0
  }

  /** 渲染为清单观众块；上限 limit 人，超出折叠为"等 N 人" */
  format(limit = 12): string {
    const list = this.active()
    if (!list.length) return ''
    const online = this.online()
    const head = online > 0 ? `当前在线 ${online} 人（活跃 ${list.length}）` : `近 30 分钟活跃观众 ${list.length} 人`
    const shown = list.slice(0, limit).map((r) => {
      const medal = r.fansMedal ? `[${r.fansMedal.name}.${r.fansMedal.level}]` : ''
      const guard = r.guardLevel ? `[${guardName(r.guardLevel)}]` : ''
      const stats: string[] = []
      if (r.danmakuCount > 0) stats.push(`弹幕${r.danmakuCount}`)
      if (r.giftTotal > 0) stats.push(`礼物${(r.giftTotal / 1000).toFixed(0)}元`)
      const statText = stats.length ? `（${stats.join('/')}）` : ''
      return `- ${r.name}${medal}${guard}${statText}`
    })
    const more = list.length > limit ? `\n- …等 ${list.length} 人` : ''
    return `${head}\n${shown.join('\n')}${more}`
  }

  /** 下播清理（liveEnd 时调用，保留统计归零） */
  reset(): void {
    this.map.clear()
    this.onlineCount = 0
    this.onlineAt = 0
  }
}

function guardName(level: number): string {
  if (level === 1) return '总督'
  if (level === 2) return '提督'
  if (level === 3) return '舰长'
  return `舰长${GUARD_ORDER[level] ?? level}`
}

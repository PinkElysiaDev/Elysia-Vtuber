/**
 * 事件目录：直播间事件 + 系统后台事件的统一注册表。
 * 消费方：
 *  - 上下文清单（behavior.feed.include 按本目录 key 决定是否呈现给模型）
 *  - WebUI「事件上下文」面板（分组勾选 + 示例预览，数据来自 behavior.catalog RPC）
 *  - 密度合并器（仅收集 live 分组事件；system 分组只进清单不触发）
 */
import type { StandardEvent } from '../modules/events'

export type EventGroup = 'live' | 'system'

export interface CatalogEntry {
  key: string
  group: EventGroup
  label: string
  description: string
  /** 默认是否进入 LLM 上下文清单 */
  defaultInclude: boolean
  /** 预览用示例事件（真实字段结构，供 feed.preview 补齐与 WebUI 展示） */
  sample: () => StandardEvent
}

function sampleEvent(
  type: string,
  data: Record<string, unknown>,
  user?: StandardEvent['user'],
): StandardEvent {
  return { type, timestamp: Date.now(), roomId: '', user, data }
}

function viewer(name = '小明', uid = '10086', medalLevel = 12): StandardEvent['user'] {
  return { uid, name, fansMedal: { name: '星光', level: medalLevel } }
}

export const EVENT_CATALOG: CatalogEntry[] = [
  // ================= 直播间事件 =================
  {
    key: 'danmaku', group: 'live', label: '弹幕', description: '观众发送的弹幕', defaultInclude: true,
    sample: () => sampleEvent('danmaku', { content: '今天玩什么游戏呀' }, viewer()),
  },
  {
    key: 'gift', group: 'live', label: '礼物', description: '观众送出的礼物', defaultInclude: true,
    sample: () => sampleEvent('gift', { giftName: '小心心', num: 10, price: 1000, totalPrice: 1000 }, viewer()),
  },
  {
    key: 'superchat', group: 'live', label: '醒目留言', description: 'SC（附带金额与留言）', defaultInclude: true,
    sample: () => sampleEvent('superchat', { price: 50, message: '主播加油！今日份SC支持！' }, viewer('小红', '10010')),
  },
  {
    key: 'enter', group: 'live', label: '进入直播间', description: '观众进入（B站不保证推送全部进入，清单为下界）', defaultInclude: true,
    sample: () => sampleEvent('enter', {}, viewer('阿伟', '10011', 6)),
  },
  {
    key: 'follow', group: 'live', label: '关注', description: '观众关注了主播', defaultInclude: true,
    sample: () => sampleEvent('follow', {}, viewer('路过的仓鼠', '10012', 3)),
  },
  {
    key: 'like', group: 'live', label: '点赞', description: '观众点赞（量大，默认不进清单）', defaultInclude: false,
    sample: () => sampleEvent('like', { count: 5 }, viewer('刷屏怪', '10013', 1)),
  },
  {
    key: 'guard', group: 'live', label: '上舰', description: '开通舰长/提督/总督', defaultInclude: true,
    sample: () => sampleEvent('guard', { guardLevel: 3, guardName: '舰长', num: 1 }, viewer('土豪哥', '10014', 20)),
  },
  {
    key: 'liveStart', group: 'live', label: '开播', description: '直播开始（含标题与分区）', defaultInclude: true,
    sample: () => sampleEvent('liveStart', { title: '新的一天，开整！', areaName: '虚拟主播' }),
  },
  {
    key: 'liveEnd', group: 'live', label: '下播', description: '直播结束', defaultInclude: true,
    sample: () => sampleEvent('liveEnd', {}),
  },
  {
    key: 'online', group: 'live', label: '在线人数', description: '当前真实在线人数（仅 Web 连接模式有心跳真值）', defaultInclude: false,
    sample: () => sampleEvent('online', { count: 233 }),
  },
  {
    key: 'watchedChange', group: 'live', label: '看过人数', description: '累计看过直播的人数（只增不减，仅 Web 模式）', defaultInclude: false,
    sample: () => sampleEvent('watchedChange', { count: 1024 }),
  },
  // ================= 系统事件（后台行为，主播视角的“后台日志”） =================
  {
    key: 'system.live2d.connected', group: 'system', label: 'Live2D 已连接', description: 'Live2D 执行器连接成功', defaultInclude: false,
    sample: () => sampleEvent('system.live2d.connected', {}),
  },
  {
    key: 'system.live2d.disconnected', group: 'system', label: 'Live2D 断开', description: 'Live2D 执行器连接断开', defaultInclude: false,
    sample: () => sampleEvent('system.live2d.disconnected', {}),
  },
  {
    key: 'system.live2d.loaded', group: 'system', label: '模型加载完成', description: 'Live2D 模型加载成功', defaultInclude: true,
    sample: () => sampleEvent('system.live2d.loaded', { model: 'Haru' }),
  },
  {
    key: 'system.live2d.loadFailed', group: 'system', label: '模型加载失败', description: 'Live2D 模型加载失败（含原因）', defaultInclude: false,
    sample: () => sampleEvent('system.live2d.loadFailed', { model: 'Haru', error: 'model3.json not found' }),
  },
  {
    key: 'system.live2d.modelChanged', group: 'system', label: '模型切换', description: 'Live2D 模型配置变更并重新应用', defaultInclude: true,
    sample: () => sampleEvent('system.live2d.modelChanged', { model: 'Hiyori' }),
  },
  {
    key: 'system.jukebox.playing', group: 'system', label: '开始播放', description: '点歌机开始播放一首歌', defaultInclude: true,
    sample: () => sampleEvent('system.jukebox.playing', { title: '起风了', artist: '买辣椒也用券', source: 'kuwo', userName: '小明' }),
  },
  {
    key: 'system.jukebox.added', group: 'system', label: '歌曲入队', description: '一首歌成功加入播放队列', defaultInclude: true,
    sample: () => sampleEvent('system.jukebox.added', { title: '晴天', artist: '周杰伦', source: 'netease', userName: '小红', position: 3 }),
  },
  {
    key: 'system.jukebox.skipped', group: 'system', label: '切歌', description: '当前歌曲被跳过', defaultInclude: true,
    sample: () => sampleEvent('system.jukebox.skipped', { title: '晴天', by: '小明' }),
  },
  {
    key: 'system.jukebox.restarted', group: 'system', label: '点歌机重启', description: '点歌机重启（可保留队列）', defaultInclude: false,
    sample: () => sampleEvent('system.jukebox.restarted', { preserveQueue: true }),
  },
  {
    key: 'system.command.executed', group: 'system', label: '指令执行', description: '弹幕指令被直接执行（不经过模型）', defaultInclude: true,
    sample: () => sampleEvent('system.command.executed', { command: 'jukebox-order', keyword: '点歌', userName: '小明', ok: true, message: '已加入队列：《起风了》' }, viewer()),
  },
  {
    key: 'system.instant.sent', group: 'system', label: '即时回复', description: '即时规则按模板直接发送了回复（不经过模型）', defaultInclude: true,
    sample: () => sampleEvent('system.instant.sent', { rule: '入场欢迎', userName: '阿伟', action: 'template-reply', text: '欢迎 阿伟 进入直播间~' }, viewer('阿伟', '10011', 6)),
  },
]

const KEY_SET = new Set(EVENT_CATALOG.map((e) => e.key))

/** 是否为已登记的事件 key */
export function isCatalogKey(key: string): boolean {
  return KEY_SET.has(key)
}

/** 系统事件（后台行为）：只进清单，不参与合并触发 */
export function isSystemEventKey(type: string): boolean {
  return typeof type === 'string' && type.startsWith('system.')
}

/** 目录标签（清单行与 UI 共用；未登记类型回退原 key） */
export function catalogLabel(key: string): string {
  return EVENT_CATALOG.find((e) => e.key === key)?.label ?? key
}

/** 全部目录 key → 默认入清单开关 的映射（defaultConfig 用） */
export function defaultIncludeMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const entry of EVENT_CATALOG) out[entry.key] = entry.defaultInclude
  return out
}

/**
 * 能力注册表：系统预置功能的唯一登记处，同时驱动「弹幕指令」与「LLM 工具」两个暴露面。
 * 对齐原则：一个功能若可配置为指令，就必须可暴露为 LLM 工具（反向亦然）。
 * send_reply / stay_silent 是认知循环的元工具，不在此登记；MCP 外部工具在此基础上仅扩展工具层。
 */
import type { ToolRegistry } from './tools'
import { objectSchema } from './tools'
import type { StandardEvent } from '../modules/events'
import type { CppClient } from '../cpp/client'
import type { Jukebox } from '../music/jukebox'
import type { Live2DConfig } from '../config'

export type AbilityGroup = 'jukebox' | 'live2d'

/** 指令页 / 即时应对页渲染的固定参数声明 */
export interface AbilityParam {
  key: string
  label: string
  kind: 'text' | 'select' | 'boolean' | 'number'
  /** select 的动态选项来源 */
  dynamic?: 'music-sources' | 'live2d-expressions' | 'live2d-costumes' | 'live2d-motions'
  default?: unknown
  description?: string
}

export interface Ability {
  id: string
  name: string
  group: AbilityGroup
  /** 用户可读描述（指令页能力选择器展示） */
  description: string
  /** 弹幕指令匹配语义：rest=别名开头+尾部作参数；none=别名整条匹配 */
  arg: 'none' | 'rest'
  /** arg=rest 时的主参数名（keyword / name / motion） */
  argKey?: string
  /** 固定参数声明（指令页/即时应对页动态渲染配置 UI） */
  params: AbilityParam[]
  /** LLM 工具描述 */
  toolDescription: string
  /** LLM 工具参数 schema */
  toolParameters: Record<string, unknown>
  /** 执行体：返回 { success, message, ... }；指令回执用 message */
  handler: (args: Record<string, unknown>, ctx: { event?: StandardEvent }) => unknown | Promise<unknown>
}

export interface AbilityDeps {
  jukebox: Jukebox
  cpp: CppClient
  getLive2dConfig: () => Live2DConfig
  /** 重载 Live2D 模型（重新应用完整模型配置） */
  reloadLive2d: () => Promise<void>
}

function cppCall(cpp: CppClient, method: string, args: Record<string, unknown>): Promise<unknown> {
  if (!cpp.isConnected()) {
    return Promise.resolve({ success: false, error: 'C++ 执行器未连接' })
  }
  return cpp.request(method, args).catch((err: unknown) => ({
    success: false,
    error: err instanceof Error ? err.message : String(err),
  }))
}

/** 从资源注册表取已启用项（live2d 表情/换装/动作描述与校验共用） */
export function live2dAssetNames(config: Live2DConfig, kind: 'expressions' | 'costumes' | 'motions'): string[] {
  const reg = config.assetRegistration?.[kind] ?? {}
  return Object.entries(reg).filter(([, v]) => v && v.enabled).map(([name]) => name)
}

/** 构建全部内置能力（id 沿用现有 LLM 工具名，保持提示词/门控配置兼容） */
export function buildAbilities(deps: AbilityDeps): Ability[] {
  const { jukebox, cpp } = deps
  const musicSources = () => jukebox.sources()
  const sourceParam: AbilityParam = {
    key: 'source', label: '固定音源', kind: 'select', dynamic: 'music-sources',
    description: '留空 = 默认音源；指定后该指令固定走该渠道（渠道别名的实现方式）',
  }

  const abilities: Ability[] = [
    {
      id: 'jukebox_add_song', name: '点歌', group: 'jukebox',
      description: '按关键词搜索并加入播放队列（弹幕尾部为歌曲关键词）',
      arg: 'rest', argKey: 'keyword',
      params: [sourceParam],
      toolDescription: '把歌曲加入播放队列。可给 songId+source，或 keyword 搜索后加入第一首；source 可指定渠道让模型选源。',
      toolParameters: objectSchema({
        songId: { type: 'string' }, source: { type: 'string', description: '检索渠道，不填用默认渠道' },
        keyword: { type: 'string' }, title: { type: 'string' },
        userId: { type: 'string' }, userName: { type: 'string' },
      }),
      handler: async (args, ctx) => {
        const userId = String(args.userId ?? ctx.event?.user?.uid ?? 'system') || 'system'
        const userName = String(args.userName ?? ctx.event?.user?.name ?? userId)
        return jukebox.add({
          songId: args.songId ? String(args.songId) : undefined,
          source: args.source ? String(args.source) : undefined,
          keyword: args.keyword ? String(args.keyword) : undefined,
          title: args.title ? String(args.title) : undefined,
          userId, userName,
        })
      },
    },
    {
      id: 'jukebox_search_song', name: '搜歌', group: 'jukebox',
      description: '按关键词搜索歌曲并返回结果（查询类，不改队列）',
      arg: 'rest', argKey: 'keyword',
      params: [sourceParam],
      toolDescription: '搜索歌曲，可用 source 指定渠道：' + musicSources().join(' / ') + '（netease、qq 需扫码登录）',
      toolParameters: objectSchema({
        keyword: { type: 'string' },
        source: { type: 'string', enum: musicSources(), description: '检索渠道，不填用默认渠道。netease / qq 需扫码登录后可用' },
      }),
      handler: async (args) => {
        const keyword = String(args.keyword ?? '')
        const result = await jukebox.search(keyword, args.source ? String(args.source) : undefined)
        const top = (result.results ?? []).slice(0, 3)
          .map((r: { title?: string; artist?: string }, i: number) => `${i + 1}. ${r.title ?? '?'} - ${r.artist ?? '?'}`)
          .join('；')
        return { success: true, message: top ? `搜索「${keyword}」：${top}` : `没有找到「${keyword}」`, ...result }
      },
    },
    {
      id: 'jukebox_skip_song', name: '切歌', group: 'jukebox',
      description: '跳过当前歌曲',
      arg: 'none',
      params: [{ key: 'selfOnly', label: '仅能切自己点的歌', kind: 'boolean', default: true }],
      toolDescription: '切到下一首',
      toolParameters: objectSchema(),
      handler: (args, ctx) => {
        if (args.selfOnly !== false && ctx.event) {
          const np = jukebox.getState().nowPlaying as { userId?: string; title?: string } | null
          const uid = ctx.event.user?.uid || 'anon'
          if (np && np.userId && np.userId !== 'system' && np.userId !== uid) {
            return { success: false, message: '只能切自己点的歌' }
          }
        }
        return jukebox.skip(ctx.event?.user?.name)
      },
    },
    {
      id: 'jukebox_get_queue', name: '查看队列', group: 'jukebox',
      description: '查询待播队列（查询类）',
      arg: 'none', params: [],
      toolDescription: '查看点歌队列',
      toolParameters: objectSchema(),
      handler: () => {
        const queue = jukebox.getState().queue ?? []
        const summary = queue.slice(0, 5)
          .map((q: { title?: string; userName?: string }, i: number) => `${i + 1}.${q.title ?? '?'}(${q.userName ?? '?'})`)
          .join(' ')
        return { success: true, message: queue.length ? `待播${queue.length}首：${summary}` : '队列为空', queue }
      },
    },
    {
      id: 'jukebox_get_current_song', name: '当前歌曲', group: 'jukebox',
      description: '查询正在播放的歌曲（查询类）',
      arg: 'none', params: [],
      toolDescription: '查看正在播放的歌',
      toolParameters: objectSchema(),
      handler: () => {
        const np = jukebox.getState().nowPlaying
        return {
          success: true,
          message: np ? `正在播放：${np.title ?? '?'} - ${np.artist ?? '?'}` : '当前没有播放',
          nowPlaying: np,
        }
      },
    },
    {
      id: 'jukebox_restart', name: '重启点歌机', group: 'jukebox',
      description: '重启点歌机播放引擎',
      arg: 'none',
      params: [{ key: 'preserveQueue', label: '重启时保留待播队列', kind: 'boolean', default: true }],
      toolDescription: '重启点歌机（可保留待播队列）',
      toolParameters: objectSchema(),
      handler: (args) => jukebox.restart(args.preserveQueue !== false),
    },
    {
      id: 'live2d_expression', name: '换表情', group: 'live2d',
      description: '切换 Live2D 表情（弹幕尾部为表情名）',
      arg: 'rest', argKey: 'name', params: [],
      toolDescription: '',  // 动态生成（见 live2dDynamicDescriptions）
      toolParameters: objectSchema({ name: { type: 'string' } }),
      handler: (args) => {
        const name = String(args.name ?? '')
        const available = live2dAssetNames(deps.getLive2dConfig(), 'expressions')
        if (name && available.length && !available.includes(name)) {
          return { success: false, error: `表情未注册: ${name}`, available }
        }
        return cppCall(cpp, 'live2d.expression', { name })
      },
    },
    {
      id: 'live2d_costume', name: '换装', group: 'live2d',
      description: '切换 Live2D 换装（本质是表情，会替换当前表情）',
      arg: 'rest', argKey: 'name', params: [],
      toolDescription: '',
      toolParameters: objectSchema({ name: { type: 'string' } }),
      handler: (args) => {
        const name = String(args.name ?? '')
        const available = live2dAssetNames(deps.getLive2dConfig(), 'costumes')
        if (!name || (available.length && !available.includes(name))) {
          return { success: false, error: `换装未注册: ${name}`, available }
        }
        return cppCall(cpp, 'live2d.expression', { name })
      },
    },
    {
      id: 'live2d_motion', name: '做动作', group: 'live2d',
      description: '播放 Live2D 动作（弹幕尾部为动作名或 组#序号）',
      arg: 'rest', argKey: 'motion', params: [],
      toolDescription: '',
      toolParameters: objectSchema({ motion: { type: 'string' } }),
      handler: (args) => {
        const ref = String(args.motion ?? args.name ?? '')
        const available = live2dAssetNames(deps.getLive2dConfig(), 'motions')
        if (!ref || (available.length && !available.includes(ref))) {
          return { success: false, error: `动作未注册: ${ref}`, available }
        }
        if (ref.includes('#')) {
          const [group, idx] = ref.split('#')
          return cppCall(cpp, 'live2d.motion', { group, index: Number(idx) })
        }
        return cppCall(cpp, 'live2d.motion', { name: ref })
      },
    },
    {
      id: 'live2d_transform', name: '调整位置缩放', group: 'live2d',
      description: '调整 Live2D 缩放与位移（固定参数配置）',
      arg: 'none',
      params: [
        { key: 'scale', label: '缩放', kind: 'number', default: 1 },
        { key: 'x', label: '水平位移', kind: 'number', default: 0 },
        { key: 'y', label: '垂直位移', kind: 'number', default: 0 },
      ],
      toolDescription: '调整 Live2D 缩放和位移。scale 默认 1，x/y 为相对平移。',
      toolParameters: objectSchema({
        scale: { type: 'number', description: '缩放，>0' },
        x: { type: 'number', description: '水平位移' },
        y: { type: 'number', description: '垂直位移' },
      }),
      handler: (args) => cppCall(cpp, 'live2d.transform', {
        scale: Number(args.scale ?? 1), x: Number(args.x ?? 0), y: Number(args.y ?? 0),
      }),
    },
    {
      id: 'live2d_status', name: '查询状态', group: 'live2d',
      description: '查询 Live2D 模型与可用表情/动作（查询类）',
      arg: 'none', params: [],
      toolDescription: '查询当前 Live2D 模型、可用表情和动作组',
      toolParameters: objectSchema(),
      handler: () => cppCall(cpp, 'live2d.status', {}),
    },
    {
      id: 'live2d_reload', name: '重载模型', group: 'live2d',
      description: '重新加载当前 Live2D 模型配置',
      arg: 'none', params: [],
      toolDescription: '重新加载 Live2D 模型（模型配置变更后生效）',
      toolParameters: objectSchema(),
      handler: async () => {
        try {
          await deps.reloadLive2d()
          return { success: true, message: 'Live2D 模型已重新加载' }
        } catch (err) {
          return { success: false, message: err instanceof Error ? err.message : String(err) }
        }
      },
    },
  ]
  refreshLive2dDescriptions(abilities, deps)
  return abilities
}

/** Live2D 三能力的工具描述动态内联可用项清单（资源注册表变更后调用重建） */
export function refreshLive2dDescriptions(abilities: Ability[], deps: AbilityDeps): void {
  const config = deps.getLive2dConfig()
  const exprs = live2dAssetNames(config, 'expressions')
  const costumes = live2dAssetNames(config, 'costumes')
  const motions = live2dAssetNames(config, 'motions')
  const find = (id: string) => abilities.find((a) => a.id === id)
  const expr = find('live2d_expression')
  if (expr) {
    expr.toolDescription = exprs.length
      ? `切换 Live2D 表情。可用：${exprs.join(' / ')}；空字符串重置。`
      : '切换 Live2D 表情（当前没有已注册的表情，返回错误说明）。'
    expr.toolParameters = objectSchema({
      name: { type: 'string', description: exprs.length ? `表情名，可选：${exprs.join(' / ')}；空则重置` : '表情名（当前无已注册表情）' },
    })
  }
  const costume = find('live2d_costume')
  if (costume) {
    costume.toolDescription = costumes.length
      ? `切换 Live2D 换装（本质是表情，会替换当前表情）。可用：${costumes.join(' / ')}。恢复默认用 live2d_expression 传空串。`
      : '切换 Live2D 换装（当前没有已注册的换装）。'
    costume.toolParameters = objectSchema({
      name: { type: 'string', description: costumes.length ? `换装名，可选：${costumes.join(' / ')}` : '换装名（当前无已注册换装）' },
    })
  }
  const motion = find('live2d_motion')
  if (motion) {
    motion.toolDescription = motions.length
      ? `播放 Live2D 动作。可用（"组#序号" 为声明动作，其余为命名动作）：${motions.join(' / ')}。`
      : '播放 Live2D 动作（当前没有已注册的动作）。'
    motion.toolParameters = objectSchema({
      motion: { type: 'string', description: motions.length ? `动作引用，可选：${motions.join(' / ')}` : '动作引用（当前无已注册动作）' },
    })
  }
}

/** 能力 → ToolRegistry 注册（LLM 工具面） */
export function registerAbilityTools(tools: ToolRegistry, abilities: Ability[]): void {
  for (const ability of abilities) {
    tools.register({
      name: ability.id,
      description: ability.toolDescription,
      parameters: ability.toolParameters,
      handler: (args) => ability.handler(args ?? {}, {}),
    })
  }
}

/** 元工具之外的全部能力 id（对齐校验/测试用） */
export function abilityIds(abilities: Ability[]): string[] {
  return abilities.map((a) => a.id)
}

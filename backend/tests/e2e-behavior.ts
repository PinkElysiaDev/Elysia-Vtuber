/**
 * E2E：行为循环第二轮（能力注册表 / Koishi 风格指令匹配 / 即时应对条件矩阵 / 配置迁移 / 认知留痕）
 * 运行：npx ts-node tests/e2e-behavior.ts
 */
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'
import { AdaptiveBatcher, type BatchFire } from '../src/core/batcher'
import { ContextBuilder } from '../src/core/context'
import { CommandSystem } from '../src/core/commands'
import { InstantEngine } from '../src/core/instant'
import { OutputRouter } from '../src/modules/output'
import { EventBridge } from '../../src/event-bridge'
import type { FeedConfig, MergeConfig, CommandsConfig, InstantConfig, InstantItem, OutputConfig } from '../src/config'
import { loadConfig } from '../src/config'
import type { StandardEvent } from '../src/modules/events'

let passed = 0
function ok(cond: unknown, msg: string): void {
  if (cond) {
    passed++
    console.log('  ✓', msg)
  } else {
    console.error('--- FAIL ---', msg)
    process.exit(1)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function danmaku(text: string, uid = 'u1', name = '小明'): StandardEvent {
  return {
    type: 'danmaku', timestamp: Date.now(), roomId: '2233',
    user: { uid, name, fansMedal: { name: '星光', level: 10 } },
    data: { content: text },
  }
}

// ================= 1. 密度合并器（回归） =================
async function testBatcher(): Promise<void> {
  console.log('[1] 密度自适应合并器')
  const fires: BatchFire[] = []
  const mk = (cfg: Partial<MergeConfig>, collect = () => true) => {
    fires.length = 0
    const b = new AdaptiveBatcher({
      getConfig: () => ({ enabled: true, quietWindowMs: 8000, maxWaitMs: 30000, densityWindowSec: 10, densityThreshold: 15, maxBatch: 50, ...cfg }),
      shouldCollect: collect,
      onFire: (f) => fires.push(f),
    })
    b.start()
    return b
  }
  let b = mk({ quietWindowMs: 120 })
  b.push(danmaku('a'))
  await sleep(400)
  ok(fires.length === 1 && fires[0].reason === 'quiet', '静默窗口到期触发')
  b.stop()
  b = mk({ quietWindowMs: 60_000, densityWindowSec: 10, densityThreshold: 3 })
  b.push(danmaku('1')); b.push(danmaku('2')); b.push(danmaku('3'))
  ok(fires.length === 1 && fires[0].reason === 'density', '密度达标立即触发')
  b.stop()
  b = mk({ quietWindowMs: 60_000, maxBatch: 2 })
  b.push(danmaku('1')); b.push(danmaku('2'))
  ok(fires.length === 1 && fires[0].reason === 'max-batch', '单批上限立即触发')
  b.stop()
  b = mk({ quietWindowMs: 60_000, maxWaitMs: 250 })
  b.push(danmaku('1'))
  await sleep(120)
  b.push(danmaku('2'))
  await sleep(400)
  ok(fires.length === 1 && fires[0].reason === 'max-wait' && fires[0].events.length === 2, '最大等待封顶必发（2 条合并）')
  b.stop()
}

// ================= 2. 指令系统（Koishi 风格匹配 + 能力对齐） =================
async function testCommands(): Promise<void> {
  console.log('[2] 指令系统（别名 + 尾部参数）')
  const runs: Array<{ ability: string; args: Record<string, unknown>; uid: string }> = []
  const replies: string[] = []
  const emits: Array<Record<string, unknown>> = []
  let cfg: CommandsConfig = {
    enabled: true,
    items: [
      // 有参能力：别名开头 + 尾部参数；多别名按长度优先
      { id: 'c1', enabled: true, ability: 'jukebox_add_song', aliases: ['点歌', '来首'], args: {}, permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 0 }, successTemplate: '已点：{{message}}', failureTemplate: '', announceToFeed: true },
      // 渠道别名：固定 source + 更长别名（验证长度优先不被"点歌"抢占）
      { id: 'c2', enabled: true, ability: 'jukebox_add_song', aliases: ['点w歌', '网易点歌'], args: { source: 'netease' }, permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 0 }, successTemplate: '', failureTemplate: '', announceToFeed: false },
      // 无参能力：整条精确匹配
      { id: 'c3', enabled: true, ability: 'jukebox_skip_song', aliases: ['切歌', '跳过这首'], args: { selfOnly: true }, permission: { mode: 'guard' }, cooldown: { globalMs: 0, perUserMs: 0 }, successTemplate: '', failureTemplate: '', announceToFeed: false },
      // 查询类能力也可配指令（对齐原则）
      { id: 'c4', enabled: true, ability: 'jukebox_get_queue', aliases: ['看队列'], args: {}, permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 0 }, successTemplate: '{{message}}', failureTemplate: '', announceToFeed: false },
      // 冷却
      { id: 'c5', enabled: true, ability: 'jukebox_skip_song', aliases: ['冲'], args: {}, permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 60_000 }, successTemplate: '', failureTemplate: '', announceToFeed: false },
    ],
  }
  const abilityStub = {
    jukebox_add_song: { arg: 'rest', argKey: 'keyword' },
    jukebox_skip_song: { arg: 'none' },
    jukebox_get_queue: { arg: 'none' },
  } as Record<string, { arg: 'rest' | 'none'; argKey?: string }>
  const sys = new CommandSystem({
    getConfig: () => cfg,
    getAbility: (id) => {
      const stub = abilityStub[id]
      return stub ? { id, arg: stub.arg, argKey: stub.argKey } as never : undefined
    },
    expand: (t) => t.replace('{{message}}', '歌曲A').replace('{{user.name}}', '小明'),
    run: async (ability, args, event) => {
      runs.push({ ability: ability.id, args, uid: event.user?.uid ?? '' })
      return { ok: true, message: '歌曲A' }
    },
    reply: (t) => replies.push(t),
    emit: (data) => emits.push(data),
  })

  ok(await sys.handle(danmaku('点歌 晴天 周杰伦', 'u9')) === true, '有参指令命中（别名+空格+参数）')
  ok(runs[0].ability === 'jukebox_add_song' && runs[0].args.keyword === '晴天 周杰伦', '尾部参数透传 keyword')
  ok(await sys.handle(danmaku('点歌晴天', 'u9')) === true && runs[1].args.keyword === '晴天', '无空格前缀也可匹配（尾部为参数）')
  ok(await sys.handle(danmaku('点歌', 'u9')) === false, '仅别名无参数不消费（交给大脑）')
  ok(await sys.handle(danmaku('来首 起风了', 'u9')) === true && runs[2].args.keyword === '起风了', '多别名均可触发')

  runs.length = 0
  ok(await sys.handle(danmaku('点w歌 晴天')) === true, '渠道别名命中')
  ok(runs[0].ability === 'jukebox_add_song' && runs[0].args.source === 'netease' && runs[0].args.keyword === '晴天', '长度优先：长别名不被「点歌」抢占，固定 source 生效')

  const guardUser = danmaku('跳过这首', 'u2'); guardUser.user!.guardLevel = 3
  runs.length = 0
  ok(await sys.handle(danmaku('切歌', 'u1')) === false, '无舰长权限：无参指令不消费')
  ok(await sys.handle(guardUser) === true && runs.length === 1, '舰长权限：第二个别名整条命中')

  ok(await sys.handle(danmaku('看队列', 'u3')) === true, '查询类能力可配置为指令（对齐原则）')
  ok(replies.some((r) => r.includes('歌曲A')), '查询指令回执返回结果摘要')

  ok(await sys.handle(danmaku('冲', 'u5')) === true, '首次高频指令消费')
  ok(await sys.handle(danmaku('冲', 'u5')) === false, '同一用户冷却期内不消费')
  ok(await sys.handle(danmaku('冲', 'u6')) === true, '其他用户不受冷却影响')

  cfg = { ...cfg, enabled: false }
  ok(await sys.handle(danmaku('点歌 晴天')) === false, '指令系统停用时不匹配')
}

// ================= 3. 即时应对（条件矩阵 + 动作矩阵 + 变量矩阵） =================
async function testInstant(): Promise<void> {
  console.log('[3] 即时应对（条件/动作/变量矩阵）')
  const routed: Array<Array<{ method: string; text: string }>> = []
  const llmCalls: Array<{ directive?: string; rule: string }> = []
  const abilityRuns: Array<{ ability: string; args: Record<string, unknown> }> = []
  const emits: Array<Record<string, unknown>> = []
  const cfg: InstantConfig = {
    enabled: true,
    items: [
      { id: 'i1', name: '入场欢迎', enabled: true, eventType: 'enter', condition: {},
        action: { type: 'send-text', template: '欢迎 {{user.name}} 进入直播间~', channels: ['danmaku'] }, cooldownMs: 0, announceToFeed: true },
      { id: 'i2', name: '大额SC', enabled: true, eventType: 'superchat', condition: { minPrice: 50 },
        action: { type: 'llm', directive: '请优先回应这条SC' }, cooldownMs: 0, announceToFeed: true },
      { id: 'i3', name: '提问弹幕', enabled: true, eventType: 'danmaku',
        condition: { regex: '^(.+?)几点播$', guardOnly: false },
        action: { type: 'send-text', template: '{{user.name}} 问的是 {{match.1}}', channels: ['danmaku'] }, cooldownMs: 0, announceToFeed: false },
      { id: 'i4', name: '点歌成功致谢', enabled: true, eventType: 'system.jukebox.added',
        condition: { userRequestOnly: true },
        action: { type: 'send-text', template: '已收到 {{user.name ?? ""}}点的《{{song.title}}》', channels: ['danmaku'] }, cooldownMs: 0, announceToFeed: false },
      { id: 'i5', name: '上舰撒花', enabled: true, eventType: 'guard', condition: { guardLevels: [1, 2] },
        action: { type: 'run-ability', ability: 'live2d_motion', args: { motion: 'celebrate' } }, cooldownMs: 0, announceToFeed: false },
      { id: 'i6', name: '多前缀OR', enabled: true, eventType: 'danmaku', condition: { startsWith: ['晚安', '下了'] },
        action: { type: 'send-text', template: '再见', channels: ['danmaku'] }, cooldownMs: 0, announceToFeed: false },
      { id: 'i7', name: '多正则OR+AND', enabled: true, eventType: 'danmaku', condition: { regex: ['^A(.+)B$', '^主播(.+)几点$'], minMedalLevel: 5 },
        action: { type: 'send-text', template: '问的是 {{match.1}}', channels: ['danmaku'] }, cooldownMs: 0, announceToFeed: false },
      { id: 'i8', name: '礼物名OR', enabled: true, eventType: 'gift', condition: { giftName: ['小心心', '辣条'] },
        action: { type: 'send-text', template: '谢谢{{gift.name}}', channels: ['danmaku'] }, cooldownMs: 0, announceToFeed: false },
    ],
  }
  const engine = new InstantEngine({
    getConfig: () => cfg,
    getRoomId: () => '2233',
    route: async (segs) => { routed.push(segs) },
    onLlm: (event, directive, ruleName) => { llmCalls.push({ directive, rule: ruleName }) },
    runAbility: async (ability, args) => { abilityRuns.push({ ability, args }); return { ok: true, message: 'done' } },
    emit: (data) => { emits.push(data) },
  })

  const enter: StandardEvent = { type: 'enter', timestamp: Date.now(), roomId: '2233', user: { uid: 'u7', name: '阿伟' }, data: {} }
  ok(await engine.handle(enter) === true, '进入事件被欢迎规则消费')
  ok(routed[0][0].text === '欢迎 阿伟 进入直播间~', 'send-text 模板变量展开')

  const scSmall: StandardEvent = { type: 'superchat', timestamp: Date.now(), roomId: '2233', user: { uid: 'u1', name: '小红' }, data: { price: 10, message: '加油' } }
  ok(await engine.handle(scSmall) === false, '低于金额阈值的 SC 不触发（走合并器）')
  const scBig: StandardEvent = { ...scSmall, data: { price: 100, message: '加油' } }
  ok(await engine.handle(scBig) === true, '大额 SC 命中金额条件')
  ok(llmCalls.length === 1 && llmCalls[0].directive === '请优先回应这条SC', 'llm 动作携带定向指令')

  ok(await engine.handle(danmaku('主播几点播')) === true, '正则条件命中')
  ok(routed[routed.length - 1][0].text === '小明 问的是 主播', '正则捕获组变量 {{match.1}} 展开')
  ok(await engine.handle(danmaku('今天天气不错')) === false, '普通弹幕不被消费')

  // 系统事件触发即时应对（点歌成功）+ 事件专属变量
  const added: StandardEvent = { type: 'system.jukebox.added', timestamp: Date.now(), roomId: '2233', user: { uid: 'u1', name: '小红' }, data: { title: '晴天', artist: '周杰伦', source: 'netease', userName: '小红', position: 2 } }
  ok(await engine.handle(added) === true, '系统事件（点歌成功）可触发即时应对')
  ok(routed[routed.length - 1][0].text.includes('《晴天》'), '点歌变量 {{song.title}} 展开')

  // 上舰条件（等级多选）+ run-ability 动作
  const guard3: StandardEvent = { type: 'guard', timestamp: Date.now(), roomId: '2233', user: { uid: 'u8', name: '舰长哥', guardLevel: 3 }, data: { guardLevel: 3, guardName: '舰长', num: 1 } }
  ok(await engine.handle(guard3) === false, '舰长(3)不在条件等级 [总督,提督] 内：不触发')
  const guard2: StandardEvent = { ...guard3, user: { uid: 'u9', name: '提督姐', guardLevel: 2 }, data: { guardLevel: 2, guardName: '提督', num: 1 } }
  ok(await engine.handle(guard2) === true, '提督(2)命中等级多选条件')
  ok(abilityRuns.length === 1 && abilityRuns[0].ability === 'live2d_motion' && abilityRuns[0].args.motion === 'celebrate', 'run-ability 动作执行能力')

  // 多同类文本条件 OR（startsWith 两条任一命中）
  routed.length = 0
  ok(await engine.handle(danmaku('晚安啦大家')) === true, '多前缀条件：命中第一条（晚安）')
  ok(await engine.handle(danmaku('下了下了，去睡觉')) === true, '多前缀条件：命中第二条（下了）')
  ok(await engine.handle(danmaku('今天天气不错')) === false, '多前缀条件：都不命中不触发')

  // 多正则 OR + 跨条件 AND（粉丝牌 ≥5）；用例内容避开 i3 的提问正则
  routed.length = 0
  ok(await engine.handle(danmaku('主播今晚几点')) === true, '多正则条件：第二条命中')
  ok(routed[routed.length - 1][0].text === '问的是 今晚', '捕获组来自命中的那条正则（{{match.1}}=今晚）')
  const lowMedal = danmaku('主播今晚几点', 'u20', '新人'); lowMedal.user!.fansMedal!.level = 2
  ok(await engine.handle(lowMedal) === false, '正则命中但粉丝牌不足（跨条件 AND）：不触发')

  // 礼物名多值 OR
  routed.length = 0
  const gift1: StandardEvent = { type: 'gift', timestamp: Date.now(), roomId: '2233', user: { uid: 'u1', name: '小明' }, data: { giftName: '辣条', num: 1, price: 100 } }
  ok(await engine.handle(gift1) === true, '礼物名多值条件：命中第二项（辣条）')
  ok(routed[routed.length - 1][0].text === '谢谢辣条', '礼物变量 {{gift.name}} 展开')
  const gift2: StandardEvent = { ...gift1, data: { giftName: '小花花', num: 1, price: 100 } }
  ok(await engine.handle(gift2) === false, '礼物名不在多值列表：不触发')
}

// ================= 3.5 可观测性与链路缺陷（第八轮） =================
async function testObservability(): Promise<void> {
  console.log('[3.5] 可观测性：输出跳过回调 / uid=0 回退 / 断线补发 / 冷却不吞')

  // OutputRouter onSkip：通道禁用
  const skips: Array<{ method: string; reason: string }> = []
  const router = new OutputRouter({
    getConfig: () => ({ danmaku: { enabled: false, ratePerMinute: 20 }, display: { enabled: true, style: 'bubble', fontSize: 28, fontFile: '', fontFamily: '' }, tts: { enabled: false, delayBeforeSpeakMs: 0 } } as OutputConfig),
    getRoomId: () => '2233',
    sendDanmaku: () => { throw new Error('不应到达') },
    displayText: () => {},
    speak: () => {},
    onSkip: (method, _text, reason) => { skips.push({ method, reason }) },
  })
  const r1 = await router.route([{ method: 'danmaku', text: 'hi' }])
  ok(r1.skipped === 1 && skips.length === 1 && skips[0].method === 'danmaku' && skips[0].reason === 'disabled', '弹幕通道禁用时 onSkip(disabled) 触发且不发送')

  // OutputRouter onSkip：限流
  const sent: string[] = []
  const router2 = new OutputRouter({
    getConfig: () => ({ danmaku: { enabled: true, ratePerMinute: 2 }, display: { enabled: true, style: 'bubble', fontSize: 28, fontFile: '', fontFamily: '' }, tts: { enabled: false, delayBeforeSpeakMs: 0 } } as OutputConfig),
    getRoomId: () => '2233',
    sendDanmaku: (text) => { sent.push(text) },
    displayText: () => {},
    speak: () => {},
    onSkip: (method, _text, reason) => { skips.push({ method, reason }) },
  })
  await router2.route([{ method: 'danmaku', text: 'a' }])
  await router2.route([{ method: 'danmaku', text: 'b' }])
  const r3 = await router2.route([{ method: 'danmaku', text: 'c' }])
  ok(sent.length === 2 && r3.skipped === 1 && skips[skips.length - 1].reason === 'rate-limited', '超出每分钟上限时第 3 条被跳过且 onSkip(rate-limited) 触发')

  // EventBridge：open 模式 enter 事件 uid=0 → 回退 open_id
  const fakeCtx = { on: () => () => {} }
  const fakeBackend = { isConnected: () => true, request: async () => ({}) }
  const fakeLogger = { warn: () => {}, info: () => {} }
  const bridge: any = new EventBridge(fakeCtx as never, { roomId: '2233' } as never, fakeBackend as never, fakeLogger as never)
  const ev = bridge.standard({ uid: 0, uname: '小明', open_id: 'OPEN123', roomId: '2233' }, 'enter', {})
  ok(ev.user?.uid === 'OPEN123' && ev.user?.name === '小明', 'uid=0 回退 open_id（open 模式 enter）')
  const ev2 = bridge.standard({ uid: 42, uname: '小红', roomId: '2233' }, 'danmaku', { content: 'hi' })
  ok(ev2.user?.uid === '42', '正常 uid 不受影响')

  // EventBridge：断线队列补发
  const queued: Array<{ roomId: string; event: StandardEvent }> = []
  const fakeBackend2: any = {
    isConnected: () => true,
    request: async (_method: string, params: { roomId: string; event: StandardEvent }) => { queued.push(params) },
  }
  const bridge2: any = new EventBridge(fakeCtx as never, { roomId: '2233' } as never, fakeBackend2 as never, fakeLogger as never)
  bridge2.disconnectQueue.push({ roomId: '2233', event: danmaku('断线弹幕') })
  bridge2.disconnectQueue.push({ roomId: '2233', event: danmaku('断线弹幕2') })
  bridge2.flushDisconnectQueue()
  await new Promise((r) => setTimeout(r, 50))
  ok(queued.length === 2 && queued[0].event.data.content === '断线弹幕', '重连后断线队列全部补发')
  ok(bridge2.disconnectQueue.length === 0, '补发后队列清空')

  // instant：全部通道被跳过时 sent=0、不消耗冷却
  let routeCalls = 0
  const cfg: InstantConfig = {
    enabled: true,
    items: [{
      id: 'i-skip', name: '欢迎', enabled: true, eventType: 'enter', condition: {},
      action: { type: 'send-text', template: '欢迎 {{user.name}}', channels: ['danmaku'] },
      cooldownMs: 60_000, announceToFeed: true,
    }],
  }
  const emits: Array<Record<string, unknown>> = []
  const engine2 = new InstantEngine({
    getConfig: () => cfg,
    getRoomId: () => '2233',
    route: async () => { routeCalls++; return { sent: 0, skipped: 1 } },
    onLlm: () => {},
    runAbility: async () => ({ ok: true, message: '' }),
    emit: (data) => { emits.push(data) },
  })
  const e1: StandardEvent = { type: 'enter', timestamp: Date.now(), roomId: '2233', user: { uid: 'u1', name: '小明' }, data: {} }
  await engine2.handle(e1)
  ok(routeCalls === 1 && emits.length === 1 && emits[0].sent === 0 && emits[0].skipped === 1, 'instant.sent 携带 sent/skipped 结果（全跳过 sent=0）')
  await engine2.handle({ ...e1, user: { uid: 'u2', name: '小红' } })
  ok(routeCalls === 2, '全部通道被跳过不消耗冷却（下一条立即重试）')
}

// ================= 4. 上下文清单（纯清单 + 纯示例预览） =================
async function testContext(): Promise<void> {
  console.log('[4] 上下文清单与预览')
  const feed: FeedConfig = {
    include: { danmaku: true, like: false, 'system.jukebox.added': true },
    maxEvents: 4,
  }
  const events: StandardEvent[] = [
    danmaku('第一条', 'u1', '小明'),
    { type: 'like', timestamp: Date.now(), roomId: 'r', data: { count: 1 }, user: { uid: 'x', name: '赞哥' } },
    { type: 'system.jukebox.added', timestamp: Date.now(), roomId: 'r', data: { title: '晴天', artist: '周杰伦', userName: '小红', position: 2 } },
    danmaku('第二条', 'u2', '小红'),
    danmaku('第三条', 'u3', '小刚'),
  ]
  const builder = new ContextBuilder({
    getFeedConfig: () => feed,
    getHistory: () => events,
  })
  const built = builder.build()
  const lines = built.feedBlock.split('\n')
  ok(lines.length === 4, `include 过滤 + maxEvents 截断（期望4行，实际 ${lines.length}）`)
  ok(!built.feedBlock.includes('赞哥'), 'like 未入清单不出现')
  ok(built.feedBlock.includes('《晴天》已加入队列'), '系统点歌事件以主播视角呈现')
  ok(built.feedBlock.includes('] 弹幕 | 小明:'), '清单行 [HH:mm:ss] 分类 | 内容 样式')
  ok(!built.feedBlock.includes('当前观众') && !built.feedBlock.includes('你最近说过'), '观众表/自我记忆块不再拼进 user 消息')

  // 预览：纯样式示例（不含真实事件），随 override 即时变化
  const previewAll = builder.preview({ danmaku: true, gift: true, superchat: true, like: false }, 30)
  ok(previewAll.lines.length >= 3 && previewAll.lines.some((l) => l.includes('弹幕 |')) && previewAll.lines.some((l) => l.includes('礼物 |')), '预览按 override 渲染开启类型的示例行')
  ok(!previewAll.lines.some((l) => l.includes('赞哥') || l.includes('晴天已加入')), '预览不含真实事件（纯示例）')
  ok(!previewAll.lines.some((l) => l.includes('点赞')), '未开启类型不出现在预览')
  const previewCapped = builder.preview({ danmaku: true, gift: true }, 1)
  ok(previewCapped.lines.length === 1 && previewCapped.count === 1, '预览遵守 maxEvents 上限')
}

// ================= 5. 配置迁移 =================
async function testMigration(): Promise<void> {
  console.log('[5] 配置迁移（directOrder / 旧指令格式 / 旧即时格式 / 旧触发器忽略）')
  const dir = path.join(__dirname, '..', 'data', 'test-migration')
  fs.mkdirSync(dir, { recursive: true })

  // 场景 A：directOrder 时代（无 commands 键）→ 迁移为指令
  const cfgA = path.join(dir, 'config-a.json')
  fs.writeFileSync(cfgA, JSON.stringify({
    roomId: '2233',
    music: {
      directOrder: { enabled: true, keywords: ['点歌'], channelCommands: { netease: ['点w歌'] }, pluginCommand: false },
      skipCommand: { enabled: true, keywords: ['切歌'], selfOnly: true },
    },
    triggers: [{ id: 'old-rule', enabled: true, mode: 'immediate', eventTypes: ['danmaku'] }],
  }), 'utf-8')
  const cfg = loadConfig(cfgA)
  const orderCmds = cfg.commands.items.filter((i) => i.ability === 'jukebox_add_song')
  ok(orderCmds.some((i) => i.aliases.includes('点歌')), 'directOrder 通用词迁移为别名')
  ok(orderCmds.some((i) => i.aliases.includes('点w歌') && i.args?.source === 'netease'), '渠道触发词迁移为别名 + 固定 source')
  ok(cfg.commands.items.some((i) => i.ability === 'jukebox_skip_song' && i.aliases.includes('切歌') && i.args?.selfOnly === true), '切歌迁移并保留 selfOnly')
  ok(!Array.isArray((cfg as unknown as Record<string, unknown>).triggers) || !(cfg as unknown as { triggers?: unknown[] }).triggers?.length, '旧触发器配置被忽略清除')

  // 场景 B：第一轮重构格式（keyword/match + action 字符串）→ 迁移为新格式
  const cfgB = path.join(dir, 'config-b.json')
  fs.writeFileSync(cfgB, JSON.stringify({
    roomId: '2233',
    commands: { enabled: true, items: [{ id: 'legacy', enabled: true, match: 'prefix', keyword: '换装', command: 'live2d-costume', args: {}, permission: { mode: 'all' }, cooldown: { globalMs: 0, perUserMs: 0 }, successTemplate: '', failureTemplate: '', announceToFeed: true }] },
    instant: { enabled: true, items: [{ id: 'old-inst', name: '欢迎', enabled: true, condition: { type: 'enter' }, action: 'template-reply', template: '欢迎 {{user.name}}', args: {}, channels: ['danmaku'], cooldownMs: 0, announceToFeed: true }] },
  }), 'utf-8')
  const cfg2 = loadConfig(cfgB)
  ok(cfg2.commands.items.some((i) => i.ability === 'live2d_costume' && (i.aliases ?? []).includes('换装')), '旧指令格式（keyword/command）迁移为 aliases/ability')
  const inst = cfg2.instant.items.find((i) => i.id === 'old-inst')
  ok(inst && inst.eventType === 'enter' && inst.action.type === 'send-text' && (inst.action as { template?: string }).template === '欢迎 {{user.name}}', '旧即时格式迁移为 eventType + action 对象')
}

// ================= 6. 服务级：能力对齐 + 指令/即时端到端 + 认知留痕 =================
function startMockLlm(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const sys = JSON.stringify(body.messages ?? [])
      const send = (obj: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (sys.includes('STAY_SILENT_TEST')) {
        send({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'stay_silent', arguments: '{"reason":"只是打卡弹幕"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      } else {
        send({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'send_reply', arguments: '{"segments":[{"method":"danmaku","text":"大家好！"}]}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }))
  })
}

function connectWs(port: number): Promise<{ call: (method: string, params?: unknown) => Promise<any>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let nextId = 1
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
    ws.on('open', () => {
      resolve({
        call: (method, params = {}) => new Promise((res2, rej2) => {
          const id = nextId++
          pending.set(id, { resolve: res2, reject: rej2 })
          ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
        }),
        close: () => ws.close(),
      })
    })
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d))
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) entry.reject(new Error(msg.error.message))
        else entry.resolve(msg.result)
      }
    })
    ws.on('error', reject)
  })
}

function cfgHasVariables(cfg: any): boolean {
  return Boolean(cfg?.llm?.variables?.history?.sources && cfg?.llm?.variables?.now)
}

async function testService(): Promise<void> {
  console.log('[6] 服务级：能力对齐 + 端到端 + 认知留痕')
  const configPath = path.join(__dirname, '..', 'data', 'test-instance', 'config.json')
  // 独立端口 + 空闲 IPC：生产实例常驻 19274/19275，测试必须避开并不得触碰真实执行器
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      roomId: '2233',
      server: { host: '127.0.0.1', httpPort: 19298, wsPort: 19299 },
      live2dCpp: { ipcPort: 19290, autoStart: false, reconnectMs: 60000 },
      audioCpp: { ipcPort: 19291, autoStart: false, reconnectMs: 60000 },
    }), 'utf-8')
  }
  process.env.VTUBER_CONFIG = configPath
  const svc = new VtuberService()
  await svc.start()
  const port = (svc.config as any).server?.wsPort ?? 19299
  const rpc = await connectWs(port)
  const mock = await startMockLlm()

  try {
    await rpc.call('config.updatePaths', {
      entries: [
        { path: 'llm.provider', value: 'openai' },
        { path: 'llm.baseURL', value: `http://127.0.0.1:${mock.port}/v1` },
        { path: 'llm.apiKey', value: 'sk-behavior-test' },
        { path: 'llm.model', value: 'mock-model' },
        { path: 'llm.systemPrompt', value: 'STAY_SILENT_TEST 你是测试主播。\n你最近说过：{{memory}}' },
        { path: 'behavior.merge.quietWindowMs', value: 150 },
      ],
    })

    // 能力对齐：abilities.list 与 llm.tools
    const abilities = (await rpc.call('abilities.list', {})).abilities
    ok(abilities.length >= 12, `预置能力 ${abilities.length} 项`)
    const tools = (await rpc.call('llm.tools', {})).tools.map((t: any) => t.name)
    ok(abilities.every((a: any) => tools.includes(a.id)), '全部能力已注册为 LLM 工具（双向对齐）')
    ok(tools.includes('jukebox_restart') && tools.includes('live2d_reload'), '新增能力（重启点歌机/重载模型）同时入工具面')

    // 即时应对 schema 下发
    const schema = await rpc.call('instant.schema', {})
    ok(schema.conditions.danmaku.fields.some((f: any) => f.key === 'regex'), 'instant.schema 下发弹幕正则条件')
    ok((schema.variables.superchat || []).some((v: { token: string }) => v.token === '{{sc.price}}'), 'instant.schema 下发 SC 变量（含含义文档）')
    ok((schema.variables.common || []).every((v: { desc?: string }) => v.desc), '变量文档全部带含义说明')

    // 清单预览：纯样式示例（sample 标记 + 不含真实事件）
    const feedPrev = await rpc.call('feed.preview', { include: { danmaku: true, gift: false }, maxEvents: 30 })
    ok(feedPrev.sample === true && Array.isArray(feedPrev.lines) && feedPrev.lines.some((l: string) => l.includes('弹幕 |')), 'feed.preview 返回纯示例清单')
    ok(!feedPrev.lines.some((l: string) => l.includes('礼物 |')), '未开启类型不出现在预览（override 生效）')

    // 指令端到端：默认「切歌」指令走能力执行（点歌机未启动 → 失败路径，但指令链路与清单留痕完整）
    svc.onEvent(danmaku('切歌', 'u1', '小明'))
    await sleep(300)
    const cmdTraces = svc.history.recent(20).filter((e) => e.type === 'system.command.executed')
    ok(cmdTraces.length >= 1, '指令执行写入清单 system.command.executed')

    // 沉默决策留痕 + {{memory}} 注入 system
    svc.onEvent(danmaku('打卡', 'u1', '小明'))
    await sleep(900)
    const traces1 = await rpc.call('trace.list', { limit: 5, source: 'batcher' })
    const last1 = traces1.traces[0]
    ok(last1 && last1.decision === 'silent' && last1.silent_reason === '只是打卡弹幕', '沉默决策留痕')
    ok(String(last1.system_prompt).includes('你最近说过：'), '{{memory}} 变量在 system 提示词中展开')
    ok(!String(last1.user_prompt).includes('当前观众') && !String(last1.user_prompt).includes('你最近说过'), '附加上下文块已从 user 消息移除')

    // 变量系统：{{history}} 过滤与条数、{{now}} 自定义格式、{{state.*}} 后端状态注入
    ok(cfgHasVariables(await rpc.call('config.get', {})), 'llm.variables 默认设置就位')
    await rpc.call('config.updatePaths', {
      entries: [
        { path: 'llm.systemPrompt', value: 'STAY_SILENT_TEST 你是测试主播。\n历史：\n{{history}}\n时间：{{now}}' },
        {
          path: 'llm.variables',
          value: {
            history: { count: 2, sources: { danmaku: true, gift: false, superchat: false, enter: false, follow: false, like: false, guard: false, liveStart: false, liveEnd: false, system: false } },
            now: { detail: 'datetime', timezone: 'utc', offsetHours: 0, template: 'MM月DD日HH点' },
          },
        },
      ],
    })
    svc.onEvent(danmaku('第一条', 'u10', '甲'))
    svc.onEvent({ type: 'gift', timestamp: Date.now(), roomId: '2233', user: { uid: 'u11', name: '乙' }, data: { giftName: '小心心', num: 1, price: 100 } })
    svc.onEvent(danmaku('第二条', 'u12', '丙'))
    await sleep(900)
    const varTrace = (await rpc.call('trace.list', { limit: 1 })).traces[0]
    const sys = String(varTrace.system_prompt)
    ok(sys.includes('第一条') && sys.includes('第二条'), '{{history}} 包含弹幕来源历史（count=2 截断最新两条）')
    ok(!sys.includes('小心心'), '{{history}} 按来源过滤（礼物被排除）')
    ok(/\d{2}月\d{2}日\d{2}点/.test(sys), '{{now}} 按自定义模板格式化')
    // 引用 state 后注入
    await rpc.call('config.updatePaths', { entries: [{ path: 'llm.systemPrompt', value: '你是测试主播。\n播放：{{state.jukebox.playing}}\n队列：{{state.jukebox.queue}}\n模型：{{state.live2d.model}}' }] })
    svc.onEvent(danmaku('查状态', 'u13', '丁'))
    await sleep(900)
    const stateTrace = (await rpc.call('trace.list', { limit: 1 })).traces[0]
    ok(String(stateTrace.system_prompt).includes('播放：（空闲）') && String(stateTrace.system_prompt).includes('队列：0 首'), '{{state.jukebox.*}} 后端状态变量注入')

    // 发言 → 记忆记录 → 下一次 system 注入记忆内容
    await rpc.call('config.updatePaths', { entries: [{ path: 'llm.systemPrompt', value: '你是测试主播。\n你最近说过：{{memory}}' }] })
    svc.onEvent(danmaku('介绍一下自己', 'u2', '小红'))
    await sleep(900)
    const traces2 = await rpc.call('trace.list', { limit: 5, source: 'batcher' })
    ok(traces2.traces[0]?.decision === 'replied', 'send_reply 路径判定为发言')
    svc.onEvent(danmaku('再说说', 'u3', '小刚'))
    await sleep(900)
    const traces3 = await rpc.call('trace.list', { limit: 1 })
    ok(String(traces3.traces[0].system_prompt).includes('大家好！'), '自我记忆经 {{memory}} 注入下一次 system 提示词')

    // Prompt 预演（真实数据）
    const prompt = await rpc.call('prompt.preview', {})
    ok(String(prompt.user).includes('=== 直播间实时状况'), 'prompt.preview 返回完整 user 消息')

    // 旧触发器 RPC 已删除
    let triggerRpcGone = false
    try { await rpc.call('trigger.list', {}) } catch { triggerRpcGone = true }
    ok(triggerRpcGone, 'trigger.* RPC 已随旧引擎删除')

    await svc.stop()
    rpc.close()
    mock.server.close()
  } catch (e) {
    console.error('--- FAIL ---', e)
    try { await svc.stop() } catch { /* 忽略 */ }
    process.exit(1)
  }
}

async function main(): Promise<void> {
  await testBatcher()
  await testCommands()
  await testInstant()
  await testObservability()
  await testContext()
  await testMigration()
  await testService()
  console.log(`--- PASS --- (${passed} assertions)`)
  setTimeout(() => process.exit(0), 300).unref()
}

void main()

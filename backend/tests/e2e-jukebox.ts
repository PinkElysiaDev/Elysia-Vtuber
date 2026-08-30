/**
 * E2E：点歌机大改版后端 —— 旧 idlePlaylist→分组迁移、新 RPC 面（pause/resume/seek/previous/playNow/history）、
 * 播放失败也写「失败」历史记录并落盘。全程无执行器/无外网（stub media + 未知 provider 让 url 解析失败）。
 * 运行：npx ts-node tests/e2e-jukebox.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { WebSocket } from 'ws'
import { VtuberService } from '../src/index'
import { Jukebox } from '../src/music/jukebox'
import type { MusicConfig } from '../src/config'
import type { CppClient } from '../src/cpp/client'
import type { ProviderRegistry } from '../src/music/registry'

function fail(msg: string): never {
  console.error('--- FAIL ---', msg)
  process.exit(1)
}

function connectWs(port: number): Promise<{
  call: (method: string, params?: unknown) => Promise<any>
  on: (method: string, cb: (params: any) => void) => void
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    let nextId = 1
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
    const notifyHandlers = new Map<string, Array<(params: any) => void>>()
    ws.on('open', () => {
      resolve({
        call: (method, params = {}) => new Promise((res2, rej2) => {
          const id = nextId++
          pending.set(id, { resolve: res2, reject: rej2 })
          ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
        }),
        on: (method, cb) => {
          const list = notifyHandlers.get(method) ?? []
          list.push(cb)
          notifyHandlers.set(method, list)
        },
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
      } else if (msg.method && notifyHandlers.has(msg.method)) {
        for (const cb of notifyHandlers.get(msg.method)!) cb(msg.params)
      }
    })
    ws.on('error', reject)
  })
}

async function main() {
  const configPath = path.join(__dirname, '..', 'data', 'test-instance', 'config.json')
  const dbPath = path.join(__dirname, '..', 'data', 'test-instance', 'data', 'vtuber.db')
  try { fs.unlinkSync(dbPath) } catch { /* 无旧文件 */ }

  // 1) 迁移：把旧平铺 idlePlaylist 写进配置文件，服务启动时 loadConfig 迁移为分组
  const rawCfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  rawCfg.music.idlePlaylist = ['testsrc:111', 'testsrc:222']
  delete rawCfg.music.idlePlaylists
  // 自动上线 + 关闭待机循环：开机 advance 对垃圾 ref 只尝试一轮即放弃，
  // 否则 nextIdleItem 持旧配置死循环（约 250ms/次的网络失败）阻塞后续 playNow 用例
  rawCfg.music.autoStartJukebox = true
  rawCfg.music.idleLoop = false
  fs.writeFileSync(configPath, JSON.stringify(rawCfg, null, 2), 'utf-8')

  process.env.VTUBER_CONFIG = configPath
  const svc = new VtuberService()
  await svc.start()
  const port = (svc.config as any).server?.wsPort ?? 19279
  const rpc = await connectWs(port)

  try {
    // 自动上线：autoStartJukebox=true 时服务启动后点歌机即 running
    const stAuto = await rpc.call('jukebox.getState')
    if (!stAuto.running) fail('autoStartJukebox 未生效：服务启动后点歌机应自动在线')
    console.log('✓ 自动上线: autoStartJukebox=true 启动即在线')

    // 迁移断言
    const cfg1 = await rpc.call('config.get')
    const groups = cfg1.music.idlePlaylists ?? []
    if (groups.length !== 1 || groups[0].name !== '默认歌单' || JSON.stringify(groups[0].songs) !== JSON.stringify(['testsrc:111', 'testsrc:222'])) {
      fail('idlePlaylist → idlePlaylists 迁移不对: ' + JSON.stringify(groups))
    }
    console.log('✓ 迁移：旧平铺 idlePlaylist → 「默认歌单」分组')

    // idle.resolve 返回分组结构
    const idle = await rpc.call('jukebox.idle.resolve')
    if (!Array.isArray(idle.groups) || idle.groups.length !== 1 || idle.groups[0].songs.length !== 2) {
      fail('idle.resolve 分组结构不对: ' + JSON.stringify(idle).slice(0, 200))
    }
    console.log('✓ idle.resolve：分组结构（1 组 2 首，含 ok/title 字段）')

    // 清空 idlePlaylists（防止 advance 被空闲歌曲的网络解析阻塞）
    await rpc.call('config.updatePaths', { entries: [{ path: 'music.idlePlaylists', value: [] }] })

    // 空态错误路径
    const p1 = await rpc.call('jukebox.pause')
    if (p1.success) fail('无播放时 pause 应失败')
    const s1 = await rpc.call('jukebox.seek', { sec: 10 })
    if (s1.success) fail('无播放时 seek 应失败')
    const prev1 = await rpc.call('jukebox.previous')
    if (prev1.success) fail('无历史时 previous 应失败')
    const h0 = await rpc.call('jukebox.history.list')
    if (!Array.isArray(h0.records)) fail('history.list 结构不对')
    console.log('✓ 空态：pause/seek/previous 结构化失败，history.list 可用')

    // playNow（stub media：songId+title 免网络；未知 provider 让 url 解析失败 → 「失败」历史落盘）
    await rpc.call('jukebox.start')
    const pn = await rpc.call('jukebox.playNow', { songId: 'stub-song-1', source: 'testsrc', title: '测试歌曲', artist: '测试歌手' })
    if (!pn.success) fail('playNow 应成功入队切歌: ' + JSON.stringify(pn))
    await new Promise((r) => setTimeout(r, 1200))
    const h1 = await rpc.call('jukebox.history.list')
    const rec = h1.records.find((r: any) => r.title === '测试歌曲')
    if (!rec || rec.status !== 'failed' || !rec.endedAt) {
      fail('播放失败应写「失败」记录: ' + JSON.stringify(h1.records.slice(0, 2)))
    }
    if (!fs.existsSync(dbPath)) fail('播放记录未落盘（SQLite）: ' + dbPath)
    if (rec.userName !== 'console' || !rec.requestedAt || !rec.startedAt) fail('记录字段不全: ' + JSON.stringify(rec))
    console.log('✓ playNow → 解析失败 → 「失败」记录落盘（点歌/播放时间/状态齐全）')

    // previous：有历史（失败记录含 songId/source）→ resolveMedia 兜底 stub → 再失败再记一条
    const prev2 = await rpc.call('jukebox.previous')
    if (!prev2.success) fail('previous 应可重播: ' + JSON.stringify(prev2))
    await new Promise((r) => setTimeout(r, 1200))
    const h2 = await rpc.call('jukebox.history.list')
    if (h2.records.length < 2) fail('第二次播放未记录: ' + h2.records.length)
    console.log('✓ previous：从历史重播并再次记录')

    // resume 空态
    const r1 = await rpc.call('jukebox.resume')
    if (r1.success) fail('空态 resume 应失败')
    console.log('✓ 空态 resume 结构化失败')

    // ===== 切歌指令（RPC 链路）：event.ingest 弹幕 → 精确匹配 → jukebox.skipCommanded 广播 =====
    await rpc.call('config.updatePaths', { entries: [{ path: 'events.enabled', value: true }] })
    await rpc.call('config.updatePaths', { entries: [{ path: 'music.skipCommand', value: { enabled: true, keywords: ['切歌'], selfOnly: true } }] })
    const skipNotes: any[] = []
    rpc.on('jukebox.skipCommanded', (p) => skipNotes.push(p))
    const mkDanmaku = (content: string, uid: string, name: string) => ({
      type: 'danmaku', roomId: 'test-room', timestamp: Date.now(),
      user: { uid, name }, data: { content },
    })
    // 非精确匹配（"切歌一下"）不触发
    await rpc.call('event.ingest', { event: mkDanmaku('切歌一下', '30003', '路人') })
    await new Promise((r) => setTimeout(r, 250))
    const skipCnt0 = skipNotes.length
    if (skipCnt0 !== 0) fail('非精确匹配弹幕不应触发切歌: ' + JSON.stringify(skipNotes))
    // 精确匹配触发（空队列 → skip 结构化失败，广播 ok:false）
    await rpc.call('event.ingest', { event: mkDanmaku('切歌', '30003', '路人') })
    await new Promise((r) => setTimeout(r, 250))
    const skipCnt1 = skipNotes.length
    if (skipCnt1 !== 1 || skipNotes[0].ok !== false || !skipNotes[0].user) {
      fail('精确匹配应广播切歌结果: ' + JSON.stringify(skipNotes))
    }
    console.log('✓ 切歌指令（RPC 链路）：精确匹配触发并广播；非精确弹幕不触发')

    // ===== 切歌指令（selfOnly 语义）：独立 Jukebox + fake cpp 构造持续 nowPlaying =====
    const skCfg: MusicConfig = {
      defaultSource: 'fake', maxDuration: 0, maxQueueSize: 50, maxPerUser: 3,
      idlePlaylist: [], idlePlaylists: [], idleLoop: true,
      directOrder: { enabled: false, keywords: [], channelCommands: {}, pluginCommand: false },
      skipCommand: { enabled: true, keywords: ['切歌'], selfOnly: true },
      nowPlaying: { outputs: [], windowEnabled: false, queueItemTemplate: '' },
      autoStartJukebox: false,
      dedupe: false,
      outputDevice: '', sessions: {},
    }
    const skNotes: any[] = []
    const fakeCpp = {
      onEvent: (_e: string, _fn: (p: unknown) => void) => () => { /* noop */ },
      safeRequest: async () => ({ ok: true }),
    } as unknown as CppClient
    const fakeRegistry = {
      names: () => ['fake'],
      url: async () => [{ url: 'http://127.0.0.1/fake.mp3', headers: {} }],
      lyric: async () => [null],
    } as unknown as ProviderRegistry
    const jb = new Jukebox({
      getConfig: () => skCfg,
      cpp: fakeCpp,
      broadcast: (method, params) => { if (method === 'jukebox.skipCommanded') skNotes.push(params) },
      registry: fakeRegistry,
    })
    const added = await jb.add({ songId: 's1', source: 'fake', title: 'selfOnly 测试曲', userId: '10001', userName: '点歌人A' })
    if (!added.success) fail('stub 点歌应成功: ' + JSON.stringify(added))
    jb.start()
    await new Promise((r) => setTimeout(r, 300))
    let st = jb.getState()
    if (!st.playing || st.nowPlaying?.title !== 'selfOnly 测试曲') fail('fake cpp 应开播成功: ' + JSON.stringify(st.nowPlaying))
    // 他人切歌：selfOnly 拒绝
    if (!jb.tryDirectOrder({ type: 'danmaku', roomId: 'r', timestamp: Date.now(), user: { uid: '20002', name: '路人B' }, data: { content: '切歌' } })) fail('切歌指令应被识别')
    const skCnt1 = skNotes.length
    if (skCnt1 !== 1 || skNotes[0].ok !== false || skNotes[0].message !== '只能切自己点的歌') {
      fail('selfOnly 应拒绝他人切歌: ' + JSON.stringify(skNotes))
    }
    st = jb.getState()
    if (!st.playing || st.nowPlaying?.title !== 'selfOnly 测试曲') fail('被拒绝后不应切歌')
    // 点歌人本人切歌：成功
    if (!jb.tryDirectOrder({ type: 'danmaku', roomId: 'r', timestamp: Date.now(), user: { uid: '10001', name: '点歌人A' }, data: { content: '切歌' } })) fail('切歌指令应被识别')
    const skCnt2 = skNotes.length
    if (skCnt2 !== 2 || skNotes[1].ok !== true) fail('本人切歌应成功: ' + JSON.stringify(skNotes))
    await new Promise((r) => setTimeout(r, 300))
    st = jb.getState()
    if (st.playing) fail('切歌后队列与空闲皆空应停止: ' + JSON.stringify(st.nowPlaying))
    // 关闭开关后不触发
    skCfg.skipCommand.enabled = false
    if (jb.tryDirectOrder({ type: 'danmaku', roomId: 'r', timestamp: Date.now(), user: { uid: '10001', name: '点歌人A' }, data: { content: '切歌' } })) fail('关闭后不应触发')
    const skCnt3 = skNotes.length
    if (skCnt3 !== 2) fail('关闭后不应有新广播')
    jb.stop()
    console.log('✓ 切歌指令（selfOnly）：他人被拒 / 本人切歌成功 / 关闭开关失效')

    // ===== 控制台豁免：console 不受「播放列表内单用户最大点歌数」限制 =====
    await rpc.call('jukebox.stop')
    await rpc.call('config.updatePaths', { entries: [{ path: 'music.maxPerUser', value: 1 }] })
    for (let i = 1; i <= 3; i++) {
      const r = await rpc.call('jukebox.add', { songId: 'cx' + i, source: 'testsrc', title: '豁免' + i, userId: 'console', userName: 'console' })
      if (!r.success) fail('console 加歌应豁免每人上限: ' + JSON.stringify(r))
    }
    const v1 = await rpc.call('jukebox.add', { songId: 'vx1', source: 'testsrc', title: '观众曲', userId: '90001', userName: '观众' })
    if (!v1.success) fail('观众第一首应成功: ' + JSON.stringify(v1))
    const v2 = await rpc.call('jukebox.add', { songId: 'vx2', source: 'testsrc', title: '观众曲2', userId: '90001', userName: '观众' })
    if (v2.success || !String(v2.message).includes('播放列表内每人最多点')) fail('观众第二首应被拒（新文案）: ' + JSON.stringify(v2))
    const q = await rpc.call('jukebox.getQueue')
    if ((q.queue ?? []).length !== 4) fail('队列长度应为 4（3 console + 1 观众）: ' + JSON.stringify(q).slice(0, 200))
    await rpc.call('jukebox.queue.clear')
    await rpc.call('config.updatePaths', { entries: [{ path: 'music.maxPerUser', value: 3 }] })
    console.log('✓ 控制台豁免：console 连点 3 首不受限；观众超限被拒（新文案）')

    // ===== 点歌去重：同 ID 拒绝 / 不同 ID 通过 / console 豁免 =====
    await rpc.call('config.updatePaths', { entries: [{ path: 'music.dedupe', value: true }] })
    const d1 = await rpc.call('jukebox.add', { songId: 'dup-1', source: 'testsrc', title: '去重曲A', userId: '70001', userName: '观众甲' })
    if (!d1.success) fail('去重开: 首次点歌应成功: ' + JSON.stringify(d1))
    const d2 = await rpc.call('jukebox.add', { songId: 'dup-1', source: 'testsrc', title: '去重曲A(重复)', userId: '70002', userName: '观众乙' })
    if (d2.success || !String(d2.message).includes('已在播放列表')) fail('同 ID 应被拒: ' + JSON.stringify(d2))
    const d3 = await rpc.call('jukebox.add', { songId: 'dup-1', source: 'testsrc', title: '去重曲A(console)', userId: 'console', userName: 'console' })
    if (d3.success || !String(d3.message).includes('已在播放列表')) fail('console 添加同 ID 也应被拒（列表不重复）: ' + JSON.stringify(d3))
    const d4 = await rpc.call('jukebox.add', { songId: 'dup-2', source: 'testsrc', title: '去重曲B', userId: '70002', userName: '观众乙' })
    if (!d4.success) fail('不同 ID（不同版本）应通过: ' + JSON.stringify(d4))
    const d5 = await rpc.call('jukebox.add', { songId: 'dup-3', source: 'testsrc', title: '去重曲C', userId: 'console', userName: 'console' })
    if (!d5.success) fail('console 添加非重复曲应通过: ' + JSON.stringify(d5))
    await rpc.call('jukebox.queue.clear')
    await rpc.call('config.updatePaths', { entries: [{ path: 'music.dedupe', value: false }] })
    console.log('✓ 点歌去重: 观众/console 同 ID 均拒绝；不同版本通过')

    // ===== 测试提示音断点续播：暂停式播放 → ended(bytes://) → positionMs 续播 =====
    const tcCfg: MusicConfig = {
      defaultSource: 'fake', maxDuration: 0, maxQueueSize: 50, maxPerUser: 3,
      idlePlaylist: [], idlePlaylists: [], idleLoop: true,
      directOrder: { enabled: false, keywords: [], channelCommands: {}, pluginCommand: false },
      skipCommand: { enabled: false, keywords: [], selfOnly: true },
      nowPlaying: { outputs: [], windowEnabled: false, queueItemTemplate: '' },
      autoStartJukebox: false, dedupe: false, outputDevice: '', sessions: {},
    }
    const playCalls: Array<{ method: string; params: any }> = []
    const endedHandlers: Array<(p: unknown) => void> = []
    const fakeCppTc = {
      onEvent: (_e: string, fn: (p: unknown) => void) => { endedHandlers.push(fn); return () => { /* noop */ } },
      safeRequest: async (method: string, params?: unknown) => { playCalls.push({ method, params }); return { ok: true } },
    } as unknown as CppClient
    const fakeRegistryTc = {
      names: () => ['fake'],
      url: async () => [{ url: 'http://127.0.0.1/fake.mp3', headers: {} }],
      lyric: async () => [null],
    } as unknown as ProviderRegistry
    const jbTc = new Jukebox({
      getConfig: () => tcCfg,
      cpp: fakeCppTc,
      broadcast: () => { /* noop */ },
      registry: fakeRegistryTc,
    })
    await jbTc.add({ songId: 't1', source: 'fake', title: '断点测试曲', userId: '10001', userName: '测试者' })
    jbTc.start()
    await new Promise((r) => setTimeout(r, 1400)) // 播放 1.4s，让断点 positionMs ≥ 1000
    const fireEnded = (url: string) => { for (const fn of endedHandlers) fn({ channel: 'music', url }) }
    const tc = await jbTc.testChime({ volume: 80, bytes: [1, 2, 3] })
    if (!tc.ok) fail('testChime 应成功: ' + JSON.stringify(tc))
    let stTc = jbTc.getState()
    if (stTc.nowPlaying && !stTc.nowPlaying.paused) fail('测试音期间记账应为暂停态')
    if (!playCalls.some((c) => c.params && c.params.bytes)) fail('测试音未通过 bytes 播放')
    // 提示音 ended（bytes:// 源）→ 断点续播原曲
    fireEnded('bytes://music')
    await new Promise((r) => setTimeout(r, 250))
    stTc = jbTc.getState()
    if (!stTc.playing) fail('测试音结束后应恢复播放: ' + JSON.stringify(stTc.nowPlaying))
    const replay = playCalls[playCalls.length - 1]
    if (!replay.params.url || !replay.params.positionMs || replay.params.positionMs < 1000) {
      fail('断点续播应带 positionMs(≥1000): ' + JSON.stringify(replay.params))
    }
    // 孤立 bytes ended（无挂起恢复）不得触发切歌
    fireEnded('bytes://music')
    await new Promise((r) => setTimeout(r, 200))
    stTc = jbTc.getState()
    if (!stTc.playing || stTc.nowPlaying?.title !== '断点测试曲') fail('孤立 bytes ended 不应切歌')
    // 正常歌曲 ended 仍切歌（advance 路径不受影响）
    fireEnded('http://127.0.0.1/fake.mp3')
    await new Promise((r) => setTimeout(r, 200))
    if (jbTc.getState().playing) fail('正常 ended 应切歌（队列空→停止）')
    jbTc.stop()
    console.log('✓ 测试提示音: 暂停式播放 → ended(bytes://) → positionMs 断点续播；孤立 bytes 不切歌；正常 ended 照常')

    // 恢复测试配置，避免影响其他 e2e
    await rpc.call('config.updatePaths', { entries: [
      { path: 'music.autoStartJukebox', value: false },
      { path: 'music.idleLoop', value: true },
    ] })

    console.log('--- PASS ---')
    rpc.close()
    await svc.stop()
    try { fs.unlinkSync(dbPath) } catch { /* 忽略 */ }
    setTimeout(() => process.exit(0), 300).unref()
  } catch (e) {
    console.error('--- FAIL ---', e)
    try { await svc.stop() } catch { /* 忽略 */ }
    process.exit(1)
  }
}

void main()

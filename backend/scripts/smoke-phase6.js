/**
 * 冒烟 phase6：行为循环（事件目录 / 清单预览 / Prompt 预演 / 运行日志 / 行为状态 / 指令配置）
 * 对运行中的逻辑服务执行（默认 127.0.0.1:19275）：
 *   node scripts/smoke-phase6.js
 */
const WebSocket = require('ws')

function rpc(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 8000)
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  console.log('  ✓', msg)
}

async function main() {
  const port = Number(process.env.WS_PORT || 19275)
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', () => reject(new Error(`无法连接 127.0.0.1:${port}，请先启动逻辑服务`)))
  })
  await rpc(ws, 1, 'peer.declare', { kind: 'webui' })
  let id = 2

  // 事件目录
  const catalog = await rpc(ws, id++, 'behavior.catalog')
  assert(catalog.catalog.length >= 20, `事件目录返回 ${catalog.catalog.length} 项（直播间 + 系统后台）`)
  assert(catalog.catalog.some((e) => e.group === 'system'), '目录含系统后台事件分组')

  // 配置默认分区
  const config = await rpc(ws, id++, 'config.get')
  assert(config.behavior && config.behavior.merge && config.behavior.feed, 'behavior 配置分区就位')
  assert(config.commands && Array.isArray(config.commands.items) && config.commands.items.every((i) => Array.isArray(i.aliases)), `指令系统就位（${config.commands.items.length} 条，别名制）`)
  assert(config.instant && Array.isArray(config.instant.items) && config.instant.items.every((i) => i.eventType && i.action && i.action.type), `即时应对就位（${config.instant.items.length} 条，条件化）`)
  assert(!config.triggers, '旧触发器配置已移除')

  // 能力注册表与工具对齐
  const abilities = (await rpc(ws, id++, 'abilities.list', {})).abilities
  assert(abilities.length >= 12, `预置能力 ${abilities.length} 项`)
  const tools = (await rpc(ws, id++, 'llm.tools', {})).tools.map((t) => t.name)
  assert(abilities.every((a) => tools.includes(a.id)), '能力全部对齐注册为 LLM 工具')

  // 即时应对 schema
  const ischema = await rpc(ws, id++, 'instant.schema', {})
  assert(ischema.conditions.danmaku && ischema.variables.superchat, '即时应对条件/变量矩阵下发')

  // 清单预览：纯样式示例（不含真实事件）
  const feed = await rpc(ws, id++, 'feed.preview', { include: { danmaku: true, gift: false } })
  assert(feed.sample === true && Array.isArray(feed.lines) && feed.lines.some((l) => l.includes('弹幕 |')), `清单预览 ${feed.count} 行（纯示例，随勾选变化）`)

  // Prompt 预演
  const prompt = await rpc(ws, id++, 'prompt.preview')
  assert(String(prompt.user).includes('直播间实时状况'), 'Prompt 预演包含主播视角清单')

  // 行为状态 + 当前批
  const status = await rpc(ws, id++, 'behavior.status')
  assert(typeof status.viewers === 'number', `行为状态：活跃观众 ${status.viewers}，大脑计数 ${JSON.stringify(status.counts)}`)
  const pending = await rpc(ws, id++, 'batcher.pending')
  assert(typeof pending.count === 'number', `合并器当前批 ${pending.count} 条`)

  // 运行日志
  const traces = await rpc(ws, id++, 'trace.list', { limit: 5 })
  assert(Array.isArray(traces.traces), `运行日志 ${traces.total} 条`)

  console.log('--- smoke phase6 PASS ---')
  ws.close()
  setTimeout(() => process.exit(0), 200).unref()
}

main().catch((err) => {
  console.error('--- smoke phase6 FAIL ---', err.message)
  process.exit(1)
})

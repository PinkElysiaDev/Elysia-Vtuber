const assert = require('assert')
const { expandTemplate, formatEvents } = require('../dist/core/variables')
const { cronMatches, cronMinuteKey } = require('../dist/core/cron')
const { TriggerEngine } = require('../dist/modules/triggers')
const { parseReplyContent, OutputRouter } = require('../dist/modules/output')
const { ToolRegistry, objectSchema } = require('../dist/core/tools')

function event(type, extra = {}) {
  return {
    type,
    timestamp: Date.now(),
    roomId: '1',
    user: { uid: 'u1', name: extra.name || 'alice' },
    data: extra.data || { content: extra.content || 'hello' },
  }
}

function rule(partial) {
  return {
    id: 'r',
    name: 'r',
    enabled: true,
    mode: 'immediate',
    eventTypes: ['danmaku'],
    delayMs: 40,
    maxBatch: 10,
    mergeEvents: [],
    cron: '',
    actions: [],
    ...partial,
  }
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const ctx = {
    events: [event('danmaku', { content: '你好' })],
    history: [],
    roomId: '4242',
  }
  assert.strictEqual(expandTemplate('房间{{roomId}} {{user}}: {{content}}', ctx), '房间4242 alice: 你好')
  assert.ok(formatEvents(ctx.events).includes('[弹幕] alice: 你好'))
  assert.ok(cronMatches('* * * * *'))
  assert.ok(cronMinuteKey().split('-').length === 5)

  const fired = []
  const engine = new TriggerEngine()
  engine.setCallback((fire) => { fired.push(fire) })
  engine.configure([
    rule({ id: 'imm', mode: 'immediate' }),
    rule({ id: 'deb', mode: 'debounce', delayMs: 50, maxBatch: 3 }),
    rule({ id: 'x', mode: 'cross-merge', eventTypes: ['gift'], mergeEvents: ['danmaku'], delayMs: 50 }),
  ])
  engine.start()
  engine.handleEvent(event('danmaku', { content: 'a' }))
  engine.handleEvent(event('gift', { data: { giftName: '小花花', num: 1 } }))
  engine.handleEvent(event('danmaku', { content: 'into-gift-window' }))
  await wait(200)
  engine.stop()

  assert.ok(fired.some((f) => f.rule.id === 'imm' && f.reason === 'immediate'))
  assert.ok(fired.some((f) => f.rule.id === 'deb' && f.events.length >= 1))
  const merged = fired.find((f) => f.rule.id === 'x')
  assert.ok(merged, 'cross-merge should fire')
  assert.ok(merged.events.some((e) => e.type === 'gift'))
  assert.ok(merged.events.some((e) => e.type === 'danmaku'))

  const segments = parseReplyContent(JSON.stringify({
    segments: [
      { method: 'danmaku', text: '弹幕' },
      { method: 'display', text: '展示' },
    ],
  }))
  assert.strictEqual(segments.length, 2)

  const sent = []
  const output = new OutputRouter({
    getConfig: () => ({
      danmaku: { enabled: true, ratePerMinute: 20 },
      display: { enabled: true, style: 'bubble', fontSize: 28 },
      tts: { enabled: false, delayBeforeSpeakMs: 0 },
    }),
    getRoomId: () => '1',
    sendDanmaku: (text) => sent.push(['danmaku', text]),
    displayText: (text) => sent.push(['display', text]),
    speak: (text) => sent.push(['tts', text]),
  })
  const tools = new ToolRegistry()
  tools.register({
    name: 'send_reply',
    description: 'reply',
    parameters: objectSchema(),
    handler: async (args) => output.route(args.segments),
  })
  const result = await tools.call('send_reply', {
    segments: [{ method: 'danmaku', text: 'hi' }, { method: 'display', text: 'board' }],
  })
  assert.strictEqual(result.sent, 2)
  assert.deepStrictEqual(sent, [['danmaku', 'hi'], ['display', 'board']])

  console.log('phase1 smoke ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

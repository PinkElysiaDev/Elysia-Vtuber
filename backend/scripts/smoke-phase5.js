const WebSocket = require('ws')
const { splitSpeech } = require('../dist/tts/client')
const { extractWbiKey, signWbiQuery } = require('../dist/music/bili-wbi')
const { parseLyrics } = require('../dist/music/lyric')

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
}

async function main() {
  const parts = splitSpeech('你好。欢迎来到直播间！今天也要开心。', 8)
  assert(parts.length >= 2, 'splitSpeech should break sentences')
  assert(parts.join('').includes('欢迎'), 'splitSpeech lost text')
  assert(splitSpeech('').length === 0, 'empty speech should be empty')

  const key = extractWbiKey(
    'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
  )
  assert(key.length === 32, 'wbi key length')
  const signed = signWbiQuery({ keyword: 'test', page: 1 }, key, 1700000000)
  assert(signed.includes('w_rid='), 'wbi missing wrid')
  assert(signed.includes('wts=1700000000'), 'wbi missing wts')

  const lyrics = parseLyrics('[00:01.00]hello\n[00:02.50]world')
  assert(lyrics.content.some((l) => l.lyric === 'hello'), 'lyric parse')

  const ws = new WebSocket('ws://127.0.0.1:19275')
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  await rpc(ws, 1, 'peer.declare', { kind: 'webui' })
  const schema = await rpc(ws, 2, 'config.schema')
  assert(schema.find((s) => s.key === 'tts').fields['tts.baseURL'], 'tts.baseURL missing in schema')
  const status = await rpc(ws, 3, 'system.status')
  assert(status.tts, 'system.status.tts missing')
  const tts = await rpc(ws, 4, 'tts.status')
  assert(typeof tts.speaking === 'boolean', 'tts.status')
  const speak = await rpc(ws, 5, 'tts.speak', { text: '阶段五本地冒烟' })
  assert(speak.ok, 'tts.speak should enqueue')
  const after = await rpc(ws, 6, 'tts.status')
  assert(after.lastText.includes('阶段五') || after.queued >= 0, 'tts queue not updated')
  await rpc(ws, 7, 'tts.stop')
  console.log('phase5 local smoke ok')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

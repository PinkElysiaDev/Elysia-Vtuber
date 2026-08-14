const WebSocket = require('ws')
const http = require('http')

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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    }).on('error', reject)
  })
}

async function main() {
  const health = await httpGet('http://127.0.0.1:19274/api/health')
  if (health.status !== 200) throw new Error('health not 200')
  const h = JSON.parse(health.body)
  if (!h.ok) throw new Error('health not ok')
  if (h.wsPort !== 19275) throw new Error('health.wsPort expected 19275')
  console.log('health', health.body)

  const settings = await httpGet('http://127.0.0.1:19274/settings.html')
  if (settings.status !== 200) throw new Error('settings.html not served')
  if (!settings.body.includes('config.updatePaths')) throw new Error('settings.html missing schema-driven save')
  if (settings.body.includes("SECTIONS = [\n      ['server'")) throw new Error('settings.html still has Electron hardcoded tabs')

  const index = await httpGet('http://127.0.0.1:19274/')
  if (!index.body.includes('完整配置')) throw new Error('index.html is still a stub')

  const rpcJs = await httpGet('http://127.0.0.1:19274/assets/js/rpc-client.js')
  if (rpcJs.body.includes('19264')) throw new Error('rpc-client still defaults to 19264')
  if (!rpcJs.body.includes("kind: 'webui'")) throw new Error('rpc-client missing peer.declare')

  const ws = new WebSocket('ws://127.0.0.1:19275')
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const declared = await rpc(ws, 1, 'peer.declare', { kind: 'webui' })
  if (!declared || !declared.ok) throw new Error('peer.declare failed')

  const schema = await rpc(ws, 2, 'config.schema')
  if (!Array.isArray(schema)) throw new Error('schema is not an array')
  const keys = schema.map((s) => s.key)
  const expected = ['server', 'events', 'triggers', 'llm', 'tts', 'output', 'music', 'live2d', 'audio', 'cpp']
  for (const key of expected) {
    if (!keys.includes(key)) throw new Error('missing schema section ' + key)
  }
  const triggerSec = schema.find((s) => s.key === 'triggers')
  if (triggerSec.fields.triggers.type !== 'triggers') throw new Error('triggers field type wrong')
  console.log('schema sections', keys.join(','))

  const before = await rpc(ws, 3, 'config.get')
  const prevMax = before.music.maxPerUser
  const nextMax = prevMax === 3 ? 4 : 3
  await rpc(ws, 4, 'config.updatePaths', {
    entries: [{ path: 'music.maxPerUser', value: nextMax }],
  })
  const after = await rpc(ws, 5, 'config.get')
  if (after.music.maxPerUser !== nextMax) throw new Error('updatePaths did not persist nested field')
  await rpc(ws, 6, 'config.updatePaths', {
    entries: [{ path: 'music.maxPerUser', value: prevMax }],
  })

  const status = await rpc(ws, 7, 'system.status')
  if (!status.version) throw new Error('system.status missing version')
  if (!('jukebox' in status)) throw new Error('system.status missing jukebox')
  console.log('status', JSON.stringify({
    version: status.version,
    triggers: status.triggers,
    llmConfigured: status.llmConfigured,
    jukebox: status.jukebox,
  }))

  console.log('phase4 webui smoke ok')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

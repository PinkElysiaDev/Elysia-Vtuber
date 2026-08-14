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

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:19276')
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { peer: 'node' } }))

  const ping = await rpc(ws, 1, 'system.ping')
  console.log('ping', JSON.stringify(ping))
  const status = await rpc(ws, 2, 'live2d.status')
  console.log('status', JSON.stringify(status))
  const expression = await rpc(ws, 3, 'live2d.expression', { name: 'F02' })
  console.log('expression', JSON.stringify(expression))
  const motion = await rpc(ws, 4, 'live2d.motion', { group: 'TapBody', index: 0 })
  console.log('motion', JSON.stringify(motion))
  const transform = await rpc(ws, 5, 'live2d.transform', { scale: 1.1, x: 0, y: -0.05 })
  console.log('transform', JSON.stringify(transform))
  const after = await rpc(ws, 6, 'live2d.status')
  console.log('after', JSON.stringify(after))

  if (!ping.ok) throw new Error('ping failed')
  if (!status.loaded) throw new Error('model not loaded')
  if (!expression.ok) throw new Error('expression failed')
  if (!motion.ok) throw new Error('motion failed')
  if (!transform.ok) throw new Error('transform failed')
  console.log('phase2 smoke ok')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

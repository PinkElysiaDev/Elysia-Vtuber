const WebSocket = require('ws')

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 20000)
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
      else resolve(msg.result)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:19275')
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'peer.declare', params: { kind: 'webui' } }))

  const started = await rpc(ws, 1, 'cpp.start')
  console.log('cpp.start', JSON.stringify(started))
  const status = await rpc(ws, 2, 'live2d.status')
  console.log('live2d.status', JSON.stringify(status))
  const expression = await rpc(ws, 3, 'live2d.expression', { name: 'F03' })
  console.log('live2d.expression', JSON.stringify(expression))
  const motion = await rpc(ws, 4, 'live2d.motion', { group: 'TapBody', index: 1 })
  console.log('live2d.motion', JSON.stringify(motion))
  const transform = await rpc(ws, 5, 'live2d.transform', { scale: 1, x: 0, y: 0 })
  console.log('live2d.transform', JSON.stringify(transform))
  const tool = await rpc(ws, 6, 'tool.call', { name: 'live2d_expression', args: { name: 'F01' } })
  console.log('tool.call', JSON.stringify(tool))

  if (!started.ok && !started.connected) throw new Error('cpp.start failed')
  if (!status.connected) throw new Error('live2d not connected via node')
  if (expression.ok === false) throw new Error('expression via node failed')
  console.log('phase2 node smoke ok')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

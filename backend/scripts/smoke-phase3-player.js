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
  const status = await rpc(ws, 2, 'player.status')
  console.log('player.status', JSON.stringify(status))
  const volume = await rpc(ws, 3, 'player.volume', { volume: 25 })
  console.log('player.volume', JSON.stringify(volume))
  const after = await rpc(ws, 4, 'player.status')
  console.log('player.status.after', JSON.stringify(after))
  const stop = await rpc(ws, 5, 'player.stop')
  console.log('player.stop', JSON.stringify(stop))

  if (!ping.ok) throw new Error('ping failed')
  if (status.ok === false) throw new Error('player.status failed')
  if (!volume.ok) throw new Error('player.volume failed')
  if (after.volume !== 25) throw new Error('volume not applied')
  console.log('phase3 player smoke ok')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

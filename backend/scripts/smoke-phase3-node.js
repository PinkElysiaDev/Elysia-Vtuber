const WebSocket = require('ws')

function rpc(ws, id, method, params = {}) {
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

  const started = await rpc(ws, 1, 'jukebox.start')
  console.log('jukebox.start', JSON.stringify(started))
  const state = await rpc(ws, 2, 'jukebox.getState')
  console.log('jukebox.getState', JSON.stringify({
    running: state.running,
    sources: state.sources,
    queue: state.queue.length,
  }))
  const added = await rpc(ws, 3, 'jukebox.add', {
    songId: 'phase3-local',
    source: 'kuwo',
    title: 'Phase3 Local',
    userId: 'smoke',
    userName: 'smoke',
  })
  console.log('jukebox.add', JSON.stringify(added))
  const queue = await rpc(ws, 4, 'jukebox.getQueue')
  console.log('jukebox.getQueue', JSON.stringify(queue))
  const tool = await rpc(ws, 5, 'tool.call', { name: 'jukebox_get_queue', args: {} })
  console.log('tool.call', JSON.stringify(tool))
  const skipped = await rpc(ws, 6, 'jukebox.skip')
  console.log('jukebox.skip', JSON.stringify(skipped))
  const volume = await rpc(ws, 7, 'jukebox.setVolume', { volume: 30 })
  console.log('jukebox.setVolume', JSON.stringify(volume))

  if (!started.success) throw new Error('jukebox.start failed')
  if (!Array.isArray(state.sources) || !state.sources.includes('kuwo')) throw new Error('kuwo source missing')
  if (!added.success) throw new Error('jukebox.add failed')
  console.log('phase3 node smoke ok')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

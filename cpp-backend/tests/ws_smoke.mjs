import WebSocket from 'ws'

const ws = new WebSocket('ws://127.0.0.1:19275')
let nextId = 1

function call(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const message = JSON.parse(data.toString())
      if (message.id !== id) return
      ws.off('message', handler)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

ws.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

ws.on('open', async () => {
  try {
    const state = await call('jukebox.getState')
    if (state.state !== 'stopped') throw new Error('unexpected initial state')

    const volume = await call('jukebox.setVolume', { volume: 55 })
    if (volume.volume !== 55) throw new Error('volume set failed')

    const started = await call('jukebox.start')
    if (started.state !== 'running') throw new Error('start failed')

    const tools = await call('tool.list')
    if (!Array.isArray(tools) || tools.length < 19) throw new Error('tool list failed')

    const toolVolume = await call('tool.call', {
      name: 'jukebox_set_volume',
      args: { volume: 42 },
    })
    if (toolVolume.volume !== 42) throw new Error('LLM tool volume call failed')

    const toolState = await call('tool.call', { name: 'jukebox_get_state', args: {} })
    if (toolState.volume !== 42) throw new Error('LLM tool state call failed')

    const live2d = await call('live2d.load', { modelPath: 'test.model3.json' })
    if (!live2d.success) throw new Error('live2d load failed')

    const display = await call('display.show', { text: 'hello', style: 'normal', emotion: 'neutral' })
    if (!display.success) throw new Error('display show failed')

    const audio = await call('audio.setVolume', { volume: 20 })
    if (audio.volume !== 20) throw new Error('audio volume failed')

    const config = await call('config.get')
    if (!config.server || !config.music) throw new Error('config get failed')
    await call('config.update', { config })
    await call('config.reload')

    const ingest = await call('event.ingest', {
      roomId: 'default',
      event: {
        type: 'danmaku',
        timestamp: Date.now(),
        roomId: 'default',
        user: { uid: '1', name: 'alice' },
        data: { content: 'hello' },
      },
    })
    if (ingest.eventCount < 1) throw new Error('event ingest failed')

    console.log('ws_smoke passed')
    ws.close()
  } catch (error) {
    console.error(error)
    ws.close()
    process.exit(1)
  }
})

ws.on('close', () => process.exit(0))

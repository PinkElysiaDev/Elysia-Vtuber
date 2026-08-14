const assert = require('assert')
const { parseLyrics, findLyric, lyricsToLrc } = require('../dist/music/lyric')
const { createDefaultRegistry, ProviderRegistry } = require('../dist/music/registry')
const { kuwoEncryptBase64 } = require('../dist/music/kuwo-des')
const { Jukebox } = require('../dist/music/jukebox')

function fakeCpp() {
  const handlers = new Map()
  return {
    isConnected: () => true,
    request: async (method, params) => ({ ok: true, method, params }),
    onEvent: (event, fn) => {
      handlers.set(event, fn)
      return () => handlers.delete(event)
    },
    emit(event, params) {
      handlers.get(event)?.(params)
    },
  }
}

function config() {
  return {
    defaultSource: 'kuwo',
    maxDuration: 360,
    maxQueueSize: 2,
    maxPerUser: 1,
    idlePlaylist: [],
    idleLoop: true,
    directOrder: { enabled: true, keywords: ['点歌'], pluginCommand: false },
    nowPlaying: { template: '{{title}} - {{artist}}', filePath: '', windowEnabled: false },
    outputDevice: '',
    sessions: {},
  }
}

async function main() {
  const lyrics = parseLyrics('[00:01.00]hello\n[00:03.50]world')
  assert.ok(lyrics.content.length >= 2)
  assert.strictEqual(findLyric(lyrics, 1.2).lyric, 'hello')
  assert.strictEqual(findLyric(lyrics, 3.6).lyric, 'world')
  assert.ok(lyricsToLrc(lyrics).includes('hello'))

  const encoded = kuwoEncryptBase64('user=0&corp=kuwo&type=convert_url2')
  assert.ok(encoded.length > 8)

  const registry = createDefaultRegistry()
  assert.deepStrictEqual(registry.names().sort(), ['bilivideo', 'kugou', 'kuwo', 'migu', 'netease', 'qq'].sort())
  assert.strictEqual(registry.match('kw12345')?.meta.identifier, '12345')
  assert.strictEqual(registry.match('BV1xx411c7mD')?.provider.name, 'bilivideo')
  assert.strictEqual(registry.get('bilibili-video')?.name, 'bilivideo')

  const broadcasts = []
  const cpp = fakeCpp()
  const mock = {
    name: 'kuwo',
    qualities: () => ['320k'],
    mapQuality: () => 'mp3',
    matchMedia: (kw) => /^[0-9]+$/.test(kw) ? { provider: 'kuwo', identifier: kw } : null,
    search: async (keyword) => [{
      title: keyword,
      artist: 'mock',
      artists: ['mock'],
      album: '',
      cover: '',
      duration: 120,
      meta: { provider: 'kuwo', identifier: '1' },
    }],
    getMediaInfo: async (meta) => ({
      title: `song-${meta.identifier}`,
      artist: 'mock',
      artists: ['mock'],
      album: '',
      cover: '',
      duration: 120,
      meta,
    }),
    getMediaUrl: async () => [{ url: 'http://127.0.0.1/mock.mp3', quality: '320k', headers: {} }],
    getMediaLyric: async () => [parseLyrics('[00:00.00]mock')],
  }
  const jukebox = new Jukebox({
    getConfig: config,
    cpp,
    broadcast: (method, params) => broadcasts.push({ method, params }),
    registry: new ProviderRegistry([mock]),
  })

  const first = await jukebox.add({
    songId: '111',
    source: 'kuwo',
    title: '测试曲',
    userId: 'u1',
    userName: 'alice',
  })
  assert.strictEqual(first.success, true)
  const second = await jukebox.add({
    songId: '222',
    source: 'kuwo',
    title: '第二首',
    userId: 'u1',
    userName: 'alice',
  })
  assert.strictEqual(second.success, false, 'maxPerUser should reject')
  const third = await jukebox.add({
    songId: '333',
    source: 'kuwo',
    title: '第三首',
    userId: 'u2',
    userName: 'bob',
  })
  assert.strictEqual(third.success, true)
  const fourth = await jukebox.add({
    songId: '444',
    source: 'kuwo',
    title: '第四首',
    userId: 'u3',
    userName: 'carol',
  })
  assert.strictEqual(fourth.success, false, 'maxQueueSize should reject')
  jukebox.start()

  await new Promise((r) => setTimeout(r, 50))
  const state = jukebox.getState()
  assert.ok(state.running)
  assert.ok(state.nowPlaying || state.queue.length >= 1)

  const skipped = jukebox.skip()
  assert.strictEqual(skipped.success, true)
  const muted = jukebox.mute()
  assert.strictEqual(muted.muted, true)
  jukebox.unmute()
  jukebox.setVolume(40)
  assert.strictEqual(jukebox.getState().volume, 40)

  const ordered = jukebox.tryDirectOrder({
    type: 'danmaku',
    timestamp: Date.now(),
    roomId: '1',
    user: { uid: 'u9', name: 'dan' },
    data: { content: '点歌 晴天' },
  })
  assert.strictEqual(ordered, true)

  console.log('phase3 local smoke ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

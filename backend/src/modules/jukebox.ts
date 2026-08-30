import type { RpcHandler } from '../core/rpc'
import type { Jukebox } from '../music/jukebox'

export function buildJukeboxModule(jukebox: Jukebox): Record<string, RpcHandler> {
  return {
    'jukebox.getState': () => jukebox.getState(),
    'jukebox.start': () => jukebox.start(),
    'jukebox.stop': () => jukebox.stop(),
    'jukebox.restart': (params) => jukebox.restart(Boolean((params as any)?.preserveQueue ?? true)),
    'jukebox.setVolume': (params) => jukebox.setVolume(Number((params as any)?.volume ?? 80)),
    'jukebox.adjustVolume': (params) => jukebox.adjustVolume(Number((params as any)?.delta ?? 0)),
    'jukebox.mute': () => jukebox.mute(),
    'jukebox.unmute': () => jukebox.unmute(),
    'jukebox.getQueue': () => ({ queue: jukebox.getState().queue }),
    'jukebox.getNowPlaying': () => ({ nowPlaying: jukebox.getState().nowPlaying }),
    'jukebox.queue.remove': (params) => {
      const id = String((params as any)?.id ?? '')
      if (!id) throw new Error('jukebox.queue.remove requires { id }')
      return jukebox.remove(id)
    },
    'jukebox.queue.toTop': (params) => {
      const id = String((params as any)?.id ?? '')
      if (!id) throw new Error('jukebox.queue.toTop requires { id }')
      return jukebox.toTop(id)
    },
    'jukebox.queue.clear': () => jukebox.clearQueue(),
    'jukebox.nowPlaying.removeOutput': (params) => {
      const file = String((params as any)?.file ?? '')
      if (!file) throw new Error('jukebox.nowPlaying.removeOutput requires { file }')
      return jukebox.removeNowPlayingOutput(file)
    },
    'jukebox.skip': () => jukebox.skip(),
    'jukebox.pause': () => jukebox.pause(),
    'jukebox.resume': () => jukebox.resume(),
    'jukebox.seek': (params) => {
      const sec = Number((params as any)?.sec ?? NaN)
      if (!Number.isFinite(sec) || sec < 0) throw new Error('jukebox.seek requires { sec }')
      return jukebox.seek(sec)
    },
    'jukebox.previous': () => jukebox.previous(),
    'jukebox.playNow': async (params) => {
      const rec = (params as any) ?? {}
      if (!rec.songId && !rec.keyword && !rec.title) throw new Error('jukebox.playNow requires { songId | keyword | title }')
      return jukebox.playNow({
        songId: rec.songId ? String(rec.songId) : undefined,
        source: rec.source ? String(rec.source) : undefined,
        keyword: rec.keyword ? String(rec.keyword) : undefined,
        title: rec.title ? String(rec.title) : undefined,
        userId: rec.userId ? String(rec.userId) : undefined,
        userName: rec.userName ? String(rec.userName) : undefined,
      })
    },
    'jukebox.history.list': (params) => {
      const rec = (params as any) ?? {}
      const limit = Math.max(1, Math.min(500, Number(rec.limit ?? 100)))
      const before = rec.before !== undefined ? Number(rec.before) : undefined
      return { records: jukebox.getHistory(limit, before) }
    },
    'jukebox.search': async (params) => {
      const rec = (params as any) ?? {}
      const keyword = String(rec.keyword ?? rec.query ?? '')
      if (!keyword) throw new Error('jukebox.search requires { keyword }')
      return jukebox.search(keyword, rec.source, Number(rec.page ?? 1), Number(rec.size ?? 10))
    },
    'jukebox.add': async (params) => {
      const rec = (params as any) ?? {}
      return jukebox.add({
        songId: rec.songId ? String(rec.songId) : undefined,
        source: rec.source ? String(rec.source) : undefined,
        keyword: rec.keyword ? String(rec.keyword) : undefined,
        title: rec.title ? String(rec.title) : undefined,
        userId: rec.userId ? String(rec.userId) : undefined,
        userName: rec.userName ? String(rec.userName) : undefined,
      })
    },
    'jukebox.lyric': (params) => jukebox.lyricAt(Number((params as any)?.time ?? 0)),
    'jukebox.sources': () => ({ sources: jukebox.sources() }),
    /** 歌单链接/ID → 展开预览（前 50 条 + 总数） */
    'jukebox.playlist.resolve': async (params) => {
      const ref = String((params as any)?.ref ?? '').trim()
      if (!ref) throw new Error('jukebox.playlist.resolve requires { ref }')
      const source = (params as any)?.source ? String((params as any).source) : undefined
      const hit = await jukebox.registry.playlist(ref, source)
      if (!hit) {
        return { ok: false, error: '无法识别的歌单引用（支持网易云/QQ/酷狗歌单链接或纯 ID）' }
      }
      const preview = hit.items.slice(0, 50).map((m) => ({
        title: m.title, artist: m.artist, duration: m.duration,
        ref: `${m.meta.provider}:${m.meta.identifier}`,
      }))
      return { ok: true, provider: hit.provider, count: hit.items.length, preview, refs: hit.items.map((m) => `${m.meta.provider}:${m.meta.identifier}`) }
    },
    /** 支持歌单解析的音源名单（前端提示用） */
    'jukebox.playlist.providers': () => ({ providers: jukebox.registry.playlistProviders() }),
    /** 空闲歌单分组批量解析为可读信息（双栏展示用，只读；含时长/封面） */
    'jukebox.idle.resolve': async () => ({ groups: await jukebox.previewIdleGroups() }),
  }
}

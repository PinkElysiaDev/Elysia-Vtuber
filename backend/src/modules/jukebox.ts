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
    'jukebox.skip': () => jukebox.skip(),
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
      const hit = await jukebox.registry.playlist(ref)
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
    /** 空闲歌单条目批量解析为可读信息（列表显示用，只读） */
    'jukebox.idle.resolve': async () => ({ items: await jukebox.previewIdleRefs() }),
  }
}

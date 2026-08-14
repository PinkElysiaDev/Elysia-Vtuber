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
  }
}

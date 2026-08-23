/**
 * 网易云音乐音源（eapi 协议，对照 miaosic / Music163Api-Go 移植）。
 * 匿名可搜索/取歌词；取播放 URL 需扫码登录（VIP 曲目需对应会员）。
 */
import type { Loginable, LoginableProvider, QrLoginResult, QrLoginSession } from '../login'
import type { Lyrics, MediaInfo, MediaUrl, MetaData, PlaylistCapable, Quality } from '../types'
import { MusicError, PLAYLIST_MAX } from '../types'
import { parseLyrics } from '../lyric'
import { eapiRequest, pickCookie, type NeteaseCookies } from '../netease-eapi'
import { randomBytes } from 'crypto'

function randomDeviceId(): string {
  return randomBytes(16).toString('hex')
}

export class NeteaseProvider implements LoginableProvider, PlaylistCapable {
  name = 'netease'

  private cookies: NeteaseCookies = {}
  private deviceId = randomDeviceId()

  qualities(): Quality[] {
    return ['128k', '320k', 'hq', 'sq']
  }

  mapQuality(quality: Quality): string {
    if (quality === 'sq') return 'lossless'
    if (quality === 'hq') return 'higher'
    if (quality === '192k' || quality === '256k' || quality === '320k') return 'exhigh'
    return 'standard'
  }

  matchMedia(keyword: string): MetaData | null {
    const match = /^netease:(\d+)$/.exec(keyword.trim())
    return match ? { provider: this.name, identifier: match[1] } : null
  }

  // ============ 登录 ============

  async qrLogin(): Promise<QrLoginSession> {
    const res = await eapiRequest('/api/login/qrcode/unikey', { type: 1 }, this.cookieHeader())
    if (res.code !== 200 || !res.data?.unikey) throw new MusicError(`netease: 获取二维码失败 (${res.code})`)
    return {
      url: `https://music.163.com/login?codekey=${res.data.unikey}`,
      key: String(res.data.unikey),
    }
  }

  async qrLoginVerify(session: QrLoginSession): Promise<QrLoginResult> {
    const res = await eapiRequest('/api/login/qrcode/client/login', { key: session.key, type: 1 }, this.cookieHeader())
    const code = res.code
    if (code === 803) {
      const musicU = pickCookie(res.setCookie, 'MUSIC_U')
      if (!musicU) return { status: 'failed', message: '登录成功但未取到 MUSIC_U cookie' }
      this.cookies = {
        MUSIC_U: musicU,
        __csrf: pickCookie(res.setCookie, '__csrf'),
        MUSIC_A: pickCookie(res.setCookie, 'MUSIC_A') || this.cookies.MUSIC_A,
      }
      return { status: 'success', message: `登录成功：${res.data?.nickname ?? ''}`.trim() }
    }
    if (code === 802) return { status: 'scanned', message: '已扫码，请在手机上确认' }
    if (code === 801) return { status: 'waiting', message: '等待扫码' }
    if (code === 800) return { status: 'expired', message: '二维码已过期，请重新获取' }
    return { status: 'failed', message: `登录失败 (${code})` }
  }

  async isLogin(): Promise<boolean> {
    if (!this.cookies.MUSIC_U) return false
    try {
      const res = await eapiRequest('/api/w/nuser/account/get', {}, this.cookieHeader())
      return Boolean(res.data?.account?.id)
    } catch {
      return false
    }
  }

  async logout(): Promise<void> {
    this.cookies = {}
  }

  saveSession(): string {
    return Buffer.from(JSON.stringify({ ...this.cookies, deviceId: this.deviceId }), 'utf8').toString('base64')
  }

  async restoreSession(session: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(Buffer.from(session, 'base64').toString('utf8')) as NeteaseCookies
      if (!parsed.MUSIC_U) return false
      this.cookies = {
        MUSIC_U: parsed.MUSIC_U,
        MUSIC_A: parsed.MUSIC_A,
        __csrf: parsed.__csrf,
      }
      if (parsed.deviceId) this.deviceId = parsed.deviceId
      return await this.isLogin()
    } catch {
      return false
    }
  }

  // ============ 歌单 ============

  matchPlaylist(ref: string): { id: string } | null {
    const s = ref.trim()
    if (/^https?:\/\/music\.163\.com/i.test(s)) {
      const m = /[?&]id=(\d+)/.exec(s) ?? /playlist\/(\d+)/.exec(s)
      return m ? { id: m[1] } : null
    }
    if (/^\d{4,}$/.test(s)) return { id: s }
    return null
  }

  async getPlaylist(id: string): Promise<MediaInfo[]> {
    // v6/playlist/detail 拿 trackIds（匿名可读公开歌单），再分批 song/detail 取详情
    const res = await eapiRequest('/api/v6/playlist/detail', { id: Number(id), n: 0, s: 0 }, this.cookieHeader())
    const playlist = res.data?.playlist
    // trackIds 条目形如 { id, v, t, ... }（部分版本为 rid）
    const trackIds = (playlist?.trackIds ?? []) as Array<{ id?: number | string; rid?: number | string } | number>
    const ids = trackIds
      .map((t) => String((t as { id?: number | string; rid?: number | string })?.id ?? (t as { rid?: number | string })?.rid ?? t))
      .filter((s) => s !== '' && s !== '[object Object]')
      .slice(0, PLAYLIST_MAX)
    if (!ids.length) throw new MusicError('netease: 歌单为空或不可读（部分歌单需要登录）')
    const items: MediaInfo[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const detail = await eapiRequest('/api/v3/song/detail', {
        c: JSON.stringify(chunk.map((x) => ({ id: Number(x) }))),
      }, this.cookieHeader())
      for (const song of detail.data?.songs ?? []) {
        const mapped = this.mapSong(song, String(song.id))
        if (mapped) items.push(mapped)
      }
    }
    return items
  }

  // ============ 音源 ============

  /** eapi 歌曲对象 → MediaInfo（search/song/detail/歌单共用） */
  private mapSong(song: any, id: string): MediaInfo | null {
    if (!id) return null
    return {
      title: String(song.name ?? ''),
      artist: (song.ar ?? song.artists ?? []).map((a: any) => a.name).filter(Boolean).join('、'),
      artists: (song.ar ?? song.artists ?? []).map((a: any) => String(a.name ?? '')).filter(Boolean),
      album: String(song.al?.name ?? song.album?.name ?? ''),
      cover: String(song.al?.picUrl ?? song.album?.picUrl ?? ''),
      duration: Math.round(Number(song.dt ?? song.duration ?? 0) / 1000),
      meta: { provider: this.name, identifier: id },
    }
  }

  async search(keyword: string, page = 1, size = 10): Promise<MediaInfo[]> {
    const res = await eapiRequest('/api/cloudsearch/pc', {
      s: keyword,
      offset: (page - 1) * size,
      limit: size,
      type: 1,
    }, this.cookieHeader())
    if (res.code !== 200) throw new MusicError(`netease: 搜索失败 (${res.code})`)
    return (res.data?.result?.songs ?? [])
      .map((song: any) => this.mapSong(song, String(song.id)))
      .filter((item: MediaInfo | null): item is MediaInfo => item !== null)
  }

  async getMediaInfo(meta: MetaData): Promise<MediaInfo> {
    const res = await eapiRequest('/api/v3/song/detail', {
      c: JSON.stringify([{ id: Number(meta.identifier) }]),
    }, this.cookieHeader())
    const song = res.data?.songs?.[0]
    if (!song) throw new MusicError('netease: 歌曲不存在')
    return this.mapSong(song, meta.identifier) ?? this.emptyInfo(meta)
  }

  private emptyInfo(meta: MetaData): MediaInfo {
    return { title: meta.identifier, artist: '', artists: [], album: '', cover: '', duration: 0, meta }
  }

  async getMediaUrl(meta: MetaData, quality: Quality = '320k'): Promise<MediaUrl[]> {
    const res = await eapiRequest('/api/song/enhance/player/url/v1', {
      ids: JSON.stringify([String(meta.identifier)]),
      level: this.mapQuality(quality),
      encodeType: 'flac',
    }, this.cookieHeader())
    if (res.code !== 200) throw new MusicError(`netease: 取播放地址失败 (${res.code})`)
    const item = res.data?.data?.[0]
    if (!item?.url) {
      throw new MusicError(item?.freeTrialInfo
        ? 'netease: 该曲目为试听片段，完整播放需登录/VIP'
        : 'netease: 无播放版权（需登录或 VIP）')
    }
    return [{ url: String(item.url), quality, headers: {} }]
  }

  async getMediaLyric(meta: MetaData): Promise<Lyrics[]> {
    const res = await eapiRequest('/api/song/lyric', {
      id: Number(meta.identifier),
      lv: -1,
      kv: -1,
      tv: -1,
      rv: -1,
    }, this.cookieHeader())
    const raw = res.data?.lrc?.lyric
    if (!raw) return []
    return [parseLyrics(String(raw), 'zho')]
  }

  private cookieHeader(): NeteaseCookies {
    return { ...this.cookies, deviceId: this.deviceId }
  }
}

export const netease = new NeteaseProvider()

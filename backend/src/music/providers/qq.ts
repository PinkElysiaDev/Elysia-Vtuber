/**
 * QQ 音乐音源（musicu.fcg + 请求签名，对照 miaosic 移植）。
 * 搜索/歌词匿名可用；取播放 URL 需登录（默认微信扫码通道，覆盖微信绑定的账号）。
 */
import type { LoginableProvider, QrLoginResult, QrLoginSession } from '../login'
import type { Lyrics, MediaInfo, MediaUrl, MetaData, PlaylistCapable, Quality } from '../types'
import { MusicError, PLAYLIST_MAX } from '../types'
import { parseLyrics } from '../lyric'
import { httpRequest } from '../http'
import { decodeQrc } from '../qq-qrcdec'
import { createHash } from 'crypto'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const WECHAT_APPID = 'wx48db31d50e334801'
const QIMEI_FALLBACK = '6c9d3cd110abca9b16311cee10001e717614'
const SIGN_OL = [212, 45, 80, 68, 195, 163, 163, 203, 157, 220, 254, 91, 204, 79, 104, 6]
const SIGN_HEAD = [21, 4, 9, 26, 16, 20, 27, 30]
const SIGN_TAIL = [18, 11, 3, 2, 1, 7, 6, 25]

interface QqCredential {
  musicid: string
  musickey: string
  refresh_token?: string
  refresh_key?: string
  expired_at?: number
  created_at?: number
}

/** musicu.fcg 请求签名（miaosic sign.go 的 MD5 置换算法） */
function qqSign(body: string): string {
  const md5hex = createHash('md5').update(body, 'utf8').digest('hex').toUpperCase()
  let head = ''
  let tail = ''
  for (const i of SIGN_HEAD) head += md5hex[i]
  for (const i of SIGN_TAIL) tail += md5hex[i]
  const bytes: number[] = []
  for (let i = 0; i < 32; i += 2) {
    bytes.push(parseInt(md5hex.slice(i, i + 2), 16) ^ SIGN_OL[i / 2])
  }
  return ('zzb' + head + Buffer.from(bytes).toString('base64') + tail).toLowerCase().replace(/[/+=]/g, '')
}

export class QqProvider implements LoginableProvider, PlaylistCapable {
  name = 'qq'

  private credential: QqCredential | null = null
  /** media_mid → songId 缓存（歌词接口需要数字 songId） */
  private songIds = new Map<string, string>()

  qualities(): Quality[] {
    return ['128k', '320k', 'sq']
  }

  mapQuality(quality: Quality): string {
    if (quality === 'sq') return 'flac'
    if (quality === '128k' || quality === 'standard') return 'mp3'
    return 'mp3'
  }

  matchMedia(keyword: string): MetaData | null {
    const match = /^qq:([0-9a-zA-Z]{14})$/.exec(keyword.trim())
    return match ? { provider: this.name, identifier: match[1] } : null
  }

  // ============ musicu.fcg 请求 ============

  private loggedIn(): boolean {
    return Boolean(this.credential?.musickey)
  }

  private async callApi(module: string, method: string, param: Record<string, unknown>): Promise<any> {
    const key = `${module}.${method}`
    const comm: Record<string, unknown> = {
      ct: 11,
      tmeAppID: 'qqmusic',
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      uid: '3931641530',
      cv: 'v=13020508',
      QIMEI36: QIMEI_FALLBACK,
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      referer: 'https://y.qq.com/',
      'user-agent': UA,
    }
    if (this.loggedIn() && this.credential) {
      comm.authst = this.credential.musickey
      comm.qq = this.credential.musicid
      comm.tmeLoginType = 1
      headers.cookie = `uin=${this.credential.musicid}; qqmusic_key=${this.credential.musickey}; qm_keyst=${this.credential.musickey}; tmeLoginType=1;`
    }
    const body = JSON.stringify({ comm, [key]: { module, method, param } })
    const res = await httpRequest(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${encodeURIComponent(qqSign(body))}`, {
      method: 'POST',
      headers,
      body,
      timeoutMs: 10000,
    })
    const json = res.json<any>()
    const payload = json?.[key] ?? json
    const code = Number(payload?.code ?? json?.code ?? 0)
    if (code === 2000) throw new MusicError('qq: 请求签名被拒')
    if (code === 4000) throw new MusicError('qq: 需要登录')
    if (code === 1000) {
      this.credential = null
      throw new MusicError('qq: 登录态已失效，请重新扫码')
    }
    return payload
  }

  // ============ 登录（微信扫码通道） ============

  async qrLogin(): Promise<QrLoginSession> {
    const redirect = encodeURIComponent('https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/')
    const res = await httpRequest(
      `https://open.weixin.qq.com/connect/qrconnect?appid=${WECHAT_APPID}&redirect_uri=${redirect}&response_type=code&scope=snsapi_login&state=vtuber`,
      { headers: { 'user-agent': UA }, timeoutMs: 10000 },
    )
    const uuid = /uuid=(.+?)"/.exec(res.text)?.[1]
    if (!uuid) throw new MusicError('qq: 获取微信二维码失败')
    return {
      url: `https://open.weixin.qq.com/connect/confirm?uuid=${uuid}`,
      key: uuid,
    }
  }

  async qrLoginVerify(session: QrLoginSession): Promise<QrLoginResult> {
    const res = await httpRequest(
      `https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${encodeURIComponent(session.key)}&_=${Date.now()}`,
      { headers: { referer: 'https://open.weixin.qq.com/' }, timeoutMs: 4000 },
    )
    const errcode = Number(/window\.wx_errcode=(\d+)/.exec(res.text)?.[1] ?? -1)
    const code = /window\.wx_code='([^']*)'/.exec(res.text)?.[1] ?? ''
    if (errcode === 405 && code) {
      await this.exchangeCode(code)
      return { status: 'success', message: '登录成功' }
    }
    if (errcode === 404) return { status: 'scanned', message: '已扫码，请在手机上确认' }
    if (errcode === 408 || errcode === -1) return { status: 'waiting', message: '等待扫码' }
    if (errcode === 403) return { status: 'failed', message: '已拒绝授权' }
    return { status: 'waiting', message: '等待扫码' }
  }

  /** 用微信 code 换取 QQ 音乐凭据 */
  private async exchangeCode(code: string): Promise<void> {
    const payload = await this.callApi('music.login.LoginServer', 'Login', {
      code,
      strAppid: WECHAT_APPID,
    })
    const data = payload?.data
    if (!data?.musickey || !data?.musicid) throw new MusicError('qq: 换取登录凭据失败')
    this.credential = {
      musicid: String(data.musicid),
      musickey: String(data.musickey),
      refresh_token: String(data.refresh_token ?? ''),
      refresh_key: String(data.refresh_key ?? ''),
      expired_at: Number(data.expired_at ?? 0),
      created_at: Date.now(),
    }
  }

  /** 用 refresh_key 续期登录态 */
  private async refreshLogin(): Promise<boolean> {
    if (!this.credential?.refresh_key) return false
    try {
      const payload = await this.callApi('music.login.LoginServer', 'Login', {
        refresh_key: this.credential.refresh_key,
        refresh_token: this.credential.refresh_token ?? '',
        musickey: this.credential.musickey,
        musicid: this.credential.musicid,
      })
      const data = payload?.data
      if (!data?.musickey) return false
      this.credential = {
        musicid: String(data.musicid ?? this.credential.musicid),
        musickey: String(data.musickey),
        refresh_token: String(data.refresh_token ?? ''),
        refresh_key: String(data.refresh_key ?? ''),
        expired_at: Number(data.expired_at ?? 0),
        created_at: Date.now(),
      }
      return true
    } catch {
      return false
    }
  }

  async isLogin(): Promise<boolean> {
    if (!this.loggedIn()) return false
    try {
      const payload = await this.callApi('music.userInfo.userBaseInfo', 'getUserInfo', { visitType: 1 })
      return Boolean(payload?.data?.userInfo)
    } catch {
      if (await this.refreshLogin()) return true
      return false
    }
  }

  async logout(): Promise<void> {
    this.credential = null
  }

  saveSession(): string {
    return Buffer.from(JSON.stringify({ credential: this.credential }), 'utf8').toString('base64')
  }

  async restoreSession(session: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(Buffer.from(session, 'base64').toString('utf8')) as { credential?: QqCredential }
      if (!parsed.credential?.musickey) return false
      this.credential = parsed.credential
      return await this.isLogin()
    } catch {
      return false
    }
  }

  // ============ 歌单 ============

  matchPlaylist(ref: string): { id: string } | null {
    const s = ref.trim()
    if (/^https?:\/\/y\.qq\.com/i.test(s)) {
      const m = /playlist\/([0-9A-Za-z]+)/.exec(s)
      return m ? { id: m[1] } : null
    }
    if (/^\d{4,}$/.test(s)) return { id: s }
    return null
  }

  async getPlaylist(id: string): Promise<MediaInfo[]> {
    // 老版歌单接口（匿名可读公开歌单），与扫码登录通道无关
    const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=1&nosign=1&disstid=${encodeURIComponent(id)}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`
    const res = await httpRequest(url, {
      headers: { referer: `https://y.qq.com/n/ryqq/playlist/${id}`, 'user-agent': UA },
      timeoutMs: 10000,
    })
    const data = res.json<any>()
    const songlist = data?.data?.[0]?.songlist ?? data?.songlist ?? []
    const items: MediaInfo[] = []
    for (const song of songlist) {
      const identifier = String(song.songmid ?? song.mid ?? '')
      if (!identifier) continue
      if (song.id) this.songIds.set(identifier, String(song.id))
      items.push({
        title: String(song.songname ?? song.name ?? ''),
        artist: (song.singer ?? []).map((s: any) => s.name).filter(Boolean).join('、'),
        artists: (song.singer ?? []).map((s: any) => String(s.name ?? '')).filter(Boolean),
        album: String(song.albumname ?? ''),
        cover: this.coverUrl(song.albummid),
        duration: Number(song.interval ?? 0),
        meta: { provider: this.name, identifier },
      })
      if (items.length >= PLAYLIST_MAX) break
    }
    if (!items.length) throw new MusicError('qq: 歌单为空或不可读（部分歌单需要登录）')
    return items
  }

  // ============ 音源 ============

  async search(keyword: string, page = 1, size = 10): Promise<MediaInfo[]> {
    const payload = await this.callApi('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', {
      search_type: 0,
      query: keyword,
      page_num: page,
      num_per_page: size,
    })
    const list = payload?.data?.body?.song?.list ?? []
    return list.map((song: any) => {
      const identifier = String(song.file?.media_mid ?? song.mid ?? '')
      if (identifier && song.id) this.songIds.set(identifier, String(song.id))
      return {
        title: String(song.name ?? ''),
        artist: (song.singer ?? []).map((s: any) => s.name).filter(Boolean).join('、'),
        artists: (song.singer ?? []).map((s: any) => String(s.name ?? '')).filter(Boolean),
        album: String(song.album?.name ?? ''),
        cover: this.coverUrl(song.album?.mid),
        duration: Number(song.interval ?? 0),
        meta: { provider: this.name, identifier },
      }
    }).filter((item: MediaInfo) => item.meta.identifier)
  }

  private coverUrl(albumMid: string | undefined, size = 300): string {
    return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg` : ''
  }

  async getMediaInfo(meta: MetaData): Promise<MediaInfo> {
    const list = await this.searchByIdentifier(meta.identifier)
    if (!list.length) throw new MusicError('qq: 歌曲不存在')
    return list[0]
  }

  private async searchByIdentifier(identifier: string): Promise<MediaInfo[]> {
    // media_mid 无法直接反查，用 vkey 校验存在性；详情从搜索结果带出
    // jukebox 流程总是先 search/match 再取 URL，这里兜底返回最小信息
    const payload = await this.callApi('music.vkey.UrlGetVkey', 'CgiGetVkey', {
      guid: '1234567890',
      songmid: [identifier],
      songtype: [0],
      uin: this.credential?.musicid ?? '0',
      loginflag: 1,
      platform: '20',
    })
    const info = payload?.data?.midurlinfo?.[0]
    if (!info) throw new MusicError('qq: 歌曲不存在')
    return [{
      title: String(info.songname ?? identifier),
      artist: String(info.singer ?? ''),
      artists: String(info.singer ?? '').split('、').filter(Boolean),
      album: '',
      cover: '',
      duration: 0,
      meta: { provider: this.name, identifier },
    }]
  }

  async getMediaUrl(meta: MetaData, quality: Quality = '320k'): Promise<MediaUrl[]> {
    const ext = this.mapQuality(quality)
    const prefix = ext === 'flac' ? 'F000' : 'M800'
    const suffix = ext === 'flac' ? 'flac' : 'mp3'
    const payload = await this.callApi('music.vkey.UrlGetVkey', 'CgiGetVkey', {
      guid: String(Math.floor(Math.random() * 1e10)),
      filename: [`${prefix}${meta.identifier}.${suffix}`],
      songmid: [meta.identifier],
      songtype: [0],
      uin: this.credential?.musicid ?? '0',
      loginflag: 1,
      platform: '20',
    })
    const purl = String(payload?.data?.midurlinfo?.[0]?.purl ?? '')
    if (!purl) throw new MusicError('qq: 无播放地址（需登录或 VIP）')
    const url = purl.startsWith('http') ? purl : `https://isure.stream.qqmusic.qq.com/${purl}`
    return [{ url, quality, headers: {} }]
  }

  async getMediaLyric(meta: MetaData): Promise<Lyrics[]> {
    const payload = await this.callApi('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', {
      crypt: 1,
      qrc: 0,
      roma: 1,
      trans: 1,
      songMid: meta.identifier,
      songId: Number(this.songIds.get(meta.identifier) ?? 0),
    })
    const hex = payload?.data?.lyric
    if (!hex) return []
    try {
      return [parseLyrics(decodeQrc(String(hex)), 'zho')]
    } catch {
      return []
    }
  }
}

export const qq = new QqProvider()

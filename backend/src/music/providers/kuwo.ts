import type { Lyrics, MediaInfo, MediaProvider, MediaUrl, MetaData, Quality } from '../types'
import { decodeHtml, firstNonEmpty, httpGet } from '../http'
import { parseLyrics } from '../lyric'
import { kuwoEncryptBase64 } from '../kuwo-des'
import { MusicError } from '../types'
import * as net from 'net'

const UA = {
  accept: 'application/json, text/plain, */*',
  cookie: 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324=T3WtFh7AT3ZMkFrrhEGe8iRhA85SdM8b',
  secret: generateSecret('T3WtFh7AT3ZMkFrrhEGe8iRhA85SdM8b', 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324'),
}
const CONVERT_SOURCE = 'kwplayer_ar_5.1.0.0_B_jiakong_vh.apk'
const URL_RE = /http[^\s"]+/

function generateSecret(t: string, e: string): string {
  if (!e) return ''
  let n = ''
  for (let i = 0; i < e.length; i++) n += String(e.charCodeAt(i))
  const r = Math.floor(n.length / 5)
  let o0 = n[r] + n[2 * r] + n[3 * r] + n[4 * r]
  if (5 * r < n.length) o0 += n[5 * r]
  const o = Number(o0)
  const l = Math.ceil(e.length / 2)
  const c = 2 ** 31 - 1
  if (o < 2) return ''
  const d = Math.floor(Math.random() * 100000000)
  n += String(d)
  while (n.length > 10) {
    let num1: number
    let num2: number
    if (n.length - 10 > 19) {
      num1 = Number(n.slice(10, 11))
      num2 = Number(n.slice(19, 28))
      num2 = num2 % 10 >= 5 ? Math.floor(num2 / 10) + 1 : Math.floor(num2 / 10)
    } else {
      num1 = Number(n.slice(0, 10))
      num2 = Number(n.slice(10))
    }
    n = String(num1 + num2)
  }
  let nValue = (o * Number(n) + l) % c
  let f = ''
  for (let i = 0; i < t.length; i++) {
    const h = t.charCodeAt(i) ^ Math.floor((nValue / c) * 255)
    f += h < 16 ? `0${h.toString(16)}` : h.toString(16)
    nValue = (o * nValue + l) % c
  }
  return f + d.toString(16).padStart(8, '0')
}

function mobiGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: 'mobi.kuwo.cn', port: 80 })
    const chunks: Buffer[] = []
    const fail = (err: Error) => {
      socket.destroy()
      reject(err)
    }
    socket.setTimeout(8000)
    socket.on('connect', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: mobi.kuwo.cn\r\nUser-Agent: okhttp/3.10.0\r\nConnection: close\r\n\r\n`)
    })
    socket.on('data', (chunk) => chunks.push(chunk as Buffer))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.on('timeout', () => fail(new Error('kuwo mobi timeout')))
    socket.on('error', fail)
  })
}

export class KuwoProvider implements MediaProvider {
  name = 'kuwo'

  qualities(): Quality[] {
    return ['128k', '320k', 'sq']
  }

  mapQuality(quality: Quality): string {
    return quality === 'sq' ? 'flac' : 'mp3'
  }

  matchMedia(keyword: string): MetaData | null {
    if (/^[0-9]+$/.test(keyword)) return { provider: this.name, identifier: keyword }
    if (/^kw[0-9]+$/i.test(keyword)) return { provider: this.name, identifier: keyword.slice(2) }
    return null
  }

  async search(keyword: string, page = 1, size = 10): Promise<MediaInfo[]> {
    const url = new URL('http://www.kuwo.cn/search/searchMusicBykeyWord/searchMusicBykeyWord')
    url.searchParams.set('vipver', '1')
    url.searchParams.set('client', 'kt')
    url.searchParams.set('ft', 'music')
    url.searchParams.set('cluster', '0')
    url.searchParams.set('strategy', '2012')
    url.searchParams.set('encoding', 'utf8')
    url.searchParams.set('rformat', 'json')
    url.searchParams.set('mobi', '1')
    url.searchParams.set('issubtitle', '1')
    url.searchParams.set('show_copyright_off', '1')
    url.searchParams.set('all', keyword)
    url.searchParams.set('pn', String(Math.max(0, page - 1)))
    url.searchParams.set('rn', String(size))
    const res = await httpGet(url.toString(), UA)
    const list = res.json<any>().abslist ?? []
    return (Array.isArray(list) ? list : []).map((item: any) => ({
      title: decodeHtml(String(item.SONGNAME ?? '')),
      artist: String(item.ARTIST ?? ''),
      artists: String(item.ARTIST ?? '').split('&').filter(Boolean),
      album: String(item.ALBUM ?? ''),
      cover: item.web_albumpic_short ? `https://img2.kuwo.cn/star/albumcover/${item.web_albumpic_short}` : '',
      duration: Number(item.DURATION ?? item.duration ?? 0),
      meta: { provider: this.name, identifier: String(item.DC_TARGETID ?? '') },
    })).filter((item: MediaInfo) => item.meta.identifier)
  }

  async getMediaInfo(meta: MetaData): Promise<MediaInfo> {
    const url = `http://www.kuwo.cn/api/www/music/musicInfo?httpsStatus=1&mid=${encodeURIComponent(meta.identifier)}`
    const data = (await httpGet(url, UA)).json<any>().data ?? {}
    if (!data.musicrid && !data.name) throw new MusicError('kuwo: media info not found')
    return {
      title: decodeHtml(String(data.name ?? '')),
      artist: String(data.artist ?? ''),
      artists: String(data.artist ?? '').split('&').filter(Boolean),
      album: String(data.album ?? ''),
      cover: String(data.pic ?? ''),
      duration: Number(data.duration ?? 0),
      meta,
    }
  }

  async getMediaUrl(meta: MetaData, quality: Quality = '320k'): Promise<MediaUrl[]> {
    const formats = this.mapQuality(quality) === 'flac' ? ['flac', 'mp3'] : ['mp3']
    let last = ''
    for (const format of formats) {
      try {
        const query = `user=0&corp=kuwo&source=${CONVERT_SOURCE}&p2p=1&type=convert_url2&sig=0&format=${format}&rid=${meta.identifier}`
        const path = `/mobi.s?f=kuwo&q=${encodeURIComponent(kuwoEncryptBase64(query))}`
        const body = await mobiGet(path)
        const raw = body.match(URL_RE)?.[0] ?? ''
        if (raw) return [{ url: raw, quality: format === 'flac' ? 'sq' : '320k', headers: {} }]
        last = 'empty url'
      } catch (err) {
        last = err instanceof Error ? err.message : String(err)
      }
    }
    throw new MusicError(`kuwo: failed to get url (${last})`)
  }

  async getMediaLyric(meta: MetaData): Promise<Lyrics[]> {
    const url = `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(meta.identifier)}`
    const list = (await httpGet(url, UA)).json<any>().data?.lrclist ?? []
    if (!Array.isArray(list) || !list.length) return []
    const raw = list.map((line: any) => `[00:${line.time}]${line.lineLyric ?? ''}`).join('\n')
    return [parseLyrics(raw, 'zho')]
  }
}

export const kuwo = new KuwoProvider()

import type { Lyrics, MediaInfo, MediaProvider, MediaUrl, MetaData, Quality } from '../types'
import { httpGet } from '../http'
import { parseLyrics } from '../lyric'
import { MusicError } from '../types'
import { createHash } from 'crypto'

const HEADER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }
const APPID = '1005'
const CLIENTVER = '20489'
const SIGNKEY = 'OIlwieks28dk2k092lksi2UIkp'
const SALT = '57ae12eb6890223e355ccfcb74edf70d'

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex')
}

function signature(params: Record<string, unknown>, data = ''): string {
  const keys = Object.keys(params).sort()
  let body = ''
  for (const key of keys) {
    const value = params[key]
    body += `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
  }
  return md5(SIGNKEY + body + data + SIGNKEY)
}

function signPlayKey(hash: string, mid: string, userid: string): string {
  return md5(hash + SALT + APPID + mid + userid)
}

export class KugouProvider implements MediaProvider {
  name = 'kugou'

  qualities(): Quality[] {
    return ['128k', '320k', 'sq']
  }

  mapQuality(quality: Quality): string {
    if (quality === 'sq') return 'flac'
    if (quality === '128k' || quality === 'standard') return '128'
    return '320'
  }

  matchMedia(keyword: string): MetaData | null {
    if (/^[0-9a-zA-Z]{32}$/.test(keyword)) return { provider: this.name, identifier: keyword.toLowerCase() }
    return null
  }

  async search(keyword: string, page = 1, size = 10): Promise<MediaInfo[]> {
    const url = new URL('http://mobilecdn.kugou.com/api/v3/search/song')
    url.searchParams.set('keyword', keyword)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pagesize', String(size))
    const data = (await httpGet(url.toString(), HEADER)).json<any>()
    if (Number(data.errcode) !== 0) throw new MusicError(`kugou: search failed ${data.error ?? ''}`)
    return (data.data?.info ?? []).map((item: any) => ({
      title: String(item.songname ?? ''),
      artist: String(item.singername ?? ''),
      artists: String(item.singername ?? '').split('、').filter(Boolean),
      album: String(item.album_name ?? ''),
      cover: '',
      duration: Number(item.duration ?? 0),
      meta: { provider: this.name, identifier: String(item.hash ?? '').toLowerCase() },
    })).filter((item: MediaInfo) => item.meta.identifier)
  }

  async getMediaInfo(meta: MetaData): Promise<MediaInfo> {
    const body = {
      appid: APPID,
      area_code: 1,
      behavior: 'play',
      clientver: CLIENTVER,
      need_hash_offset: 1,
      relate: 1,
      support_verify: 1,
      resource: [{ type: 'audio', page_id: 0, hash: meta.identifier, album_id: 0 }],
      qualities: ['128', '320', 'flac', 'high'],
    }
    const res = await fetch('http://media.store.kugou.com/v2/get_res_privilege/lite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-router': 'media.store.kugou.com' },
      body: JSON.stringify(body),
    })
    const json = await res.json() as any
    const item = json.data?.[0]
    if (!item?.name) throw new MusicError('kugou: media info not found')
    const artist = String(item.singername ?? '')
    const img = String(item.info?.image ?? '').replace('{size}', String(item.info?.imgsize?.[0] ?? ''))
    return {
      title: String(item.name ?? '').replace(`${artist} - `, ''),
      artist,
      artists: artist.split('、').filter(Boolean),
      album: String(item.albumname ?? ''),
      cover: img,
      duration: Number(item.duration ?? 0),
      meta,
    }
  }

  async getMediaUrl(meta: MetaData, quality: Quality = '320k'): Promise<MediaUrl[]> {
    const now = Date.now()
    const mid = md5('-')
    const params: Record<string, unknown> = {
      album_audio_id: 0,
      appid: APPID,
      clientver: CLIENTVER,
      clienttime: String(now),
      area_code: 1,
      hash: meta.identifier,
      vipType: 0,
      vipToken: '',
      behavior: 'play',
      pid: 2,
      cmd: 26,
      pidversion: 3001,
      isFreePart: 0,
      album_id: 0,
      ssa_flag: 'is_fromtrack',
      version: 11709,
      page_id: 312258376,
      quality: this.mapQuality(quality),
      ppage_id: '463467626,350369493,788954147',
      cdnBackup: 1,
      kcard: 0,
      ptype: 0,
      key: signPlayKey(meta.identifier, mid, '0'),
      dfid: '-',
      mid,
    }
    params.signature = signature(params)
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) query.set(key, String(value))
    const url = `https://gateway.kugou.com/v5/url?${query.toString()}`
    const data = (await httpGet(url, {
      ...HEADER,
      'x-router': 'tracker.kugou.com',
      dfid: '-',
      mid,
      clienttime: String(now),
    })).json<any>()
    const urls: string[] = Array.isArray(data.url) ? data.url : (data.url ? [data.url] : [])
    if (!urls.length) throw new MusicError('kugou: failed to get url (vip or signed)')
    return urls.map((item) => ({ url: item, quality, headers: {} }))
  }

  async getMediaLyric(meta: MetaData): Promise<Lyrics[]> {
    const search = await httpGet(`http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=&duration=&hash=${meta.identifier}`, HEADER)
    const candidates = search.json<any>().candidates ?? []
    if (!candidates.length) return []
    const down = await httpGet(`http://lyrics.kugou.com/download?ver=1&client=pc&fmt=lrc&charset=utf8&id=${candidates[0].id}&accesskey=${candidates[0].accesskey}`, HEADER)
    const encoded = down.json<any>().content
    if (!encoded) return []
    return [parseLyrics(Buffer.from(encoded, 'base64').toString('utf8'), 'zho')]
  }
}

export const kugou = new KugouProvider()

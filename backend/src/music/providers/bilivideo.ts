import type { Lyrics, MediaInfo, MediaProvider, MediaUrl, MetaData, Quality } from '../types'
import { httpGet } from '../http'
import { parseLyrics } from '../lyric'
import { MusicError } from '../types'
import { wbiUrl } from '../bili-wbi'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
}

const EM = /<\/?em[^>]*>/g
const BV = /^BV[0-9A-Za-z]+/
const ID = /^BV[0-9A-Za-z]+(?:\?p=[0-9]+)?/

function getBv(id: string): string {
  return id.match(BV)?.[0] ?? id
}

function getPage(id: string): number {
  const match = id.match(/p=([0-9]+)/)
  return match ? Number(match[1]) : 1
}

export class BiliVideoProvider implements MediaProvider {
  name = 'bilivideo'

  qualities(): Quality[] {
    return ['standard', 'hq']
  }

  mapQuality(quality: Quality): string {
    return quality === 'hq' || quality === '320k' ? '80' : '64'
  }

  matchMedia(keyword: string): MetaData | null {
    const id = keyword.match(ID)?.[0]
    return id ? { provider: this.name, identifier: id } : null
  }

  async search(keyword: string, page = 1, size = 10): Promise<MediaInfo[]> {
    const url = await wbiUrl('https://api.bilibili.com/x/web-interface/wbi/search/type', {
      search_type: 'video',
      keyword,
      page,
      page_size: size,
    }, HEADERS)
    const data = (await httpGet(url, HEADERS)).json<any>()
    if (String(data.code) !== '0') throw new MusicError(`bilivideo: search failed (${data.message ?? data.code})`)
    return (data.data?.result ?? []).map((item: any) => ({
      title: String(item.title ?? '').replace(EM, ''),
      artist: String(item.author ?? ''),
      artists: [String(item.author ?? '')].filter(Boolean),
      album: '',
      cover: String(item.pic ?? '').startsWith('http') ? String(item.pic) : `https:${item.pic ?? ''}`,
      duration: parseDuration(item.duration),
      meta: { provider: this.name, identifier: String(item.bvid ?? '') },
    })).filter((item: MediaInfo) => item.meta.identifier)
  }

  async getMediaInfo(meta: MetaData): Promise<MediaInfo> {
    const url = `https://api.bilibili.com/x/web-interface/view/detail?bvid=${encodeURIComponent(getBv(meta.identifier))}`
    const view = (await httpGet(url, HEADERS)).json<any>().data?.View
    if (!view?.title) throw new MusicError('bilivideo: media info not found')
    return {
      title: String(view.title),
      artist: String(view.owner?.name ?? ''),
      artists: [String(view.owner?.name ?? '')].filter(Boolean),
      album: '',
      cover: String(view.pic ?? ''),
      duration: Number(view.duration ?? 0),
      meta,
    }
  }

  async getMediaUrl(meta: MetaData, quality: Quality = 'standard'): Promise<MediaUrl[]> {
    const bvid = getBv(meta.identifier)
    const page = getPage(meta.identifier) - 1
    const detail = (await httpGet(`https://api.bilibili.com/x/web-interface/view/detail?bvid=${encodeURIComponent(bvid)}`, HEADERS)).json<any>()
    const pages = detail.data?.View?.pages ?? []
    const cids: number[] = pages.map((item: any) => Number(item.cid)).filter(Boolean)
    if (!cids.length || page >= cids.length) throw new MusicError('bilivideo: cid not found')
    const play = await wbiUrl('https://api.bilibili.com/x/player/wbi/playurl', {
      bvid,
      cid: cids[page],
      qn: this.mapQuality(quality),
      fnval: 16,
      fourk: 1,
    }, HEADERS)
    const data = (await httpGet(play, HEADERS)).json<any>()
    const dashAudio = data.data?.dash?.audio?.[0]?.baseUrl || data.data?.dash?.audio?.[0]?.base_url
    const durl = data.data?.durl?.[0]?.url
    const url = dashAudio || durl
    if (!url) throw new MusicError('bilivideo: playurl empty')
    return [{
      url,
      quality,
      headers: { ...HEADERS, Referer: `https://www.bilibili.com/video/${bvid}` },
    }]
  }

  async getMediaLyric(meta: MetaData): Promise<Lyrics[]> {
    const bvid = getBv(meta.identifier)
    const page = getPage(meta.identifier) - 1
    const detail = (await httpGet(`https://api.bilibili.com/x/web-interface/view/detail?bvid=${encodeURIComponent(bvid)}`, HEADERS)).json<any>()
    const pages = detail.data?.View?.pages ?? []
    const cid = Number(pages[page]?.cid ?? 0)
    if (!cid) return []
    const player = (await httpGet(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`,
      HEADERS,
    )).json<any>()
    const list = player.data?.subtitle?.subtitles ?? []
    const picked = list.find((item: any) => String(item.lan ?? '').startsWith('zh')) ?? list[0]
    if (!picked?.subtitle_url) return []
    const subUrl = String(picked.subtitle_url).startsWith('http') ? String(picked.subtitle_url) : `https:${picked.subtitle_url}`
    const body = (await httpGet(subUrl, HEADERS)).json<any>()
    const lines = Array.isArray(body.body) ? body.body : []
    if (!lines.length) return []
    const raw = lines.map((item: any) => {
      const from = Number(item.from ?? 0)
      const mm = String(Math.floor(from / 60)).padStart(2, '0')
      const ss = (from % 60).toFixed(2).padStart(5, '0')
      return `[${mm}:${ss}]${String(item.content ?? '').trim()}`
    }).join('\n')
    return [parseLyrics(raw, String(picked.lan ?? 'zh'))]
  }
}

function parseDuration(value: unknown): number {
  if (typeof value === 'number') return value
  const text = String(value ?? '')
  if (!text) return 0
  const parts = text.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((sum, n) => sum * 60 + n, 0)
}

export const bilivideo = new BiliVideoProvider()

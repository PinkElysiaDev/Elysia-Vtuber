import type { Lyrics, MediaInfo, MediaProvider, MediaUrl, MetaData, Quality } from '../types'
import { firstNonEmpty, httpGet, httpRequest } from '../http'
import { parseLyrics } from '../lyric'
import { MusicError } from '../types'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1',
  Referer: 'http://music.migu.cn/',
}
const MAGIC_USER = '15548614588710179085069'

interface RateFormat {
  formatType?: string
  resourceType?: string
  size?: string
  androidSize?: string
  isize?: string
  asize?: string
  price?: string
  showTag?: string[]
  showTags?: string[]
}

interface SongItem {
  id?: string
  name?: string
  songName?: string
  songId?: string
  singers?: Array<{ name?: string }>
  artists?: Array<{ name?: string }>
  singerList?: Array<{ name?: string }>
  albums?: Array<{ name?: string }>
  album?: string
  singer?: string
  contentId?: string
  copyrightId?: string
  imgItems?: Array<{ imgSizeType?: string; img?: string }>
  albumImgs?: Array<{ imgSizeType?: string; img?: string }>
  rateFormats?: RateFormat[]
  audioFormats?: RateFormat[]
  img1?: string
  img2?: string
  img3?: string
  duration?: number
}

const FORMAT_RANK: Record<string, number> = { SQ: 4, ZQ: 3, HQ: 2, PQ: 1, LQ: 0 }

function splitId(identifier: string): { contentId: string; resourceType: string; formatType: string } {
  const [contentId = '', resourceType = '', formatType = ''] = identifier.split('|')
  return { contentId: contentId.trim(), resourceType: resourceType.trim(), formatType: formatType.trim() }
}

function artistsOf(item: SongItem): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const push = (name?: string) => {
    const text = String(name ?? '').trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    names.push(text)
  }
  for (const singer of [...(item.singers ?? []), ...(item.singerList ?? []), ...(item.artists ?? [])]) push(singer.name)
  if (!names.length) String(item.singer ?? '').split('|').forEach(push)
  return names
}

function pickImage(items?: Array<{ imgSizeType?: string; img?: string }>): string {
  for (const preferred of ['02', '01', '03']) {
    const hit = items?.find((item) => item.imgSizeType === preferred && item.img)
    if (hit?.img) return hit.img
  }
  return items?.find((item) => item.img)?.img ?? ''
}

function normalizeImage(image: string): string {
  const text = image.trim()
  if (!text) return ''
  if (text.startsWith('http://') || text.startsWith('https://')) return text
  if (text.startsWith('//')) return `https:${text}`
  if (text.startsWith('/')) return `https://d.musicapp.migu.cn${text}`
  return text
}

function pickFormat(formats: RateFormat[], quality: string): RateFormat | null {
  if (!formats.length) return null
  const requested = quality.toUpperCase()
  const scored = formats.map((format) => ({
    format,
    rank: FORMAT_RANK[String(format.formatType ?? '').toUpperCase()] ?? -1,
    size: Number(firstNonEmpty(format.androidSize, format.asize, format.size, format.isize)) || 0,
  }))
  const exact = scored.filter((item) => String(item.format.formatType ?? '').toUpperCase() === requested)
  if (exact.length) return exact.sort((a, b) => b.size - a.size)[0].format
  return scored.sort((a, b) => b.rank - a.rank || b.size - a.size)[0].format
}

function toMedia(item: SongItem, quality: string): MediaInfo | null {
  const formats = item.rateFormats?.length ? item.rateFormats : (item.audioFormats ?? [])
  const format = pickFormat(formats, quality)
  const contentId = firstNonEmpty(item.contentId, item.copyrightId, item.id, item.songId)
  if (!contentId) return null
  const names = artistsOf(item)
  return {
    title: firstNonEmpty(item.name, item.songName),
    artist: names.join(','),
    artists: names,
    album: firstNonEmpty(item.albums?.[0]?.name, item.album),
    cover: normalizeImage(firstNonEmpty(pickImage(item.imgItems), pickImage(item.albumImgs), item.img1, item.img2, item.img3)),
    duration: Number(item.duration ?? 0),
    meta: {
      provider: 'migu',
      identifier: format ? `${contentId}|${format.resourceType ?? ''}|${format.formatType ?? ''}` : contentId,
    },
  }
}

export class MiguProvider implements MediaProvider {
  name = 'migu'

  qualities(): Quality[] {
    return ['standard', 'hq', 'sq']
  }

  mapQuality(quality: Quality): string {
    if (quality === 'sq') return 'SQ'
    if (quality === 'hq' || quality === '320k' || quality === '256k' || quality === '192k') return 'HQ'
    if (quality === '128k' || quality === 'standard') return 'PQ'
    return 'HQ'
  }

  matchMedia(keyword: string): MetaData | null {
    const link = keyword.match(/music\.migu\.cn\/(?:v3|v5)\/music\/song\/(\d+)/)
      ?? keyword.match(/contentId=(\d+)/)
      ?? keyword.match(/copyrightId=(\d+)/)
    if (link?.[1]) return { provider: this.name, identifier: link[1] }
    if (/^(?:mg)?\d+$/i.test(keyword)) return { provider: this.name, identifier: keyword.replace(/^mg/i, '') }
    return null
  }

  async search(keyword: string, page = 1, size = 10): Promise<MediaInfo[]> {
    const url = new URL('http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do')
    url.searchParams.set('ua', 'Android_migu')
    url.searchParams.set('version', '5.0.1')
    url.searchParams.set('text', keyword)
    url.searchParams.set('pageNo', String(Math.max(1, page)))
    url.searchParams.set('pageSize', String(size))
    url.searchParams.set('searchSwitch', '{"song":1,"album":0,"singer":0,"tagSong":0,"mvSong":0,"songlist":0,"bestShow":1}')
    const data = (await httpGet(url.toString(), HEADERS)).json<any>()
    const items: SongItem[] = data.songResultData?.result ?? []
    return items.map((item) => toMedia(item, 'HQ')).filter((item): item is MediaInfo => Boolean(item))
  }

  async getMediaInfo(meta: MetaData): Promise<MediaInfo> {
    const { contentId, formatType } = splitId(meta.identifier)
    const item = await this.fetchDetail(contentId)
    const media = toMedia(item, formatType || 'HQ')
    if (!media) throw new MusicError('migu: media info not found')
    return { ...media, meta: { ...media.meta, identifier: media.meta.identifier || meta.identifier } }
  }

  async getMediaUrl(meta: MetaData, quality: Quality = 'hq'): Promise<MediaUrl[]> {
    let { contentId, resourceType, formatType } = splitId(meta.identifier)
    const requested = this.mapQuality(quality)
    if (!resourceType || !formatType || requested !== formatType) {
      const item = await this.fetchDetail(contentId)
      const format = pickFormat(item.rateFormats?.length ? item.rateFormats : (item.audioFormats ?? []), requested)
      if (!format) throw new MusicError('migu: no playable format')
      resourceType = format.resourceType ?? ''
      formatType = format.formatType ?? requested
    }
    const url = new URL('http://app.pd.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do')
    url.searchParams.set('toneFlag', formatType)
    url.searchParams.set('netType', '00')
    url.searchParams.set('userId', MAGIC_USER)
    url.searchParams.set('ua', 'Android_migu')
    url.searchParams.set('version', '5.1')
    url.searchParams.set('copyrightId', '0')
    url.searchParams.set('contentId', contentId)
    url.searchParams.set('resourceType', resourceType)
    url.searchParams.set('channel', '0')
    const res = await httpRequest(url.toString(), { headers: HEADERS, redirect: 'manual' })
    const location = res.location || res.headers.location || ''
    if (location) return [{ url: location, quality, headers: {} }]
    const body = res.json<any>()
    const playUrl = firstNonEmpty(body.data?.url, body.data?.playUrl, body.data?.song?.url, body.url, body.playUrl)
    if (playUrl) return [{ url: playUrl, quality, headers: {} }]
    throw new MusicError(`migu: failed to get url${body.code ? ` (${body.code})` : ''}`)
  }

  async getMediaLyric(meta: MetaData): Promise<Lyrics[]> {
    const { contentId } = splitId(meta.identifier)
    const infoUrl = `http://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceId=${encodeURIComponent(contentId)}&resourceType=2`
    const resource = (await httpGet(infoUrl, HEADERS)).json<any>().resource?.[0]
    let lyricUrl = firstNonEmpty(resource?.lrcUrl, resource?.lyricUrl).replace(/^http:\/\//, 'https://')
    if (!lyricUrl) return []
    const raw = (await httpGet(lyricUrl, {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://y.migu.cn/',
    })).text
    return raw ? [parseLyrics(raw, 'zho')] : []
  }

  private async fetchDetail(contentId: string): Promise<SongItem> {
    const url = `http://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceId=${encodeURIComponent(contentId)}&resourceType=2`
    const item = (await httpGet(url, HEADERS)).json<any>().resource?.[0]
    if (!item) throw new MusicError('migu: song detail not found')
    return item
  }
}

export const migu = new MiguProvider()

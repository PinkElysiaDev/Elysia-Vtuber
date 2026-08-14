export type Quality = 'any' | 'standard' | '128k' | '192k' | '256k' | '320k' | 'hq' | 'sq'

export interface MetaData {
  provider: string
  identifier: string
}

export interface MediaInfo {
  title: string
  artist: string
  artists: string[]
  album: string
  cover: string
  duration: number
  meta: MetaData
}

export interface MediaUrl {
  url: string
  quality: Quality
  headers: Record<string, string>
}

export interface LyricLine {
  time: number
  lyric: string
}

export interface Lyrics {
  lang: string
  content: LyricLine[]
}

export interface MediaProvider {
  name: string
  qualities(): Quality[]
  mapQuality(quality: Quality): string
  search(keyword: string, page?: number, size?: number): Promise<MediaInfo[]>
  matchMedia(keyword: string): MetaData | null
  getMediaInfo(meta: MetaData): Promise<MediaInfo>
  getMediaUrl(meta: MetaData, quality?: Quality): Promise<MediaUrl[]>
  getMediaLyric(meta: MetaData): Promise<Lyrics[]>
}

export interface QueueItem {
  id: string
  media: MediaInfo
  userId: string
  userName: string
  requestedAt: number
  idle: boolean
}

export interface NowPlaying {
  item: QueueItem
  url: MediaUrl
  lyrics: Lyrics | null
  startedAt: number
  paused: boolean
}

export class MusicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicError'
  }
}

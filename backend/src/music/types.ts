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

/** 歌单解析能力（provider 可选实现）：歌单链接/ID → 歌曲列表 */
export interface PlaylistCapable {
  /** 识别歌单引用（平台链接或纯 ID）；不匹配返回 null */
  matchPlaylist(ref: string): { id: string } | null
  /** 展开歌单为歌曲列表（每源截断至 PLAYLIST_MAX） */
  getPlaylist(id: string): Promise<MediaInfo[]>
}

/** 歌单导入的单源上限（防巨型歌单拖垮请求与配置） */
export const PLAYLIST_MAX = 500

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
  /** 暂停开始时刻（恢复时清空并累计入 pausedAccumMs） */
  pausedAt?: number
  /** 累计暂停时长（ms），用于 elapsed 修正 */
  pausedAccumMs: number
  /** seek 起始偏移（ms） */
  offsetMs: number
}

/** 播放记录（落盘 data/play-history.json，上限 500） */
export interface PlayHistoryRecord {
  /** 队列项 id（同曲重播会有多条） */
  id: string
  title: string
  artist: string
  source: string
  songId: string
  duration: number
  cover: string
  userId: string
  userName: string
  /** 点歌时间（入队时刻） */
  requestedAt: number
  /** 播放时间（开播时刻） */
  startedAt: number
  /** 结束时刻；播放中为 undefined */
  endedAt?: number
  /** completed=播完 skipped=跳过 interrupted=中断 failed=失败；播放中为 undefined */
  status?: 'completed' | 'skipped' | 'interrupted' | 'failed'
}

export class MusicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicError'
  }
}

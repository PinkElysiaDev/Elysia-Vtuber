import type { Lyrics, MediaInfo, MediaProvider, MediaUrl, MetaData, Quality } from '../types'
import { MusicError } from '../types'

export class StubProvider implements MediaProvider {
  constructor(
    public name: string,
    private reason: string,
  ) {}

  qualities(): Quality[] {
    return ['320k']
  }

  mapQuality(_quality: Quality): string {
    return '320k'
  }

  matchMedia(_keyword: string): MetaData | null {
    return null
  }

  async search(): Promise<MediaInfo[]> {
    throw new MusicError(`${this.name}: ${this.reason}`)
  }

  async getMediaInfo(): Promise<MediaInfo> {
    throw new MusicError(`${this.name}: ${this.reason}`)
  }

  async getMediaUrl(): Promise<MediaUrl[]> {
    throw new MusicError(`${this.name}: ${this.reason}`)
  }

  async getMediaLyric(): Promise<Lyrics[]> {
    return []
  }
}

export const netease = new StubProvider('netease', '需要登录与 weapi，阶段 3 暂未开放播放')
export const qq = new StubProvider('qq', '需要登录与签名，阶段 3 暂未开放播放')

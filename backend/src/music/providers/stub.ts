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


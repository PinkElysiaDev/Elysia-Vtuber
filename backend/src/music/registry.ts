import type { Lyrics, MediaInfo, MediaProvider, MediaUrl, MetaData, PlaylistCapable, Quality } from './types'
import { MusicError } from './types'
import { kuwo } from './providers/kuwo'
import { kugou } from './providers/kugou'
import { migu } from './providers/migu'
import { bilivideo } from './providers/bilivideo'
import { netease } from './providers/netease'
import { qq } from './providers/qq'

const ALIASES: Record<string, string> = {
  'bilibili-video': 'bilivideo',
  bili: 'bilivideo',
  kw: 'kuwo',
  kg: 'kugou',
  mg: 'migu',
  wy: 'netease',
}

export class ProviderRegistry {
  private providers = new Map<string, MediaProvider>()

  constructor(list: MediaProvider[]) {
    for (const provider of list) this.register(provider)
  }

  register(provider: MediaProvider): void {
    this.providers.set(provider.name, provider)
  }

  get(name: string): MediaProvider | undefined {
    const key = ALIASES[name] ?? name
    return this.providers.get(key)
  }

  names(): string[] {
    return [...this.providers.keys()]
  }

  resolve(name?: string, fallback = 'kuwo'): MediaProvider {
    const provider = this.get(name || fallback) ?? this.get(fallback)
    if (!provider) throw new MusicError(`unknown source: ${name || fallback}`)
    return provider
  }

  match(keyword: string, preferred?: string): { provider: MediaProvider; meta: MetaData } | null {
    if (preferred) {
      const provider = this.get(preferred)
      const meta = provider?.matchMedia(keyword)
      if (provider && meta) return { provider, meta }
    }
    for (const provider of this.providers.values()) {
      const meta = provider.matchMedia(keyword)
      if (meta) return { provider, meta }
    }
    return null
  }

  async search(keyword: string, source?: string, page = 1, size = 10): Promise<MediaInfo[]> {
    return this.resolve(source).search(keyword, page, size)
  }

  async info(meta: MetaData): Promise<MediaInfo> {
    return this.resolve(meta.provider).getMediaInfo(meta)
  }

  async url(meta: MetaData, quality: Quality = '320k'): Promise<MediaUrl[]> {
    return this.resolve(meta.provider).getMediaUrl(meta, quality)
  }

  async lyric(meta: MetaData): Promise<Lyrics[]> {
    return this.resolve(meta.provider).getMediaLyric(meta)
  }

  /** 歌单链接/ID → 歌曲列表：preferred 优先，其余按注册序 fallthrough */
  async playlist(ref: string, preferred?: string): Promise<{ provider: string; items: MediaInfo[] } | null> {
    const capable: MediaProvider[] = []
    for (const provider of this.providers.values()) {
      const cap = provider as MediaProvider & Partial<PlaylistCapable>
      if (typeof cap.matchPlaylist !== 'function' || typeof cap.getPlaylist !== 'function') continue
      capable.push(provider)
    }
    // preferred 排最前（纯数字歌单 ID 多家都命中，需用户选择优先）
    if (preferred) {
      const idx = capable.findIndex((p) => p.name === preferred)
      if (idx > 0) capable.unshift(...capable.splice(idx, 1))
    }
    for (const provider of capable) {
      const cap = provider as MediaProvider & Partial<PlaylistCapable>
      const hit = cap.matchPlaylist!(ref)
      if (!hit) continue
      try {
        const items = await cap.getPlaylist!(hit.id)
        if (items?.length) return { provider: provider.name, items }
      } catch (err) {
        // 首选 provider 展开失败时 fallthrough 到下一家（而非整体报错）
        console.warn(`[registry] playlist provider ${provider.name} failed:`, err instanceof Error ? err.message : err)
      }
    }
    return null
  }

  /** 支持歌单解析的 provider 名单（前端下拉用） */
  playlistProviders(): string[] {
    return [...this.providers.values()]
      .filter((p) => typeof (p as MediaProvider & Partial<PlaylistCapable>).matchPlaylist === 'function')
      .map((p) => p.name)
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry([kuwo, kugou, migu, bilivideo, netease, qq])
}

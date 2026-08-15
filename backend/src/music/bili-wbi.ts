import { createHash } from 'crypto'
import { httpGet } from './http'

const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

const NAV = 'https://api.bilibili.com/x/web-interface/nav'

const CACHE_TTL_MS = 2 * 60 * 60 * 1000

let cached: { key: string; expire: number } | null = null

export function extractWbiKey(imgUrl: string, subUrl: string): string {
  const img = filenameStem(imgUrl)
  const sub = filenameStem(subUrl)
  const raw = img + sub
  return MIXIN.map((i) => raw[i] ?? '').join('').slice(0, 32)
}

export function signWbiQuery(params: Record<string, string | number>, mixinKey: string, wts = Math.floor(Date.now() / 1000)): string {
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    filtered[key] = String(value).replace(/[!'()*]/g, '')
  }
  filtered.wts = String(wts)
  const query = Object.keys(filtered).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(filtered[key])}`).join('&')
  const wrid = createHash('md5').update(query + mixinKey).digest('hex')
  return `${query}&w_rid=${wrid}`
}

export async function getWbiKey(headers: Record<string, string>): Promise<string> {
  if (cached && cached.expire > Date.now()) return cached.key
  const data = (await httpGet(NAV, headers, 8000)).json<any>()
  const img = String(data.data?.wbi_img?.img_url ?? '')
  const sub = String(data.data?.wbi_img?.sub_url ?? '')
  if (!img || !sub) throw new Error('bilivideo: wbi keys missing')
  const key = extractWbiKey(img, sub)
  cached = { key, expire: Date.now() + CACHE_TTL_MS }
  return key
}

export async function wbiUrl(base: string, params: Record<string, string | number>, headers: Record<string, string>): Promise<string> {
  const key = await getWbiKey(headers)
  const query = signWbiQuery(params, key)
  return `${base}?${query}`
}

function filenameStem(url: string): string {
  const name = url.split('/').pop() ?? ''
  return name.replace(/\.[^.]+$/, '')
}

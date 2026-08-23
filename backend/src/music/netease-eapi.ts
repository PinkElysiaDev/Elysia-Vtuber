/**
 * 网易云 eapi 请求封装（对照 Music163Api-Go / miaosic 移植）。
 * 加密：digest=md5("nobody"+path+"use"+json+"md5forencrypt")，
 * payload = path+"-36cd479b6b5-"+json+"-36cd479b6b5-"+digest，
 * params  = AES-128-ECB(payload, key) 大写 hex。
 */
import { createCipheriv, createHash } from 'crypto'
import { httpRequest } from './http'

const EAPI_KEY = 'e82ckenh8dichen8'
const BASE = 'https://music.163.com'
const APPVER = '8.9.70'

export interface NeteaseCookies {
  MUSIC_U?: string
  MUSIC_A?: string
  __csrf?: string
  os?: string
  appver?: string
  buildver?: string
  deviceId?: string
}

function md5Hex(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex')
}

/** PKCS7 填充的 AES-128-ECB，输出大写 hex */
export function eapiEncrypt(payload: string): string {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(EAPI_KEY, 'utf8'), null)
  return Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]).toString('hex').toUpperCase()
}

export function buildEapiParams(path: string, body: Record<string, unknown>): string {
  const json = JSON.stringify(body)
  const digest = md5Hex(`nobody${path}use${json}md5forencrypt`)
  return eapiEncrypt(`${path}-36cd479b6b5-${json}-36cd479b6b5-${digest}`)
}

function cookieString(cookies: NeteaseCookies): string {
  const buildver = Math.floor(Date.now() / 1000).toString().slice(0, 10)
  const parts: string[] = []
  if (cookies.MUSIC_U) parts.push(`MUSIC_U=${cookies.MUSIC_U}`)
  if (cookies.MUSIC_A) parts.push(`MUSIC_A=${cookies.MUSIC_A}`)
  if (cookies.__csrf) parts.push(`__csrf=${cookies.__csrf}`)
  if (cookies.deviceId) parts.push(`deviceId=${cookies.deviceId}`)
  parts.push(`appver=${APPVER}`, `buildver=${buildver}`, 'resolution=1920x1080', 'os=android')
  return parts.join('; ')
}

export interface EapiResponse {
  code: number
  setCookie: string[]
  data: any
}

/** path 形如 /api/login/qrcode/unikey，实际请求 /eapi/<path 去掉开头 /api/> */
export async function eapiRequest(path: string, body: Record<string, unknown>, cookies: NeteaseCookies = {}, timeoutMs = 10000): Promise<EapiResponse> {
  const url = `${BASE}/eapi${path.slice(4)}`
  const res = await httpRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'NeteaseMusic/8.9.70.1 (DAL-AL00;android 13)',
      cookie: cookieString(cookies),
    },
    body: `params=${buildEapiParams(path, body)}`,
    timeoutMs,
  })
  const data = res.json<any>()
  return { code: Number(data?.code ?? 0), setCookie: res.setCookie, data }
}

/** 从 Set-Cookie 列表中提取指定 cookie 值 */
export function pickCookie(setCookie: string[], name: string): string {
  for (const line of setCookie) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(line)
    if (match) return match[1]
  }
  return ''
}

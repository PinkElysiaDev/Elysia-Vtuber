/**
 * 音源登录抽象（对照 miaosic Loginable 设计）。
 * session 为 base64(JSON) 字符串，由各 provider 自定义字段，经 SessionStore 持久化。
 */
import type { MediaProvider } from './types'

export interface QrLoginSession {
  /** 二维码内容（前端渲染成二维码图片） */
  url: string
  /** 轮询凭证 */
  key: string
}

export type QrLoginStatus = 'waiting' | 'scanned' | 'success' | 'expired' | 'failed'

export interface QrLoginResult {
  status: QrLoginStatus
  message: string
}

export interface Loginable {
  /** 发起扫码登录，返回二维码内容与轮询 key */
  qrLogin(): Promise<QrLoginSession>
  /** 校验一次扫码状态（由上层轮询调用） */
  qrLoginVerify(session: QrLoginSession): Promise<QrLoginResult>
  isLogin(): Promise<boolean>
  logout(): Promise<void>
  /** 从 base64(JSON) 恢复登录态，返回是否恢复成功 */
  restoreSession(session: string): Promise<boolean>
  /** 导出当前登录态为 base64(JSON) */
  saveSession(): string
}

export type LoginableProvider = MediaProvider & Loginable

export function isLoginable(provider: MediaProvider): provider is LoginableProvider {
  const candidate = provider as Partial<Loginable>
  return (
    typeof candidate.qrLogin === 'function' &&
    typeof candidate.qrLoginVerify === 'function' &&
    typeof candidate.saveSession === 'function' &&
    typeof candidate.restoreSession === 'function'
  )
}

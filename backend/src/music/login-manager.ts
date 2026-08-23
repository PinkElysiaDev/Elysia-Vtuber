/**
 * 各音源登录态的内存缓存 + 持久化协调。
 * 持久化落到 music.sessions（backend-config.json），不进 schema UI（含敏感 token）。
 */
import type { ProviderRegistry } from './registry'
import { isLoginable } from './login'

export interface SessionStoreDeps {
  registry: ProviderRegistry
  /** 将完整 sessions 写回配置并保存（index.ts 提供） */
  persistSessions: (sessions: Record<string, string>) => void
  /** 登录状态变化时广播（如 music.login.changed） */
  broadcast?: (method: string, params: unknown) => void
}

export class LoginManager {
  private sessions: Record<string, string> = {}
  private qrSessions = new Map<string, import('./login').QrLoginSession>()

  constructor(private deps: SessionStoreDeps) {}

  /** 启动 / 配置重载时恢复所有已保存的登录态 */
  async restoreFrom(sessions: Record<string, string>): Promise<void> {
    this.sessions = { ...sessions }
    for (const [name, session] of Object.entries(sessions)) {
      if (!session) continue
      const provider = this.deps.registry.get(name)
      if (!provider || !isLoginable(provider)) continue
      try {
        const ok = await provider.restoreSession(session)
        if (!ok) console.warn(`[music-login] ${name} session 恢复失败，可能已过期`)
      } catch (err) {
        console.warn(`[music-login] ${name} session 恢复异常:`, err instanceof Error ? err.message : err)
      }
    }
  }

  async listProviders(): Promise<Array<{ name: string; loginable: boolean; loggedIn: boolean }>> {
    const out: Array<{ name: string; loginable: boolean; loggedIn: boolean }> = []
    for (const name of this.deps.registry.names()) {
      const provider = this.deps.registry.get(name)
      if (!provider) continue
      if (!isLoginable(provider)) {
        out.push({ name, loginable: false, loggedIn: false })
        continue
      }
      let loggedIn = false
      try {
        loggedIn = await provider.isLogin()
      } catch {
        loggedIn = false
      }
      out.push({ name, loginable: true, loggedIn })
    }
    return out
  }

  async qrCreate(providerName: string): Promise<{ provider: string; url: string; key: string }> {
    const provider = this.requireLoginable(providerName)
    const session = await provider.qrLogin()
    this.qrSessions.set(providerName, session)
    return { provider: providerName, url: session.url, key: session.key }
  }

  /** 单次校验扫码状态；成功时保存 session 并广播 */
  async qrPoll(providerName: string): Promise<{ provider: string; status: string; message: string }> {
    const provider = this.requireLoginable(providerName)
    const session = this.qrSessions.get(providerName)
    if (!session) throw new Error(`${providerName}: 尚未获取二维码`)
    const result = await provider.qrLoginVerify(session)
    if (result.status === 'success') {
      this.saveProviderSession(providerName, provider.saveSession())
      this.qrSessions.delete(providerName)
      this.deps.broadcast?.('music.login.changed', { provider: providerName, loggedIn: true })
    } else if (result.status === 'expired' || result.status === 'failed') {
      this.qrSessions.delete(providerName)
    }
    return { provider: providerName, status: result.status, message: result.message }
  }

  async logout(providerName: string): Promise<{ provider: string; ok: boolean }> {
    const provider = this.requireLoginable(providerName)
    await provider.logout()
    this.saveProviderSession(providerName, '')
    this.qrSessions.delete(providerName)
    this.deps.broadcast?.('music.login.changed', { provider: providerName, loggedIn: false })
    return { provider: providerName, ok: true }
  }

  /** 高级用法：直接注入 base64(JSON) session（也给非 Loginable 源留凭据覆盖口） */
  async sessionSet(providerName: string, session: string): Promise<{ provider: string; ok: boolean; message: string }> {
    const provider = this.deps.registry.get(providerName)
    if (!provider) throw new Error(`unknown provider: ${providerName}`)
    if (isLoginable(provider)) {
      if (session) {
        const ok = await provider.restoreSession(session)
        if (!ok) throw new Error(`${providerName}: session 无效或已过期`)
      } else {
        await provider.logout()
      }
    }
    this.saveProviderSession(providerName, session)
    this.deps.broadcast?.('music.login.changed', { provider: providerName, loggedIn: Boolean(session) })
    return { provider: providerName, ok: true, message: session ? 'session 已保存' : 'session 已清除' }
  }

  /** 读取某源已保存的 session 字符串（校验用，不外发） */
  sessionGet(providerName: string): string {
    return this.sessions[providerName] ?? ''
  }

  private saveProviderSession(name: string, session: string): void {
    if (session) this.sessions[name] = session
    else delete this.sessions[name]
    this.deps.persistSessions(this.sessions)
  }

  private requireLoginable(name: string) {
    const provider = this.deps.registry.get(name)
    if (!provider) throw new Error(`unknown provider: ${name}`)
    if (!isLoginable(provider)) throw new Error(`${name}: 不支持登录（仅匿名音源）`)
    return provider
  }
}

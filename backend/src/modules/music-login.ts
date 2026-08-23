import type { RpcHandler } from '../core/rpc'
import type { LoginManager } from '../music/login-manager'

export function buildMusicLoginModule(manager: LoginManager): Record<string, RpcHandler> {
  return {
    'music.login.providers': async () => ({ ok: true, providers: await manager.listProviders() }),
    'music.login.qr.create': async (params) => {
      const provider = String((params as any)?.provider ?? '')
      if (!provider) throw new Error('music.login.qr.create requires { provider }')
      return manager.qrCreate(provider)
    },
    'music.login.qr.poll': async (params) => {
      const provider = String((params as any)?.provider ?? '')
      if (!provider) throw new Error('music.login.qr.poll requires { provider }')
      return manager.qrPoll(provider)
    },
    'music.login.logout': async (params) => {
      const provider = String((params as any)?.provider ?? '')
      if (!provider) throw new Error('music.login.logout requires { provider }')
      return manager.logout(provider)
    },
    'music.login.session.set': async (params) => {
      const provider = String((params as any)?.provider ?? '')
      const session = String((params as any)?.session ?? '')
      if (!provider) throw new Error('music.login.session.set requires { provider, session }')
      return manager.sessionSet(provider, session)
    },
  }
}

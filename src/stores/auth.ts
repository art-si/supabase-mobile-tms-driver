import { defineStore } from 'pinia'
import { redirectToLogin } from '@mobile-core/login-navigation'
import { ApiRequestError, bindDriverWechatPhone, driverPasswordLogin, driverWechatPhoneLogin, refreshToken, signOut } from '@/api/supabase'
import { getProfileSummary } from '@/api/profile'
import { useProfileStore } from './profile'
import type { Session } from '@/api/types'
import { useDictionaryStore } from './dictionary'

const STORAGE_KEY = 'tms-driver-session'

let sessionRevision = 0
let pendingRefresh: { revision: number; promise: Promise<void> } | null = null

interface AuthState {
  session: Session | null
  booted: boolean
}

function normalizeSession(session: Session | null) {
  if (!session) return null
  if (!session.expires_at && session.expires_in) {
    session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in
  }
  return session
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    session: null,
    booted: false
  }),
  getters: {
    token: (state) => state.session?.access_token || '',
    user: (state) => state.session?.user || null,
    isLoggedIn: (state) => Boolean(state.session?.access_token),
    isTokenExpired: (state) => {
      if (!state.session?.access_token) return false
      const expiresAt = state.session?.expires_at
      if (!expiresAt) return true
      return expiresAt * 1000 - Date.now() < 180_000
    }
  },
  actions: {
    hydrate() {
      if (this.booted) return
      const cached = uni.getStorageSync(STORAGE_KEY)
      if (cached) {
        try {
          this.session = normalizeSession(typeof cached === 'string' ? JSON.parse(cached) : cached)
        } catch {
          this.session = null
        }
      }
      this.booted = true
    },
    persist() {
      if (this.session) {
        uni.setStorageSync(STORAGE_KEY, JSON.stringify(this.session))
      } else {
        uni.removeStorageSync(STORAGE_KEY)
      }
    },
    clearSession(redirect = false) {
      sessionRevision += 1
      useDictionaryStore().clear()
      useProfileStore().clear()
      this.session = null
      this.persist()
      if (redirect) redirectToLogin()
    },
    async ensureValidSession(redirect = true) {
      this.hydrate()
      if (!this.token) {
        this.clearSession(redirect)
        return false
      }
      if (!this.isTokenExpired) return true

      try {
        await this.refreshSession(redirect)
        return Boolean(this.token)
      } catch {
        return false
      }
    },
    async withFreshAccess<T>(read: (token: string) => Promise<T>): Promise<T> {
      const revision = sessionRevision
      const token = this.token
      if (!token) throw new Error('请先登录')

      let result: T
      try {
        result = await read(token)
      } catch (error) {
        if (revision !== sessionRevision || !(error instanceof ApiRequestError && error.isAccessTokenExpired)) {
          throw error
        }
        if (this.token === token) await this.refreshSession()
        if (revision !== sessionRevision || !this.token) throw new Error('登录已过期，请重新登录')
        result = await read(this.token)
      }
      if (revision !== sessionRevision) throw new Error('登录已过期，请重新登录')
      return result
    },
    async login(account: string, password: string) {
      const session = await driverPasswordLogin(account.trim(), password)
      return this.completeSignIn(session)
    },
    async loginWithWechatPhone(phoneCode: string) {
      const session = await driverWechatPhoneLogin(phoneCode)
      return this.completeSignIn(session)
    },
    async completeSignIn(session: Session): Promise<Session> {
      this.clearSession()
      const revision = sessionRevision
      try {
        if (!session?.access_token || !session.refresh_token || !session.user?.id) throw new Error('登录服务未返回有效会话，请重试')
        const summary = await getProfileSummary(session.access_token)
        await useDictionaryStore().load(session.access_token, true)
        if (revision !== sessionRevision) throw new Error('登录状态已变更，请重新登录')
        useProfileStore().$patch({ summary })
        this.session = normalizeSession(session)
        this.persist()
        return session
      } catch (error) {
        try { await signOut(session.access_token) } catch { /* Local credentials are still cleared. */ }
        if (revision === sessionRevision) this.clearSession()
        throw error
      }
    },
    async bindWechatPhone(phoneCode: string): Promise<void> {
      if (!(await this.ensureValidSession(false))) throw new Error('请先用账号密码重新登录，再绑定微信手机号')
      await bindDriverWechatPhone(phoneCode, this.token)
    },
    async refreshSession(redirect = true) {
      const revision = sessionRevision
      if (pendingRefresh?.revision === revision) return pendingRefresh.promise

      if (!this.session?.refresh_token) {
        this.clearSession(redirect)
        throw new Error('登录已过期，请重新登录')
      }

      const currentRefreshToken = this.session.refresh_token
      const promise = (async () => {
        try {
          const nextSession = normalizeSession(await refreshToken(currentRefreshToken))
          if (revision !== sessionRevision) return
          if (!nextSession?.access_token) throw new Error('登录已过期，请重新登录')
          this.session = nextSession
          this.persist()
        } catch (error) {
          if (revision === sessionRevision) this.clearSession(redirect)
          throw error
        } finally {
          if (pendingRefresh?.revision === revision) pendingRefresh = null
        }
      })()

      pendingRefresh = { revision, promise }
      return promise
    },
    async logout() {
      if (this.session?.access_token) {
        try {
          await signOut(this.session.access_token)
        } catch {
          // Local logout still clears stale credentials if remote logout is unavailable.
        }
      }
      this.clearSession(true)
    }
  }
})

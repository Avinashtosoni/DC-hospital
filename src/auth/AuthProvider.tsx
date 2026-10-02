import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Profile } from '../types'
import type { AuthAdapter, SignUpInput } from '../data/adapter'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadLocal } from '../data/local'
import { supabaseAuth } from '../data/supabaseAdapter'
import { resolveSession, TenantAccessError } from '../tenancy/session'
import { clearProviderChoice, type MyContext } from '../tenancy/state'
import { toast } from 'sonner'

/** demo mode: the in-browser accounts, loaded on first use */
const L = async () => (await loadLocal()).localAuth
const lazyLocalAuth: AuthAdapter = {
  getCurrent: async () => (await L()).getCurrent(),
  signIn: async (email, password) => (await L()).signIn(email, password),
  signUp: async (input) => (await L()).signUp(input),
  signOut: async () => (await L()).signOut(),
  changePassword: async (current, next) => (await L()).changePassword(current, next),
  requestPasswordReset: async (email, redirectTo) => (await L()).requestPasswordReset(email, redirectTo),
  hasRecoverySession: async () => (await L()).hasRecoverySession(),
  setNewPassword: async (next) => (await L()).setNewPassword(next),
  signOutEverywhere: async () => (await L()).signOutEverywhere(),
  uploadAvatar: async (userId, file) => (await L()).uploadAvatar(userId, file),
  onChange(cb) {
    let off = () => {}, done = false
    void L().then((a) => { if (!done) off = a.onChange(cb) })
    return () => { done = true; off() }
  },
}

export const auth: AuthAdapter = isSupabaseConfigured ? supabaseAuth : lazyLocalAuth

interface AuthCtx {
  user: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Profile>
  signUp: (input: SignUpInput) => Promise<Profile>
  signOut: () => Promise<void>
  /** true right after this tab signed out on purpose — guards send the visitor to the public home, not the login page */
  signedOut: boolean
  refresh: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  signOutEverywhere: () => Promise<void>
  uploadAvatar: (file: Blob) => Promise<string>
  /** multi-hospital mode: this person's hospital, role and provider role / mode (null in single mode) */
  context: MyContext | null
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  const [context, setContext] = useState<MyContext | null>(null)
  const qc = useQueryClient()

  /** profile → profile with this hospital's role (multi mode); a wrong-hospital account is signed out */
  const settle = useCallback(async (p: Profile | null) => {
    if (!p) { setUser(null); setContext(null); return null }
    try {
      const r = await resolveSession(p)
      setContext(r.context); setUser(r.user)
      return r.user
    } catch (e) {
      if (e instanceof TenantAccessError) { await auth.signOut().catch(() => undefined); setUser(null); setContext(null) }
      throw e
    }
  }, [])

  const refresh = useCallback(async () => {
    try { await settle(await auth.getCurrent()) } catch (e) {
      setUser(null)
      if (e instanceof TenantAccessError) toast.error(e.message)
    } finally { setLoading(false) }
  }, [settle])

  // the "go home after sign-out" hint only matters for the redirect right after it
  useEffect(() => { if (!signedOut) return; const id = setTimeout(() => setSignedOut(false), 3000); return () => clearTimeout(id) }, [signedOut])

  useEffect(() => {
    refresh()
    return auth.onChange(() => { refresh() })
  }, [refresh])

  const value = useMemo<AuthCtx>(() => ({
    user, loading, refresh, signedOut, context,
    signIn: async (e, p) => { const u = (await settle(await auth.signIn(e, p)))!; qc.clear(); setSignedOut(false); return u },
    signUp: async (input) => { const u = (await settle(await auth.signUp(input)))!; qc.clear(); setSignedOut(false); return u },
    // the session is dropped locally even if the network call fails, so "Sign out" always works
    signOut: async () => { try { await auth.signOut() } finally { clearProviderChoice(); setSignedOut(true); setUser(null); setContext(null); qc.clear() } },
    changePassword: (c, n) => auth.changePassword(c, n),
    signOutEverywhere: async () => { await auth.signOutEverywhere(); clearProviderChoice(); setSignedOut(true); setUser(null); setContext(null); qc.clear() },
    uploadAvatar: (file) => { if (!user) throw new Error('Not signed in'); return auth.uploadAvatar(user.id, file) },
  }), [user, loading, refresh, signedOut, context, settle, qc])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}

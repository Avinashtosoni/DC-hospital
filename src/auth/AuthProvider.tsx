import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Profile } from '../types'
import type { AuthAdapter, SignUpInput } from '../data/adapter'
import { supabaseAuth } from '../data/supabaseAdapter'
import { resolveSession, TenantAccessError } from '../tenancy/session'
import { clearProviderChoice, type MyContext } from '../tenancy/state'
import { toast } from 'sonner'
import { OtpRequiredError, type OtpChannelId, type OtpStatus } from '../data/errors'
import { requestLoginOtp, verifyLoginOtp, type OtpSent } from './loginOtp'
import { flushNotificationsSoon } from '../settings/store'
import { supabase } from '../lib/supabase'

export const auth: AuthAdapter = supabaseAuth

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
  /** signed in, but this session still has to enter its sign-in code (Settings → Security) */
  otp: OtpStatus | null
  requestOtp: (channel: OtpChannelId | null) => Promise<OtpSent>
  verifyOtp: (code: string) => Promise<Profile | null>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  const [context, setContext] = useState<MyContext | null>(null)
  const [otp, setOtp] = useState<OtpStatus | null>(null)
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

  /** the profile, or — sign-in OTP pending — remember what the code screen needs and stay signed out of the app */
  const load = useCallback(async (get: () => Promise<Profile | null>) => {
    try {
      const u = await settle(await get())
      setOtp(null)
      return u
    } catch (e) {
      if (e instanceof OtpRequiredError) { setOtp(e.status); setUser(null); setContext(null) }
      throw e
    }
  }, [settle])

  const refresh = useCallback(async () => {
    try { await load(() => auth.getCurrent()) } catch (e) {
      setUser(null)
      if (e instanceof TenantAccessError) toast.error(e.message)
    } finally { setLoading(false) }
  }, [load])

  // the "go home after sign-out" hint only matters for the redirect right after it
  useEffect(() => { if (!signedOut) return; const id = setTimeout(() => setSignedOut(false), 3000); return () => clearTimeout(id) }, [signedOut])

  useEffect(() => {
    refresh()
    return auth.onChange(() => { refresh() })
  }, [refresh])

  const value = useMemo<AuthCtx>(() => ({
    user, loading, refresh, signedOut, context, otp,
    signIn: async (e, p) => { const u = (await load(() => auth.signIn(e, p)))!; qc.clear(); setSignedOut(false); return u },
    signUp: async (input) => { const u = (await load(() => auth.signUp(input)))!; qc.clear(); setSignedOut(false); return u },
    requestOtp: async (channel) => {
      const r = await requestLoginOtp(channel)
      if (r.scope === 'hospital') flushNotificationsSoon(0, [r.ref])   // deliver the code right away
      // a Hospital Comrade team member: their code goes out on the platform's shared accounts
      else if (r.sent) void supabase?.functions.invoke('ops', { body: { deliver_otp: r.ref } }).catch(() => undefined)
      return r
    },
    verifyOtp: async (code) => { await verifyLoginOtp(code); const u = await load(() => auth.getCurrent()); qc.clear(); setSignedOut(false); return u },
    // the session is dropped locally even if the network call fails, so "Sign out" always works
    signOut: async () => { try { await auth.signOut() } finally { clearProviderChoice(); setSignedOut(true); setUser(null); setContext(null); setOtp(null); qc.clear() } },
    changePassword: (c, n) => auth.changePassword(c, n),
    signOutEverywhere: async () => { await auth.signOutEverywhere(); clearProviderChoice(); setSignedOut(true); setUser(null); setContext(null); setOtp(null); qc.clear() },
    uploadAvatar: (file) => { if (!user) throw new Error('Not signed in'); return auth.uploadAvatar(user.id, file) },
  }), [user, loading, refresh, signedOut, context, otp, load, qc])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}

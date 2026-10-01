import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Profile } from '../types'
import type { AuthAdapter, SignUpInput } from '../data/adapter'
import { isSupabaseConfigured } from '../lib/supabase'
import { localAuth } from '../data/localAdapter'
import { supabaseAuth } from '../data/supabaseAdapter'

export const auth: AuthAdapter = isSupabaseConfigured ? supabaseAuth : localAuth

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
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedOut, setSignedOut] = useState(false)
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try { setUser(await auth.getCurrent()) } catch { setUser(null) } finally { setLoading(false) }
  }, [])

  // the "go home after sign-out" hint only matters for the redirect right after it
  useEffect(() => { if (!signedOut) return; const id = setTimeout(() => setSignedOut(false), 3000); return () => clearTimeout(id) }, [signedOut])

  useEffect(() => {
    refresh()
    return auth.onChange(() => { refresh() })
  }, [refresh])

  const value = useMemo<AuthCtx>(() => ({
    user, loading, refresh, signedOut,
    signIn: async (e, p) => { const u = await auth.signIn(e, p); qc.clear(); setSignedOut(false); setUser(u); return u },
    signUp: async (input) => { const u = await auth.signUp(input); qc.clear(); setSignedOut(false); setUser(u); return u },
    // the session is dropped locally even if the network call fails, so "Sign out" always works
    signOut: async () => { try { await auth.signOut() } finally { setSignedOut(true); setUser(null); qc.clear() } },
    changePassword: (c, n) => auth.changePassword(c, n),
    signOutEverywhere: async () => { await auth.signOutEverywhere(); setSignedOut(true); setUser(null); qc.clear() },
    uploadAvatar: (file) => { if (!user) throw new Error('Not signed in'); return auth.uploadAvatar(user.id, file) },
  }), [user, loading, refresh, signedOut, qc])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}

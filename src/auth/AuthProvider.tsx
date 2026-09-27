import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Profile } from '../types'
import type { AuthAdapter, SignUpInput } from '../data/adapter'
import { isSupabaseConfigured } from '../lib/supabase'
import { localAuth } from '../data/localAdapter'
import { supabaseAuth } from '../data/supabaseAdapter'

const auth: AuthAdapter = isSupabaseConfigured ? supabaseAuth : localAuth

interface AuthCtx {
  user: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Profile>
  signUp: (input: SignUpInput) => Promise<Profile>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try { setUser(await auth.getCurrent()) } catch { setUser(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    return auth.onChange(() => { refresh() })
  }, [refresh])

  const value = useMemo<AuthCtx>(() => ({
    user, loading, refresh,
    signIn: async (e, p) => { const u = await auth.signIn(e, p); qc.clear(); setUser(u); return u },
    signUp: async (input) => { const u = await auth.signUp(input); qc.clear(); setUser(u); return u },
    signOut: async () => { await auth.signOut(); qc.clear(); setUser(null) },
  }), [user, loading, refresh, qc])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}

/**
 * Browser side of the template library: the in-app bell (public.user_notifications), the platform's switches / locks
 * for Settings → Notifications, and the new-device sign-in check. scripts/sql/notify_catalog.sql.
 */
import { supabase } from '../lib/supabase'
import type { EvChannel } from './catalog'

export interface BellItem { id: string; event: string; title: string; body: string; link: string | null; read: boolean; created_at: string }
export interface BellPage { unread: number; items: BellItem[] }

/** the platform team's edits that matter to a hospital (control panel → Messaging → Templates) */
export interface PlatformOverride {
  enabled: boolean
  locked: boolean
  channels: Partial<Record<EvChannel, boolean>>
  tpl: { subject?: string; text?: string; waText?: string; pushText?: string }
}

/** older databases (before notify_catalog.sql) answer "function not found" — treat as "nothing yet" */
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? ''))

export const bellApi = {
  async list(limit = 30): Promise<BellPage> {
    if (!supabase) return { unread: 0, items: [] }
    const { data, error } = await supabase.rpc('my_notifications', { p_limit: limit, p_before: null })
    if (missing(error)) return { unread: 0, items: [] }
    if (error) throw error
    return data as BellPage
  },
  async read(ids: string[] | null): Promise<number> {
    if (!supabase) return 0
    const { data, error } = await supabase.rpc('read_notifications', { p_ids: ids })
    if (missing(error)) return 0
    if (error) throw error
    return Number(data) || 0
  },
}

export async function platformOverrides(): Promise<Record<string, PlatformOverride>> {
  if (!supabase) return {}
  const { data, error } = await supabase.rpc('notify_platform_overrides')
  if (missing(error)) return {}
  if (error) throw error
  return (data ?? {}) as Record<string, PlatformOverride>
}

const DEVICE_KEY = 'dch-device-id'
/** a short, human description of this browser ("Chrome on Windows") */
export function deviceLabel(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iPhone / iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : 'an unknown system'
  return `${browser} on ${os}`
}

/** after a sign-in: tell the database which device this is (it alerts the person when the device is new). Best effort. */
export async function noteSignIn(): Promise<void> {
  if (!supabase || typeof localStorage === 'undefined') return
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id || id.length < 16) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    await supabase.rpc('note_sign_in', { p_device: id, p_label: deviceLabel() })
  } catch { /* never block signing in */ }
}

/**
 * Notice board helpers shared by the board page, the top-bar bell and the dashboard:
 * who can see a notice, whether it is live, and per-user read state (kept in this browser).
 */
import { useCallback, useSyncExternalStore } from 'react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { Notice, Role } from '../types'
import { today } from '../lib/utils'

export const visibleTo = (n: Notice, role?: Role) =>
  role === 'owner' || n.audience === 'all' || (role === 'patient' ? n.audience === 'patients' : n.audience === 'staff' || (role === 'doctor' && n.audience === 'doctors'))

export type NoticeState = 'live' | 'scheduled' | 'expired'
export function noticeState(n: Notice, on = today()): NoticeState {
  if (n.published_on > on) return 'scheduled'
  if (n.expires_on && n.expires_on < on) return 'expired'
  return 'live'
}
export const daysLeft = (n: Notice, on = today()) => (n.expires_on ? differenceInCalendarDays(parseISO(n.expires_on), parseISO(on)) : null)

/** pinned first, then urgent → important → normal within the same day, newest first */
const PRI = { urgent: 0, important: 1, normal: 2 } as const
export const sortNotices = (a: Notice, b: Notice) =>
  Number(!!b.pinned) - Number(!!a.pinned) || b.published_on.localeCompare(a.published_on) || PRI[a.priority] - PRI[b.priority] || String(b.created_at).localeCompare(String(a.created_at))

// ------------------------------------------------------------------ read state (per user, per browser)
const key = (uid: string) => `dch:notices-read:${uid}`
const listeners = new Set<() => void>()
const cache = new Map<string, string>()
const raw = (uid: string) => { if (!cache.has(uid)) cache.set(uid, localStorage.getItem(key(uid)) ?? '[]'); return cache.get(uid)! }
function write(uid: string, ids: string[]) {
  const v = JSON.stringify(ids.slice(-500))
  localStorage.setItem(key(uid), v); cache.set(uid, v)
  listeners.forEach((l) => l())
}
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key?.startsWith('dch:notices-read:')) { cache.clear(); listeners.forEach((l) => l()) } })

export function useNoticeReads(uid: string | undefined) {
  const json = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => (uid ? raw(uid) : '[]'))
  const ids = new Set<string>(JSON.parse(json) as string[])
  const isRead = useCallback((id: string) => ids.has(id), [json]) // eslint-disable-line react-hooks/exhaustive-deps
  const markRead = useCallback((list: string[]) => { if (uid) write(uid, [...new Set([...ids, ...list])]) }, [uid, json]) // eslint-disable-line react-hooks/exhaustive-deps
  const markUnread = useCallback((id: string) => { if (uid) write(uid, [...ids].filter((x) => x !== id)) }, [uid, json]) // eslint-disable-line react-hooks/exhaustive-deps
  return { isRead, markRead, markUnread }
}

/** unread = live, visible, not opened yet and posted in the last 30 days (older ones never nag) */
export const isFresh = (n: Notice, on = today()) => differenceInCalendarDays(parseISO(on), parseISO(n.published_on)) <= 30

import { useCallback, useEffect, useState } from 'react'
import { LogOut, UserCog } from 'lucide-react'
import { platformName } from '../lib/supabase'
import { currentImpersonation, endImpersonation, impersonationActive } from './impersonation'

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Shown on every screen of a "sign in as user" tab: who you are acting as, the countdown and End. When the time is up
 * or the session was ended elsewhere, the tab is signed out and covered with a "session ended" screen.
 */
export function ImpersonationBanner() {
  const [s] = useState(currentImpersonation)
  const [now, setNow] = useState(() => Date.now())
  const [ended, setEnded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const finish = useCallback(async (reason: string) => {
    setBusy(true)
    await endImpersonation(reason)
    setEnded(reason)
    try { window.close() } catch { /* opened without opener — the screen below stays */ }
  }, [])

  useEffect(() => {
    if (!s) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const check = setInterval(() => { void impersonationActive(s.id).then((ok) => { if (!ok) void finish('expired') }) }, 60_000)
    return () => { clearInterval(tick); clearInterval(check) }
  }, [s, finish])

  const left = s ? Date.parse(s.expires_at) - now : 0
  useEffect(() => { if (s && left <= 0 && !ended && !busy) void finish('expired') }, [s, left, ended, busy, finish])

  if (!s) return null
  if (ended) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-brand-950/90 p-6 backdrop-blur-sm">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
          <UserCog className="mx-auto h-10 w-10 text-brand-600" />
          <h2 className="mt-3 font-display text-lg font-bold text-brand-950">Session ended</h2>
          <p className="mt-2 text-sm text-slate-600">
            {ended === 'expired' ? 'The 30-minute limit was reached.' : 'You are no longer signed in as this user.'} You can close this tab.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 bg-amber-500 px-4 py-2 text-xs font-medium text-amber-950 sm:px-6">
      <span className="inline-flex items-center gap-1.5 font-semibold"><UserCog className="h-4 w-4" />Signed in as {s.full_name} ({s.role}) · {s.hospital}</span>
      <span className="hidden sm:inline">{platformName} support session{s.admin_name ? ` by ${s.admin_name}` : ''} — everything is logged.</span>
      <span className="ml-auto tabular-nums">Ends in {mmss(left)}</span>
      <button type="button" disabled={busy} onClick={() => void finish('ended')}
        className="inline-flex items-center gap-1 rounded-md bg-amber-950 px-2.5 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60">
        <LogOut className="h-3.5 w-3.5" />End session
      </button>
    </div>
  )
}

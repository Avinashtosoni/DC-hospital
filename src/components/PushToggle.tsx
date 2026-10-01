import { useEffect, useState } from 'react'
import { BellOff, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { useAppSettings } from '../settings/AppSettingsProvider'
import { isSupabaseConfigured } from '../lib/supabase'
import { cn } from '../lib/utils'

/** "Notifications on this device" switch — shown when the owner has set up Firebase push. */
export function PushToggle({ variant = 'menu', onDone }: { variant?: 'menu' | 'button'; onDone?: () => void }) {
  const { settings } = useAppSettings()
  const cfg = settings.notifications.push
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    import('../lib/push').then((p) => { if (!live) return; setReady(p.pushConfigured(cfg) && p.pushSupported() && isSupabaseConfigured); setOn(!!p.savedPushToken() && p.pushPermission() === 'granted') })
    return () => { live = false }
  }, [cfg])
  if (!ready) return null
  const toggle = async () => {
    setBusy(true)
    try {
      const p = await import('../lib/push')
      if (on) { await p.disablePush(cfg); setOn(false); toast.success('Notifications turned off on this device') }
      else { await p.enablePush(cfg); setOn(true); toast.success('Notifications are on', { description: 'Notices and account alerts will pop up on this device.' }) }
      onDone?.()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const Icon = busy ? Loader2 : on ? BellRing : BellOff
  if (variant === 'button') return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={!!on}
      className={cn('inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium ring-1 transition', on ? 'bg-brand-50 text-brand-800 ring-brand-200 hover:bg-brand-100' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50')}>
      <Icon className={cn('h-4 w-4', busy && 'animate-spin')} />{on ? 'Notifications on' : 'Get notifications'}
    </button>
  )
  return (
    <button type="button" role="switch" aria-checked={!!on} onClick={toggle} disabled={busy} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
      <Icon className={cn('h-4 w-4', busy && 'animate-spin')} /><span className="flex-1 text-left">Notifications here</span>
      <span className={cn('relative h-4 w-7 rounded-full transition', on ? 'bg-brand-600' : 'bg-slate-300')}><span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', on ? 'left-3.5' : 'left-0.5')} /></span>
    </button>
  )
}

/** Shows a toast for push messages that arrive while the app is open (background ones are shown by the service worker). */
export function PushForeground() {
  const { settings } = useAppSettings()
  const cfg = settings.notifications.push
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSupabaseConfigured || !cfg.enabled) return
    let stop: (() => void) | undefined, live = true
    import('../lib/push').then(async (p) => {
      if (!p.pushConfigured(cfg) || !p.savedPushToken() || p.pushPermission() !== 'granted') return
      const off = await p.onForegroundPush(cfg, (m) => toast(m.title, {
        description: m.body,
        action: m.link ? { label: 'Open', onClick: () => { try { const u = new URL(m.link!, location.origin); if (u.origin === location.origin) navigate(u.pathname + u.search); else location.href = u.href } catch { /* bad link */ } } } : undefined,
      }))
      if (live) stop = off; else off()
    }).catch(() => { /* not supported */ })
    return () => { live = false; stop?.() }
  }, [cfg, navigate])
  return null
}

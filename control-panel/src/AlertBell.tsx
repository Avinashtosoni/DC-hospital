/**
 * Header bell: the signed-in member's team alerts (cp_alerts), refreshed every minute and right away when a push
 * arrives while the panel is open.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertOctagon, AlertTriangle, Bell, CheckCheck, Info } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../src/lib/utils'
import { cp } from './api'
import type { CpAlert, AlertSeverity } from './types'
import { onForegroundPush, savedPushToken } from './push'

export const SEVERITY_ICON: Record<AlertSeverity, JSX.Element> = {
  info: <Info className="h-4 w-4 text-sky-600" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  critical: <AlertOctagon className="h-4 w-4 text-rose-600" />,
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** links inside the panel stay in the app; anything else opens normally */
export const internal = (link: string | null) => !!link && link.startsWith('/') && !link.startsWith('//')

export function AlertBell() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const q = useQuery({ queryKey: ['cp-alerts'], queryFn: () => cp.alerts(false, 8), refetchInterval: 60_000, retry: false })
  const push = useQuery({ queryKey: ['cp-push-config'], queryFn: () => cp.pushConfig(), staleTime: 600_000, retry: false })
  const read = useMutation({ mutationFn: (ids?: string[]) => cp.readAlerts(ids), onSuccess: () => qc.invalidateQueries({ queryKey: ['cp-alerts'] }) })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // an alert pushed to this browser while it is open → toast + refresh the bell
  useEffect(() => {
    if (!push.data || !savedPushToken()) return
    let off: (() => void) | undefined
    onForegroundPush(push.data, (p) => { toast(p.title, { description: p.body }); qc.invalidateQueries({ queryKey: ['cp-alerts'] }) }).then((f) => { off = f }).catch(() => {})
    return () => off?.()
  }, [push.data, qc])

  // the database is older than cp_notify.sql → no bell rather than an error
  if (q.error) return null
  const unread = q.data?.unread ?? 0
  const openAlert = (a: CpAlert) => {
    if (!a.read_at) read.mutate([a.id])
    setOpen(false)
    if (internal(a.link)) nav(a.link!)
    else if (a.link) window.open(a.link, '_blank', 'noopener')
    else nav('/alerts')
  }
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={unread ? `${unread} unread alerts` : 'Alerts'}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-brand-50 hover:text-brand-900">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[22rem] max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <p className="flex-1 font-display text-sm font-semibold text-brand-950">Alerts</p>
            {unread > 0 && <button type="button" onClick={() => read.mutate(undefined)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}
          </div>
          <ul className="max-h-96 divide-y divide-slate-50 overflow-y-auto">
            {!q.data?.items.length ? <li className="px-4 py-8 text-center text-sm text-slate-500">No alerts yet.</li> : q.data.items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => openAlert(a)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-brand-50/60', !a.read_at && 'bg-brand-50/40')}>
                  <span className="mt-0.5">{SEVERITY_ICON[a.severity]}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', a.read_at ? 'text-slate-700' : 'font-semibold text-brand-950')}>{a.title}</span>
                    {a.body && <span className="line-clamp-2 block text-xs text-slate-500">{a.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{ago(a.created_at)}</span>
                  </span>
                  {!a.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
          <Link to="/alerts" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-xs font-medium text-brand-700 hover:bg-brand-50">All alerts & notification settings</Link>
        </div>
      )}
    </div>
  )
}

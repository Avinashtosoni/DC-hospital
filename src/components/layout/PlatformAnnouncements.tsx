import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Info, Megaphone, X } from 'lucide-react'
import { platformName, supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'

interface PlatformAnnouncement { id: string; title: string; body: string; level: 'info' | 'warning' | 'critical'; starts_at: string }

const KEY = 'dch:announcements:dismissed'
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[] } catch { return [] } }

const STYLE = {
  info: { box: 'border-brand-200 bg-brand-50 text-brand-950', icon: Info },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-950', icon: AlertTriangle },
  critical: { box: 'border-rose-200 bg-rose-50 text-rose-950', icon: AlertTriangle },
} as const

/** Messages from the Hospital Comrade team (control panel → Announcements). Critical ones can't be dismissed. */
export function PlatformAnnouncements() {
  const [dismissed, setDismissed] = useState(readDismissed)
  const q = useQuery({
    queryKey: ['my_announcements'],
    enabled: !!supabase,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc('my_announcements')
      if (error) return [] as PlatformAnnouncement[]     // older database without the function: show nothing
      return (data ?? []) as PlatformAnnouncement[]
    },
  })
  const list = (q.data ?? []).filter((a) => a.level === 'critical' || !dismissed.includes(a.id))
  if (!list.length) return null
  const dismiss = (id: string) => {
    const next = [...dismissed.filter((d) => (q.data ?? []).some((a) => a.id === d)), id]
    setDismissed(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }
  return (
    <div className="mb-5 space-y-2">
      {list.map((a) => {
        const S = STYLE[a.level] ?? STYLE.info
        return (
          <div key={a.id} role={a.level === 'critical' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', S.box)}>
            <S.icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{a.title}</p>
              {a.body && <p className="mt-0.5 whitespace-pre-line opacity-90">{a.body}</p>}
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] opacity-70"><Megaphone className="h-3 w-3" />{platformName}</p>
            </div>
            {a.level !== 'critical' && (
              <button type="button" onClick={() => dismiss(a.id)} className="rounded-md p-1 opacity-60 hover:bg-black/5 hover:opacity-100" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

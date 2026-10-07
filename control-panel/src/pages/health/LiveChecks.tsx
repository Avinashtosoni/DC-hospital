/**
 * Live checks (cp_health_live): every 5 minutes the ops Edge Function checks the site, Supabase Auth / Storage, each
 * Edge Function, the shared provider accounts and the database's own numbers. Uptime, a 24-hour / 7-day strip, latency and an
 * uptime + response-time graph per service, failure history and "Check now".
 */
import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ChevronDown, LineChart, PlayCircle, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Skeleton, type Tone } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp, friendly } from '../../api'
import type { HealthStatus, LiveService } from '../../types'
import { dateTime, Section } from '../../ui'
import { ago } from '../../AlertBell'
import { slug } from './visuals'

const ServiceChart = lazy(() => import('./ServiceChart'))

const TONE: Record<HealthStatus, Tone> = { ok: 'green', warn: 'amber', fail: 'red', off: 'slate' }
const LABEL: Record<HealthStatus, string> = { ok: 'OK', warn: 'Attention', fail: 'Down', off: 'Not set up' }
const DOT: Record<HealthStatus, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', fail: 'bg-rose-500', off: 'bg-slate-300' }

/** overall state: any fail → fail, any warn → warn, else ok (services not set up don't count) */
export function overall(services: Pick<LiveService, 'status'>[]): HealthStatus {
  if (services.some((s) => s.status === 'fail')) return 'fail'
  if (services.some((s) => s.status === 'warn')) return 'warn'
  return services.some((s) => s.status === 'ok') ? 'ok' : 'off'
}

/** 24 hourly cells, oldest first; an hour with no checks stays empty */
export function hourCells(hours: LiveService['hours'], now = Date.now()) {
  const by = new Map(hours.map((h) => [new Date(h.h).getTime(), h]))
  const top = Math.floor(now / 3_600_000) * 3_600_000
  return Array.from({ length: 24 }, (_, i) => {
    const t = top - (23 - i) * 3_600_000
    const h = by.get(t)
    return { t, pct: h && h.n ? Math.round((100 * h.ok) / h.n) : null, ms: h?.ms ?? null }
  })
}

/** 7 daily cells (India dates), oldest first */
export function dayCells(days: LiveService['days'], now = Date.now()) {
  const by = new Map((days ?? []).map((d) => [String(d.d).slice(0, 10), d]))
  return Array.from({ length: 7 }, (_, i) => {
    const key = new Date(now + 330 * 60_000 - (6 - i) * 86_400_000).toISOString().slice(0, 10)
    const d = by.get(key)
    return { t: key, pct: d && d.n ? Math.round((100 * d.ok) / d.n) : null, ms: d?.ms ?? null }
  })
}

/** x-axis label for a cell: hour (24 h) or weekday + date (7 days) */
export const cellLabel = (t: number | string) => typeof t === 'number'
  ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  : new Date(t + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

type Filter = 'all' | 'problems' | 'ok' | 'off'
const FILTERS: { id: Filter; label: string; dot?: string }[] = [
  { id: 'all', label: 'All' }, { id: 'problems', label: 'Problems', dot: 'bg-rose-500' }, { id: 'ok', label: 'Healthy', dot: 'bg-emerald-500' }, { id: 'off', label: 'Not set up', dot: 'bg-slate-300' },
]
/** status chip + free-text filter (label, detail, group, service id) */
export function filterServices<T extends Pick<LiveService, 'status' | 'label' | 'service'> & { detail?: string | null; group?: string | null }>(list: T[], f: Filter, term: string): T[] {
  const t = term.trim().toLowerCase()
  return list.filter((s) => (f === 'all' || (f === 'problems' ? s.status === 'fail' || s.status === 'warn' : s.status === f))
    && (!t || [s.label, s.detail, s.group, s.service].some((v) => v?.toLowerCase().includes(t))))
}

function Spark({ values }: { values: (number | null)[] }) {
  const last = Math.max(values.length - 1, 1)
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (pts.length < 2) return <span className="text-[11px] text-slate-400">—</span>
  const max = Math.max(...pts.map((p) => p[1]), 1)
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${(i / last) * 96 + 2},${22 - (v / max) * 18}`).join(' ')
  return <svg viewBox="0 0 100 24" className="h-6 w-24" aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-500" /></svg>
}

export function LiveChecks() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-health-live'], queryFn: () => cp.liveHealth(), refetchInterval: 60_000, retry: false })
  const [showFailures, setShowFailures] = useState(false)
  const [range, setRange] = useState<'24h' | '7d'>('24h')
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [term, setTerm] = useState('')
  const run = useMutation({
    mutationFn: () => cp.checkNow(),
    onSuccess: () => { toast.success('Checks finished'); qc.invalidateQueries({ queryKey: ['cp-health-live'] }) },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return (
    <Section title="Live checks" subtitle="Run the upgrade SQL (supabase/upgrade-2026-10.sql) to turn these on.">
      <p className="text-sm text-slate-500">{friendly(q.error)}</p>
    </Section>
  )
  const h = q.data
  const services = h?.services ?? []
  const state = overall(services)
  const counts: Record<Filter, number> = { all: services.length, problems: services.filter((s) => s.status === 'fail' || s.status === 'warn').length, ok: services.filter((s) => s.status === 'ok').length, off: services.filter((s) => s.status === 'off').length }
  const shown = filterServices(services, filter, term)
  const groups = [...new Set(shown.map((s) => s.group ?? 'Other'))]
  const stale = h?.last_run && Date.now() - Date.parse(h.last_run) > 15 * 60_000
  return (
    <Section
      title={<span className="flex items-center gap-2"><Activity className="h-4 w-4" />Live checks {h && services.length > 0 && <Badge tone={TONE[state]} dot>{state === 'ok' ? 'All systems normal' : state === 'warn' ? 'Needs attention' : state === 'fail' ? 'Something is down' : 'Not set up'}</Badge>}</span>}
      subtitle={!h ? 'Loading…' : h.last_run ? <>Last run {ago(h.last_run)}{stale ? <span className="text-amber-700"> — automatic checks look stopped (scheduler / ops function)</span> : ' · every 5 minutes'}{!h.settings.enabled && ' · automatic checks are off'}</> : 'Never run yet — deploy the ops function (supabase functions deploy ops) and press Check now.'}
      action={<div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs" role="group" aria-label="History range">
          {(['24h', '7d'] as const).map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}
            className={cn('rounded-md px-2.5 py-1 font-medium', range === r ? 'bg-brand-900 text-white' : 'text-slate-600 hover:bg-brand-50')}>{r === '24h' ? '24 hours' : '7 days'}</button>)}
        </div>
        <Button size="sm" variant="outline" loading={run.isPending} icon={<PlayCircle className="h-4 w-4" />} onClick={() => run.mutate()}>Check now</Button>
      </div>}>
      {!h ? <Skeleton className="h-40" /> : !services.length ? <p className="text-sm text-slate-500">No results yet.</p> : (
        <div className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Show">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                  className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 transition',
                    filter === f.id ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-brand-50')}>
                  {f.dot && <span className={cn('h-2 w-2 rounded-full', f.dot)} />}{f.label}
                  <span className={cn('rounded-full px-1.5 text-[10px]', filter === f.id ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <label className="relative block sm:w-64">
              <span className="sr-only">Search checks</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search checks…"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
              {term && <button type="button" aria-label="Clear search" onClick={() => setTerm('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>}
            </label>
          </div>
          {!shown.length && <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">{filter === 'problems' && !term ? 'No problems right now 🎉' : 'Nothing matches.'}</p>}
          <div className="grid gap-5 min-[1800px]:grid-cols-2 min-[1800px]:items-start">
          {groups.map((g) => (
            <div key={g} id={`grp-${slug(g)}`} className="min-w-0 scroll-mt-28">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {shown.filter((s) => (s.group ?? 'Other') === g).map((s) => {
                  const cells = range === '24h' ? hourCells(s.hours) : dayCells(s.days)
                  return (
                    <li key={s.service} className="px-3 py-2.5 text-sm">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto_auto]">
                      <div className="col-span-2 flex min-w-0 items-start gap-2.5 md:col-span-1">
                        <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', DOT[s.status])} />
                        <div className="min-w-0">
                          <p className="font-medium text-brand-950">{s.label} <Badge tone={TONE[s.status]} className="ml-1">{LABEL[s.status]}</Badge></p>
                          {s.detail && <p className={cn('truncate text-xs', s.status === 'fail' ? 'text-rose-600' : 'text-slate-500')} title={s.detail}>{s.detail}</p>}
                          {s.status !== 'ok' && s.status !== 'off' && <p className="text-[11px] text-slate-400">since {dateTime(s.since)}</p>}
                        </div>
                      </div>
                      <div className="order-2 flex flex-wrap gap-x-3 gap-y-1 pl-5 text-xs text-slate-500 md:order-none md:justify-end md:pl-0">
                        <span title="Uptime, 24 hours"><b className="text-brand-950">{s.uptime24 ?? '—'}{s.uptime24 != null && '%'}</b> 24h</span>
                        <span title="Uptime, 7 days"><b className="text-brand-950">{s.uptime7d ?? '—'}{s.uptime7d != null && '%'}</b> 7d</span>
                        {s.latency_ms != null && <span className="md:hidden" title="Latest response time"><b className="text-brand-950">{s.latency_ms}</b> ms</span>}
                      </div>
                      <div className={cn('order-4 col-span-2 ml-5 flex h-5 items-end md:order-none md:col-span-1 md:ml-0', range === '24h' ? 'gap-px' : 'gap-1')} aria-label={range === '24h' ? 'Last 24 hours' : 'Last 7 days'}>
                        {cells.map((c) => (
                          <span key={c.t} title={`${cellLabel(c.t)} · ${c.pct == null ? 'no checks' : `${c.pct}% up`}${c.ms != null ? ` · ${c.ms} ms` : ''}`}
                            className={cn('h-full flex-1 rounded-sm', c.pct == null ? 'bg-slate-100' : c.pct === 100 ? 'bg-emerald-400' : c.pct >= 80 ? 'bg-amber-400' : 'bg-rose-500')} />
                        ))}
                      </div>
                      <div className="hidden items-center gap-2 text-xs text-slate-500 md:flex md:justify-end">
                        <Spark values={cells.map((c) => c.ms)} />
                        <span className="w-14 text-right" title="Latest response time">{s.latency_ms != null ? `${s.latency_ms} ms` : ''}</span>
                      </div>
                      <Button size="sm" variant="ghost" aria-expanded={open === s.service} aria-label={`${s.label} history graph`} icon={<LineChart className="h-4 w-4" />}
                        className="order-3 justify-self-end md:order-none" onClick={() => setOpen(open === s.service ? null : s.service)}>
                        <span className="sr-only">Graph</span>
                      </Button>
                    </div>
                    {open === s.service && (
                      <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                        <p className="mb-1 text-xs text-slate-500">{s.label} · {range === '24h' ? 'last 24 hours, per hour' : 'last 7 days, per day'}{cells.every((c) => c.pct == null) && ' · no checks yet'}</p>
                        <Suspense fallback={<Skeleton className="h-56" />}>
                          <ServiceChart latency={cells.some((c) => c.ms != null)} cells={cells.map((c) => ({ label: cellLabel(c.t), pct: c.pct, ms: c.ms }))} />
                        </Suspense>
                      </div>
                    )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          </div>
          <div>
            <button type="button" onClick={() => setShowFailures((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <ChevronDown className={cn('h-3.5 w-3.5 transition', showFailures && 'rotate-180')} />Failure history ({h.failures.length})
            </button>
            {showFailures && (
              !h.failures.length ? <p className="mt-2 text-sm text-slate-500">No failures in the last 30 days.</p> : (
                <ul className="mt-2 divide-y divide-slate-100 text-sm">
                  {h.failures.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 py-2">
                      <Badge tone={TONE[f.status]}>{LABEL[f.status]}</Badge>
                      <div className="min-w-0"><p className="font-medium text-brand-950">{f.label}</p>{f.detail && <p className="break-words text-xs text-slate-500">{f.detail}</p>}</div>
                      <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{dateTime(f.at)}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>
      )}
    </Section>
  )
}

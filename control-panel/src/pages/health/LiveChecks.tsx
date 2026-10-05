/**
 * Live checks (cp_health_live): every 5 minutes the ops Edge Function checks the site, Supabase Auth / Storage, each
 * Edge Function, the shared provider accounts and the database's own numbers. Uptime, a 24-hour strip and latency
 * per service, failure history and "Check now".
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ChevronDown, PlayCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Skeleton, type Tone } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp, friendly } from '../../api'
import type { HealthStatus, LiveService } from '../../types'
import { dateTime, Section } from '../../ui'
import { ago } from '../../AlertBell'

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

function Spark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (pts.length < 2) return <span className="text-[11px] text-slate-400">—</span>
  const max = Math.max(...pts.map((p) => p[1]), 1)
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${(i / 23) * 96 + 2},${22 - (v / max) * 18}`).join(' ')
  return <svg viewBox="0 0 100 24" className="h-6 w-24" aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-500" /></svg>
}

export function LiveChecks() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-health-live'], queryFn: () => cp.liveHealth(), refetchInterval: 60_000, retry: false })
  const [showFailures, setShowFailures] = useState(false)
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
  const groups = [...new Set(services.map((s) => s.group ?? 'Other'))]
  const stale = h?.last_run && Date.now() - Date.parse(h.last_run) > 15 * 60_000
  return (
    <Section
      title={<span className="flex items-center gap-2"><Activity className="h-4 w-4" />Live checks {h && services.length > 0 && <Badge tone={TONE[state]} dot>{state === 'ok' ? 'All systems normal' : state === 'warn' ? 'Needs attention' : state === 'fail' ? 'Something is down' : 'Not set up'}</Badge>}</span>}
      subtitle={!h ? 'Loading…' : h.last_run ? <>Last run {ago(h.last_run)}{stale ? <span className="text-amber-700"> — automatic checks look stopped (scheduler / ops function)</span> : ' · every 5 minutes'}{!h.settings.enabled && ' · automatic checks are off'}</> : 'Never run yet — deploy the ops function (supabase functions deploy ops) and press Check now.'}
      action={<Button size="sm" variant="outline" loading={run.isPending} icon={<PlayCircle className="h-4 w-4" />} onClick={() => run.mutate()}>Check now</Button>}>
      {!h ? <Skeleton className="h-40" /> : !services.length ? <p className="text-sm text-slate-500">No results yet.</p> : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {services.filter((s) => (s.group ?? 'Other') === g).map((s) => {
                  const cells = hourCells(s.hours)
                  return (
                    <li key={s.service} className="grid gap-2 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto] md:items-center">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', DOT[s.status])} />
                        <div className="min-w-0">
                          <p className="font-medium text-brand-950">{s.label} <Badge tone={TONE[s.status]} className="ml-1">{LABEL[s.status]}</Badge></p>
                          {s.detail && <p className={cn('truncate text-xs', s.status === 'fail' ? 'text-rose-600' : 'text-slate-500')} title={s.detail}>{s.detail}</p>}
                          {s.status !== 'ok' && s.status !== 'off' && <p className="text-[11px] text-slate-400">since {dateTime(s.since)}</p>}
                        </div>
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500 md:justify-end">
                        <span title="Uptime, 24 hours"><b className="text-brand-950">{s.uptime24 ?? '—'}{s.uptime24 != null && '%'}</b> 24h</span>
                        <span title="Uptime, 7 days"><b className="text-brand-950">{s.uptime7d ?? '—'}{s.uptime7d != null && '%'}</b> 7d</span>
                      </div>
                      <div className="flex h-5 items-end gap-px" aria-label="Last 24 hours">
                        {cells.map((c) => (
                          <span key={c.t} title={`${new Date(c.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${c.pct == null ? 'no checks' : `${c.pct}% up`}${c.ms != null ? ` · ${c.ms} ms` : ''}`}
                            className={cn('h-full flex-1 rounded-sm', c.pct == null ? 'bg-slate-100' : c.pct === 100 ? 'bg-emerald-400' : c.pct >= 80 ? 'bg-amber-400' : 'bg-rose-500')} />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 md:justify-end">
                        <Spark values={cells.map((c) => c.ms)} />
                        <span className="w-14 text-right">{s.latency_ms != null ? `${s.latency_ms} ms` : ''}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
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

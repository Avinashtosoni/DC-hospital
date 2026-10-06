/**
 * Top of the Health page: one look at everything — a health score ring, services by status (donut), uptime gauges,
 * response time, resource meters (database connections / size, storage, server CPU / RAM / disk), each group's status
 * and the uptime + response-time trend across all services. Uses the same live-check data as LiveChecks (shared cache).
 */
import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Gauge, Timer, Zap } from 'lucide-react'
import { Card, Skeleton } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp } from '../../api'
import type { HealthStatus, LiveService } from '../../types'
import { ago } from '../../AlertBell'
import { cellLabel, dayCells, hourCells, overall } from './LiveChecks'
import { COLOR, Donut, goodColor, Legend, Meter, pctFrom, Ring, slug, StackBar, type Slice } from './visuals'

const Charts = lazy(() => import('./HealthCharts').then((m) => ({ default: m.UptimeTrend })))
const LatencyBars = lazy(() => import('./HealthCharts').then((m) => ({ default: m.LatencyBars })))

const STATUS_LABEL: Record<HealthStatus, string> = { ok: 'Healthy', warn: 'Attention', fail: 'Down', off: 'Not set up' }
const HEADLINE: Record<HealthStatus, string> = { ok: 'All systems normal', warn: 'Needs attention', fail: 'Something is down', off: 'Not set up yet' }
const HERO: Record<HealthStatus, string> = {
  ok: 'from-emerald-50 via-white to-white ring-emerald-100', warn: 'from-amber-50 via-white to-white ring-amber-100',
  fail: 'from-rose-50 via-white to-white ring-rose-100', off: 'from-slate-50 via-white to-white ring-slate-100',
}
/** resource checks that report a percentage in their detail text */
const RESOURCES: { match: RegExp; label: string; warn: number; fail: number }[] = [
  { match: /^server:cpu$/, label: 'Server CPU', warn: 85, fail: 97 },
  { match: /^server:ram$/, label: 'Server memory', warn: 90, fail: 98 },
  { match: /^server:disk$/, label: 'Server disk', warn: 85, fail: 95 },
  { match: /^db:connections$/, label: 'DB connections', warn: 70, fail: 90 },
  { match: /^db:size$/, label: 'Database size', warn: 75, fail: 90 },
  { match: /^storage:usage$/, label: 'File storage', warn: 75, fail: 90 },
]

const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const fmtMs = (ms: number | null) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

export function HealthOverview() {
  const q = useQuery({ queryKey: ['cp-health-live'], queryFn: () => cp.liveHealth(), refetchInterval: 60_000, retry: false })
  const [range, setRange] = useState<'24h' | '7d'>('24h')
  const services = useMemo(() => q.data?.services ?? [], [q.data])
  const live = services.filter((s) => s.status !== 'off')
  const state = overall(services)

  const counts = useMemo(() => {
    const c: Record<HealthStatus, number> = { ok: 0, warn: 0, fail: 0, off: 0 }
    for (const s of services) c[s.status]++
    return c
  }, [services])
  const slices: Slice[] = [
    { key: 'ok', label: 'Healthy', value: counts.ok, color: COLOR.ok },
    { key: 'warn', label: 'Attention', value: counts.warn, color: COLOR.warn },
    { key: 'fail', label: 'Down', value: counts.fail, color: COLOR.fail },
    { key: 'off', label: 'Not set up', value: counts.off, color: COLOR.off },
  ]
  // score: healthy = 1, attention = ½, down = 0 — over the services that are set up
  const score = live.length ? Math.round((100 * (counts.ok + counts.warn / 2)) / live.length) : null
  const up24 = avg(live.map((s) => s.uptime24))
  const up7 = avg(live.map((s) => s.uptime7d))
  const withMs = live.filter((s) => s.latency_ms != null) as (LiveService & { latency_ms: number })[]
  const avgMs = avg(withMs.map((s) => s.latency_ms))
  const slowest = [...withMs].sort((a, b) => b.latency_ms - a.latency_ms)[0]

  const resources = RESOURCES.map((r) => {
    const s = services.find((x) => r.match.test(x.service))
    return s ? { ...r, s, pct: pctFrom(s.detail) } : null
  }).filter((x): x is NonNullable<typeof x> => !!x && (x.pct != null || x.s.status !== 'off'))

  const groups = [...new Set(services.map((s) => s.group ?? 'Other'))].map((g) => {
    const list = services.filter((s) => (s.group ?? 'Other') === g)
    return { g, list, state: overall(list) }
  })

  // average of every service, per hour (24 h) or per day (7 days)
  const trend = useMemo(() => {
    const per = live.map((s) => (range === '24h' ? hourCells(s.hours) : dayCells(s.days)))
    if (!per.length) return []
    return per[0].map((c, i) => {
      const pct = avg(per.map((p) => p[i].pct)), ms = avg(per.map((p) => p[i].ms))
      return { label: cellLabel(c.t), pct: pct == null ? null : Math.round(pct * 10) / 10, ms: ms == null ? null : Math.round(ms) }
    })
  }, [live, range])

  if (q.error) return null   // LiveChecks below explains what to do
  if (!q.data) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-52 rounded-2xl lg:col-span-2" /><Skeleton className="h-52 rounded-2xl" /></div>

  return (
    <div className="space-y-4">
      {/* hero */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className={cn('overflow-hidden bg-gradient-to-br ring-1', HERO[state])}>
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <Ring className="self-center sm:self-auto" value={score} size={148} stroke={14} color={score == null ? COLOR.off : score >= 95 ? COLOR.ok : score >= 75 ? COLOR.warn : COLOR.fail} label={`Health score ${score ?? 'unknown'}`}>
              <div>
                <p className="font-display text-4xl font-bold leading-none text-brand-950 tabular-nums">{score ?? '—'}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">health score</p>
              </div>
            </Ring>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span className="relative flex h-2.5 w-2.5">
                  {state !== 'off' && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', { ok: 'bg-emerald-400', warn: 'bg-amber-400', fail: 'bg-rose-400', off: '' }[state])} />}
                  <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', { ok: 'bg-emerald-500', warn: 'bg-amber-500', fail: 'bg-rose-500', off: 'bg-slate-300' }[state])} />
                </span>
                Live status
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold text-brand-950">{HEADLINE[state]}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {counts.ok} of {live.length} services healthy{counts.warn > 0 && <> · <b className="text-amber-700">{counts.warn} need attention</b></>}{counts.fail > 0 && <> · <b className="text-rose-700">{counts.fail} down</b></>}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{q.data.last_run ? `Last checked ${ago(q.data.last_run)}` : 'Not checked yet'} · {services.length} checks</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Kpi icon={<Activity className="h-3.5 w-3.5" />} label="Uptime 24 h" value={up24 == null ? '—' : `${up24.toFixed(up24 === 100 ? 0 : 2)}%`} tone={up24 == null ? undefined : goodColor(up24)} />
                <Kpi icon={<Gauge className="h-3.5 w-3.5" />} label="Uptime 7 d" value={up7 == null ? '—' : `${up7.toFixed(up7 === 100 ? 0 : 2)}%`} tone={up7 == null ? undefined : goodColor(up7)} />
                <Kpi icon={<Zap className="h-3.5 w-3.5" />} label="Avg response" value={fmtMs(avgMs)} tone={avgMs == null ? undefined : avgMs >= 3000 ? COLOR.fail : avgMs >= 1500 ? COLOR.warn : COLOR.ok} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-brand-950">Services by status</p>
          <p className="text-xs text-slate-500">{services.length} live checks</p>
          <div className="mt-3 flex items-center gap-5">
            <Donut slices={slices} size={132} stroke={18}>
              <div><p className="font-display text-2xl font-bold text-brand-950 tabular-nums">{services.length}</p><p className="text-[10px] uppercase tracking-wider text-slate-400">checks</p></div>
            </Donut>
            <Legend slices={slices} className="min-w-0 flex-1" />
          </div>
          {slowest && (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <Timer className="h-3.5 w-3.5 text-brand-700" /> Slowest: <b className="text-brand-950">{slowest.label}</b> · {fmtMs(slowest.latency_ms)}
            </p>
          )}
        </Card>
      </div>

      {/* groups */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(165px,1fr))] gap-3">
        {groups.map(({ g, list, state: st }) => {
          const ok = list.filter((s) => s.status === 'ok').length, set = list.filter((s) => s.status !== 'off').length
          return (
            <a key={g} href={`#grp-${slug(g)}`} className="group rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', { ok: 'bg-emerald-500', warn: 'bg-amber-500', fail: 'bg-rose-500', off: 'bg-slate-300' }[st])} title={STATUS_LABEL[st]} />
              </div>
              <p className="mt-1 font-display text-lg font-bold text-brand-950 tabular-nums">{set ? `${ok}/${set}` : '—'} <span className="text-xs font-medium text-slate-400">{set ? 'healthy' : 'not set up'}</span></p>
              <StackBar className="mt-2" height="h-1.5" slices={(['ok', 'warn', 'fail', 'off'] as HealthStatus[]).map((k) => ({ key: k, label: STATUS_LABEL[k], value: list.filter((s) => s.status === k).length, color: COLOR[k] }))} />
            </a>
          )
        })}
      </div>

      {/* resources + trend */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card className="p-5">
          <p className="text-sm font-semibold text-brand-950">Resources</p>
          <p className="text-xs text-slate-500">Database, storage{resources.some((r) => r.s.service.startsWith('server:')) ? ' and the server' : ' — server CPU / RAM / disk appear once the monitor agent reports'}</p>
          {resources.length === 0 ? <p className="mt-4 text-sm text-slate-500">No resource numbers yet.</p> : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {resources.map((r) => <Meter key={r.label} label={r.label} pct={r.pct} detail={r.s.detail} warn={r.warn} fail={r.fail} />)}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-sm font-semibold text-brand-950">Uptime & response time</p><p className="text-xs text-slate-500">Average of every service that is set up</p></div>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs" role="group" aria-label="Trend range">
              {(['24h', '7d'] as const).map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}
                className={cn('rounded-md px-2.5 py-1 font-medium', range === r ? 'bg-brand-900 text-white' : 'text-slate-600 hover:bg-brand-50')}>{r === '24h' ? '24 hours' : '7 days'}</button>)}
            </div>
          </div>
          <div className="mt-2">
            {trend.every((t) => t.pct == null) ? <p className="py-16 text-center text-sm text-slate-400">No checks in this period yet.</p>
              : <Suspense fallback={<Skeleton className="h-56" />}><Charts data={trend} /></Suspense>}
          </div>
        </Card>
      </div>

      {withMs.length > 1 && (
        <Card className="p-5">
          <p className="text-sm font-semibold text-brand-950">Response time by service</p>
          <p className="text-xs text-slate-500">Latest check · amber over 1.5 s, red over 3 s</p>
          <div className="mt-2">
            <Suspense fallback={<Skeleton className="h-48" />}>
              <LatencyBars data={[...withMs].sort((a, b) => b.latency_ms - a.latency_ms).map((s) => ({ label: s.label, ms: s.latency_ms }))} />
            </Suspense>
          </div>
        </Card>
      )}
    </div>
  )
}

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/80 p-2.5 ring-1 ring-slate-100">
      <p className="flex items-center gap-1 text-[11px] text-slate-500">{icon}{label}</p>
      <p className="mt-0.5 font-display text-base font-bold tabular-nums" style={{ color: tone ?? '#121233' }}>{value}</p>
    </div>
  )
}

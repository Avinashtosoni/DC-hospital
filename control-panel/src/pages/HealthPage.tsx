/**
 * System health (admin, support: assigned hospitals): scheduler jobs, message delivery in the last 24 hours, recent
 * failures, payments, database size, hospitals closing, privacy requests, incidents and the last retention run.
 */
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Database, MessageSquare, RefreshCw, ShieldAlert, Timer, XCircle } from 'lucide-react'
import { Badge, Button, PageHeader, Skeleton } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp } from '../api'
import { date, dateTime, ErrorBox, relDays, Section, useMe } from '../ui'
import { LaunchChecklist } from './LaunchChecklist'
import { LiveChecks } from './health/LiveChecks'
import { HealthOverview } from './health/Overview'
import { COLOR, Donut, Legend, Ring, StackBar, type Slice } from './health/visuals'

const MessagesBars = lazy(() => import('./health/HealthCharts').then((m) => ({ default: m.MessagesBars })))
const HospitalBars = lazy(() => import('./health/HealthCharts').then((m) => ({ default: m.HospitalBars })))
const TABLE_COLORS = ['#292966', '#46467f', '#5C5C99', '#7d7db8', '#A3A3CC', '#CCCCFF', '#94a3b8', '#cbd5e1']

const mb = (b: number | null | undefined) => (b == null ? '—' : b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`)
const minsAgo = (v: string | null) => (v ? Math.round((Date.now() - Date.parse(v)) / 60_000) : null)
/** a job is late when it has not run for well over its interval */
function jobLate(schedule: string, last: string | null) {
  const m = minsAgo(last)
  if (m == null) return true
  if (schedule.startsWith('* ')) return m > 10
  if (schedule.startsWith('*/')) return m > Number(schedule.slice(2).split(' ')[0]) * 3
  return m > 26 * 60
}

function Stat({ label, value, tone = 'slate', icon, to, visual, foot }: { label: string; value: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red'; icon: React.ReactNode; to?: string; visual?: React.ReactNode; foot?: React.ReactNode }) {
  const body = (
    <div className={cn('relative h-full overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition', to && 'hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md',
      tone === 'red' ? 'border-rose-200' : tone === 'amber' ? 'border-amber-200' : 'border-slate-100')}>
      <span className={cn('absolute inset-x-0 top-0 h-1', { slate: 'bg-brand-200', green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-rose-500' }[tone])} />
      <div className="flex items-center gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', { slate: 'bg-brand-50 text-brand-800', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-rose-50 text-rose-700' }[tone])}>{icon}</span>
        <div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{label}</p><p className="font-display text-xl font-bold text-brand-950">{value}</p></div>
        {visual}
      </div>
      {foot && <div className="mt-3">{foot}</div>}
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export function HealthPage() {
  const { me } = useMe()
  const q = useQuery({ queryKey: ['cp-health'], queryFn: () => cp.health(), refetchInterval: 60_000 })
  const h = q.data
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />

  const late = h?.jobs.filter((j) => j.active && jobLate(j.schedule, j.last_run)) ?? []
  const failed24 = h?.messages.reduce((n, m) => n + m.failed, 0) ?? 0
  const stuck = h?.messages.reduce((n, m) => n + m.stuck, 0) ?? 0
  const closing = h?.hospitals.filter((x) => x.closing_at) ?? []
  const activeJobs = h?.jobs.filter((j) => j.active) ?? []
  const jobsFailed = activeJobs.filter((j) => j.last_status && j.last_status !== 'succeeded').length
  const jobsLate = late.filter((j) => !(j.last_status && j.last_status !== 'succeeded')).length
  const jobSlices: Slice[] = [
    { key: 'ok', label: 'On time', value: Math.max(activeJobs.length - jobsFailed - jobsLate, 0), color: COLOR.ok },
    { key: 'late', label: 'Late', value: jobsLate, color: COLOR.warn },
    { key: 'failed', label: 'Failed', value: jobsFailed, color: COLOR.fail },
    { key: 'paused', label: 'Paused', value: (h?.jobs.length ?? 0) - activeJobs.length, color: COLOR.off },
  ]
  const failBy = new Map<string, number>()
  for (const f of h?.recent_failures ?? []) failBy.set(f.channel, (failBy.get(f.channel) ?? 0) + 1)
  const failSlices: Slice[] = [...failBy].sort((a, b) => b[1] - a[1]).map(([c, n], i) => ({ key: c, label: c, value: n, color: ['#f43f5e', '#fb7185', '#f59e0b', '#a3a3cc', '#5c5c99'][i % 5] }))
  const sent24 = h?.messages.reduce((n, m) => n + m.sent, 0) ?? 0
  const waiting24 = h?.messages.reduce((n, m) => n + m.waiting, 0) ?? 0
  const msgSlices: Slice[] = [
    { key: 'sent', label: 'Sent', value: sent24, color: COLOR.ok },
    { key: 'waiting', label: 'Waiting', value: waiting24, color: COLOR.soft },
    { key: 'failed', label: 'Failed', value: failed24, color: COLOR.fail },
  ]
  const deliveryPct = sent24 + failed24 > 0 ? Math.round((1000 * sent24) / (sent24 + failed24)) / 10 : null
  const paySlices: Slice[] = h ? [
    { key: 'paid', label: 'Paid', value: h.payments.paid_7d, color: COLOR.ok },
    { key: 'abandoned', label: 'Abandoned', value: h.payments.abandoned_7d, color: COLOR.warn },
    { key: 'failed', label: 'Failed', value: h.payments.failed_7d, color: COLOR.fail },
  ] : []
  const payTotal = paySlices.reduce((n, x) => n + x.value, 0)
  const tables = h?.database.largest_tables ?? []
  const tableSlices: Slice[] = tables.slice(0, 7).map((t, i) => ({ key: t.table, label: t.table, value: t.bytes, color: TABLE_COLORS[i] }))
  const restBytes = (h?.database.size_bytes ?? 0) - tables.slice(0, 7).reduce((n, t) => n + t.bytes, 0)
  if (restBytes > 0) tableSlices.push({ key: 'other', label: 'everything else', value: restBytes, color: TABLE_COLORS[7] })

  return (
    <>
      <PageHeader title="System health" description="Is everything running? Refreshes every minute."
        actions={<Button variant="outline" icon={<RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>Refresh</Button>} />
      {!h ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div> : (
        <div className="space-y-6">
          <HealthOverview />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Scheduler" icon={<Timer className="h-5 w-5" />} tone={!h.extensions.pg_cron || late.length ? 'red' : 'green'}
              value={!h.extensions.pg_cron ? 'Not installed' : late.length ? `${late.length} job${late.length === 1 ? '' : 's'} late` : 'All on time'}
              visual={h.jobs.length > 0 && <Donut slices={jobSlices} size={52} stroke={7}><span className="text-[11px] font-bold text-brand-950">{activeJobs.length}</span></Donut>}
              foot={h.jobs.length > 0 && <StackBar slices={jobSlices} height="h-1.5" />} />
            <Stat label="Messages failed · 24 h" icon={<MessageSquare className="h-5 w-5" />} tone={stuck ? 'red' : failed24 ? 'amber' : 'green'}
              value={<>{failed24}{stuck > 0 && <span className="ml-2 text-sm font-medium text-rose-700">{stuck} stuck</span>}</>}
              visual={<Ring value={deliveryPct} size={52} stroke={6} color={deliveryPct == null ? COLOR.off : deliveryPct >= 98 ? COLOR.ok : deliveryPct >= 90 ? COLOR.warn : COLOR.fail} label="Delivery rate"><span className="text-[10px] font-bold text-brand-950">{deliveryPct == null ? '—' : `${Math.round(deliveryPct)}%`}</span></Ring>}
              foot={<p className="text-[11px] text-slate-400">{deliveryPct == null ? 'Nothing sent in 24 hours' : `${deliveryPct}% delivered · ${sent24.toLocaleString('en-IN')} sent`}</p>} />
            <Stat label="Open incidents" icon={<ShieldAlert className="h-5 w-5" />} tone={h.incidents_open ? 'red' : 'green'} value={h.incidents_open} to="/incidents"
              foot={<p className="text-[11px] text-slate-400">{h.incidents_open ? 'Report personal-data breaches within 72 hours' : 'No open incidents'}</p>} />
            <Stat label="Privacy requests open" icon={<Clock className="h-5 w-5" />} tone={h.privacy_overdue ? 'red' : h.privacy_open ? 'amber' : 'green'}
              value={<>{h.privacy_open}{h.privacy_overdue > 0 && <span className="ml-2 text-sm font-medium text-rose-700">{h.privacy_overdue} over 30 days</span>}</>}
              foot={<StackBar height="h-1.5" slices={[{ key: 'ok', label: 'Within 30 days', value: h.privacy_open - h.privacy_overdue, color: COLOR.warn }, { key: 'late', label: 'Over 30 days', value: h.privacy_overdue, color: COLOR.fail }]} />} />
          </div>
          <LiveChecks />

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Scheduled jobs" subtitle={h.extensions.pg_net ? 'pg_cron + pg_net' : 'pg_net is missing — messages cannot be sent from the database'}>
              {!h.extensions.pg_cron ? (
                <p className="text-sm text-slate-600">pg_cron is not enabled, so reminders, message delivery and clean-up do not run. Enable it under Database → Extensions, then switch automatic delivery off and on in a hospital’s Settings → Notifications.</p>
              ) : h.jobs.length === 0 ? <p className="text-sm text-slate-500">No jobs scheduled yet — switch on automatic delivery in Settings → Notifications.</p> : (
                <>
                <div className="mb-3 flex items-center gap-4 rounded-xl bg-slate-50/70 p-3">
                  <Donut slices={jobSlices} size={84} stroke={11}><div><p className="font-display text-lg font-bold text-brand-950">{h.jobs.length}</p><p className="text-[9px] uppercase tracking-wider text-slate-400">jobs</p></div></Donut>
                  <Legend slices={jobSlices} className="min-w-0 flex-1" />
                </div>
                <ul className="divide-y divide-slate-100 text-sm">
                  {h.jobs.map((j) => {
                    const isLate = j.active && jobLate(j.schedule, j.last_run), bad = j.last_status && j.last_status !== 'succeeded'
                    return (
                      <li key={j.name} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-medium text-slate-800">{j.name}</p>
                          <p className="text-xs text-slate-500">{j.schedule} · last run {j.last_run ? dateTime(j.last_run) : 'never'}</p>
                          {bad && j.last_message && <p className="mt-0.5 text-xs text-rose-700">{j.last_message}</p>}
                        </div>
                        {!j.active ? <Badge tone="slate">Paused</Badge> : bad ? <Badge tone="red" dot>Failed</Badge> : isLate ? <Badge tone="amber" dot>Late</Badge> : <Badge tone="green" dot>OK</Badge>}
                      </li>
                    )
                  })}
                </ul>
                </>
              )}
            </Section>

            <Section title="Messages · last 24 hours" subtitle="Per hospital, on all channels">
              {h.messages.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Donut slices={msgSlices} size={96} stroke={12}><MessageSquare className="h-5 w-5 text-slate-300" /></Donut>
                  <p className="text-sm text-slate-500">Nothing sent in the last 24 hours.</p>
                </div>
              ) : (
                <>
                <div className="mb-4 flex flex-wrap items-center gap-4">
                  <Donut slices={msgSlices} size={96} stroke={12}><div><p className="font-display text-lg font-bold text-brand-950 tabular-nums">{(sent24 + failed24 + waiting24).toLocaleString('en-IN')}</p><p className="text-[9px] uppercase tracking-wider text-slate-400">messages</p></div></Donut>
                  <Legend slices={msgSlices} className="min-w-[160px] flex-1" />
                </div>
                {h.messages.length > 1 && <Suspense fallback={<Skeleton className="h-56" />}><MessagesBars data={h.messages.slice(0, 12).map((m) => ({ name: m.name, sent: m.sent, failed: m.failed, waiting: m.waiting }))} /></Suspense>}
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1.5">Hospital</th><th className="py-1.5 text-right">Sent</th><th className="py-1.5 text-right">Failed</th><th className="py-1.5 text-right">Waiting</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {h.messages.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2"><Link to={`/hospitals/${m.id}`} className="font-medium text-brand-900 hover:underline">{m.name}</Link></td>
                        <td className="py-2 text-right tabular-nums">{m.sent}</td>
                        <td className={cn('py-2 text-right tabular-nums', m.failed && 'font-semibold text-rose-700')}>{m.failed}</td>
                        <td className={cn('py-2 text-right tabular-nums', m.stuck && 'font-semibold text-rose-700')}>{m.waiting}{m.stuck ? ` (${m.stuck} stuck)` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
            </Section>

            <Section title="Recent delivery failures" subtitle="Last 7 days">
              {h.recent_failures.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <Ring value={100} size={96} stroke={10} color={COLOR.ok} label="No failures"><CheckCircle2 className="h-8 w-8 text-emerald-500" /></Ring>
                  <div><p className="font-semibold text-emerald-700">No delivery failures</p><p className="text-xs text-slate-500">Every message in the last 7 days went through.</p></div>
                </div>
              ) : (
                <>
                <div className="mb-3 rounded-xl bg-rose-50/40 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-600">{h.recent_failures.length} failure{h.recent_failures.length === 1 ? '' : 's'} by channel</p>
                  <StackBar slices={failSlices} />
                  <Legend slices={failSlices} className="mt-2 grid grid-cols-2 gap-x-4 space-y-0" />
                </div>
                <ul className="space-y-2 text-sm">
                  {h.recent_failures.map((f, i) => (
                    <li key={i} className="rounded-xl bg-rose-50/60 px-3 py-2">
                      <p className="flex items-center gap-1.5 font-medium text-slate-800"><XCircle className="h-3.5 w-3.5 text-rose-600" />{f.hospital} · {f.channel} · {f.event.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-600">{f.error ?? 'Unknown error'} <span className="text-slate-400">· {dateTime(f.at)}</span></p>
                    </li>
                  ))}
                </ul>
                </>
              )}
            </Section>

            <Section title="Payments & database" subtitle="Online payments in the last 7 days · database storage">
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payments · 7 days</p>
                  <div className="flex items-center gap-4">
                    <Donut slices={paySlices} size={100} stroke={13}>
                      <div><p className="font-display text-lg font-bold text-brand-950">{payTotal ? `${Math.round((100 * h.payments.paid_7d) / payTotal)}%` : '—'}</p><p className="text-[9px] uppercase tracking-wider text-slate-400">success</p></div>
                    </Donut>
                    <Legend slices={paySlices} className="min-w-0 flex-1" />
                  </div>
                  {!payTotal && <p className="mt-2 text-xs text-slate-400">No online payments this week.</p>}
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Database className="h-3.5 w-3.5" />Database · {mb(h.database.size_bytes)}</p>
                  <div className="flex items-center gap-4">
                    <Donut slices={tableSlices} size={100} stroke={13} label="Database size by table">
                      <div><p className="font-display text-base font-bold text-brand-950">{mb(h.database.size_bytes)}</p><p className="text-[9px] uppercase tracking-wider text-slate-400">total</p></div>
                    </Donut>
                    <ul className="min-w-0 flex-1 space-y-1 text-[11px]">
                      {tableSlices.map((t) => (
                        <li key={t.key} className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} /><span className="min-w-0 flex-1 truncate font-mono text-slate-600">{t.label}</span><span className="tabular-nums text-slate-500">{mb(t.value)}</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              {tables.length > 0 && (
                <ul className="mt-5 space-y-1.5 text-xs">
                  {tables.map((t, i) => {
                    const max = tables[0].bytes || 1
                    return (
                      <li key={t.table} className="flex items-center gap-2">
                        <span className="w-36 truncate font-mono text-slate-600">{t.table}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(t.bytes / max) * 100}%`, background: TABLE_COLORS[Math.min(i, 7)] }} /></span>
                        <span className="w-16 text-right tabular-nums text-slate-500">{mb(t.bytes)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="mt-4 text-xs text-slate-500">Retention clean-up: {h.retention ? <>last run {dateTime(h.retention.at)}, {Object.values(h.retention.deleted).reduce((a, b) => a + b, 0)} old rows deleted</> : 'not run yet'}.</p>
            </Section>
          </div>

          <Section title="Hospitals" subtitle="Records held per hospital">
            {closing.length > 0 && (
              <div className="mb-3 space-y-1">
                {closing.map((c) => (
                  <p key={c.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <AlertTriangle className="h-4 w-4" /> <Link to={`/hospitals/${c.id}`} className="font-semibold hover:underline">{c.name}</Link> is closing — deletable {c.purge_after && Date.parse(c.purge_after) < Date.now() ? 'now' : `from ${date(c.purge_after)} (${relDays(c.purge_after)})`}.
                  </p>
                ))}
              </div>
            )}
            {h.hospitals.length > 0 && <Suspense fallback={<Skeleton className="h-60" />}><HospitalBars data={h.hospitals.slice(0, 15).map((x) => ({ name: x.name, patients: x.patients, appointments: x.appointments, invoices: x.invoices }))} /></Suspense>}
            <div className="-mx-5 mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">Hospital</th><th className="px-5 py-2 text-right">Patients</th><th className="px-5 py-2 text-right">Appointments</th><th className="px-5 py-2 text-right">Invoices</th><th className="px-5 py-2 text-right">Audit entries</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {h.hospitals.map((x) => (
                    <tr key={x.id}>
                      <td className="px-5 py-2"><Link to={`/hospitals/${x.id}`} className="font-medium text-brand-900 hover:underline">{x.name}</Link>{x.closing_at && <Badge tone="amber" className="ml-2">Closing</Badge>}</td>
                      {[x.patients, x.appointments, x.invoices, x.audit_log].map((n, i) => <td key={i} className="px-5 py-2 text-right tabular-nums text-slate-700">{n.toLocaleString('en-IN')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {me.role === 'admin' && <LaunchChecklist />}
        </div>
      )}
    </>
  )
}

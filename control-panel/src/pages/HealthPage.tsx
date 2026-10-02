/**
 * System health (admin, support: assigned hospitals): scheduler jobs, message delivery in the last 24 hours, recent
 * failures, payments, database size, hospitals closing, privacy requests, incidents and the last retention run.
 */
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Database, MessageSquare, RefreshCw, ShieldAlert, Timer, XCircle } from 'lucide-react'
import { Badge, Button, PageHeader, Skeleton } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp } from '../api'
import { date, dateTime, ErrorBox, relDays, Section, useMe } from '../ui'
import { LaunchChecklist } from './LaunchChecklist'

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

function Stat({ label, value, tone = 'slate', icon, to }: { label: string; value: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red'; icon: React.ReactNode; to?: string }) {
  const body = (
    <div className={cn('flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition', to && 'hover:border-brand-200',
      tone === 'red' ? 'border-rose-200' : tone === 'amber' ? 'border-amber-200' : 'border-slate-100')}>
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', { slate: 'bg-brand-50 text-brand-800', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-rose-50 text-rose-700' }[tone])}>{icon}</span>
      <div><p className="text-xs text-slate-500">{label}</p><p className="font-display text-xl font-bold text-brand-950">{value}</p></div>
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

  return (
    <>
      <PageHeader title="System health" description="Is everything running? Refreshes every minute."
        actions={<Button variant="outline" icon={<RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>Refresh</Button>} />
      {!h ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div> : (
        <div className="space-y-6">
          {me.role === 'admin' && <LaunchChecklist />}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Scheduler" icon={<Timer className="h-5 w-5" />} tone={!h.extensions.pg_cron || late.length ? 'red' : 'green'}
              value={!h.extensions.pg_cron ? 'Not installed' : late.length ? `${late.length} job${late.length === 1 ? '' : 's'} late` : 'All on time'} />
            <Stat label="Messages failed · 24 h" icon={<MessageSquare className="h-5 w-5" />} tone={stuck ? 'red' : failed24 ? 'amber' : 'green'}
              value={<>{failed24}{stuck > 0 && <span className="ml-2 text-sm font-medium text-rose-700">{stuck} stuck</span>}</>} />
            <Stat label="Open incidents" icon={<ShieldAlert className="h-5 w-5" />} tone={h.incidents_open ? 'red' : 'green'} value={h.incidents_open} to="/incidents" />
            <Stat label="Privacy requests open" icon={<Clock className="h-5 w-5" />} tone={h.privacy_overdue ? 'red' : h.privacy_open ? 'amber' : 'green'}
              value={<>{h.privacy_open}{h.privacy_overdue > 0 && <span className="ml-2 text-sm font-medium text-rose-700">{h.privacy_overdue} over 30 days</span>}</>} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Scheduled jobs" subtitle={h.extensions.pg_net ? 'pg_cron + pg_net' : 'pg_net is missing — messages cannot be sent from the database'}>
              {!h.extensions.pg_cron ? (
                <p className="text-sm text-slate-600">pg_cron is not enabled, so reminders, message delivery and clean-up do not run. Enable it under Database → Extensions, then switch automatic delivery off and on in a hospital’s Settings → Notifications.</p>
              ) : h.jobs.length === 0 ? <p className="text-sm text-slate-500">No jobs scheduled yet — switch on automatic delivery in Settings → Notifications.</p> : (
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
              )}
            </Section>

            <Section title="Messages · last 24 hours" subtitle="Per hospital, on all channels">
              {h.messages.length === 0 ? <p className="text-sm text-slate-500">Nothing sent in the last 24 hours.</p> : (
                <table className="w-full text-sm">
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
              )}
            </Section>

            <Section title="Recent delivery failures" subtitle="Last 7 days">
              {h.recent_failures.length === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> No failures.</p> : (
                <ul className="space-y-2 text-sm">
                  {h.recent_failures.map((f, i) => (
                    <li key={i} className="rounded-xl bg-rose-50/60 px-3 py-2">
                      <p className="flex items-center gap-1.5 font-medium text-slate-800"><XCircle className="h-3.5 w-3.5 text-rose-600" />{f.hospital} · {f.channel} · {f.event.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-600">{f.error ?? 'Unknown error'} <span className="text-slate-400">· {dateTime(f.at)}</span></p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Payments & database">
              <dl className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-xl bg-emerald-50 p-3"><dt className="text-xs text-emerald-800">Paid · 7 d</dt><dd className="font-display text-lg font-bold text-emerald-900">{h.payments.paid_7d}</dd></div>
                <div className="rounded-xl bg-amber-50 p-3"><dt className="text-xs text-amber-800">Abandoned</dt><dd className="font-display text-lg font-bold text-amber-900">{h.payments.abandoned_7d}</dd></div>
                <div className="rounded-xl bg-rose-50 p-3"><dt className="text-xs text-rose-800">Failed</dt><dd className="font-display text-lg font-bold text-rose-900">{h.payments.failed_7d}</dd></div>
              </dl>
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-700"><Database className="h-4 w-4 text-brand-700" /> Database size <b>{mb(h.database.size_bytes)}</b></p>
              {h.database.largest_tables.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {h.database.largest_tables.map((t) => {
                    const max = h.database.largest_tables[0].bytes || 1
                    return (
                      <li key={t.table} className="flex items-center gap-2">
                        <span className="w-40 truncate font-mono text-slate-600">{t.table}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(t.bytes / max) * 100}%` }} /></span>
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
            <div className="-mx-5 overflow-x-auto">
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
        </div>
      )}
    </>
  )
}

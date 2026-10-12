import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, ArrowUpRight, Bell, Building2, CheckCircle2, CreditCard, IndianRupee, Inbox, MessageSquare, RefreshCw, UserPlus, Wallet } from 'lucide-react'
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, StatCard } from '../../../src/components/ui'
import { cp } from '../api'
import { date, dateTime, ErrorBox, inr, LicenseBadge, paise, planLabel, relDays, Section, STATUS, useMe } from '../ui'
import { COLOR, Donut, Legend, type Slice } from './health/visuals'

const PlanMixChart = lazy(() => import('./overview/OverviewCharts').then((m) => ({ default: m.PlanMixChart })))
const ChannelMixChart = lazy(() => import('./overview/OverviewCharts').then((m) => ({ default: m.ChannelMixChart })))
const RevenueSnapshotChart = lazy(() => import('./overview/OverviewCharts').then((m) => ({ default: m.RevenueSnapshotChart })))

const STATUS_COLOR: Record<string, string> = {
  trial: '#0ea5e9',
  active: '#10b981',
  grace: '#f59e0b',
  read_only: '#f43f5e',
  suspended: '#64748b',
}

export function OverviewPage() {
  const { me } = useMe()
  const q = useQuery({ queryKey: ['cp-overview'], queryFn: () => cp.overview() })
  const o = q.data
  const customerCount = o ? Object.values(o.by_status).reduce((a, b) => a + b, 0) : 0
  const statusSlices: Slice[] = Object.entries(STATUS).map(([status, meta]) => ({
    key: status, label: meta.label, value: o?.by_status[status] ?? 0, color: STATUS_COLOR[status] ?? COLOR.off,
  }))
  const planMix = Object.entries(o?.by_plan ?? {}).map(([plan, hospitals]) => ({ plan: planLabel(plan), hospitals }))
  const channelMix = [
    { channel: 'WhatsApp', messages: o?.messages.whatsapp ?? 0 },
    { channel: 'SMS', messages: o?.messages.sms ?? 0 },
    { channel: 'E-mail', messages: o?.messages.email ?? 0 },
  ]
  const totalMessages = channelMix.reduce((sum, channel) => sum + channel.messages, 0)
  const revenueSnapshot = o?.payments_30d_paise == null ? [] : [
    { period: 'MRR', rupees: o.mrr },
    { period: 'Received · 30d', rupees: Math.round(o.payments_30d_paise / 100) },
  ]
  const shortcuts = [
    { to: '/hospitals', title: 'Hospitals', description: `${o?.hospitals ?? 'All'} hospitals, licences and billing`, icon: <Building2 className="h-4 w-4" />, tone: 'bg-brand-100 text-brand-800' },
    ...(me.role === 'admin' ? [{ to: '/signups', title: 'Sign-ups', description: 'Review new account requests', icon: <UserPlus className="h-4 w-4" />, tone: 'bg-violet-100 text-violet-700' }] : []),
    ...(me.role === 'support' ? [{ to: '/onboarding', title: 'Onboarding', description: 'Follow customer setup progress', icon: <Activity className="h-4 w-4" />, tone: 'bg-sky-100 text-sky-700' }] : []),
    ...((me.role === 'admin' || me.role === 'support') ? [{ to: '/health', title: 'System health', description: 'Check jobs and integrations', icon: <Activity className="h-4 w-4" />, tone: 'bg-emerald-100 text-emerald-700' }] : []),
    { to: '/alerts', title: 'Alerts', description: 'Open the team inbox and preferences', icon: <Bell className="h-4 w-4" />, tone: 'bg-amber-100 text-amber-700' },
    ...((me.role === 'admin' || me.role === 'finance') ? [{ to: '/payments', title: 'Payments', description: 'Review transactions and receipts', icon: <CreditCard className="h-4 w-4" />, tone: 'bg-teal-100 text-teal-700' }] : []),
  ]

  return (
    <>
      <PageHeader
        title={`Namaste, ${me.full_name.split(' ')[0]}`}
        description={me.role === 'admin' ? 'Every hospital on the platform at a glance.' : 'The hospitals assigned to you.'}
        actions={<>
          {q.dataUpdatedAt > 0 && <span className="hidden text-xs text-slate-400 sm:inline">Updated {dateTime(new Date(q.dataUpdatedAt).toISOString())}</span>}
          <Button size="sm" variant="outline" loading={q.isFetching} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => q.refetch()}>Refresh</Button>
        </>}
      />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hospitals" value={o?.hospitals ?? '—'} loading={q.isLoading} icon={<Building2 className="h-5 w-5" />} hint={o ? `${customerCount} customer${customerCount === 1 ? '' : 's'} + the original install` : undefined} />
        <StatCard label="Monthly revenue (MRR)" tone="green" value={o ? inr(o.mrr) : '—'} loading={q.isLoading} icon={<IndianRupee className="h-5 w-5" />} hint="Paying hospitals’ monthly price, before GST" />
        {o?.payments_30d_paise != null || q.isLoading
          ? <StatCard label="Received · 30 days" tone="blue" value={o ? paise(o.payments_30d_paise) : '—'} loading={q.isLoading} icon={<CheckCircle2 className="h-5 w-5" />} hint="Plan payments + wallet top-ups, with GST" />
          : <StatCard label="Trials running" tone="blue" value={o?.by_status.trial ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} />}
        <StatCard label="Wallet balances" tone="violet" value={o ? paise(o.wallet_paise) : '—'} loading={q.isLoading} icon={<Wallet className="h-5 w-5" />} hint="Prepaid message credit held for hospitals" />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section
            title="Needs attention"
            subtitle="Trials or plans ending within 7 days, grace periods and read-only hospitals."
            action={o && <Badge tone={o.attention.length ? 'amber' : 'green'} dot>{o.attention.length ? `${o.attention.length} need attention` : 'All clear'}</Badge>}
          >
            {q.isLoading ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
              : !o?.attention.length ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50/50 p-4 sm:flex-row sm:items-center">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><CheckCircle2 className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-emerald-950">Everything looks healthy</p>
                    <p className="mt-0.5 text-xs leading-5 text-emerald-800">No licences need attention right now. We’ll surface expiring trials and plans here.</p>
                  </div>
                  <Link to="/hospitals" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950">View hospitals <ArrowUpRight className="h-3.5 w-3.5" /></Link>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {o.attention.map((a) => (
                    <li key={a.id}>
                      <Link to={`/hospitals/${a.id}`} className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-brand-50/60">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${a.status === 'read_only' ? 'bg-rose-50' : 'bg-amber-50'}`}>
                          <AlertTriangle className={`h-4 w-4 ${a.status === 'read_only' ? 'text-rose-600' : 'text-amber-600'}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{a.name}</p>
                          <p className="text-xs text-slate-500">
                            {a.status === 'grace' || a.status === 'read_only' ? `Read-only from ${date(a.read_only_from)} (${relDays(a.read_only_from)})` : `Ends ${date(a.until)} (${relDays(a.until)})`}
                          </p>
                        </div>
                        <LicenseBadge status={a.status} />
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-brand-700" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Section>

          <Section title="Quick actions" subtitle="Jump straight to the work your team does most.">
            <div className="grid gap-2 sm:grid-cols-2">
              {shortcuts.map((action) => (
                <Link key={action.to} to={action.to} className="group flex min-h-16 items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-brand-50/40 hover:shadow-sm">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${action.tone}`}>{action.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-brand-950">{action.title}</span>
                    <span className="block truncate text-xs text-slate-500">{action.description}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-brand-700" />
                </Link>
              ))}
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Customers by status" subtitle={customerCount ? `${customerCount} customer${customerCount === 1 ? '' : 's'} across all licences` : undefined}>
            {q.isLoading ? <Skeleton className="h-36" /> : (
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
                <Donut slices={statusSlices} size={132} stroke={17} label="Customers by licence status">
                  <div><p className="font-display text-xl font-bold tabular-nums text-brand-950">{customerCount}</p><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">customers</p></div>
                </Donut>
                <Legend slices={statusSlices} total={customerCount} className="w-full min-w-0 sm:flex-1" />
              </div>
            )}
          </Section>

          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-950"><MessageSquare className="h-4 w-4" /> Messages this month</div>
            <p className="mt-1 text-xs text-slate-500">Sent on the platform’s shared accounts</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(['whatsapp', 'sms', 'email'] as const).map((channel) => (
                <div key={channel} className="rounded-xl border border-slate-100 bg-slate-50/70 py-2.5">
                  <p className="font-display text-lg font-bold tabular-nums text-brand-950">{(o?.messages[channel] ?? 0).toLocaleString('en-IN')}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'E-mail'}</p>
                </div>
              ))}
            </div>
          </Card>

          {o?.leads_new != null && (
            <Link to="/leads" className="group flex items-center gap-3 rounded-2xl border border-[#e6e6f5] bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Inbox className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-bold text-brand-950">{o.leads_new} new lead{o.leads_new === 1 ? '' : 's'}</p>
                <p className="text-xs text-slate-500">From the product website’s contact form</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-brand-700" />
            </Link>
          )}
        </div>
      </div>

      {o && (
        <section className="mt-7" aria-labelledby="overview-analytics-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="overview-analytics-title" className="font-display text-base font-semibold text-brand-950">Platform analytics</h2>
              <p className="mt-0.5 text-xs text-slate-500">A quick visual breakdown of plans, messaging and revenue.</p>
            </div>
            <span className="text-xs text-slate-400">Current snapshot</span>
          </div>
          <div className={`grid gap-4 ${o.payments_30d_paise == null ? 'lg:grid-cols-2' : 'lg:grid-cols-2 xl:grid-cols-3'}`}>
            <Section title="Plan distribution" subtitle="Customer accounts by subscribed plan.">
              {planMix.length ? (
                <Suspense fallback={<Skeleton className="h-52" />}><PlanMixChart data={planMix} /></Suspense>
              ) : <EmptyState icon={<Building2 className="h-5 w-5" />} title="No plan data yet" description="Hospital plan counts will appear here." className="py-8" />}
            </Section>

            <Section title="Messages by channel" subtitle="Shared-account messages sent this month.">
              <Suspense fallback={<Skeleton className="h-52" />}><ChannelMixChart data={channelMix} /></Suspense>
              <p className="mt-1 text-center text-xs text-slate-500">
                {totalMessages ? `${totalMessages.toLocaleString('en-IN')} total messages sent` : 'No shared-account messages sent this month yet'}
              </p>
            </Section>

            {o.payments_30d_paise != null && (
              <Section title="Revenue snapshot" subtitle="MRR before GST vs payments received in the last 30 days, with GST.">
                <Suspense fallback={<Skeleton className="h-52" />}><RevenueSnapshotChart data={revenueSnapshot} /></Suspense>
                <div className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span>MRR <strong className="font-semibold text-brand-950">{inr(o.mrr)}</strong></span>
                  <span>Received <strong className="font-semibold text-brand-950">{paise(o.payments_30d_paise)}</strong></span>
                </div>
              </Section>
            )}
          </div>
        </section>
      )}
    </>
  )
}

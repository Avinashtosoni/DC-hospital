import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Building2, CheckCircle2, IndianRupee, Inbox, MessageSquare, Wallet } from 'lucide-react'
import { Card, PageHeader, Skeleton, StatCard } from '../../../src/components/ui'
import { cp } from '../api'
import { date, ErrorBox, inr, LicenseBadge, paise, planLabel, relDays, Section, STATUS, useMe } from '../ui'

export function OverviewPage() {
  const { me } = useMe()
  const q = useQuery({ queryKey: ['cp-overview'], queryFn: () => cp.overview() })
  const o = q.data
  const paying = o ? Object.values(o.by_status).reduce((a, b) => a + b, 0) : 0

  return (
    <>
      <PageHeader title={`Namaste, ${me.full_name.split(' ')[0]}`} description={me.role === 'admin' ? 'Every hospital on the platform at a glance.' : 'The hospitals assigned to you.'} />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hospitals" value={o?.hospitals ?? '—'} loading={q.isLoading} icon={<Building2 className="h-5 w-5" />} hint={o ? `${paying} customer${paying === 1 ? '' : 's'} + the original install` : undefined} />
        <StatCard label="Monthly revenue (MRR)" tone="green" value={o ? inr(o.mrr) : '—'} loading={q.isLoading} icon={<IndianRupee className="h-5 w-5" />} hint="Paying hospitals’ monthly price, before GST" />
        {o?.payments_30d_paise != null || q.isLoading
          ? <StatCard label="Received · 30 days" tone="blue" value={o ? paise(o.payments_30d_paise) : '—'} loading={q.isLoading} icon={<CheckCircle2 className="h-5 w-5" />} hint="Plan payments + wallet top-ups, with GST" />
          : <StatCard label="Trials running" tone="blue" value={o?.by_status.trial ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} />}
        <StatCard label="Wallet balances" tone="violet" value={o ? paise(o.wallet_paise) : '—'} loading={q.isLoading} icon={<Wallet className="h-5 w-5" />} hint="Prepaid message credit held for hospitals" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Section className="lg:col-span-2" title="Needs attention" subtitle="Trials and plans ending within 7 days, grace period and read-only hospitals">
          {q.isLoading ? <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            : !o?.attention.length ? (
              <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5" /> All good — nothing is about to expire.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {o.attention.map((a) => (
                  <li key={a.id}>
                    <Link to={`/hospitals/${a.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-brand-50/60">
                      <AlertTriangle className={a.status === 'read_only' ? 'h-4 w-4 text-rose-500' : 'h-4 w-4 text-amber-500'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{a.name}</p>
                        <p className="text-xs text-slate-500">
                          {a.status === 'grace' || a.status === 'read_only' ? `Read-only from ${date(a.read_only_from)} (${relDays(a.read_only_from)})` : `Ends ${date(a.until)} (${relDays(a.until)})`}
                        </p>
                      </div>
                      <LicenseBadge status={a.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Section>

        <div className="space-y-6">
          <Section title="Customers by status">
            {q.isLoading ? <Skeleton className="h-24" /> : (
              <div className="space-y-2.5">
                {Object.keys(STATUS).map((s) => {
                  const n = o?.by_status[s] ?? 0
                  return (
                    <div key={s} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0"><LicenseBadge status={s} /></span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${paying ? (n / paying) * 100 : 0}%` }} /></div>
                      <span className="w-6 text-right font-semibold text-slate-700">{n}</span>
                    </div>
                  )
                })}
                {o && Object.keys(o.by_plan).length > 0 && (
                  <p className="pt-2 text-xs text-slate-500">Plans: {Object.entries(o.by_plan).map(([p, n]) => `${planLabel(p)} ${n}`).join(' · ')}</p>
                )}
              </div>
            )}
          </Section>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-950"><MessageSquare className="h-4 w-4" /> Messages this month</div>
            <p className="mt-1 text-xs text-slate-500">Sent on the platform’s shared accounts</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(['whatsapp', 'sms', 'email'] as const).map((c) => (
                <div key={c} className="rounded-lg bg-brand-50/70 py-2">
                  <p className="font-display text-lg font-bold text-brand-950">{(o?.messages[c] ?? 0).toLocaleString('en-IN')}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'E-mail'}</p>
                </div>
              ))}
            </div>
          </Card>
          {o?.leads_new != null && (
            <Link to="/leads" className="flex items-center gap-3 rounded-2xl border border-[#e6e6f5] bg-white p-5 shadow-card transition hover:shadow-lift">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><Inbox className="h-5 w-5" /></span>
              <div><p className="font-display text-lg font-bold text-brand-950">{o.leads_new} new lead{o.leads_new === 1 ? '' : 's'}</p><p className="text-xs text-slate-500">From the product website’s contact form</p></div>
            </Link>
          )}
        </div>
      </div>
    </>
  )
}

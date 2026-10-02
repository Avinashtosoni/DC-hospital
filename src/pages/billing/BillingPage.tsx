/**
 * Billing & plan (phase 6) — the hospital owner's page for its Hospital Comrade subscription: plan + renewal (also
 * onto another plan), compare / switch plans, messaging wallet, 6-month usage, GST invoices as PDF, wallet statement
 * as CSV and the details printed on invoices. Owner and accountant (read-only for the accountant); the platform team
 * (admin / finance) also gets its tools here. Only for hospitals on the platform (not the platform's own / single installs).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BadgeIndianRupee, BarChart3, CalendarClock, Check, CreditCard, Download, FileSpreadsheet, FileText, History, Layers, Mail, MessageCircle, MessageSquare, Receipt, ShieldCheck, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { useCanPay } from '../../billing/LicenseBanner'
import { BILLING_QK, billingApi, PaymentCancelled } from '../../billing/api'
import { daysUntil } from '../../billing/license'
import type { BillingSummary, Channel, LedgerRow, PaymentRow, ProviderBillingAction, UsageMonth } from '../../billing/types'
import { Badge, Button, EmptyState, Field, Input, PageHeader, Select, Skeleton } from '../../components/ui'
import { isPrimaryTenant, tenancyEnabled } from '../../tenancy/state'
import { isSupabaseConfigured, platformName } from '../../lib/supabase'
import { cn, downloadCsv } from '../../lib/utils'
import { BILLING_DEFAULTS, rupees } from '../../platform/billing'
import { PLAN_LABEL, PLANS } from '../../platform/plans'
import { Section, Segmented } from '../settings/shared'

const STATUS: Record<string, { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'slate' }> = {
  trial: { label: 'Free trial', tone: 'blue' }, active: { label: 'Active', tone: 'green' }, grace: { label: 'Grace period', tone: 'amber' },
  read_only: { label: 'Read-only', tone: 'red' }, suspended: { label: 'Suspended', tone: 'red' },
}
const CHANNELS: { id: Channel; label: string; icon: typeof Mail }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }, { id: 'sms', label: 'SMS', icon: MessageSquare }, { id: 'email', label: 'E-mail', icon: Mail },
]
const TOPUPS = [500, 1000, 2500, 5000]
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const planName = (id: string) => PLAN_LABEL[id as keyof typeof PLAN_LABEL] ?? id

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return <div className={cn('flex items-center justify-between gap-4 py-1 text-sm', strong ? 'border-t border-slate-100 pt-2 font-semibold text-brand-950' : 'text-slate-600')}><span>{label}</span><span className="tabular-nums">{value}</span></div>
}

/** after anything that changes money or dates: reload the tab and the licence banner */
function useAfterChange() {
  const qc = useQueryClient()
  const { refresh } = useAuth()
  return async () => { await qc.invalidateQueries({ queryKey: BILLING_QK }); await refresh?.() }
}

function usePay(online: 'live' | 'demo' | 'off' | undefined) {
  const { user } = useAuth()
  const after = useAfterChange()
  return useMutation({
    mutationFn: (v: { kind: 'plan' | 'wallet'; months?: number; amount?: number; plan?: string }) =>
      billingApi.pay(v.kind, v, { name: user?.full_name ?? undefined, email: user?.email ?? undefined, contact: user?.phone ?? undefined }),
    onSuccess: async (invoice) => { await after(); toast.success(`Payment received — invoice ${invoice}${online === 'demo' ? ' (demo: no money moved)' : ''}`) },
    onError: (e) => { if (!(e instanceof PaymentCancelled)) toast.error((e as Error).message) },
  })
}

// ------------------------------------------------------------------ plan
function PlanCard({ s, canPay, online, target, setTarget }: { s: BillingSummary; canPay: boolean; online?: 'live' | 'demo' | 'off'; target: string; setTarget: (p: string) => void }) {
  const [months, setMonths] = useState<1 | 12>(1)
  const switching = target !== s.plan
  const targetPrice = switching ? s.plans?.[target]?.price ?? null : s.price
  const quote = useQuery({ queryKey: [...BILLING_QK, 'quote', 'plan', months, target, s.plan, s.price, s.license.paid_until, s.license.trial_ends_at], queryFn: () => billingApi.quote('plan', months, undefined, target), enabled: canPay && targetPrice != null, retry: false })
  const pay = usePay(online)
  const st = STATUS[s.license.status] ?? STATUS.active
  const l = s.license
  const plan = PLANS.find((p) => p.id === s.plan)
  return (
    <Section title="Your plan" icon={<ShieldCheck className="h-4 w-4" />} description={`${platformName} subscription for this hospital.`}
      action={<Badge tone={st.tone} dot>{st.label}</Badge>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="font-display text-2xl font-bold text-brand-950">{planName(s.plan)}</p>
            <p className="text-sm text-slate-600">{s.price != null ? <>{rupees(s.price * 100)} / month <span className="text-slate-400">+ {s.gst_percent}% GST</span></> : 'Priced individually'}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {l.trial_ends_at && <div><dt className="text-xs text-slate-500">Trial {Date.parse(l.trial_ends_at) > Date.now() ? 'ends' : 'ended'}</dt><dd className="font-medium text-brand-950">{date(l.trial_ends_at)}</dd></div>}
            {l.paid_until && <div><dt className="text-xs text-slate-500">Paid until</dt><dd className="font-medium text-brand-950">{date(l.paid_until)}{l.status === 'active' && <span className="ml-1 text-xs text-slate-500">({daysUntil(l.paid_until)} days)</span>}</dd></div>}
            {l.read_only_from && l.status !== 'active' && <div><dt className="text-xs text-slate-500">{l.status === 'read_only' ? 'Read-only since' : 'Read-only from'}</dt><dd className={cn('font-medium', l.status === 'grace' || l.status === 'read_only' ? 'text-rose-700' : 'text-brand-950')}>{date(l.read_only_from)}</dd></div>}
          </dl>
          {plan && <ul className="space-y-1 text-xs text-slate-600">{plan.features.slice(0, 4).map((f) => <li key={f}>• {f}</li>)}</ul>}
        </div>

        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
          {!canPay ? <p className="text-sm text-slate-600">Only the hospital owner can renew the plan.</p>
            : targetPrice == null ? <p className="text-sm text-slate-600">Your plan has a custom price — {platformName} will send you the payment details. Questions? Write to support.</p>
            : (
              <div className="space-y-3">
                {switching && (
                  <div className="flex items-start justify-between gap-3 rounded-lg bg-white p-2.5 text-xs text-brand-900 ring-1 ring-brand-200">
                    <span>Renewing on <b>{planName(target)}</b> — your plan switches to it as soon as the payment arrives; the new period starts after the current one.</span>
                    <button type="button" className="shrink-0 font-semibold text-brand-700 underline" onClick={() => setTarget(s.plan)}>Keep {planName(s.plan)}</button>
                  </div>
                )}
                <Segmented value={months} onChange={setMonths} options={[{ value: 1, label: '1 month' }, { value: 12, label: <>12 months <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">{12 - s.yearly_months} free</span></> }]} />
                {quote.isLoading ? <Skeleton className="h-24" /> : quote.error ? <p className="text-sm text-rose-700">{(quote.error as Error).message}</p> : quote.data && (
                  <div>
                    <Row label={`${planName(target)} · ${months === 12 ? `12 months (pay ${s.yearly_months})` : '1 month'}`} value={rupees(quote.data.base_paise)} />
                    <Row label={`GST ${quote.data.gst_percent}%`} value={rupees(quote.data.gst_paise)} />
                    <Row label="Total" value={rupees(quote.data.total_paise)} strong />
                    {quote.data.period_from && <p className="mt-1 text-xs text-slate-500">Covers {date(quote.data.period_from)} – {date(quote.data.period_to)}</p>}
                  </div>
                )}
                {online === 'off' ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Online payment isn’t switched on yet — contact {platformName} to renew by bank transfer or UPI.</p> : (
                  <Button className="w-full" icon={<CreditCard className="h-4 w-4" />} loading={pay.isPending} disabled={!quote.data}
                    onClick={() => pay.mutate({ kind: 'plan', months, plan: target })}>
                    {quote.data ? `Pay ${rupees(quote.data.total_paise)}` : 'Pay'}
                  </Button>
                )}
                <p className="text-center text-[11px] text-slate-500">{online === 'demo' ? 'Demo: the payment is simulated, no money moves.' : 'UPI, cards, net banking and wallets via Razorpay · GST invoice'}</p>
              </div>
            )}
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ compare / change plan
function PlanPicker({ s, canPay, isOwner, target, onChoose }: { s: BillingSummary; canPay: boolean; isOwner: boolean; target: string; onChoose: (p: string) => void }) {
  const after = useAfterChange()
  const l = s.license
  const paid = !!l.paid_until && Date.parse(l.paid_until) > Date.now()
  const inTrial = l.status === 'trial' && !paid
  const sw = useMutation({
    mutationFn: (plan: string) => billingApi.changeTrialPlan(plan),
    onSuccess: async (_d, plan) => { await after(); onChoose(plan); toast.success(`You're now on the ${planName(plan)} plan for the rest of the trial`) },
    onError: (e) => toast.error((e as Error).message),
  })
  const contact = s.seller?.email || BILLING_DEFAULTS.seller.email
  return (
    <Section title="Compare plans" icon={<Layers className="h-4 w-4" />}
      description={s.custom_price ? `Your price was agreed with ${platformName} — ask them to change your plan.`
        : inTrial ? 'Try any plan during the free trial — switching is instant and free. You choose what to pay for when you renew.'
        : 'Pick a plan for your next renewal. It switches when the payment arrives; the new period starts after the current one.'}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const cfg = s.plans?.[p.id]
          const price = cfg ? cfg.price : p.price
          const inc = cfg?.included ?? p.included
          const current = p.id === s.plan
          const chosen = p.id === target && !current
          return (
            <div key={p.id} className={cn('relative flex flex-col rounded-2xl border p-4 transition',
              current ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-300' : chosen ? 'border-brand-400 ring-2 ring-brand-200' : 'border-slate-200 bg-white')}>
              {current && <span className="absolute -top-2.5 left-4 rounded-full bg-brand-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Current</span>}
              {p.highlight && !current && <span className="absolute -top-2.5 left-4 rounded-full bg-brand-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-900">Popular</span>}
              <p className="font-display text-lg font-bold text-brand-950">{p.name}</p>
              <p className="text-xs text-slate-500">{p.tagline}</p>
              <p className="mt-2 text-xl font-bold tabular-nums text-brand-950">{price != null ? <>{rupees(price * 100)}<span className="text-xs font-normal text-slate-500"> / month{p.id === 'enterprise' ? '+' : ''}</span></> : <span className="text-base">Custom pricing</span>}</p>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-slate-600">
                <li className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />{(inc.whatsapp ?? 0) + (inc.sms ?? 0) + (inc.email ?? 0) === 0 ? 'Messages as agreed'
                  : `${(inc.whatsapp ?? 0).toLocaleString('en-IN')} WhatsApp · ${(inc.sms ?? 0).toLocaleString('en-IN')} SMS · ${(inc.email ?? 0).toLocaleString('en-IN')} e-mails / month`}</li>
                {p.features.slice(0, 3).map((f) => <li key={f} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />{f}</li>)}
              </ul>
              <div className="mt-4">
                {current ? <p className="text-center text-xs font-medium text-brand-700">Your plan</p>
                  : price == null ? <a className="block rounded-lg px-3 py-1.5 text-center text-sm font-medium text-brand-900 ring-1 ring-brand-200 hover:ring-brand-400" href={contact ? `mailto:${contact}?subject=${encodeURIComponent(`${p.name} plan`)}` : undefined}>Talk to us</a>
                  : !canPay || s.custom_price ? null
                  : inTrial && isOwner ? <Button size="sm" variant="outline" className="w-full" loading={sw.isPending && sw.variables === p.id} onClick={() => sw.mutate(p.id)}>Switch now</Button>
                  : <Button size="sm" variant={chosen ? 'primary' : 'outline'} className="w-full" onClick={() => onChoose(p.id)}>{chosen ? 'Selected for renewal' : `Renew on ${p.name}`}</Button>}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ usage over time
function brand(shade: number, fallback: string) {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(`--brand-${shade}`).trim() : ''
  return v ? `rgb(${v.split(/\s+/).join(',')})` : fallback
}
function UsageChart({ rows }: { rows: UsageMonth[] | undefined }) {
  const data = (rows ?? []).map((r) => ({
    label: new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    whatsapp: r.sent.whatsapp ?? 0, sms: r.sent.sms ?? 0, email: r.sent.email ?? 0, charged: r.charged_paise, own: r.own,
  }))
  const total = data.reduce((n, d) => n + d.charged, 0)
  const colors = { whatsapp: brand(600, '#5c5c99'), sms: brand(400, '#a3a3cc'), email: brand(900, '#292966') }
  return (
    <Section title="Messages over the last 6 months" icon={<BarChart3 className="h-4 w-4" />}
      description={`Sent on ${platformName}'s shared accounts. Messages on your own accounts are free and not shown in the bars.`}
      action={rows && <span className="text-xs text-slate-500">Charged to wallet: <b className="text-brand-950">{rupees(total)}</b></span>}>
      {!rows ? <Skeleton className="h-56" /> : !data.some((d) => d.whatsapp + d.sms + d.email + d.own) ? (
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No messages yet" description="Once appointment confirmations and reminders go out, you'll see them here month by month." />
      ) : (
        <>
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} width={40} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="whatsapp" name="WhatsApp" stackId="m" fill={colors.whatsapp} maxBarSize={40} />
                <Bar dataKey="sms" name="SMS" stackId="m" fill={colors.sms} maxBarSize={40} />
                <Bar dataKey="email" name="E-mail" stackId="m" fill={colors.email} radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="-mx-5 mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-right text-xs tabular-nums">
              <thead className="text-slate-500"><tr className="border-b border-slate-100"><th className="px-5 py-1.5 text-left font-medium">Month</th>{data.map((d) => <th key={d.label} className="px-2 py-1.5 font-medium">{d.label}</th>)}</tr></thead>
              <tbody>
                <tr className="border-b border-slate-50"><td className="px-5 py-1.5 text-left text-slate-600">Messages</td>{data.map((d) => <td key={d.label} className="px-2 py-1.5">{(d.whatsapp + d.sms + d.email).toLocaleString('en-IN')}</td>)}</tr>
                <tr className="border-b border-slate-50"><td className="px-5 py-1.5 text-left text-slate-600">Own accounts</td>{data.map((d) => <td key={d.label} className="px-2 py-1.5 text-slate-500">{d.own.toLocaleString('en-IN')}</td>)}</tr>
                <tr><td className="px-5 py-1.5 text-left text-slate-600">Charged</td>{data.map((d) => <td key={d.label} className="px-2 py-1.5 font-medium text-brand-950">{d.charged ? rupees(d.charged) : '—'}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ wallet
function WalletCard({ s, canPay, online }: { s: BillingSummary; canPay: boolean; online?: 'live' | 'demo' | 'off' }) {
  const [amount, setAmount] = useState(1000)
  const [debounced, setDebounced] = useState(1000)
  useEffect(() => { const t = setTimeout(() => setDebounced(amount), 350); return () => clearTimeout(t) }, [amount])
  const quote = useQuery({ queryKey: [...BILLING_QK, 'quote', 'wallet', debounced], queryFn: () => billingApi.quote('wallet', 1, debounced), enabled: canPay && !s.is_primary, retry: false })
  const pay = usePay(online)
  const low = s.wallet_paise < 5000
  return (
    <Section title="Messaging wallet" icon={<Wallet className="h-4 w-4" />}
      description={`Messages on ${platformName}'s SMS, WhatsApp and e-mail beyond your plan's monthly allowance are paid from this prepaid balance. OTPs always go out.`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500">Balance</p>
            <p className={cn('font-display text-3xl font-bold tabular-nums', s.wallet_paise < 0 ? 'text-rose-700' : 'text-brand-950')}>{rupees(s.wallet_paise)}</p>
            {low && !s.is_primary && <p className="mt-1 text-xs text-amber-800">Low balance — messages beyond the allowance stop when it runs out.</p>}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">This month</p>
            {CHANNELS.map((c) => {
              const used = s.usage[c.id] ?? 0, inc = s.included[c.id] ?? 0
              const pct = inc ? Math.min(100, Math.round((used / inc) * 100)) : used ? 100 : 0
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-1.5 text-slate-700"><c.icon className="h-3.5 w-3.5" />{c.label}</span>
                    <span className="tabular-nums text-slate-600">{used.toLocaleString('en-IN')} / {inc.toLocaleString('en-IN')} included{used > inc && <> · <b className="text-brand-900">{(used - inc).toLocaleString('en-IN')} paid</b></>}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', used > inc ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
            <p className="text-[11px] text-slate-500">Beyond the allowance: {CHANNELS.map((c) => `${c.label} ${rupees(s.rates_paise[c.id] ?? 0)}`).join(' · ')} per message (+ GST on top-ups).</p>
          </div>
        </div>
        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
          {s.is_primary ? <p className="text-sm text-slate-600">This is the platform's own hospital — messages are not charged.</p> : !canPay ? <p className="text-sm text-slate-600">Only the hospital owner can top up the wallet.</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {TOPUPS.map((a) => (
                  <button key={a} type="button" onClick={() => setAmount(a)} aria-pressed={amount === a}
                    className={cn('rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition', amount === a ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-brand-900 ring-brand-200 hover:ring-brand-400')}>{rupees(a * 100)}</button>
                ))}
              </div>
              <Field label="Amount (₹)" hint={`${rupees(s.min_topup * 100)} – ${rupees(s.max_topup * 100)}`}>
                <Input type="number" inputMode="numeric" min={s.min_topup} max={s.max_topup} step={100} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </Field>
              {quote.error ? <p className="text-sm text-rose-700">{(quote.error as Error).message}</p> : quote.data && (
                <div><Row label="Added to wallet" value={rupees(quote.data.base_paise)} /><Row label={`GST ${quote.data.gst_percent}%`} value={rupees(quote.data.gst_paise)} /><Row label="Total" value={rupees(quote.data.total_paise)} strong /></div>
              )}
              {online === 'off' ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Online payment isn’t switched on yet — contact {platformName} to top up.</p> : (
                <Button className="w-full" variant="secondary" icon={<BadgeIndianRupee className="h-4 w-4" />} loading={pay.isPending} disabled={!quote.data || debounced !== amount}
                  onClick={() => pay.mutate({ kind: 'wallet', amount })}>{quote.data ? `Add ${rupees(quote.data.base_paise)} · pay ${rupees(quote.data.total_paise)}` : 'Add money'}</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ invoice details
function BuyerCard({ s, editable }: { s: BillingSummary; editable: boolean }) {
  const [d, setD] = useState(s.buyer)
  useEffect(() => setD(s.buyer), [s.buyer])
  const after = useAfterChange()
  const save = useMutation({ mutationFn: () => billingApi.saveDetails(d), onSuccess: async () => { await after(); toast.success('Invoice details saved') }, onError: (e) => toast.error((e as Error).message) })
  const dirty = JSON.stringify(d) !== JSON.stringify(s.buyer)
  return (
    <Section title="Invoice details" icon={<FileText className="h-4 w-4" />} description={`Printed on ${platformName}'s GST invoices to you. Add your GSTIN to claim input tax credit.`}
      action={editable && <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name"><Input value={d.legalName} disabled={!editable} maxLength={150} onChange={(e) => setD({ ...d, legalName: e.target.value })} /></Field>
        <Field label="GSTIN" hint="Optional"><Input value={d.gstin} disabled={!editable} maxLength={15} className="uppercase" placeholder="10ABCDE1234F1Z5" onChange={(e) => setD({ ...d, gstin: e.target.value })} /></Field>
        <Field label="Billing address" className="sm:col-span-2"><Input value={d.address} disabled={!editable} maxLength={300} onChange={(e) => setD({ ...d, address: e.target.value })} /></Field>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ history
function History2({ s, payments, ledger }: { s: BillingSummary; payments: PaymentRow[] | undefined; ledger: LedgerRow[] | undefined }) {
  const [view, setView] = useState<'payments' | 'wallet'>('payments')
  const [busy, setBusy] = useState<string | null>(null)
  const download = async (p: PaymentRow) => {
    setBusy(p.id)
    try {
      const { downloadBillingInvoice } = await import('../../billing/invoicePdf')
      await downloadBillingInvoice({ payment: p, seller: { ...BILLING_DEFAULTS.seller, ...(s.seller ?? {}) }, buyer: s.buyer, platformName })
    } catch (e) { toast.error((e as Error).message || 'Could not create the PDF') } finally { setBusy(null) }
  }
  const exportCsv = () => {
    if (!ledger?.length) return
    downloadCsv(`wallet-statement-${new Date().toISOString().slice(0, 10)}.csv`, [...ledger].reverse().map((r) => ({
      Date: r.kind === 'usage' ? r.day : r.created_at.slice(0, 10), Activity: ledgerLabel(r), Note: r.note ?? '',
      'Amount (Rs.)': (r.amount_paise / 100).toFixed(2), 'Balance (Rs.)': (r.balance_paise / 100).toFixed(2),
    })))
  }
  const what = (p: PaymentRow) => (p.kind === 'plan' ? `${planName(p.plan ?? '')} plan · ${p.months === 12 ? '12 months' : `${p.months ?? 1} month`}` : 'Wallet top-up')
  const ledgerLabel = (r: LedgerRow) => r.kind === 'usage' ? `${CHANNELS.find((c) => c.id === r.channel)?.label ?? r.channel} · ${r.units.toLocaleString('en-IN')} message${r.units === 1 ? '' : 's'}` : r.kind === 'topup' ? 'Top-up' : r.kind === 'refund' ? 'Refund' : 'Adjustment'
  return (
    <Section title="Invoices & statement" icon={<History className="h-4 w-4" />} action={
      <div className="flex items-center gap-2">
        {view === 'wallet' && !!ledger?.length && <Button size="sm" variant="ghost" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportCsv}>CSV</Button>}
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'payments', label: 'Invoices' }, { value: 'wallet', label: 'Wallet' }]} />
      </div>}>
      {view === 'payments' ? (
        !payments ? <Skeleton className="h-24" /> : !payments.length ? <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments yet" description="Your plan renewals and wallet top-ups will appear here with their invoice numbers." /> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr className="border-b border-slate-100"><th className="px-5 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Invoice</th><th className="px-2 py-2 font-medium">For</th><th className="px-2 py-2 font-medium">Paid by</th><th className="px-2 py-2 text-right font-medium">Amount</th><th className="px-5 py-2"><span className="sr-only">Download</span></th></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 text-slate-600">{date(p.paid_at ?? p.created_at)}</td>
                  <td className="px-2 py-2 font-mono text-xs text-brand-950">{p.invoice_no ?? '—'}</td>
                  <td className="px-2 py-2">{what(p)}{p.period_from && <span className="block text-xs text-slate-500">{date(p.period_from)} – {date(p.period_to)}</span>}</td>
                  <td className="px-2 py-2 text-slate-600">{p.status === 'paid' ? `${p.provider === 'manual' ? 'Manual' : 'Razorpay'}${p.method ? ` · ${p.method}` : ''}` : <Badge tone={p.status === 'failed' ? 'red' : 'slate'}>{p.status}</Badge>}</td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">{rupees(p.total_paise)}</td>
                  <td className="px-5 py-2 text-right">{p.invoice_no && (p.status === 'paid' || p.status === 'refunded') && (
                    <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} loading={busy === p.id} onClick={() => download(p)} aria-label={`Download invoice ${p.invoice_no}`}>PDF</Button>)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )
      ) : (
        !ledger ? <Skeleton className="h-24" /> : !ledger.length ? <EmptyState icon={<Wallet className="h-6 w-6" />} title="No wallet activity yet" description="Top-ups and messages charged beyond your allowance appear here, one line per day and channel." /> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr className="border-b border-slate-100"><th className="px-5 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Activity</th><th className="px-2 py-2 text-right font-medium">Amount</th><th className="px-5 py-2 text-right font-medium">Balance</th></tr></thead>
              <tbody>{ledger.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2 text-slate-600">{date(r.kind === 'usage' ? r.day : r.created_at)}</td>
                  <td className="px-2 py-2">{ledgerLabel(r)}{r.note && <span className="block text-xs text-slate-500">{r.note}</span>}</td>
                  <td className={cn('px-2 py-2 text-right tabular-nums', r.amount_paise < 0 ? 'text-slate-700' : 'font-medium text-emerald-700')}>{r.amount_paise > 0 ? '+' : '−'}{rupees(Math.abs(r.amount_paise))}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-600">{rupees(r.balance_paise)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )
      )}
    </Section>
  )
}

// ------------------------------------------------------------------ Hospital Comrade team
function ProviderTools({ s, admin }: { s: BillingSummary; admin: boolean }) {
  const after = useAfterChange()
  const run = useMutation({
    mutationFn: (v: { action: ProviderBillingAction; args?: Record<string, unknown>; done: string }) => billingApi.provider(v.action, v.args),
    onSuccess: async (_d, v) => { await after(); toast.success(v.done) },
    onError: (e) => toast.error((e as Error).message),
  })
  const [man, setMan] = useState({ kind: 'plan', plan: s.plan, months: '1', amount: '1000', method: 'bank', reference: '' })
  const [adj, setAdj] = useState({ amount: '', note: '' })
  const [days, setDays] = useState('7')
  const [plan, setPlan] = useState({ plan: s.plan, price: '' })
  return (
    <Section title={`${platformName} team tools`} icon={<CalendarClock className="h-4 w-4" />} className="border-brand-200 ring-1 ring-brand-100"
      description="Only visible to the platform team. Every action is logged in the provider audit.">
      <div className="grid gap-6 lg:grid-cols-2">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run.mutate({ action: 'manual_payment', args: { kind: man.kind, plan: man.kind === 'plan' ? man.plan : undefined, months: Number(man.months), amount: Number(man.amount), method: man.method, reference: man.reference }, done: 'Payment recorded' }) }}>
          <p className="text-sm font-semibold text-brand-950">Record a payment received outside the app</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="For"><Select value={man.kind} onChange={(e) => setMan({ ...man, kind: e.target.value })}><option value="plan">Plan renewal</option><option value="wallet">Wallet top-up</option></Select></Field>
            {man.kind === 'plan' ? <Field label="Months"><Select value={man.months} onChange={(e) => setMan({ ...man, months: e.target.value })}><option value="1">1 month</option><option value="12">12 months</option></Select></Field>
              : <Field label="Amount ₹ (before GST)"><Input type="number" value={man.amount} onChange={(e) => setMan({ ...man, amount: e.target.value })} /></Field>}
            {man.kind === 'plan' && <Field label="Plan" hint="Switches when recorded"><Select value={man.plan} onChange={(e) => setMan({ ...man, plan: e.target.value })}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
            <Field label="Method"><Select value={man.method} onChange={(e) => setMan({ ...man, method: e.target.value })}>{['bank', 'upi', 'cash', 'cheque'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select></Field>
            <Field label="Reference / UTR"><Input value={man.reference} onChange={(e) => setMan({ ...man, reference: e.target.value })} /></Field>
          </div>
          <Button type="submit" size="sm" loading={run.isPending}>Record payment</Button>
        </form>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run.mutate({ action: 'wallet_adjust', args: { amount: Number(adj.amount), note: adj.note }, done: 'Wallet adjusted' }); setAdj({ amount: '', note: '' }) }}>
          <p className="text-sm font-semibold text-brand-950">Adjust the wallet</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ₹ (− to deduct)"><Input type="number" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} placeholder="250" /></Field>
            <Field label="Why"><Input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="Goodwill credit" /></Field>
          </div>
          <Button type="submit" size="sm" variant="outline" loading={run.isPending} disabled={!adj.amount || !adj.note.trim()}>Apply</Button>
        </form>
        {admin && (
          <>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-950">Trial & access</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Extend trial by (days)"><Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" /></Field>
                <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate({ action: 'extend_trial', args: { days: Number(days) }, done: `Trial extended by ${days} days` })}>Extend</Button>
                {s.license.status === 'suspended'
                  ? <Button size="sm" variant="outline" onClick={() => run.mutate({ action: 'resume', done: 'Hospital resumed' })}>Resume</Button>
                  : <Button size="sm" variant="danger" onClick={() => { if (window.confirm('Suspend this hospital? Its website and app close until resumed.')) run.mutate({ action: 'suspend', done: 'Hospital suspended' }) }}>Suspend</Button>}
              </div>
              {!isSupabaseConfigured && (
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="mb-2 font-medium">Demo only — jump in time to see the banners:</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => run.mutate({ action: 'demo_end_trial', args: { daysAgo: 2 }, done: 'Trial ended 2 days ago → grace period' })}>Trial ended 2 days ago</Button>
                    <Button size="sm" variant="ghost" onClick={() => run.mutate({ action: 'demo_end_trial', args: { daysAgo: 10 }, done: 'Trial ended 10 days ago → read-only' })}>…10 days ago</Button>
                    <Button size="sm" variant="ghost" onClick={() => run.mutate({ action: 'extend_trial', args: { days: 9 }, done: 'Back in the trial' })}>Back to trial</Button>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-950">Plan & price</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Plan"><Select value={plan.plan} onChange={(e) => setPlan({ ...plan, plan: e.target.value })}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                <Field label="Custom ₹ / month" hint="Empty = plan price"><Input type="number" value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} className="w-32" /></Field>
                <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate({ action: 'set_plan', args: { plan: plan.plan, price: plan.price === '' ? null : Number(plan.price) }, done: 'Plan updated' })}>Save</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Section>
  )
}

function BillingContent() {
  const { user, context } = useAuth()
  const canPay = useCanPay()
  const summary = useQuery({ queryKey: [...BILLING_QK, 'summary'], queryFn: billingApi.summary })
  const online = useQuery({ queryKey: [...BILLING_QK, 'online'], queryFn: billingApi.onlineEnabled, staleTime: 300_000, enabled: canPay })
  const payments = useQuery({ queryKey: [...BILLING_QK, 'payments'], queryFn: billingApi.payments })
  const ledger = useQuery({ queryKey: [...BILLING_QK, 'ledger'], queryFn: billingApi.ledger })
  const usage = useQuery({ queryKey: [...BILLING_QK, 'usage'], queryFn: () => billingApi.usageHistory(6) })
  const pr = context?.provider_role
  const isOwner = !pr && user?.role === 'owner'
  const s = summary.data
  const [target, setTarget] = useState<string | null>(null)
  const planRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (s && target === s.plan) setTarget(null) }, [s, target])
  const header = useMemo(() => s && STATUS[s.license.status], [s])
  if (summary.isLoading) return <div className="space-y-4"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
  if (summary.error) return <EmptyState icon={<CreditCard className="h-6 w-6" />} title="Billing could not be loaded" description={(summary.error as Error).message} />
  if (!s || !header) return null
  const choose = (p: string) => { setTarget(p); planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  return (
    <div className="space-y-6">
      <div ref={planRef} className="scroll-mt-20"><PlanCard s={s} canPay={canPay} online={online.data} target={target ?? s.plan} setTarget={(p) => setTarget(p)} /></div>
      <PlanPicker s={s} canPay={canPay} isOwner={isOwner} target={target ?? s.plan} onChoose={choose} />
      <div className="grid gap-6 2xl:grid-cols-2">
        <WalletCard s={s} canPay={canPay} online={online.data} />
        <UsageChart rows={usage.data} />
      </div>
      {(pr === 'admin' || pr === 'finance') && <ProviderTools s={s} admin={pr === 'admin' && context?.provider_mode !== 'finance'} />}
      <History2 s={s} payments={payments.data} ledger={ledger.data} />
      <BuyerCard s={s} editable={isOwner} />
    </div>
  )
}

export default function BillingPage() {
  const onPlatform = tenancyEnabled() && !isPrimaryTenant()
  return (
    <div className="w-full">
      <PageHeader title="Billing & plan" description={`Your ${platformName} subscription, messaging wallet, usage and GST invoices.`} />
      {onPlatform ? <BillingContent /> : (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="Nothing to bill here" description={`This hospital is not billed through ${platformName}.`} />
      )}
    </div>
  )
}

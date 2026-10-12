/**
 * Plans & billing → Billing rules and Invoices tabs (one form: platform_settings 'billing' without the plans), and History.
 */
import { CalendarClock, Coins, FileText, Globe, History, MessageSquare, Percent, Receipt, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, Field, Input, Skeleton } from '../../../../src/components/ui'
import { platformDomain, platformName } from '../../../../src/lib/supabase'
import type { Plan } from '../../../../src/platform/plans'
import type { BillingConfig, PlanHistoryRow } from '../../types'
import { dateTime, ErrorBox, inr, Section } from '../../ui'
import { historyLine } from './model'

export type RulesForm = Omit<BillingConfig, 'plans'>

function Num({ label, hint, value, onChange, min = 0, max, suffix }: { label: string; hint?: string; value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <Input type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} className={suffix ? 'pr-12' : undefined} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
    </Field>
  )
}

export function RulesTab({ f, set, plans }: { f: RulesForm; set: (patch: Partial<RulesForm>) => void; plans: Plan[] }) {
  const sample = plans.find((p) => p.highlight && p.price != null && !p.archived) ?? plans.find((p) => p.price != null && !p.archived)
  const yearly = sample?.price != null ? sample.price * f.yearlyMonths : null
  const gst = yearly != null ? Math.round(yearly * f.gstPercent) / 100 : null
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Section title={<span className="flex items-center gap-2"><Percent className="h-4 w-4" />Tax & yearly price</span>} subtitle="GST is added on top of every price.">
        <div className="grid grid-cols-2 gap-3">
          <Num label="GST" suffix="%" max={40} value={f.gstPercent} onChange={(n) => set({ gstPercent: n })} />
          <Num label="Yearly plan costs" suffix="months" min={1} max={12} hint={`12 months for the price of ${f.yearlyMonths} (${12 - f.yearlyMonths} free)`} value={f.yearlyMonths} onChange={(n) => set({ yearlyMonths: n })} />
        </div>
        {sample && yearly != null && (
          <div className="mt-4 rounded-xl bg-brand-50/60 p-3 text-xs text-brand-900 ring-1 ring-brand-100">
            <p className="font-semibold">Example — {sample.name}, 12 months</p>
            <p className="mt-1 tabular-nums">{inr(sample.price)} × {f.yearlyMonths} = {inr(yearly)} + GST {inr(gst)} = <b>{inr(yearly + (gst ?? 0))}</b></p>
          </div>
        )}
      </Section>

      <Section title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />Trial & grace period</span>} subtitle="New hospitals get the trial; after a plan or trial ends, everything keeps working for the grace period, then the hospital turns read-only.">
        <div className="grid grid-cols-2 gap-3">
          <Num label="Free trial" suffix="days" max={90} value={f.trialDays} onChange={(n) => set({ trialDays: n })} />
          <Num label="Grace period" suffix="days" max={90} value={f.graceDays} onChange={(n) => set({ graceDays: n })} />
        </div>
        <p className="mt-3 text-xs text-slate-500">The sign-up page’s own trial length is under <Link to="/signups" className="text-brand-700 hover:underline">Sign-ups → Settings</Link>. Extend one hospital’s trial from its page.</p>
      </Section>

      <Section title={<span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" />Extra messages</span>} subtitle="Paise per message beyond the plan’s included messages, taken from the hospital’s wallet.">
        <div className="grid grid-cols-3 gap-3">
          {(['whatsapp', 'sms', 'email'] as const).map((c) => (
            <Num key={c} label={c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'E-mail'} suffix="paise" max={1000} hint={`= ${inr((f.ratesPaise[c] ?? 0) / 100)} each`}
              value={f.ratesPaise[c]} onChange={(n) => set({ ratesPaise: { ...f.ratesPaise, [c]: n } })} />
          ))}
        </div>
      </Section>

      <Section title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4" />Wallet top-ups</span>} subtitle="What a hospital can add to its message wallet in one payment.">
        <div className="grid grid-cols-2 gap-3">
          <Num label="Smallest top-up" suffix="₹" value={f.minTopup} onChange={(n) => set({ minTopup: n })} />
          <Num label="Largest top-up" suffix="₹" value={f.maxTopup} onChange={(n) => set({ maxTopup: n })} />
        </div>
        {f.minTopup > f.maxTopup && <p className="mt-2 text-xs text-rose-700">The smallest top-up is above the largest.</p>}
      </Section>
    </div>
  )
}

export function InvoicesTab({ f, set }: { f: RulesForm; set: (patch: Partial<RulesForm>) => void }) {
  const s = f.seller
  const seller = (patch: Partial<RulesForm['seller']>) => set({ seller: { ...s, ...patch } })
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Section title={<span className="flex items-center gap-2"><Receipt className="h-4 w-4" />Seller on your tax invoices</span>} subtitle="Printed on every invoice when it is numbered (older invoices keep what they had).">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name"><Input value={s.name} onChange={(e) => seller({ name: e.target.value })} /></Field>
          <Field label="GSTIN" hint={s.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(s.gstin) ? '15 characters, e.g. 10ABCDE1234F1Z5' : undefined}><Input value={s.gstin} maxLength={15} className="font-mono" onChange={(e) => seller({ gstin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={s.address} onChange={(e) => seller({ address: e.target.value })} /></Field>
          <Field label="State" hint="Decides CGST + SGST or IGST"><Input value={s.state} onChange={(e) => seller({ state: e.target.value })} /></Field>
          <Field label="Billing e-mail" hint="Also the “talk to us” address for custom plans"><Input type="email" value={s.email} onChange={(e) => seller({ email: e.target.value })} /></Field>
          <Field label="SAC code" hint="Confirm with your CA (default 998315)"><Input value={s.sac ?? ''} placeholder="998315" maxLength={8} onChange={(e) => seller({ sac: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
      </Section>
      <div className="space-y-6">
        <Section title={<span className="flex items-center gap-2"><FileText className="h-4 w-4" />Preview</span>} subtitle="Top of the invoice">
          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-slate-400">Tax invoice</p>
            <p className="mt-1 font-display text-lg font-bold text-brand-950">{s.name || 'Business name'}</p>
            <p className="text-xs text-slate-600">{s.address || 'Address'}{s.state ? `, ${s.state}` : ''}</p>
            <p className="mt-1 text-xs text-slate-600">GSTIN: <span className="font-mono">{s.gstin || '— not set —'}</span> · SAC {s.sac || '998315'}</p>
            {s.email && <p className="text-xs text-slate-600">{s.email}</p>}
            {!s.gstin && <Badge tone="amber" className="mt-2">Add your GSTIN before charging GST</Badge>}
          </div>
        </Section>
        <Section title={<span className="flex items-center gap-2"><Globe className="h-4 w-4" />Brand & domain</span>} subtitle="Set on the server (PLATFORM_NAME / PLATFORM_DOMAIN environment variables).">
          <p className="text-sm text-slate-700"><span className="font-medium">{platformName}</span> · {platformDomain}</p>
          <p className="mt-2 text-xs text-slate-500">Razorpay and the shared SMS, WhatsApp, e-mail and push accounts are in <Link className="text-brand-700 hover:underline" to="/settings">Platform settings → Integrations</Link>.</p>
        </Section>
      </div>
    </div>
  )
}

export function HistoryTab({ rows, error, onRetry }: { rows: PlanHistoryRow[] | undefined; error: unknown; onRetry: () => void }) {
  if (error) return <ErrorBox error={error} onRetry={onRetry} />
  if (!rows) return <Skeleton className="h-64" />
  if (!rows.length) return <EmptyState icon={<History className="h-6 w-6" />} title="No changes yet" description="Every plan, price and billing-rule change is listed here with who made it." />
  const icon = (a: string) => (a === 'settings:billing' ? <Coins className="h-3 w-3" /> : <Receipt className="h-3 w-3" />)
  return (
    <Section title="Change history" subtitle="Plans, prices and billing rules — newest first">
      <ol className="relative space-y-4 border-l border-slate-200 pl-5">
        {rows.map((r) => (
          <li key={r.id} className="relative">
            <span className="absolute -left-[30px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-brand-50 text-brand-700 ring-4 ring-white">{icon(r.action)}</span>
            <p className="text-sm text-brand-950">{historyLine(r)}</p>
            <p className="text-xs text-slate-500">{dateTime(r.at)} · {r.user_name ?? 'Someone'}</p>
          </li>
        ))}
      </ol>
    </Section>
  )
}

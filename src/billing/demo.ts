/**
 * Demo mode (no database): each demo hospital's plan, wallet, payments and ledger live in the browser, so
 * Settings → Plan & wallet and the licence banner can be tried on the public demo. Payments are simulated —
 * no money moves. Same rules as scripts/sql/billing.sql (prices, GST, yearly = 10 months, renewals after the trial).
 */
import { BILLING_DEFAULTS } from '../platform/billing'
import { demoTenantById, type DemoTenant } from '../tenancy/demo'
import { computeLicense, type LicenseInfo } from './license'
import type { BillingSummary, Channel, LedgerRow, PaymentRow, Quote, UsageMonth } from './types'

export interface DemoBilling {
  plan: string
  trial_ends_at: string | null
  paid_until: string | null
  suspended: boolean
  wallet_paise: number
  buyer: { legalName: string; gstin: string; address: string }
  price: number | null
  usage: Record<'sms' | 'whatsapp' | 'email', number>
  ledger: LedgerRow[]
  payments: PaymentRow[]
  seq: number
  /** phase 7: closed by the platform (control panel demo) */
  closing_at?: string | null
  purge_after?: string | null
  close_reason?: string | null
}

const key = (t: DemoTenant) => `dch:billing:v1@${t.slug}`
const iso = (ms: number) => new Date(ms).toISOString()
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)

function seed(t: DemoTenant): DemoBilling {
  const now = Date.now()
  if (t.is_primary) {
    return { plan: t.plan ?? 'enterprise', trial_ends_at: null, paid_until: null, suspended: false, wallet_paise: 0, price: null,
      buyer: { legalName: t.name, gstin: '', address: '' }, usage: { sms: 0, whatsapp: 0, email: 0 }, ledger: [], payments: [], seq: 0 }
  }
  // City Care: 5 days into its 14-day trial, ₹250 in the wallet, some messages already sent this month
  const topupAt = iso(now - 4 * 864e5)
  return {
    plan: t.plan ?? 'clinic', trial_ends_at: iso(now + 9 * 864e5), paid_until: null, suspended: false, wallet_paise: 23720, price: null,
    buyer: { legalName: 'City Care Clinic LLP', gstin: '10AAKFC4321M1Z2', address: 'Boring Road, Patna, Bihar 800001' },
    usage: { sms: 108, whatsapp: 214, email: 380 },
    payments: [{ id: 'demo-pay-1', created_at: topupAt, kind: 'wallet', plan: null, months: null, base_paise: 25000, gst_paise: 4500, total_paise: 29500,
      status: 'paid', provider: 'razorpay', method: 'upi', paid_at: topupAt, invoice_no: 'HC/2026-27/000041', period_from: null, period_to: null,
      buyer: { legalName: 'City Care Clinic LLP', gstin: '10AAKFC4321M1Z2', address: 'Boring Road, Patna, Bihar 800001' }, seller: { ...BILLING_DEFAULTS.seller }, payment_id: 'pay_demoCityCare1' }],
    ledger: [
      { id: 'demo-l-2', created_at: iso(now - 864e5), day: iso(now - 864e5).slice(0, 10), kind: 'usage', channel: 'sms', units: 8, amount_paise: -240, balance_paise: 23720, note: null },
      { id: 'demo-l-1', created_at: topupAt, day: topupAt.slice(0, 10), kind: 'topup', channel: null, units: 0, amount_paise: 25000, balance_paise: 25000, note: 'Wallet top-up · HC/2026-27/000041' },
    ] as LedgerRow[],
    seq: 41,
  }
}

export function demoBilling(tenantId: string): DemoBilling | null {
  const t = demoTenantById(tenantId)
  if (!t) return null
  try { const v = localStorage.getItem(key(t)); if (v) return JSON.parse(v) as DemoBilling } catch { /* fresh */ }
  const s = seed(t)
  saveDemoBilling(tenantId, s)
  return s
}
export function saveDemoBilling(tenantId: string, s: DemoBilling) {
  const t = demoTenantById(tenantId)
  if (t) try { localStorage.setItem(key(t), JSON.stringify(s)) } catch { /* private mode */ }
}

export function demoLicense(tenantId: string, canSeeWallet: boolean): LicenseInfo | null {
  const t = demoTenantById(tenantId), b = demoBilling(tenantId)
  if (!t || !b) return null
  const l = computeLicense({ is_primary: t.is_primary, status: b.suspended ? 'suspended' : t.status, trial_ends_at: b.trial_ends_at, paid_until: b.paid_until, closing_at: b.closing_at, purge_after: b.purge_after }, BILLING_DEFAULTS.graceDays)
  return canSeeWallet ? { ...l, wallet_paise: b.wallet_paise } : l
}

const cfgPlan = (b: DemoBilling) => BILLING_DEFAULTS.plans[b.plan as keyof typeof BILLING_DEFAULTS.plans] ?? { price: null, included: { sms: 0, whatsapp: 0, email: 0 } }

export function demoSummary(tenantId: string): BillingSummary | null {
  const t = demoTenantById(tenantId), b = demoBilling(tenantId)
  if (!t || !b) return null
  const c = BILLING_DEFAULTS
  return {
    license: demoLicense(tenantId, false)!, is_primary: !!t.is_primary, plan: b.plan, price: b.price ?? cfgPlan(b).price,
    included: cfgPlan(b).included, rates_paise: c.ratesPaise, wallet_paise: b.wallet_paise, gst_percent: c.gstPercent, yearly_months: c.yearlyMonths,
    min_topup: c.minTopup, max_topup: c.maxTopup, buyer: b.buyer, usage: b.usage,
    plans: c.plans, custom_price: b.price != null, seller: c.seller,
  }
}

/** same as public.billing_usage_history(): earlier months are a fixed made-up pattern, this month is real */
export function demoUsageHistory(tenantId: string, months = 6): UsageMonth[] {
  const b = demoBilling(tenantId)
  if (!b) return []
  const inc = cfgPlan(b).included, rates = BILLING_DEFAULTS.ratesPaise
  const now = new Date(Date.now() + 5.5 * 3600_000)
  const pattern = [0.55, 0.7, 0.62, 0.85, 0.95, 1.1, 0.8, 0.9, 1.05, 0.75, 1.2, 1]
  return Array.from({ length: months }, (_, i) => {
    const back = months - 1 - i
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const sent: Partial<Record<Channel, number>> = back === 0 ? { ...b.usage }
      : { sms: Math.round(118 * pattern[back % 12]), whatsapp: Math.round(260 * pattern[(back + 3) % 12]), email: Math.round(410 * pattern[(back + 5) % 12]) }
    const charged = (['sms', 'whatsapp', 'email'] as Channel[]).reduce((s, ch) => s + Math.max(0, (sent[ch] ?? 0) - (inc[ch] ?? 0)) * (rates[ch] ?? 0), 0)
    return { month: d.toISOString().slice(0, 7), sent, own: back === 0 ? 0 : Math.round(30 * pattern[back % 12]), charged_paise: charged }
  })
}

/** same as public.change_trial_plan() */
export function demoChangeTrialPlan(tenantId: string, plan: string): void {
  const b = demoBilling(tenantId)!
  const p = BILLING_DEFAULTS.plans[plan as keyof typeof BILLING_DEFAULTS.plans]
  if (!p) throw new Error(`Unknown plan ${plan}`)
  if (p.price == null) throw new Error('That plan is priced individually — Hospital Comrade will get in touch.')
  if (b.price != null) throw new Error('Your price was agreed with Hospital Comrade — ask them to change your plan.')
  if ((b.paid_until && Date.parse(b.paid_until) > Date.now()) || !(b.trial_ends_at && Date.parse(b.trial_ends_at) > Date.now())) {
    throw new Error('Your plan is paid — choose the new plan when you renew; it switches when the payment arrives.')
  }
  b.plan = plan
  saveDemoBilling(tenantId, b)
}

const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10)
function addMonths(day: string, months: number) {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10)
}

/** same as public.billing_quote() */
export function demoQuote(tenantId: string, kind: 'plan' | 'wallet', months = 1, amount?: number, plan?: string | null): Quote {
  const b = demoBilling(tenantId)!
  const c = BILLING_DEFAULTS
  const gst = (base: number) => Math.round((base * c.gstPercent) / 100)
  if (kind === 'plan') {
    if (months !== 1 && months !== 12) throw new Error('Choose 1 month or 12 months.')
    const target = plan || b.plan
    if (target !== b.plan) {
      if (!(target in c.plans)) throw new Error(`Unknown plan ${target}`)
      if (b.price != null) throw new Error('Your price was agreed with Hospital Comrade — ask them to change your plan.')
    }
    const price = target === b.plan ? b.price ?? cfgPlan(b).price : c.plans[target as keyof typeof c.plans].price
    if (!price) throw new Error('Your plan is priced individually — Hospital Comrade will send you the payment details.')
    const base = Math.round(price * 100 * (months === 12 ? c.yearlyMonths : 1))
    const end = Math.max(b.paid_until ? Date.parse(b.paid_until) : -Infinity, b.trial_ends_at ? Date.parse(b.trial_ends_at) : -Infinity)
    const from = istDay(Math.max(Date.now(), Number.isFinite(end) ? end : 0))
    const to = new Date(Date.parse(`${addMonths(from, months)}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)
    return { kind, plan: target, months, base_paise: base, gst_paise: gst(base), total_paise: base + gst(base), gst_percent: c.gstPercent, period_from: from, period_to: to }
  }
  if (amount == null || !Number.isFinite(amount) || amount < c.minTopup || amount > c.maxTopup) throw new Error(`Top up between ₹${c.minTopup} and ₹${c.maxTopup.toLocaleString('en-IN')}.`)
  const base = Math.round(amount * 100)
  return { kind, plan: null, months: null, base_paise: base, gst_paise: gst(base), total_paise: base + gst(base), gst_percent: c.gstPercent }
}

const fy = (ms: number) => { const d = new Date(ms + 5.5 * 3600_000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}` }

function credit(b: DemoBilling, kind: LedgerRow['kind'], amount: number, note: string | null) {
  b.wallet_paise += amount
  b.ledger.unshift({ id: uid(), created_at: iso(Date.now()), day: istDay(Date.now()), kind, channel: null, units: 0, amount_paise: amount, balance_paise: b.wallet_paise, note })
}

/** same as public.apply_payment() — returns the invoice number */
export function demoApplyPayment(tenantId: string, q: Quote, provider: 'razorpay' | 'manual', method: string): string {
  const b = demoBilling(tenantId)!
  const now = Date.now()
  b.seq += 1
  const invoice = `HC/${fy(now)}/${String(b.seq).padStart(6, '0')}`
  b.payments.unshift({ id: uid(), created_at: iso(now), kind: q.kind, plan: q.plan ?? null, months: q.months ?? null, base_paise: q.base_paise, gst_paise: q.gst_paise,
    total_paise: q.total_paise, status: 'paid', provider, method, paid_at: iso(now), invoice_no: invoice, period_from: q.period_from ?? null, period_to: q.period_to ?? null,
    buyer: { ...b.buyer }, seller: { ...BILLING_DEFAULTS.seller }, payment_id: provider === 'razorpay' ? `pay_demo${now.toString(36)}` : null })
  if (q.kind === 'plan') {
    if (q.plan) b.plan = q.plan
    const start = Math.max(now, b.paid_until ? Date.parse(b.paid_until) : 0, b.trial_ends_at ? Date.parse(b.trial_ends_at) : 0)
    const d = new Date(start); d.setMonth(d.getMonth() + (q.months ?? 1))
    b.paid_until = d.toISOString()
  } else credit(b, 'topup', q.base_paise, `Wallet top-up · ${invoice}`)
  saveDemoBilling(tenantId, b)
  return invoice
}

/** the platform team's tools (public.provider_billing) */
export function demoProviderBilling(tenantId: string, action: string, args: Record<string, unknown>): void {
  const b = demoBilling(tenantId)!
  const now = Date.now()
  if (action === 'manual_payment') {
    demoApplyPayment(tenantId, demoQuote(tenantId, args.kind === 'wallet' ? 'wallet' : 'plan', Number(args.months) || 1, Number(args.amount), typeof args.plan === 'string' ? args.plan : null), 'manual', String(args.method || 'bank'))
    return
  }
  if (action === 'wallet_adjust') {
    const amt = Number(args.amount)
    if (!amt || Math.abs(amt) > 100000) throw new Error('Enter an amount between -₹1,00,000 and ₹1,00,000.')
    if (!String(args.note ?? '').trim()) throw new Error('Add a note saying why.')
    credit(b, 'adjustment', Math.round(amt * 100), String(args.note).slice(0, 200))
  } else if (action === 'extend_trial') {
    const days = Number(args.days)
    if (!(days >= 1 && days <= 90)) throw new Error('Extend by 1 to 90 days.')
    b.trial_ends_at = iso(Math.max(now, b.trial_ends_at ? Date.parse(b.trial_ends_at) : now) + days * 864e5)
  } else if (action === 'set_plan') {
    if (typeof args.plan === 'string') b.plan = args.plan
    if ('price' in args) b.price = args.price == null || args.price === '' ? null : Number(args.price)
  } else if (action === 'suspend') b.suspended = true
  else if (action === 'resume') b.suspended = false
  // demo only: jump the trial's end to show the grace / read-only banners
  else if (action === 'demo_end_trial') { b.trial_ends_at = iso(now - Number(args.daysAgo ?? 0) * 864e5); b.paid_until = null }
  else throw new Error(`Unknown action ${action}`)
  saveDemoBilling(tenantId, b)
}

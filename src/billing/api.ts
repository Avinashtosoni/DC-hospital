/**
 * Settings → Plan & wallet. With a database: billing_summary / my_billing_quote / set_billing_details /
 * provider_billing RPCs, the billing_payments + wallet_ledger tables (RLS: owner / accountant) and the `billing`
 * Edge Function for Razorpay. Demo mode: ./demo.ts simulates all of it in the browser.
 */
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { activeDemoTenant } from '../tenancy/demo'
import { demoApplyPayment, demoBilling, demoChangeTrialPlan, demoProviderBilling, demoQuote, demoSummary, demoUsageHistory, saveDemoBilling } from './demo'
import type { BillingSummary, LedgerRow, PaymentRow, ProviderBillingAction, Quote, UsageMonth } from './types'

export const BILLING_QK = ['hc-billing'] as const
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const demoId = () => activeDemoTenant().id

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) throw new Error(/does not exist|PGRST202/i.test(error.message) ? 'Billing is not set up in the database yet — run supabase/upgrade-2026-10.sql.' : error.message)
  return data as T
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.functions.invoke('billing', { body })
  if (error) {
    const e = error as { message?: string; context?: Response }
    let msg = e.message ?? 'Request failed'
    try { const j = await e.context?.json?.(); if (j?.error) msg = j.error } catch { /* not json */ }
    if (/Failed to send a request|FunctionsFetchError|not found/i.test(msg)) msg = 'The "billing" Edge Function is not deployed yet — run: supabase functions deploy billing --no-verify-jwt'
    throw new Error(msg)
  }
  return data as T
}

// ------------------------------------------------------------------ Razorpay Standard Checkout
interface RzpOrder { key_id: string; order_id: string; amount: number; currency: string; name: string; description: string }
interface RzpSuccess { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
type RazorpayCtor = new (o: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: { error?: { description?: string } }) => void): void }

let checkoutJs: Promise<RazorpayCtor> | null = null
function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor }
  if (w.Razorpay) return Promise.resolve(w.Razorpay)
  checkoutJs ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Razorpay did not load')))
    s.onerror = () => { checkoutJs = null; reject(new Error('Could not reach Razorpay — check the internet connection and try again.')) }
    document.head.appendChild(s)
  })
  return checkoutJs
}

export class PaymentCancelled extends Error { constructor() { super('Payment cancelled') } }

function checkout(o: RzpOrder, prefill: { name?: string; email?: string; contact?: string }): Promise<RzpSuccess> {
  return loadCheckout().then((Razorpay) => new Promise<RzpSuccess>((resolve, reject) => {
    const rzp = new Razorpay({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: o.name, description: o.description,
      prefill, theme: { color: '#292966' }, retry: { enabled: true },
      handler: (r: RzpSuccess) => resolve(r),
      modal: { ondismiss: () => reject(new PaymentCancelled()), confirm_close: true },
    })
    rzp.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'The payment failed — no money was taken. Please try again.')))
    rzp.open()
  }))
}

// ------------------------------------------------------------------ API
export const billingApi = {
  async summary(): Promise<BillingSummary | null> {
    if (!isSupabaseConfigured) { await wait(150); return demoSummary(demoId()) }
    return rpc<BillingSummary | null>('billing_summary')
  },

  /** plan: renew on another plan (switches when paid) */
  async quote(kind: 'plan' | 'wallet', months = 1, amount?: number, plan?: string | null): Promise<Quote> {
    if (!isSupabaseConfigured) return demoQuote(demoId(), kind, months, amount, plan)
    return rpc<Quote>('my_billing_quote', { p_kind: kind, p_months: months, p_amount: kind === 'wallet' ? amount ?? null : null, p_plan: kind === 'plan' ? plan ?? null : null })
  },

  /** messages per month for the usage chart (oldest first) */
  async usageHistory(months = 6): Promise<UsageMonth[]> {
    if (!isSupabaseConfigured) { await wait(150); return demoUsageHistory(demoId(), months) }
    const rows = await rpc<UsageMonth[]>('billing_usage_history', { p_months: months })
    return (rows ?? []).map((r) => ({ ...r, own: Number(r.own), charged_paise: Number(r.charged_paise) }))
  },

  /** during the free trial only: switch plans straight away */
  async changeTrialPlan(plan: string): Promise<void> {
    if (!isSupabaseConfigured) { await wait(); demoChangeTrialPlan(demoId(), plan); return }
    await rpc('change_trial_plan', { p_plan: plan })
  },

  async payments(): Promise<PaymentRow[]> {
    if (!isSupabaseConfigured) return demoBilling(demoId())?.payments.slice(0, 50) ?? []
    const { data, error } = await supabase!.from('billing_payments' as never).select('id, created_at, kind, plan, months, base_paise, gst_paise, total_paise, status, provider, method, paid_at, invoice_no, period_from, period_to, buyer, seller, payment_id')
      .neq('status', 'created').order('created_at', { ascending: false }).limit(50)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as PaymentRow[]
  },

  async ledger(): Promise<LedgerRow[]> {
    if (!isSupabaseConfigured) return demoBilling(demoId())?.ledger.slice(0, 100) ?? []
    const { data, error } = await supabase!.from('wallet_ledger' as never).select('id, created_at, day, kind, channel, units, amount_paise, balance_paise, note')
      .order('created_at', { ascending: false }).limit(100)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as LedgerRow[]).map((r) => ({ ...r, amount_paise: Number(r.amount_paise), balance_paise: Number(r.balance_paise) }))
  },

  /** whether real online payment is available (Razorpay keys on the server); demo → simulated */
  async onlineEnabled(): Promise<'live' | 'demo' | 'off'> {
    if (!isSupabaseConfigured) return 'demo'
    try { return (await invoke<{ enabled: boolean }>({ action: 'config' })).enabled ? 'live' : 'off' } catch { return 'off' }
  },

  /** pay for a plan renewal or a wallet top-up; resolves with the invoice number */
  async pay(kind: 'plan' | 'wallet', opts: { months?: number; amount?: number; plan?: string | null }, prefill: { name?: string; email?: string; contact?: string } = {}): Promise<string> {
    if (!isSupabaseConfigured) {
      const q = demoQuote(demoId(), kind, opts.months ?? 1, opts.amount, opts.plan)
      await wait(900)
      return demoApplyPayment(demoId(), q, 'razorpay', 'upi')
    }
    const order = await invoke<RzpOrder>({ action: 'order', kind, months: opts.months ?? 1, amount: opts.amount, plan: kind === 'plan' ? opts.plan ?? undefined : undefined })
    const r = await checkout(order, prefill)
    const done = await invoke<{ invoice_no: string }>({ action: 'verify', order_id: r.razorpay_order_id, payment_id: r.razorpay_payment_id, signature: r.razorpay_signature })
    return done.invoice_no
  },

  async saveDetails(d: { legalName: string; gstin: string; address: string }): Promise<void> {
    if (!isSupabaseConfigured) {
      const gstin = d.gstin.replace(/\s/g, '').toUpperCase()
      if (gstin && !/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new Error('That GSTIN does not look right (15 characters, e.g. 10ABCDE1234F1Z5).')
      const b = demoBilling(demoId())!
      b.buyer = { legalName: d.legalName.trim(), gstin, address: d.address.trim() }
      saveDemoBilling(demoId(), b)
      return
    }
    await rpc('set_billing_details', { p_legal_name: d.legalName, p_gstin: d.gstin, p_address: d.address })
  },

  /** Hospital Comrade team: manual payment, wallet adjustment, trial, plan, suspend */
  async provider(action: ProviderBillingAction, args: Record<string, unknown> = {}): Promise<void> {
    if (!isSupabaseConfigured) { await wait(); demoProviderBilling(demoId(), action, args); return }
    await rpc('provider_billing', { p_action: action, p_args: args })
  },
}

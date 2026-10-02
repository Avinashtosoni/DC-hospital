/**
 * Hospital Comrade billing defaults (phase 4). Written into public.platform_settings ('billing') on install —
 * after that the database copy is what counts (a Hospital Comrade admin can change it). Plan prices and the
 * messages included per month come from plans.ts, so the product page and the bills always agree.
 */
import { PLANS, type Plan } from './plans'

export interface BillingConfig {
  currency: 'INR'
  /** GST added on top of every price */
  gstPercent: number
  /** free trial for a new hospital */
  trialDays: number
  /** days after the plan / trial ends during which everything still works (with a banner) before read-only */
  graceDays: number
  /** a yearly plan costs this many months */
  yearlyMonths: number
  /** wallet top-up limits, ₹ */
  minTopup: number
  maxTopup: number
  /** price per message beyond the plan's included messages, in paise */
  ratesPaise: { sms: number; whatsapp: number; email: number }
  plans: Record<Plan['id'], { price: number | null; included: Plan['included'] }>
  /** printed on Hospital Comrade's tax invoices */
  seller: { name: string; gstin: string; address: string; state: string; email: string }
}

export const BILLING_DEFAULTS: BillingConfig = {
  currency: 'INR',
  gstPercent: 18,
  trialDays: 14,
  graceDays: 7,
  yearlyMonths: 10,
  minTopup: 500,
  maxTopup: 100000,
  ratesPaise: { sms: 30, whatsapp: 40, email: 2 },
  plans: Object.fromEntries(PLANS.map((p) => [p.id, { price: p.price, included: p.included }])) as BillingConfig['plans'],
  seller: { name: 'Digital Comrade', gstin: '', address: '', state: 'Bihar', email: '' },
}

/** ₹ amounts with paise → "₹1,178.82" */
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

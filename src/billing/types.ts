import type { LicenseInfo } from './license'

export type Channel = 'sms' | 'whatsapp' | 'email'

/** public.billing_summary() */
export interface BillingSummary {
  license: LicenseInfo
  is_primary: boolean
  plan: string
  /** monthly ₹ (custom price or the plan's); null = priced individually */
  price: number | null
  included: Partial<Record<Channel, number>>
  rates_paise: Partial<Record<Channel, number>>
  wallet_paise: number
  gst_percent: number
  yearly_months: number
  min_topup: number
  max_topup: number
  buyer: { legalName: string; gstin: string; address: string }
  /** this month's messages on Hospital Comrade's shared accounts */
  usage: Partial<Record<Channel, number>>
  /** phase 6 — the plan picker: every plan's monthly price (null = priced individually) and allowance */
  plans?: Record<string, { price: number | null; included: Partial<Record<Channel, number>> }>
  /** a price agreed with the team — the owner can't switch plans themselves */
  custom_price?: boolean
  /** printed on new invoices (paid invoices keep their own copy) */
  seller?: Seller
}

export interface Seller { name: string; gstin: string; address: string; state: string; email: string; sac?: string }

/** public.billing_usage_history() — one row per month, oldest first */
export interface UsageMonth {
  month: string               // YYYY-MM
  sent: Partial<Record<Channel, number>>
  own: number                 // sent on the hospital's own accounts (free)
  charged_paise: number       // charged to the wallet beyond the allowance
}

/** public.billing_quote() */
export interface Quote {
  kind: 'plan' | 'wallet'
  plan?: string | null
  months?: number | null
  base_paise: number
  gst_paise: number
  total_paise: number
  gst_percent: number
  period_from?: string | null
  period_to?: string | null
}

export interface LedgerRow {
  id: string
  created_at: string
  day: string
  kind: 'topup' | 'usage' | 'refund' | 'adjustment'
  channel: Channel | null
  units: number
  amount_paise: number
  balance_paise: number
  note: string | null
}

export interface PaymentRow {
  id: string
  created_at: string
  kind: 'plan' | 'wallet'
  plan: string | null
  months: number | null
  base_paise: number
  gst_paise: number
  total_paise: number
  status: 'created' | 'paid' | 'failed' | 'refunded'
  provider: 'razorpay' | 'manual'
  method: string | null
  paid_at: string | null
  invoice_no: string | null
  period_from: string | null
  period_to: string | null
  /** buyer / seller as printed on the invoice when it was paid */
  buyer?: { legalName?: string; gstin?: string; address?: string } | null
  seller?: Seller | null
  payment_id?: string | null
}

export type ProviderBillingAction = 'manual_payment' | 'wallet_adjust' | 'extend_trial' | 'set_plan' | 'suspend' | 'resume'

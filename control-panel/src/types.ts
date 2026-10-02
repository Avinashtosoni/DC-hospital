import type { LicenseInfo } from '../../src/billing/license'
import type { PaymentRow } from '../../src/billing/types'
import type { BillingConfig } from '../../src/platform/billing'
import type { ProviderRole } from '../../src/tenancy/state'

export type { ProviderRole, BillingConfig }
export type ModuleMap = Record<string, 'provider' | 'hospital'>

export interface CpMe { user_id: string; role: ProviderRole; email: string; full_name: string }

export interface CpHospital {
  id: string
  slug: string
  name: string
  code: string
  plan: string
  is_primary: boolean
  notes: string | null
  created_at: string
  modules: ModuleMap
  license: LicenseInfo
  wallet_paise: number
  /** monthly price, ₹ before GST (null = priced individually) */
  price: number | null
  billing?: Record<string, unknown> | null
  domain: string | null
  staff: number
  patients: number
  owner_joined: boolean
  owner_email: string | null
  /** platform messages this month */
  messages: number
}

export interface CpDomain { domain: string; is_primary: boolean; method?: string | null; status?: string | null; ssl_status?: string | null; verified_at?: string | null }
export interface CpHospitalDetail extends CpHospital {
  domains: CpDomain[]
  team: { user_id: string; role: ProviderRole; name: string }[]
  /** "channel:source" → messages this month */
  usage: Record<string, number>
  payments: PaymentRow[]
}

export interface CpOverview {
  hospitals: number
  by_status: Record<string, number>
  by_plan: Record<string, number>
  mrr: number
  wallet_paise: number
  attention: { id: string; name: string; status: string; until: string | null; read_only_from: string | null }[]
  payments_30d_paise: number | null
  messages: Record<string, number>
  leads_new: number | null
}

export interface CpMember {
  user_id: string
  email: string
  name: string
  role: ProviderRole
  active: boolean
  since: string
  hospitals: { id: string; name: string }[]
  last_action: string | null
}

export type LeadStatus = 'new' | 'contacted' | 'won' | 'lost'
export interface CpLead {
  id: string
  created_at: string
  name: string
  organisation: string
  phone: string
  email: string | null
  city: string | null
  plan: string | null
  message: string | null
  source: string | null
  status: LeadStatus
  notes: string | null
}

export interface CpPayment extends PaymentRow { tenant_id: string; hospital: string; payment_id?: string | null }

export interface CpAudit {
  id: string
  at: string
  user_name: string | null
  mode: string | null
  tenant_id: string | null
  hospital: string | null
  action: string
  target: string | null
  detail: Record<string, unknown> | null
}

export interface NewHospital {
  slug: string
  name: string
  code: string
  plan: string
  owner_email: string
  domain: string
  status: 'trial' | 'active'
  trial_days: number
  months: number
  modules: ModuleMap
  notes: string
}

export interface HospitalEdit { name?: string; code?: string; notes?: string; modules?: ModuleMap; owner_email?: string }
export interface MemberSave { email: string; role: ProviderRole; active: boolean; hospitals: string[] }
export type BillingAction = 'manual_payment' | 'wallet_adjust' | 'extend_trial' | 'set_plan' | 'suspend' | 'resume'

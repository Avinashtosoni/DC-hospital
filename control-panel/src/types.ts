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
  /** phase 7: closed by the platform — read-only now, deletable after purge_after */
  closing_at?: string | null
  purge_after?: string | null
  close_reason?: string | null
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

// ------------------------------------------------------------------ phase 7: health, incidents, retention
export interface CpHealth {
  at: string
  extensions: { pg_cron: boolean; pg_net: boolean }
  jobs: { name: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null; last_message: string | null }[]
  /** last 24 hours, per hospital */
  messages: { id: string; name: string; sent: number; failed: number; waiting: number; stuck: number }[]
  recent_failures: { at: string; hospital: string; event: string; channel: string; error: string | null }[]
  payments: { abandoned_7d: number; failed_7d: number; paid_7d: number }
  database: { size_bytes: number | null; largest_tables: { table: string; bytes: number }[] }
  hospitals: { id: string; name: string; closing_at: string | null; purge_after: string | null; patients: number; appointments: number; invoices: number; audit_log: number }[]
  retention: { at: string; deleted: Record<string, number> } | null
  privacy_open: number
  privacy_overdue: number
  incidents_open: number
}

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type IncidentStatus = 'open' | 'contained' | 'resolved'
export interface CpIncident {
  id: string
  created_at: string
  updated_at: string
  detected_at: string
  title: string
  description: string | null
  severity: Severity
  status: IncidentStatus
  personal_data: boolean
  affected_tenants: string[]
  affected_people: number | null
  board_reported_at: string | null
  hospitals_notified_at: string | null
  resolved_at: string | null
  timeline: { at: string; by: string | null; note: string }[]
  created_by_name: string | null
  /** detected_at + 72 hours (DPDP Rules: report to the Data Protection Board) */
  deadline: string
  hospitals: { id: string; name: string; slug: string }[]
}
export interface IncidentSave {
  id?: string
  title?: string
  description?: string | null
  severity?: Severity
  status?: IncidentStatus
  personal_data?: boolean
  affected_tenants?: string[]
  affected_people?: number | null
  detected_at?: string
  note?: string
  board_reported?: boolean
}
export interface IncidentNotice { id: string; name: string; owner_email: string | null; queued: number }

export const RETENTION_KEYS = ['auditDays', 'providerAuditDays', 'outboxDays', 'otpDays', 'enquiryDays', 'leadDays', 'privacyDays', 'waSessionDays'] as const
export type RetentionKey = (typeof RETENTION_KEYS)[number]
export type RetentionConfig = Partial<Record<RetentionKey, number>> & { last_run?: { at: string; deleted: Record<string, number> } }
/** same minimums as cp_save_retention() */
export const RETENTION_MIN: Record<RetentionKey, number> = { auditDays: 365, providerAuditDays: 365, outboxDays: 30, otpDays: 1, enquiryDays: 30, leadDays: 30, privacyDays: 365, waSessionDays: 1 }
export const RETENTION_DEFAULTS: Record<RetentionKey, number> = { auditDays: 1095, providerAuditDays: 1095, outboxDays: 400, otpDays: 7, enquiryDays: 1095, leadDays: 1095, privacyDays: 1095, waSessionDays: 30 }

// ------------------------------------------------------------------ phase 8.2 — self-service sign-up
export type SignupStatus = 'pending' | 'created' | 'rejected' | 'expired'
export interface CpSignup {
  id: string
  created_at: string
  organisation: string
  contact_name: string
  email: string
  phone: string
  city: string | null
  plan: string
  trial_days: number
  slug: string
  code: string
  status: SignupStatus
  hospital_id: string | null
  hospital_slug?: string | null
  owner_joined?: boolean
  terms_version: string
  decided_at: string | null
  decided_by_name: string | null
  reason: string | null
}
export interface SignupSettings {
  enabled: boolean
  mode: 'instant' | 'approve'
  trialDays: number
  plan: string
  maxPerDay: number
  unclaimedDays: number
  /** the product site's address, used in the welcome e-mail's link */
  platformUrl: string
  pending?: number
}
export const SIGNUP_DEFAULTS: SignupSettings = { enabled: true, mode: 'approve', trialDays: 14, plan: 'clinic', maxPerDay: 25, unclaimedDays: 14, platformUrl: '' }

// ------------------------------------------------------------------ phase 8.3 — launch checklist
export interface LaunchCheck { id: string; title: string; status: 'ok' | 'warn' | 'fail'; detail: string }
export interface LaunchReport { at: string; checks: LaunchCheck[] }

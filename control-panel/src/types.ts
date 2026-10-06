import type { OtpStatus, OtpChannelId } from '../../src/data/errors'
import type { LicenseInfo } from '../../src/billing/license'
import type { PaymentRow } from '../../src/billing/types'
import type { BillingConfig } from '../../src/platform/billing'
import type { ProviderRole } from '../../src/tenancy/state'

export type { ProviderRole, BillingConfig }
export type ModuleMap = Record<string, 'provider' | 'hospital'>

export interface CpMe {
  user_id: string; role: ProviderRole; email: string; full_name: string
  /** team sign-in OTP (Platform settings → Security); passed = false → only the code screen until it is entered */
  otp?: OtpStatus | null
}
export type { OtpStatus, OtpChannelId }
/** Platform settings → Security */
export interface CpSecurity {
  loginOtp: { enabled: boolean; channels: OtpChannelId[] }
  /** active team members and where a code can reach each one */
  team: { user_id: string; email: string; role: ProviderRole; channels: OtpChannelId[] }[]
}
/** Hospital → Security: that hospital's OTP switches */
export interface CpHospitalOtp {
  otp: { login: { enabled: boolean; channels: OtpChannelId[]; roles: 'staff' | 'all' }; booking: { enabled: boolean; channels: OtpChannelId[] | null } }
  channels_on: Record<OtpChannelId, boolean>
  /** accounts the sign-in code applies to, and how many of them a code can reach */
  people: number; reachable: number
}

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

// ------------------------------------------------------------------ hospital operations (control_panel_ops.sql)
export interface HospitalProfile {
  name: string; tagline: string; address: string; phone: string; appointmentsPhone: string; whatsapp: string; email: string
  logoUrl: string; legalName: string; gstin: string; pan: string; billingAddress: string
}
export type HospitalUserRole = 'owner' | 'doctor' | 'receptionist' | 'accountant' | 'staff' | 'patient'
export interface HospitalUser {
  id: string; full_name: string; email: string | null; phone: string | null; role: HospitalUserRole
  created_at: string; blocked: boolean; last_sign_in_at: string | null
}
export interface HospitalInvite { id: string; full_name: string; email: string; phone: string | null; role: HospitalUserRole; token: string; expires_at: string; created_at: string }
export interface HospitalUsers { total: number; rows: HospitalUser[]; invites: HospitalInvite[] }
export type UserAction = 'create' | 'update' | 'disable' | 'enable' | 'delete' | 'invite' | 'revoke_invite' | 'password_reset'
export interface HospitalData {
  counts: Record<string, number>; users: number; appointments_30d: number; admitted_now: number
  billed_30d: number; outstanding: number; last_activity: string | null
}
export type BrowseKind = 'patients' | 'doctors' | 'appointments' | 'invoices'
export interface BrowsePage { total: number; rows: Record<string, unknown>[] }
export interface ImportResult { dry_run: boolean; imported: number; duplicates: number; failed: number; errors: { row: number; error: string }[] }
export type Channel = 'sms' | 'whatsapp' | 'email'
export interface HospitalMessaging {
  channels: Record<Channel, { enabled: boolean; source: 'own' | 'platform' }>
  monthlyLimit: Partial<Record<Channel, number>>
  included: Partial<Record<Channel, number>>
  usage: Record<string, { sent: number; failed: number }>
  pending: Partial<Record<Channel, number>>
  wallet_paise: number
  is_primary: boolean
}
export interface WalletRow { id: string; created_at: string; day: string; kind: 'topup' | 'usage' | 'refund' | 'adjustment'; channel: string | null; units: number; amount_paise: number; balance_paise: number; note: string | null; invoice_no: string | null }
export interface CreditNote {
  id: string; tenant_id: string; payment_id: string; credit_no: string; created_at: string
  base_paise: number; gst_paise: number; total_paise: number; mode: 'wallet' | 'refund'; reason: string
  seller: Record<string, string> | null; buyer: Record<string, string> | null; created_by_name: string | null
  invoice_no: string; invoice_date: string | null; kind: 'plan' | 'wallet'; plan: string | null; months: number | null; hospital?: string
}
export type AnnouncementLevel = 'info' | 'warning' | 'critical'
export interface Announcement {
  id: string; title: string; body: string; level: AnnouncementLevel; hospital_ids: string[] | null; roles: string[]
  starts_at: string; ends_at: string | null; active: boolean; created_by_name: string | null; created_at: string
  hospitals: { id: string; name: string }[]; live: boolean
}
export interface AnnouncementSave { id?: string; title: string; body: string; level: AnnouncementLevel; hospital_ids: string[] | null; roles: string[]; starts_at?: string | null; ends_at?: string | null; active: boolean }
export interface ImpersonationRow {
  id: string; admin_name: string | null; target_email: string; target_role: string; reason: string; created_at: string; expires_at: string
  bound_at: string | null; ended_at: string | null; end_reason: string | null; hospital: string; hospital_id: string; active: boolean
}

// ------------------------------------------------------------------ platform website CMS (platform_cms.sql)
export interface SitePageRow { key: string; data: unknown; draft: unknown; published_at: string | null; published_by: string | null; updated_at: string; updated_by: string | null }
export interface SiteState { canEdit: boolean; pages: SitePageRow[] }
export interface SiteRevision { id: string; key: string; data: unknown; created_at: string; created_by: string | null }
export interface CpPost {
  id: string; slug: string; title: string; excerpt: string; cover: string | null; body: string; tags: string[]; author: string | null
  status: 'draft' | 'published'; published_at: string | null; seo: { title?: string; description?: string }; created_at: string; updated_at: string; updated_by: string | null
}
export type PostSave = Omit<CpPost, 'id' | 'created_at' | 'updated_at' | 'updated_by'> & { id?: string }

// ------------------------------------------------------------------ messaging & alerts, broadcasts, live health (cp_notify.sql)
export type AlertChannel = 'bell' | 'email' | 'push' | 'whatsapp'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export interface MessagingSetup {
  /** PLATFORM_* plain settings (provider names, sender IDs, Firebase web config) */
  settings: Record<string, string>
  /** saved API keys — never the value, only the last 4 characters */
  secrets: { key: string; hint: string; updated_at: string; updated_by_name: string | null }[]
  templates: Record<string, PlatformTemplateIds>
  vault: boolean
}
export interface PlatformTemplateIds { waTemplate?: string; waParams?: string; smsTemplateId?: string }
export interface CpAlert { id: string; created_at: string; event: string; severity: AlertSeverity; title: string; body: string; link: string | null; read_at: string | null }
export interface CpAlertPrefs {
  channels: Record<AlertChannel, boolean>
  events: { key: string; label: string; group: string; severity: AlertSeverity; roles: string[]; enabled: boolean; mine: AlertChannel[] }[]
  whatsapp: string | null
  devices: number
}
export interface OpsThresholds { queueBacklog: number; failurePct: number; dbPct: number; dbLimitMb: number; latencyMs: number; walletLowPaise: number; trialDays: number
  connPct: number; storagePct: number; storageLimitMb: number; webhookHours: number; sslDays: number }
export interface OpsSettings {
  channels: Record<AlertChannel, boolean>
  events: Record<string, { enabled: boolean; severity: AlertSeverity }>
  thresholds: OpsThresholds
  health: { enabled: boolean; siteUrl: string }
  catalog: { key: string; label: string; group: string; severity: AlertSeverity; roles: string[] }[]
}
export type BroadcastChannel = 'inapp' | 'email' | 'sms' | 'whatsapp' | 'push'
export interface BroadcastAudience { hospitals: string[] | null; plans: string[]; statuses: string[]; roles: string[] }
export interface BroadcastSave { id?: string; title: string; body: string; link: string; level: AlertSeverity; channels: BroadcastChannel[]; audience: BroadcastAudience }
export interface Broadcast extends Omit<BroadcastSave, 'id' | 'link'> {
  id: string; link: string | null; status: 'draft' | 'scheduled' | 'sent' | 'cancelled'; scheduled_at: string | null; sent_at: string | null
  stats: Partial<Record<BroadcastChannel, number>>; created_by_name: string | null; created_at: string
  delivery: Partial<Record<BroadcastChannel, { sent: number; failed: number; pending: number }>>
}
export interface BroadcastPreview { hospitals: number; people: number; email: number; sms: number; whatsapp: number; push: number; sample: string[] }
export interface DeliveryRow {
  source: 'hospital' | 'platform'; id: string; created_at: string; hospital_id: string | null; hospital: string | null; kind: string; channel: Channel | 'push'
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; attempts: number; error: string | null; provider_ref: string | null; recipient: string; subject: string | null; sent_at: string | null
}
export interface DeliveryFilter { status?: string; source?: string; channel?: string; hospital?: string; q?: string }
export type HealthStatus = 'ok' | 'warn' | 'fail' | 'off'
export interface LiveService {
  service: string; label: string; group: string | null; status: HealthStatus; since: string; last_checked_at: string; latency_ms: number | null; detail: string | null
  uptime24: number | null; uptime7d: number | null; hours: { h: string; ok: number; n: number; ms: number | null }[]
  days: { d: string; ok: number; n: number; ms: number | null }[]
}
export interface LiveHealth { last_run: string | null; settings: { enabled: boolean; siteUrl: string }; services: LiveService[]; failures: { at: string; service: string; label: string; status: HealthStatus; detail: string | null }[] }
export interface PushConfig { apiKey: string; projectId: string; messagingSenderId: string; appId: string; vapidKey: string; devices: number }

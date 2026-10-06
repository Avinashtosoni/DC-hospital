/**
 * Control panel data: the cp_* database functions (scripts/sql/control_panel.sql).
 */
import { supabase } from '../../src/lib/supabase'
import type {
  BillingAction, BillingConfig, CpAudit, CpHospital, CpHospitalDetail, CpLead, CpMe, CpMember, CpOverview, CpPayment,
  HospitalEdit, LeadStatus, MemberSave, NewHospital, CpHealth, CpIncident, IncidentSave, IncidentNotice, RetentionConfig,
  CpSignup, SignupSettings, LaunchReport, HospitalProfile, HospitalUsers, UserAction, HospitalData, BrowseKind, BrowsePage,
  ImportResult, HospitalMessaging, Channel, WalletRow, CreditNote, Announcement, AnnouncementSave, ImpersonationRow,
  SiteState, SitePageRow, SiteRevision, CpPost, PostSave,
  MessagingSetup, PlatformTemplateIds, CpAlert, CpAlertPrefs, AlertChannel, OpsSettings, Broadcast, BroadcastSave, BroadcastPreview, BroadcastChannel, BroadcastAudience,
  DeliveryRow, DeliveryFilter, LiveHealth, PushConfig, HealthStatus, OtpChannelId, CpSecurity, CpHospitalOtp, CpDemo, CpTemplates, PlatformTemplate,
} from './types'
import { encodeImpersonation } from '../../src/auth/impersonation'
import { hospitalUrl } from '../../src/tenancy/urls'
import { carryLoginOtp, currentSessionId, requestLoginOtp, verifyLoginOtp, type OtpSent } from '../../src/auth/loginOtp'

export interface CpApi {
  signIn(email: string, password: string): Promise<CpMe>
  signOut(): Promise<void>
  me(): Promise<CpMe | null>
  overview(): Promise<CpOverview>
  hospitals(): Promise<CpHospital[]>
  hospital(id: string): Promise<CpHospitalDetail>
  createHospital(h: NewHospital): Promise<{ id: string; slug: string; domain: string | null; owner_email: string }>
  updateHospital(id: string, patch: HospitalEdit): Promise<CpHospital>
  billing(id: string, action: BillingAction, args: Record<string, unknown>): Promise<unknown>
  team(): Promise<CpMember[]>
  saveMember(m: MemberSave): Promise<void>
  leads(): Promise<CpLead[]>
  updateLead(id: string, patch: { status?: LeadStatus; notes?: string | null }): Promise<void>
  payments(tenantId?: string): Promise<CpPayment[]>
  audit(tenantId?: string): Promise<CpAudit[]>
  settings(): Promise<{ billing: BillingConfig }>
  saveBillingSettings(patch: Partial<BillingConfig>): Promise<BillingConfig>
  // phase 7 — offboarding, health, incidents, retention
  closeHospital(id: string, reason: string, days: number): Promise<unknown>
  reopenHospital(id: string): Promise<unknown>
  /** re-checks the signed-in admin's password first (the database wants a sign-in from the last 10 minutes) */
  purgeHospital(id: string, confirmSlug: string, password: string): Promise<{ purged: string; counts: Record<string, number> }>
  health(): Promise<CpHealth>
  incidents(): Promise<CpIncident[]>
  saveIncident(p: IncidentSave): Promise<CpIncident>
  notifyIncident(id: string, message: string): Promise<IncidentNotice[]>
  retention(): Promise<RetentionConfig>
  saveRetention(p: Partial<RetentionConfig>): Promise<RetentionConfig>
  runRetention(): Promise<Record<string, number>>
  // phase 8.2 — self-service free-trial sign-ups
  signups(): Promise<CpSignup[]>
  decideSignup(id: string, action: 'approve' | 'reject', reason?: string): Promise<CpSignup>
  signupSettings(): Promise<SignupSettings>
  saveSignupSettings(p: Partial<SignupSettings>): Promise<SignupSettings>
  // phase 8.3
  launchCheck(): Promise<LaunchReport>
  // hospital operations (control_panel_ops.sql)
  profile(id: string): Promise<HospitalProfile>
  saveProfile(id: string, patch: Partial<HospitalProfile>): Promise<HospitalProfile>
  transferOwner(id: string, userId: string, oldRole: string): Promise<{ owner: string }>
  resendOwnerInvite(id: string): Promise<{ email: string; path: string; link: string | null; queued: number }>
  users(id: string, search?: string, role?: string, offset?: number): Promise<HospitalUsers>
  userAction(id: string, action: UserAction, userId?: string | null, args?: Record<string, unknown>): Promise<{ ok: true; user_id: string | null; email: string | null; invite_id: string | null; token: string | null }>
  /** records it, then asks Supabase Auth to e-mail the reset link (to the hospital's own website) */
  sendPasswordReset(id: string, userId: string, email: string, redirectTo: string): Promise<void>
  data(id: string): Promise<HospitalData>
  browse(id: string, kind: BrowseKind, search: string, offset: number, limit?: number): Promise<BrowsePage>
  importRows(id: string, kind: 'patients' | 'doctors', rows: Record<string, string>[], dryRun: boolean): Promise<ImportResult>
  messaging(id: string): Promise<HospitalMessaging>
  saveMessaging(id: string, patch: { channels?: Partial<Record<Channel, { enabled?: boolean; source?: string }>>; monthlyLimit?: Partial<Record<Channel, number | null>> }): Promise<HospitalMessaging>
  domains(id: string, action: 'list' | 'check' | 'add' | 'remove' | 'primary', args?: Record<string, unknown>): Promise<unknown>
  walletLedger(id: string): Promise<WalletRow[]>
  creditNotes(tenantId?: string): Promise<CreditNote[]>
  creditNote(paymentId: string, args: { amount?: number | null; reason: string; mode: 'wallet' | 'refund' }): Promise<CreditNote>
  // platform website CMS
  site(): Promise<SiteState>
  siteSave(key: string, data: unknown, publish: boolean): Promise<SitePageRow>
  siteDiscard(key: string): Promise<void>
  siteReset(key: string): Promise<void>
  siteHistory(key: string): Promise<SiteRevision[]>
  siteRestore(revId: string): Promise<SitePageRow>
  posts(): Promise<CpPost[]>
  savePost(p: PostSave): Promise<CpPost>
  deletePost(id: string): Promise<void>
  announcements(): Promise<Announcement[]>
  saveAnnouncement(a: AnnouncementSave): Promise<Announcement>
  deleteAnnouncement(id: string): Promise<void>
  /** re-checks the admin's password, starts the session (impersonate Edge Function) and returns the address to open */
  impersonate(userId: string, reason: string, password: string): Promise<{ url: string; expires_at: string; email: string }>
  impersonations(): Promise<ImpersonationRow[]>
  // the public demo hospital (demo.sql)
  demo(): Promise<CpDemo>
  saveDemo(p: Record<string, unknown>): Promise<CpDemo>
  resetDemo(): Promise<CpDemo>
  saveDemoBaseline(): Promise<CpDemo>
  // messaging & alerts, broadcasts, live health (cp_notify.sql + the ops Edge Function)
  messagingSetup(): Promise<MessagingSetup>
  /** API keys need the admin's password again (the database wants a sign-in from the last 10 minutes) */
  saveMessagingSetup(settings: Record<string, string>, secrets: Record<string, string>, password?: string): Promise<MessagingSetup>
  saveTemplates(t: Record<string, PlatformTemplateIds>): Promise<Record<string, PlatformTemplateIds>>
  /** the template library (notify_catalog.sql): saved edits, how many hospitals reworded each, sends in 30 days */
  templates(): Promise<CpTemplates>
  saveTemplate(key: string, p: Partial<PlatformTemplate>): Promise<PlatformTemplate>
  /** custom: deleted; built-in: back to the default */
  deleteTemplate(key: string): Promise<void>
  testMessage(channel: 'sms' | 'whatsapp' | 'email' | 'push', to: string): Promise<{ ok: boolean; message: string }>
  /** the notify function's view of the shared accounts — proves which keys the Edge Functions can see */
  platformStatus(): Promise<{ platform: Record<string, string | null> }>
  deliveryLog(f: DeliveryFilter): Promise<DeliveryRow[]>
  retryMessage(source: 'hospital' | 'platform', id: string): Promise<void>
  alerts(unreadOnly?: boolean, limit?: number): Promise<{ unread: number; items: CpAlert[] }>
  readAlerts(ids?: string[]): Promise<number>
  unreadAlerts(ids: string[]): Promise<number>
  alertPrefs(): Promise<CpAlertPrefs>
  saveAlertPrefs(p: { events?: Record<string, AlertChannel[]>; whatsapp?: string | null }): Promise<CpAlertPrefs>
  opsSettings(): Promise<OpsSettings>
  saveOpsSettings(p: Partial<Omit<OpsSettings, 'catalog'>>): Promise<OpsSettings>
  pushConfig(): Promise<PushConfig | null>
  registerPush(token: string): Promise<number>
  unregisterPush(token?: string): Promise<number>
  broadcasts(): Promise<Broadcast[]>
  broadcastPreview(a: BroadcastAudience, channels: BroadcastChannel[]): Promise<BroadcastPreview>
  saveBroadcast(b: BroadcastSave): Promise<Broadcast>
  sendBroadcast(id: string, at?: string | null): Promise<Broadcast>
  cancelBroadcast(id: string): Promise<Broadcast | null>
  liveHealth(): Promise<LiveHealth>
  checkNow(): Promise<unknown>
  /** Platform settings → Integrations: check one account now (stored as a health check) */
  checkIntegration(id: 'razorpay' | 'sms' | 'whatsapp' | 'email' | 'push'): Promise<{ ok: boolean; check: { status: HealthStatus; detail?: string; latency_ms?: number } }>
  /** for each key: saved in the panel / set as an Edge secret (never the value) */
  keySources(keys: string[]): Promise<{ sources: Record<string, { panel: boolean; edge: boolean }> }>
  /** team sign-in OTP: send this session's code now / check it (then cp_me says passed) */
  requestOtp(channel: OtpChannelId | null): Promise<OtpSent>
  verifyOtp(code: string): Promise<CpMe | null>
  /** Platform settings → Security */
  security(): Promise<CpSecurity>
  saveSecurity(p: { loginOtp: Partial<CpSecurity['loginOtp']> }): Promise<CpSecurity>
  /** Hospital → Security: that hospital's OTP switches */
  hospitalOtp(id: string): Promise<CpHospitalOtp>
  setHospitalOtp(id: string, p: { login?: Partial<CpHospitalOtp['otp']['login']>; booking?: Partial<CpHospitalOtp['otp']['booking']> }): Promise<CpHospitalOtp>
}

/** Postgres / PostgREST error → a sentence for people */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  if (/JWT|not authenticated|refresh token/i.test(m)) return 'Your session has expired — please sign in again.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the server. Check your connection and try again.'
  if (/REAUTH_REQUIRED/.test(m)) return 'Please confirm your password again — this action needs a fresh sign-in.'
  return m.replace(/^(error:\s*)/i, '').replace(/^OTP_SETUP:\s*/, '')
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** a fresh password sign-in puts a new "password" time in the token, which the database checks for risky actions */
async function reauth(password: string) {
  const { data } = await supabase!.auth.getUser()
  const email = data.user?.email
  if (!email) throw new Error('Your session has expired — please sign in again.')
  const before = await currentSessionId()
  const { error } = await supabase!.auth.signInWithPassword({ email, password })
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong password.' : error.message)
  await carryLoginOtp(before)   // the new session keeps this device's verified sign-in code
}

/** Edge Function errors carry the real message in the JSON body */
async function invoke<T>(name: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<T> {
  const { data, error } = await supabase!.functions.invoke(name, { body, headers })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error || j?.message) msg = j.error || j.message } catch { /* not JSON */ }
    if (/Failed to send a request|not found|404/i.test(msg)) msg = `The "${name}" Edge Function is not deployed yet (supabase functions deploy ${name}).`
    throw new Error(msg)
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) throw new Error((data as { error: string }).error)
  return data as T
}

const db: CpApi = {
  async signIn(email, password) {
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong e-mail or password.' : error.message)
    const me = await rpc<CpMe | null>('cp_me')
    if (!me) {
      await supabase!.auth.signOut()
      throw new Error('This account is not on the Hospital Comrade team. Hospital staff sign in on their hospital’s website.')
    }
    return me
  },
  async signOut() { await supabase!.auth.signOut() },
  async me() {
    if (!supabase) return null
    const { data } = await supabase!.auth.getSession()
    if (!data.session) return null
    return rpc<CpMe | null>('cp_me')
  },
  overview: () => rpc('cp_overview'),
  hospitals: () => rpc('cp_hospitals'),
  hospital: (id) => rpc('cp_hospital', { p_id: id }),
  createHospital: (h) => rpc('cp_create_hospital', { p: h }),
  updateHospital: (id, patch) => rpc('cp_update_hospital', { p_id: id, p: patch }),
  billing: (id, action, args) => rpc('cp_billing', { p_id: id, p_action: action, p_args: args }),
  team: () => rpc('cp_team'),
  async saveMember(m) { await rpc('cp_save_provider', { p: m }) },
  async leads() {
    const { data, error } = await supabase!.from('platform_leads').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) throw new Error(error.message)
    return data as CpLead[]
  },
  async updateLead(id, patch) {
    const { error } = await supabase!.from('platform_leads').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
  },
  payments: (tenantId) => rpc('cp_payments', { p_tenant: tenantId ?? null, p_limit: 500 }),
  audit: (tenantId) => rpc('cp_audit', { p_tenant: tenantId ?? null, p_limit: 500 }),
  settings: () => rpc('cp_settings'),
  saveBillingSettings: (patch) => rpc('cp_save_billing_settings', { p: patch }),
  closeHospital: (id, reason, days) => rpc('cp_close_hospital', { p_id: id, p_reason: reason, p_days: days }),
  reopenHospital: (id) => rpc('cp_reopen_hospital', { p_id: id }),
  async purgeHospital(id, confirmSlug, password) {
    await reauth(password)
    return rpc('cp_purge_hospital', { p_id: id, p_confirm: confirmSlug })
  },
  health: () => rpc('cp_health'),
  incidents: () => rpc('cp_incidents'),
  saveIncident: (p) => rpc('cp_save_incident', { p }),
  notifyIncident: (id, message) => rpc('cp_notify_incident', { p_id: id, p_message: message }),
  retention: () => rpc('cp_retention'),
  saveRetention: (p) => rpc('cp_save_retention', { p }),
  runRetention: () => rpc('run_retention'),
  signups: () => rpc('cp_signups'),
  decideSignup: (id, action, reason) => rpc('cp_signup_decide', { p_id: id, p_action: action, p_reason: reason ?? null }),
  signupSettings: () => rpc('cp_signup_settings'),
  saveSignupSettings: (p) => rpc('cp_save_signup_settings', { p }),
  launchCheck: () => rpc('cp_launch_check'),
  profile: (id) => rpc('cp_hospital_profile', { p_id: id }),
  saveProfile: (id, patch) => rpc('cp_save_hospital_profile', { p_id: id, p: patch }),
  transferOwner: (id, userId, oldRole) => rpc('cp_transfer_owner', { p_id: id, p_user: userId, p_old_role: oldRole }),
  resendOwnerInvite: (id) => rpc('cp_resend_owner_invite', { p_id: id }),
  users: (id, search, role, offset) => rpc('cp_hospital_users', { p_id: id, p_search: search || null, p_role: role || null, p_offset: offset ?? 0, p_limit: 50 }),
  userAction: (id, action, userId, args) => rpc('cp_user_action', { p_id: id, p_action: action, p_user: userId ?? null, p: args ?? {} }),
  async sendPasswordReset(id, userId, email, redirectTo) {
    await rpc('cp_user_action', { p_id: id, p_action: 'password_reset', p_user: userId, p: {} })
    const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw new Error(/rate|seconds|too many/i.test(error.message) ? 'Too many reset e-mails — wait a minute and try again.' : error.message)
  },
  data: (id) => rpc('cp_hospital_data', { p_id: id }),
  browse: (id, kind, search, offset, limit = 25) => rpc('cp_browse', { p_id: id, p_kind: kind, p_search: search || null, p_offset: offset, p_limit: limit }),
  importRows: (id, kind, rows, dryRun) => rpc('cp_import', { p_id: id, p_kind: kind, p_rows: rows, p_dry_run: dryRun }),
  messaging: (id) => rpc('cp_messaging', { p_id: id }),
  saveMessaging: (id, patch) => rpc('cp_save_messaging', { p_id: id, p: patch }),
  domains: (id, action, args) => invoke('domains', { action, ...(args ?? {}) }, { 'x-tenant-id': id, 'x-provider-mode': 'admin' }),
  walletLedger: (id) => rpc('cp_wallet_ledger', { p_id: id, p_limit: 300 }),
  creditNotes: (tenantId) => rpc('cp_credit_notes', { p_tenant: tenantId ?? null }),
  creditNote: (paymentId, args) => rpc('cp_credit_note', { p_payment: paymentId, p: args }),
  site: () => rpc('cp_site'),
  siteSave: (key, data, publish) => rpc('cp_site_save', { p_key: key, p_data: data, p_publish: publish }),
  async siteDiscard(key) { await rpc('cp_site_discard', { p_key: key }) },
  async siteReset(key) { await rpc('cp_site_reset', { p_key: key }) },
  siteHistory: (key) => rpc('cp_site_history', { p_key: key }),
  siteRestore: (revId) => rpc('cp_site_restore', { p_rev: revId }),
  posts: () => rpc('cp_posts'),
  savePost: (p) => rpc('cp_save_post', { p }),
  async deletePost(id) { await rpc('cp_delete_post', { p_id: id }) },
  announcements: () => rpc('cp_announcements'),
  saveAnnouncement: (a) => rpc('cp_save_announcement', { p: a }),
  async deleteAnnouncement(id) { await rpc('cp_delete_announcement', { p_id: id }) },
  async impersonate(userId, reason, password) {
    await reauth(password)
    const r = await invoke<{ id: string; token_hash: string; email: string; full_name: string; role: string; slug: string; hospital: string; expires_at: string }>(
      'impersonate', { user_id: userId, reason })
    const hand = encodeImpersonation({ id: r.id, token_hash: r.token_hash, email: r.email, full_name: r.full_name, role: r.role, hospital: r.hospital, expires_at: r.expires_at })
    return { url: hospitalUrl({ slug: r.slug }, `/#imp=${hand}`), expires_at: r.expires_at, email: r.email }
  },
  impersonations: () => rpc('cp_impersonations', { p_limit: 100 }),
  demo: () => rpc('cp_demo'),
  saveDemo: (p) => rpc('cp_save_demo', { p }),
  resetDemo: () => rpc('cp_demo_reset'),
  saveDemoBaseline: () => rpc('cp_demo_save_baseline'),
  messagingSetup: () => rpc('cp_messaging_setup'),
  async saveMessagingSetup(settings, secrets, password) {
    if (Object.keys(secrets).length) {
      if (!password) throw new Error('Confirm your password to change API keys.')
      await reauth(password)
    }
    return rpc('cp_save_messaging_setup', { p_settings: settings, p_secrets: secrets })
  },
  saveTemplates: (t) => rpc('cp_save_platform_templates', { p_templates: t }),
  templates: () => rpc('cp_templates'),
  saveTemplate: (key, p) => rpc('cp_save_template', { p_key: key, p }),
  deleteTemplate: (key) => rpc('cp_delete_template', { p_key: key }),
  testMessage: (channel, to) => invoke('ops', { test: { channel, to } }),
  platformStatus: () => invoke('notify', { ping: true }),
  deliveryLog: (f) => rpc('cp_delivery_log', { p: { ...f, limit: 200 } }),
  async retryMessage(source, id) { await rpc('cp_retry_message', { p_source: source, p_id: id }) },
  alerts: (unreadOnly = false, limit = 30) => rpc('cp_alerts', { p_limit: limit, p_unread_only: unreadOnly }),
  readAlerts: (ids) => rpc('cp_alerts_read', { p_ids: ids?.length ? ids : null }),
  unreadAlerts: (ids) => rpc('cp_alerts_unread', { p_ids: ids }),
  alertPrefs: () => rpc('cp_alert_prefs'),
  saveAlertPrefs: (p) => rpc('cp_save_alert_prefs', { p }),
  opsSettings: () => rpc('cp_ops_settings'),
  saveOpsSettings: (p) => rpc('cp_save_ops_settings', { p }),
  pushConfig: () => rpc('cp_push_config'),
  registerPush: (token) => rpc('cp_register_push', { p_token: token, p_user_agent: navigator.userAgent.slice(0, 300) }),
  unregisterPush: (token) => rpc('cp_unregister_push', { p_token: token ?? null }),
  broadcasts: () => rpc('cp_broadcasts', { p_limit: 100 }),
  broadcastPreview: (a, channels) => rpc('cp_broadcast_preview', { p_audience: a, p_channels: channels }),
  saveBroadcast: (b) => rpc('cp_save_broadcast', { p: b }),
  sendBroadcast: (id, at) => rpc('cp_send_broadcast', { p_id: id, p_at: at ?? null }),
  cancelBroadcast: (id) => rpc('cp_cancel_broadcast', { p_id: id }),
  liveHealth: () => rpc('cp_health_live'),
  checkNow: () => invoke('ops', { health: true }),
  checkIntegration: (id) => invoke('ops', { check: id }),
  keySources: (keys) => invoke('ops', { sources: keys }),
  async requestOtp(channel) {
    const r = await requestLoginOtp(channel)
    // deliver it now; if the ops function is not deployed the scheduled flush sends it within a minute
    if (r.sent) await invoke<{ ok: boolean; message?: string }>('ops', { deliver_otp: r.ref }).then((d) => { if (d && d.ok === false && d.message) throw new Error(d.message) }, () => undefined)
    return r
  },
  async verifyOtp(code) { await verifyLoginOtp(code); return rpc<CpMe | null>('cp_me') },
  security: () => rpc('cp_security'),
  saveSecurity: (p) => rpc('cp_save_security', { p }),
  hospitalOtp: (id) => rpc('cp_hospital_otp', { p_tenant: id }),
  setHospitalOtp: (id, p) => rpc('cp_set_hospital_otp', { p_tenant: id, p }),
}

/** no database configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing) — the panel can't work */
export const backendMissing = !supabase
export const cp: CpApi = db

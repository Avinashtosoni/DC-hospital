/**
 * Hospital-wide app settings, write-only credentials and the notification outbox.
 *  - Table `app_settings` (row key 'app'), `app_secrets` (write-only through RPCs),
 *    `notification_outbox` + Edge Function `notify` which actually talks to the SMS / WhatsApp / email providers.
 */
import { supabase } from '../lib/supabase'
import { tenancyEnabled } from '../tenancy/state'
import type { AppSettings, Channel, NotifyEvent } from './types'

export interface SettingsRow { data: Partial<AppSettings> | null; updated_at?: string | null; updated_by_name?: string | null }
export interface SecretStatus { key: string; hint: string; updated_at: string; updated_by_name: string | null }
export interface OutboxRow {
  id: string; event: NotifyEvent | 'test' | `tpl:${string}`; channel: Channel; recipient: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'simulated'
  error: string | null; attempts: number; provider_ref: string | null; created_at: string; sent_at: string | null
  /** phase 3: 'platform' = sent through Hospital Comrade's shared account */
  source?: 'own' | 'platform' | null
}
export interface SendResult { ok: boolean; message: string; provider_ref?: string | null }

const sb = () => { if (!supabase) throw new Error('Supabase is not configured'); return supabase }
const fnError = async (error: unknown): Promise<string> => {
  const e = error as { message?: string; context?: Response }
  try { const body = await e.context?.json?.(); if (body?.error) return body.error } catch { /* not json */ }
  if (/Failed to send a request|FunctionsFetchError|not found/i.test(e.message ?? '')) return 'The "notify" Edge Function is not deployed yet — run: supabase functions deploy notify'
  return e.message ?? 'Request failed'
}

// ------------------------------------------------------------------ Supabase
const remote = {
  async load(): Promise<SettingsRow> {
    const { data, error } = await sb().from('app_settings').select('data, updated_at, updated_by_name').eq('key', 'app').maybeSingle()
    if (error) throw new Error(error.message.includes('app_settings') ? 'Settings table missing — re-run supabase/master.sql.' : error.message)
    return (data as SettingsRow) ?? { data: null }
  },
  async save(data: AppSettings): Promise<SettingsRow> {
    const { data: row, error } = await sb().from('app_settings').upsert({ key: 'app', data }, { onConflict: 'tenant_id,key' }).select('data, updated_at, updated_by_name').single()
    if (error) throw new Error(error.message)
    return row as SettingsRow
  },
  async secrets(): Promise<SecretStatus[]> {
    const { data, error } = await sb().rpc('app_secret_status')
    if (error) throw new Error(error.message)
    return (data ?? []) as SecretStatus[]
  },
  async setSecret(key: string, value: string | null) {
    const { error } = await sb().rpc('set_app_secret', { p_key: key, p_value: value })
    if (error) throw new Error(error.message)
  },
  async log(): Promise<OutboxRow[]> {
    const cols = 'id, event, channel, recipient, status, error, attempts, provider_ref, created_at, sent_at'
    const q = (c: string) => sb().from('notification_outbox').select(c).order('created_at', { ascending: false }).limit(100) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>
    let { data, error } = await q(`${cols}, source`)
    // database not upgraded to phase 3 yet (no source column) → the log still works
    if (error && /source/.test(error.message)) ({ data, error } = await q(cols))
    if (error) throw new Error(error.message)
    return (data ?? []) as OutboxRow[]
  },
  async test(channel: Channel, to: string): Promise<SendResult> {
    const { data, error } = await sb().functions.invoke('notify', { body: { test: { channel, to } } })
    if (error) return { ok: false, message: await fnError(error) }
    return data as SendResult
  },
  /** No ids = the whole queue (staff only); ids = just the messages about these records (anyone). */
  async flush(ids?: string[]): Promise<{ processed: number; sent: number; failed: number }> {
    const { data, error } = await sb().functions.invoke('notify', { body: ids?.length ? { flush: true, ids } : { flush: true } })
    if (error) throw new Error(await fnError(error))
    return data
  },
  async ping(): Promise<SendResult> {
    const { data, error } = await sb().functions.invoke('notify', { body: { ping: true } })
    if (error) return { ok: false, message: await fnError(error) }
    return data as SendResult
  },
  async queueReminders(): Promise<number> {
    const { data, error } = await sb().rpc('queue_appointment_reminders')
    if (error) throw new Error(error.message)
    return Number(data) || 0
  },
}

// ------------------------------------------------------------------ validation
export function recipientProblem(channel: Channel, to: string): string | null {
  if (channel === 'push') return null
  if (channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) ? null : 'Enter a valid email address'
  return /^[6-9]\d{9}$/.test(to.replace(/\D/g, '').slice(-10)) && to.replace(/\D/g, '').length >= 10 ? null : 'Enter a valid 10-digit Indian mobile number'
}

/** What is still missing before a channel can send. */
export function channelIssues(channel: Channel, s: AppSettings, secrets: SecretStatus[]): string[] {
  const has = (k: string) => secrets.some((x) => x.key === k)
  const out: string[] = []
  const n = s.notifications
  // Hospital Comrade's shared account: nothing for the hospital to set up (availability is shown by the panel)
  if (channel !== 'push' && tenancyEnabled() && n[channel]?.source === 'platform') return out
  if (channel === 'email') {
    const e = n.email
    if (!e.fromEmail) out.push('Sender email is required')
    if (e.provider === 'resend' && !has('resend_api_key')) out.push('Resend API key is not saved')
    if (e.provider === 'sendgrid' && !has('sendgrid_api_key')) out.push('SendGrid API key is not saved')
    if (e.provider === 'smtp') { if (!e.smtpHost) out.push('SMTP host is required'); if (!e.smtpUser) out.push('SMTP username is required'); if (!has('smtp_password')) out.push('SMTP password is not saved') }
  }
  if (channel === 'sms') {
    const m = n.sms
    if (m.provider === 'msg91') { if (!has('msg91_auth_key')) out.push('MSG91 auth key is not saved'); if (!m.senderId) out.push('Sender ID (6 letters, DLT approved) is required') }
    if (m.provider === 'twilio') { if (!m.twilioAccountSid) out.push('Twilio Account SID is required'); if (!m.twilioFrom) out.push('Twilio "from" number is required'); if (!has('twilio_auth_token')) out.push('Twilio auth token is not saved') }
    if (m.provider === 'fast2sms' && !has('fast2sms_api_key')) out.push('Fast2SMS API key is not saved')
    if (m.provider === 'webhook' && !/^https:\/\//.test(m.webhookUrl)) out.push('Webhook URL must start with https://')
  }
  if (channel === 'whatsapp') {
    const w = n.whatsapp
    if (w.provider === 'openwa') {
      if (!/^https?:\/\/[^/\s]+/.test(w.openwaUrl ?? '')) out.push('WA CRM / OpenWA URL is required (e.g. https://wacrm.example.in)')
      if (!w.openwaSession) out.push('WhatsApp session ID is required')
      if (!has('openwa_api_key')) out.push('WA CRM / OpenWA API key is not saved')
      if (w.chatIdFormat && !w.chatIdFormat.includes('{phone}')) out.push('Chat ID format must contain {phone}')
    }
    if (w.provider === 'meta') { if (!w.phoneNumberId) out.push('Phone number ID is required'); if (!has('meta_access_token')) out.push('Meta access token is not saved') }
    if (w.provider === 'twilio') { if (!w.twilioAccountSid) out.push('Twilio Account SID is required'); if (!w.twilioFrom) out.push('Twilio WhatsApp sender is required'); if (!has('twilio_auth_token')) out.push('Twilio auth token is not saved (shared with SMS)') }
    if (w.provider === 'aisensy' && !has('aisensy_api_key')) out.push('AiSensy API key is not saved')
    if (w.provider === 'msg91') { if (!w.msg91Number) out.push('MSG91 integrated WhatsApp number is required'); if (!has('msg91_auth_key')) out.push('MSG91 auth key is not saved (shared with SMS)') }
    if (w.provider === 'interakt' && !has('interakt_api_key')) out.push('Interakt API key is not saved')
    if (w.provider === 'webhook' && !/^https:\/\//.test(w.webhookUrl)) out.push('Webhook URL must start with https://')
  }
  if (channel === 'push') {
    const f = n.push ?? ({} as AppSettings['notifications']['push'])
    if (!f.projectId) out.push('Firebase project ID is required')
    if (!f.apiKey) out.push('Firebase web API key is required')
    if (!f.messagingSenderId) out.push('Messaging sender ID is required')
    if (!f.appId) out.push('Firebase app ID is required')
    if (!f.vapidKey) out.push('Web push certificate (VAPID key) is required')
    if (!has('fcm_service_account')) out.push('Firebase service-account JSON is not saved')
  }
  return out
}

const impl = remote
export const settingsStore = {
  load: impl.load,
  save: impl.save,
  secrets: impl.secrets,
  setSecret: impl.setSecret,
  log: impl.log,
  test: (channel: Channel, to: string, _settings?: AppSettings) => remote.test(channel, to),
  flush: () => impl.flush(),
  ping: impl.ping,
  queueReminders: impl.queueReminders,
}

/**
 * Ask the Edge Function to deliver queued messages (booking confirmations, invoices…).
 * Debounced and fire-and-forget; harmless when nothing is queued or the function isn't deployed.
 */
let flushTimer: ReturnType<typeof setTimeout> | undefined
let pendingIds = new Set<string>()
export function flushNotificationsSoon(delay = 1200, ids: (string | null | undefined)[] = []) {
  if (!supabase) return
  ids.forEach((id) => { if (id && !id.startsWith('temp-')) pendingIds.add(id) })
  if (!pendingIds.size) return
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    const batch = [...pendingIds].slice(0, 10)
    pendingIds = new Set()
    remote.flush(batch).catch(() => { /* not deployed / nothing to do */ })
  }, delay)
}

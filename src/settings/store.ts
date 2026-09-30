/**
 * Hospital-wide app settings, write-only credentials and the notification outbox.
 *  - Supabase mode: table `app_settings` (row key 'app'), `app_secrets` (write-only through RPCs),
 *    `notification_outbox` + Edge Function `notify` which actually talks to the SMS / WhatsApp / email providers.
 *  - Demo mode: localStorage, and "sending" is simulated.
 */
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { AppSettings, Channel, NotifyEvent } from './types'
import { SECRET_FIELDS } from './types'

export interface SettingsRow { data: Partial<AppSettings> | null; updated_at?: string | null; updated_by_name?: string | null }
export interface SecretStatus { key: string; hint: string; updated_at: string; updated_by_name: string | null }
export interface OutboxRow {
  id: string; event: NotifyEvent | 'test'; channel: Channel; recipient: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'simulated'
  error: string | null; attempts: number; provider_ref: string | null; created_at: string; sent_at: string | null
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
    const { data: row, error } = await sb().from('app_settings').upsert({ key: 'app', data }, { onConflict: 'key' }).select('data, updated_at, updated_by_name').single()
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
    const { data, error } = await sb().from('notification_outbox').select('id, event, channel, recipient, status, error, attempts, provider_ref, created_at, sent_at').order('created_at', { ascending: false }).limit(100)
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

// ------------------------------------------------------------------ demo mode
const K = { settings: 'dch:app-settings:v1', secrets: 'dch:app-secrets:v1', log: 'dch:outbox:v1' }
const read = <T,>(k: string, f: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : f } catch { return f } }
const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms))
let actorName = 'You'
export const setSettingsActor = (name: string) => { actorName = name }

type DemoSecret = { hint: string; updated_at: string; by: string }
function demoSecrets(): Record<string, DemoSecret> {
  const raw = read<Record<string, Partial<DemoSecret> & { value?: string }>>(K.secrets, {})
  let scrubbed = false
  const out: Record<string, DemoSecret> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v.value !== undefined) scrubbed = true
    out[k] = { hint: v.hint ?? `••••${String(v.value ?? '').slice(-4)}`, updated_at: v.updated_at ?? new Date().toISOString(), by: v.by ?? 'You' }
  }
  if (scrubbed) write(K.secrets, out)
  return out
}

const local = {
  async load(): Promise<SettingsRow> { return read<SettingsRow>(K.settings, { data: null }) },
  async save(data: AppSettings): Promise<SettingsRow> {
    await pause()
    const row = { data, updated_at: new Date().toISOString(), updated_by_name: actorName }
    write(K.settings, row)
    return row
  },
  // Demo mode never sends anything, so the key itself is never needed: only a "••••1234" hint is kept.
  // (Older builds stored the full value — it is scrubbed the first time this runs.)
  async secrets(): Promise<SecretStatus[]> {
    return Object.entries(demoSecrets()).map(([key, v]) => ({ key, hint: v.hint, updated_at: v.updated_at, updated_by_name: v.by }))
  },
  async setSecret(key: string, value: string | null) {
    await pause(200)
    if (!SECRET_FIELDS[key]) throw new Error('Unknown credential')
    const all = demoSecrets()
    if (value) all[key] = { hint: `••••${value.slice(-4)}`, updated_at: new Date().toISOString(), by: actorName }
    else delete all[key]
    write(K.secrets, all)
  },
  async log(): Promise<OutboxRow[]> { return read<OutboxRow[]>(K.log, []) },
  async test(channel: Channel, to: string, settings?: AppSettings): Promise<SendResult> {
    await pause(700)
    const issues = settings ? channelIssues(channel, settings, await local.secrets()) : []
    const recipientIssue = recipientProblem(channel, to)
    const ok = !issues.length && !recipientIssue
    const row: OutboxRow = {
      id: crypto.randomUUID(), event: 'test', channel, recipient: to, status: ok ? 'simulated' : 'failed', error: ok ? null : recipientIssue ?? issues[0],
      attempts: 1, provider_ref: ok ? 'DEMO-SIMULATED' : null, created_at: new Date().toISOString(), sent_at: ok ? new Date().toISOString() : null,
    }
    write(K.log, [row, ...read<OutboxRow[]>(K.log, [])].slice(0, 100))
    return ok ? { ok: true, message: 'Demo mode: the settings look complete. The message was simulated, not sent. Connect Supabase and deploy the notify function to send for real.', provider_ref: row.provider_ref }
      : { ok: false, message: row.error! }
  },
  async flush() { await pause(300); return { processed: 0, sent: 0, failed: 0 } },
  async ping(): Promise<SendResult> { return { ok: false, message: 'Demo mode — messages are simulated in this browser.' } },
  async queueReminders() { await pause(300); return 0 },
}

// ------------------------------------------------------------------ validation shared by both modes
export function recipientProblem(channel: Channel, to: string): string | null {
  if (channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) ? null : 'Enter a valid email address'
  return /^[6-9]\d{9}$/.test(to.replace(/\D/g, '').slice(-10)) && to.replace(/\D/g, '').length >= 10 ? null : 'Enter a valid 10-digit Indian mobile number'
}

/** What is still missing before a channel can send. */
export function channelIssues(channel: Channel, s: AppSettings, secrets: SecretStatus[]): string[] {
  const has = (k: string) => secrets.some((x) => x.key === k)
  const out: string[] = []
  const n = s.notifications
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
    if (w.provider === 'meta') { if (!w.phoneNumberId) out.push('Phone number ID is required'); if (!has('meta_access_token')) out.push('Meta access token is not saved') }
    if (w.provider === 'twilio') { if (!w.twilioAccountSid) out.push('Twilio Account SID is required'); if (!w.twilioFrom) out.push('Twilio WhatsApp sender is required'); if (!has('twilio_auth_token')) out.push('Twilio auth token is not saved (shared with SMS)') }
    if (w.provider === 'interakt' && !has('interakt_api_key')) out.push('Interakt API key is not saved')
    if (w.provider === 'webhook' && !/^https:\/\//.test(w.webhookUrl)) out.push('Webhook URL must start with https://')
  }
  return out
}

const impl = isSupabaseConfigured ? remote : local
export const settingsStore = {
  mode: isSupabaseConfigured ? 'supabase' as const : 'local' as const,
  load: impl.load,
  save: impl.save,
  secrets: impl.secrets,
  setSecret: impl.setSecret,
  log: impl.log,
  test: (channel: Channel, to: string, settings: AppSettings) => (isSupabaseConfigured ? remote.test(channel, to) : local.test(channel, to, settings)),
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
  if (!isSupabaseConfigured) return
  ids.forEach((id) => { if (id && !id.startsWith('temp-')) pendingIds.add(id) })
  if (!pendingIds.size) return
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    const batch = [...pendingIds].slice(0, 10)
    pendingIds = new Set()
    remote.flush(batch).catch(() => { /* not deployed / nothing to do */ })
  }, delay)
}

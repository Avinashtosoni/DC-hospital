/**
 * Messaging extras shared by Settings, Reports and the Dashboard:
 *  - custom messages: "Send now" + recipient preview      (notify_send_template / notify_template_audience)
 *  - usage report: messages per day / channel / event     (notification_usage)
 *  - Supabase cron status + switch                        (notify_cron_status / notify_cron_setup)
 *  - user administration                                  (admin_create_user … admin_delete_user)
 * Demo mode answers from the browser store (sends are simulated and logged; usage is a labelled sample).
 */
import { addDays, format } from 'date-fns'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { db } from '../data/adapter'
import { loadLocal } from '../data/local'
import type { NotificationTemplate, Profile } from '../types'
import { appendLocalLog, readLocalLog, recipientProblem } from './store'
import type { Channel } from './types'

const sb = () => { if (!supabase) throw new Error('Supabase is not configured'); return supabase }
const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await sb().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
const live = isSupabaseConfigured

// ------------------------------------------------------------------ custom messages
export interface AudiencePreview { total: number; phone: number; email: number; push: number }

export async function templateAudience(t: NotificationTemplate): Promise<AudiencePreview> {
  if (live) return rpc<AudiencePreview>('notify_template_audience', { p_id: t.id })
  const r = (await loadLocal()).localTemplateRecipients(t)
  return { total: r.length, phone: r.filter((x) => !recipientProblem('sms', x.phone ?? '')).length, email: r.filter((x) => x.email?.includes('@')).length, push: 0 }
}

/** queue the message for everyone in its audience now; returns how many messages were queued */
export async function sendTemplate(t: NotificationTemplate, enabledChannels: Channel[]): Promise<number> {
  if (live) return Number(await rpc<number>('notify_send_template', { p_id: t.id })) || 0
  await new Promise((r) => setTimeout(r, 500))
  const rows: Parameters<typeof appendLocalLog>[0] = []
  const local = await loadLocal()
  for (const p of local.localTemplateRecipients(t)) {
    for (const ch of t.channels) {
      if (!enabledChannels.includes(ch) || ch === 'push') continue
      const to = ch === 'email' ? p.email : p.phone
      if (!to || recipientProblem(ch, to)) continue
      rows.push({ event: `tpl:${t.id}`, channel: ch, recipient: ch === 'email' ? to : to.replace(/\D/g, '').slice(-10), status: 'simulated' })
    }
  }
  appendLocalLog(rows.slice(0, 300))
  local.localMarkTemplateRun(t.id, rows.length)
  return rows.length
}

// ------------------------------------------------------------------ usage
export interface UsageRow { day: string; channel: Channel; event: string; status: string; n: number }

/** deterministic pseudo-random numbers so the demo sample is stable between reloads */
function seeded(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10_000) / 10_000 }
}
const SAMPLE_EVENTS: [string, Channel[], number][] = [
  ['appointment_booked', ['sms', 'whatsapp', 'email'], 14], ['appointment_reminder', ['sms', 'whatsapp'], 11], ['otp', ['sms', 'whatsapp'], 9],
  ['invoice_created', ['email'], 8], ['payment_received', ['email'], 6], ['lab_report_ready', ['sms', 'whatsapp'], 5],
  ['feedback_request', ['whatsapp', 'email'], 4], ['notice_published', ['push'], 3], ['password_changed', ['email', 'push'], 1], ['custom', ['sms', 'whatsapp', 'push'], 2],
]
export function sampleUsage(from: string, to: string): UsageRow[] {
  const out: UsageRow[] = []
  for (let d = new Date(`${from}T00:00:00`); format(d, 'yyyy-MM-dd') <= to; d = addDays(d, 1)) {
    const day = format(d, 'yyyy-MM-dd')
    const rnd = seeded(day)
    const busy = d.getDay() === 0 ? 0.35 : 1
    for (const [event, chans, base] of SAMPLE_EVENTS) for (const channel of chans) {
      const n = Math.round(base * busy * (0.5 + rnd()) * (channel === 'email' ? 0.8 : 1))
      if (!n) continue
      const failed = rnd() < 0.25 ? Math.max(1, Math.round(n * 0.05)) : 0
      out.push({ day, channel, event, status: 'sent', n: n - failed })
      if (failed) out.push({ day, channel, event, status: 'failed', n: failed })
    }
  }
  return out
}

export const usageIsSample = !live
export async function loadUsage(from: string, to: string): Promise<UsageRow[]> {
  if (live) return ((await rpc<UsageRow[]>('notification_usage', { p_from: from, p_to: to })) ?? []).map((r) => ({ ...r, n: Number(r.n) }))
  // demo: a labelled sample plus whatever was really "sent" (simulated) in this browser
  const mine = readLocalLog().filter((r) => r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to)
    .map((r) => ({ day: r.created_at.slice(0, 10), channel: r.channel, event: r.event.startsWith('tpl:') ? 'custom' : r.event, status: r.status === 'simulated' ? 'sent' : r.status, n: 1 }))
  return [...sampleUsage(from, to), ...mine]
}

export interface UsageSummary { total: number; delivered: number; failed: number; pending: number; byChannel: Record<Channel, number>; cost: number }
export function summarise(rows: UsageRow[], rates: Partial<Record<Channel, number>>): UsageSummary {
  const s: UsageSummary = { total: 0, delivered: 0, failed: 0, pending: 0, byChannel: { sms: 0, whatsapp: 0, email: 0, push: 0 }, cost: 0 }
  for (const r of rows) {
    s.total += r.n
    if (r.status === 'sent' || r.status === 'simulated') { s.delivered += r.n; s.cost += r.n * (rates[r.channel] ?? 0) }
    else if (r.status === 'failed') s.failed += r.n
    else if (r.status === 'pending' || r.status === 'sending') s.pending += r.n
    if (r.channel in s.byChannel) s.byChannel[r.channel] += r.n
  }
  s.cost = Math.round(s.cost * 100) / 100
  return s
}

// ------------------------------------------------------------------ Supabase cron
export interface CronJob { name: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null; last_message: string | null }
export interface CronStatus { pg_cron: boolean; pg_net: boolean; url_set: boolean; key_set: boolean; pending: number; scheduled: number; jobs: CronJob[]; demo?: boolean }
export async function cronStatus(): Promise<CronStatus> {
  if (!live) return { demo: true, pg_cron: false, pg_net: false, url_set: false, key_set: false, pending: 0, scheduled: 0, jobs: [] }
  return rpc<CronStatus>('notify_cron_status')
}
export async function cronSetup(enable: boolean, url?: string): Promise<CronStatus> {
  if (!live) throw new Error('Demo mode — connect Supabase to schedule automatic delivery.')
  return rpc<CronStatus>('notify_cron_setup', { p_enable: enable, p_url: url || null })
}

// ------------------------------------------------------------------ users
export interface UserStatus { id: string; disabled: boolean; last_sign_in_at: string | null }
export interface UserInput { email: string; full_name: string; role: Profile['role']; phone?: string | null; password?: string | null }
export const usersApi = {
  async create(u: UserInput): Promise<string> {
    if (!live) return (await loadLocal()).localAdmin.create(u)
    return rpc<string>('admin_create_user', { p_email: u.email, p_full_name: u.full_name, p_role: u.role, p_phone: u.phone || null, p_password: u.password || null })
  },
  async update(id: string, u: Omit<UserInput, 'password'>) {
    if (!live) return (await loadLocal()).localAdmin.update(id, u)
    await rpc('admin_update_user', { p_id: id, p_full_name: u.full_name, p_role: u.role, p_phone: u.phone || null, p_email: u.email || null })
  },
  async setPassword(id: string, password: string) {
    if (!live) return (await loadLocal()).localAdmin.setPassword(id, password)
    await rpc('admin_set_user_password', { p_id: id, p_password: password })
  },
  async setActive(id: string, active: boolean) {
    if (!live) return (await loadLocal()).localAdmin.setActive(id, active)
    await rpc('admin_set_user_active', { p_id: id, p_active: active })
  },
  async status(ids: string[]): Promise<UserStatus[]> {
    if (!ids.length) return []
    if (!live) return (await loadLocal()).localAdmin.status(ids)
    return rpc<UserStatus[]>('admin_user_status', { p_ids: ids })
  },
  async remove(id: string) {
    if (!live) return (await loadLocal()).localAdmin.remove(id)
    await rpc('admin_delete_user', { p_id: id })
  },
}
export const dataMode = db.mode

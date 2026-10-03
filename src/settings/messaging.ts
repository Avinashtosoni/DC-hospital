/**
 * Messaging extras shared by Settings, Reports and the Dashboard:
 *  - custom messages: "Send now" + recipient preview      (notify_send_template / notify_template_audience)
 *  - usage report: messages per day / channel / event     (notification_usage)
 *  - Supabase cron status + switch                        (notify_cron_status / notify_cron_setup)
 *  - user administration                                  (admin_create_user … admin_delete_user)
 */
import { supabase } from '../lib/supabase'
import type { NotificationTemplate, Profile } from '../types'
import type { Channel } from './types'

const sb = () => { if (!supabase) throw new Error('Supabase is not configured'); return supabase }
const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await sb().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

// ------------------------------------------------------------------ custom messages
export interface AudiencePreview { total: number; phone: number; email: number; push: number }

export async function templateAudience(t: NotificationTemplate): Promise<AudiencePreview> {
  return rpc<AudiencePreview>('notify_template_audience', { p_id: t.id })
}

/** queue the message for everyone in its audience now; returns how many messages were queued */
export async function sendTemplate(t: NotificationTemplate, _enabledChannels?: Channel[]): Promise<number> {
  return Number(await rpc<number>('notify_send_template', { p_id: t.id })) || 0
}

// ------------------------------------------------------------------ usage
export interface UsageRow { day: string; channel: Channel; event: string; status: string; n: number }

export async function loadUsage(from: string, to: string): Promise<UsageRow[]> {
  return ((await rpc<UsageRow[]>('notification_usage', { p_from: from, p_to: to })) ?? []).map((r) => ({ ...r, n: Number(r.n) }))
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
export interface CronStatus { pg_cron: boolean; pg_net: boolean; url_set: boolean; key_set: boolean; pending: number; scheduled: number; jobs: CronJob[] }
export async function cronStatus(): Promise<CronStatus> {
  return rpc<CronStatus>('notify_cron_status')
}
export async function cronSetup(enable: boolean, url?: string): Promise<CronStatus> {
  return rpc<CronStatus>('notify_cron_setup', { p_enable: enable, p_url: url || null })
}

// ------------------------------------------------------------------ users
export interface UserStatus { id: string; disabled: boolean; last_sign_in_at: string | null }
export interface UserInput { email: string; full_name: string; role: Profile['role']; phone?: string | null; password?: string | null }
export const usersApi = {
  async create(u: UserInput): Promise<string> {
    return rpc<string>('admin_create_user', { p_email: u.email, p_full_name: u.full_name, p_role: u.role, p_phone: u.phone || null, p_password: u.password || null })
  },
  async update(id: string, u: Omit<UserInput, 'password'>) {
    await rpc('admin_update_user', { p_id: id, p_full_name: u.full_name, p_role: u.role, p_phone: u.phone || null, p_email: u.email || null })
  },
  async setPassword(id: string, password: string) {
    await rpc('admin_set_user_password', { p_id: id, p_password: password })
  },
  async setActive(id: string, active: boolean) {
    await rpc('admin_set_user_active', { p_id: id, p_active: active })
  },
  async status(ids: string[]): Promise<UserStatus[]> {
    if (!ids.length) return []
    return rpc<UserStatus[]>('admin_user_status', { p_ids: ids })
  },
  async remove(id: string) {
    await rpc('admin_delete_user', { p_id: id })
  },
}

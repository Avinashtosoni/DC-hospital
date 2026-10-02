/**
 * Hospital Comrade messaging (phase 3) — what Settings → Notifications needs to show and edit:
 *  - which shared accounts exist (notify function ping — provider names only, never keys)
 *  - this hospital's identity + monthly allowance on them (public.tenants.messaging — Hospital Comrade admins edit)
 *  - this month's platform usage (public.message_usage)
 *  - the shared template / DLT IDs for every hospital (public.platform_settings 'messaging' — admins only)
 * Demo mode keeps the same shapes in localStorage.
 */
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { demoKey } from '../tenancy/demo'
import { activeTenantId } from '../tenancy/state'
import type { PlatformMessaging, PlatformTemplate, TenantMessaging } from '../../supabase/functions/_shared/platform'
import { usageMonth } from '../../supabase/functions/_shared/platform'
import { readLocalLog } from './store'

export type { PlatformMessaging, PlatformTemplate, TenantMessaging }
export type PlatformChannel = 'sms' | 'whatsapp' | 'email'
export const PLATFORM_CHANNELS: PlatformChannel[] = ['sms', 'whatsapp', 'email']
export const PROVIDER_LABEL: Record<string, string> = { msg91: 'MSG91', fast2sms: 'Fast2SMS', aisensy: 'AiSensy', meta: 'Meta Cloud API', openwa: 'WA CRM / OpenWA', resend: 'Resend', sendgrid: 'SendGrid' }

export interface PlatformInfo {
  /** null = unknown (the notify function could not be reached) */
  accounts: Record<PlatformChannel, string | null> | null
  details: { smsSenderId: string | null; emailFrom: string | null; whatsappNumber: string | null }
  identity: TenantMessaging
  used: Record<PlatformChannel, number>
  demo: boolean
}
export const PLATFORM_INFO_QK = ['platform-messaging-info'] as const
export const PLATFORM_TEMPLATES_QK = ['platform-messaging-templates'] as const
const zero = (): Record<PlatformChannel, number> => ({ sms: 0, whatsapp: 0, email: 0 })

const sb = () => { if (!supabase) throw new Error('Supabase is not configured'); return supabase }
const remote = {
  async info(): Promise<PlatformInfo> {
    const tenant = activeTenantId()
    const [ping, t, u] = await Promise.all([
      sb().functions.invoke('notify', { body: { ping: true } }).then((r) => r.data as any, () => null),
      tenant ? sb().from('tenants').select('messaging').eq('id', tenant).maybeSingle() : Promise.resolve({ data: null }),
      sb().from('message_usage').select('channel, sent').eq('month', usageMonth()).eq('source', 'platform'),
    ])
    const used = zero()
    for (const r of ((u as any).data ?? []) as { channel: PlatformChannel; sent: number }[]) if (r.channel in used) used[r.channel] += Number(r.sent) || 0
    return {
      accounts: ping?.platform ?? null,
      details: ping?.platform_details ?? { smsSenderId: null, emailFrom: null, whatsappNumber: null },
      identity: ((t as any).data?.messaging ?? {}) as TenantMessaging, used, demo: false,
    }
  },
  async saveIdentity(identity: TenantMessaging) {
    const tenant = activeTenantId()
    if (!tenant) throw new Error('No hospital selected')
    const { data, error } = await sb().from('tenants').update({ messaging: identity }).eq('id', tenant).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Only a Hospital Comrade admin can change this')
  },
  async templates(): Promise<PlatformMessaging> {
    const { data, error } = await sb().from('platform_settings').select('data').eq('key', 'messaging').maybeSingle()
    if (error) throw new Error(error.message)
    return ((data as any)?.data ?? { templates: {} }) as PlatformMessaging
  },
  async saveTemplates(value: PlatformMessaging) {
    const { data, error } = await sb().from('platform_settings').upsert({ key: 'messaging', data: value, updated_at: new Date().toISOString() }).select('key')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Only a Hospital Comrade admin can change this')
  },
}

// demo: per-hospital identity (demoKey), one shared template list for the whole "platform"
const K = { identity: 'dch:platform-identity:v1', templates: 'hc:platform-templates:v1' }
const readJson = <T,>(k: string, f: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : f } catch { return f } }
const local = {
  async info(): Promise<PlatformInfo> {
    const month = usageMonth().slice(0, 7)
    const used = zero()
    for (const r of readLocalLog()) if (r.created_at.slice(0, 7) === month && r.channel in used && (r.status === 'sent' || r.status === 'simulated')) used[r.channel as PlatformChannel]++
    return { accounts: { sms: 'msg91', whatsapp: 'aisensy', email: 'resend' }, details: { smsSenderId: 'HSPCMR', emailFrom: 'notifications@hospitalcomrade.demo', whatsappNumber: '+91 80000 11111' },
      identity: readJson<TenantMessaging>(demoKey(K.identity), {}), used, demo: true }
  },
  async saveIdentity(identity: TenantMessaging) { localStorage.setItem(demoKey(K.identity), JSON.stringify(identity)) },
  async templates(): Promise<PlatformMessaging> { return readJson<PlatformMessaging>(K.templates, { templates: {} }) },
  async saveTemplates(value: PlatformMessaging) { localStorage.setItem(K.templates, JSON.stringify(value)) },
}
export const platformMessaging = isSupabaseConfigured ? remote : local

/** "1,000" style; allowance text for a channel */
export function allowanceText(used: number, limit: number | null | undefined) {
  const u = used.toLocaleString('en-IN')
  return limit == null ? `${u} sent · no monthly limit` : `${u} of ${Number(limit).toLocaleString('en-IN')} this month`
}

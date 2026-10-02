// "Hospital Comrade messaging" (phase 3): the platform's own SMS / WhatsApp / e-mail accounts, shared by every
// hospital that chooses them in Settings → Notifications (notifications.<channel>.source = 'platform').
//
//  • The master credentials live only in Edge Function secrets (PLATFORM_* below) — never in the database, never in
//    the browser, never visible to a hospital.
//  • Approved template / DLT IDs for the platform accounts are kept in public.platform_settings ('messaging'),
//    edited by Hospital Comrade admins.
//  • Each hospital keeps its own identity: its name in every message and template variable, its e-mail as reply-to,
//    and optionally its own DLT sender ID (header) + DLT template IDs registered under the platform account
//    (public.tenants.messaging, set by a Hospital Comrade admin — a hospital can't borrow another's header).
//  • Monthly allowance per channel (tenants.messaging.limits) — metered in public.message_usage. OTPs always go out.
//
// Pure functions (no Deno / database access) so the same code is unit-tested in tests/notify/platform.test.ts.
// deno-lint-ignore-file no-explicit-any
import { deliver, type Channel, type Ctx, type Msg, type Result } from './providers.ts'

export type Env = (name: string) => string | undefined
export type Source = 'own' | 'platform'
export type PlatformChannel = 'sms' | 'whatsapp' | 'email'
export const PLATFORM_CHANNELS: PlatformChannel[] = ['sms', 'whatsapp', 'email']
export const PLATFORM_PROVIDERS = { sms: ['msg91', 'fast2sms'], whatsapp: ['aisensy', 'meta', 'msg91', 'openwa'], email: ['resend', 'sendgrid'] } as const

export interface PlatformTemplate { waTemplate?: string; waParams?: string; smsTemplateId?: string }
/** public.platform_settings → key 'messaging' */
export interface PlatformMessaging { templates?: Record<string, PlatformTemplate> }
/** public.tenants.messaging — the hospital's identity on the platform accounts, set by Hospital Comrade */
export interface TenantMessaging {
  smsSenderId?: string
  templates?: Record<string, PlatformTemplate>
  /** messages per calendar month (IST) on the platform accounts; empty = unlimited */
  limits?: Partial<Record<PlatformChannel, number | null>>
}

interface Account { provider: string; cfg: Record<string, unknown>; secrets: Record<string, string> }

/** Which platform accounts are set up, from the PLATFORM_* secrets. A channel without a provider is simply missing. */
export function platformAccounts(env: Env): Partial<Record<PlatformChannel, Account>> {
  const v = (k: string) => (env(k) ?? '').trim()
  const out: Partial<Record<PlatformChannel, Account>> = {}
  const sms = v('PLATFORM_SMS_PROVIDER').toLowerCase()
  if (sms === 'msg91' || sms === 'fast2sms') {
    out.sms = { provider: sms, cfg: { senderId: v('PLATFORM_SMS_SENDER_ID').toUpperCase(), dltEntityId: v('PLATFORM_DLT_ENTITY_ID') },
      secrets: sms === 'msg91' ? { msg91_auth_key: v('PLATFORM_MSG91_AUTH_KEY') } : { fast2sms_api_key: v('PLATFORM_FAST2SMS_API_KEY') } }
  }
  const wa = v('PLATFORM_WHATSAPP_PROVIDER').toLowerCase()
  const language = v('PLATFORM_WHATSAPP_LANGUAGE') || 'en'
  if (wa === 'aisensy') out.whatsapp = { provider: wa, cfg: { language, aisensyTestCampaign: v('PLATFORM_AISENSY_TEST_CAMPAIGN') }, secrets: { aisensy_api_key: v('PLATFORM_AISENSY_API_KEY') } }
  if (wa === 'meta') out.whatsapp = { provider: wa, cfg: { language, phoneNumberId: v('PLATFORM_META_PHONE_NUMBER_ID') }, secrets: { meta_access_token: v('PLATFORM_META_ACCESS_TOKEN') } }
  if (wa === 'msg91') out.whatsapp = { provider: wa, cfg: { language, msg91Number: v('PLATFORM_MSG91_WA_NUMBER'), msg91Namespace: v('PLATFORM_MSG91_WA_NAMESPACE') }, secrets: { msg91_auth_key: v('PLATFORM_MSG91_AUTH_KEY') } }
  if (wa === 'openwa') out.whatsapp = { provider: wa, cfg: { openwaUrl: v('PLATFORM_OPENWA_URL'), openwaSession: v('PLATFORM_OPENWA_SESSION'), chatIdFormat: v('PLATFORM_OPENWA_CHAT_ID_FORMAT') }, secrets: { openwa_api_key: v('PLATFORM_OPENWA_API_KEY') } }
  const mail = v('PLATFORM_EMAIL_PROVIDER').toLowerCase()
  if (mail === 'resend' || mail === 'sendgrid') {
    out.email = { provider: mail, cfg: { fromEmail: v('PLATFORM_EMAIL_FROM') },
      secrets: mail === 'resend' ? { resend_api_key: v('PLATFORM_RESEND_API_KEY') } : { sendgrid_api_key: v('PLATFORM_SENDGRID_API_KEY') } }
  }
  return out
}

/** For the Settings screen: provider name per channel, or null — never any credential. */
export const platformStatus = (env: Env) => {
  const a = platformAccounts(env)
  return Object.fromEntries(PLATFORM_CHANNELS.map((c) => [c, a[c]?.provider ?? null])) as Record<PlatformChannel, string | null>
}

/** Public facts about the shared accounts shown to hospitals (sender ID, from-address, WhatsApp number) — no keys. */
export const platformDetails = (env: Env) => {
  const v = (k: string) => (env(k) ?? '').trim()
  return { smsSenderId: v('PLATFORM_SMS_SENDER_ID').toUpperCase() || null, emailFrom: v('PLATFORM_EMAIL_FROM') || null, whatsappNumber: v('PLATFORM_WHATSAPP_NUMBER') || null }
}

export const sourceOf = (n: any, channel: Channel): Source => (channel !== 'push' && n?.[channel]?.source === 'platform' ? 'platform' : 'own')

/**
 * The hospital's settings with the platform account swapped in for every channel it sends through Hospital Comrade.
 * Wording (text, subject, waText) stays the hospital's own; template / DLT IDs come from the platform
 * (the hospital's registered overrides first). Channels on their own account are left exactly as they were.
 */
export function platformCtx(own: Ctx, env: Env, opts: { platform?: PlatformMessaging | null; tenant?: TenantMessaging | null; replyTo?: string } = {}): Ctx {
  const accounts = platformAccounts(env)
  const n = { ...own.n }
  const secrets: Record<string, string> = {}
  const shared = opts.platform?.templates ?? {}
  const mine = opts.tenant?.templates ?? {}
  for (const ch of PLATFORM_CHANNELS) {
    if (sourceOf(own.n, ch) !== 'platform') continue
    const acc = accounts[ch]
    // keep the hospital's on/off switch; no account → a clear, permanent error from the adapter
    if (!acc) { n[ch] = { enabled: !!own.n?.[ch]?.enabled, source: 'platform', provider: `platform-${ch}-missing` }; continue }
    n[ch] = { ...acc.cfg, enabled: !!own.n?.[ch]?.enabled, source: 'platform', provider: acc.provider }
    if (ch === 'sms' && opts.tenant?.smsSenderId) n.sms.senderId = String(opts.tenant.smsSenderId).toUpperCase()
    if (ch === 'email') {
      n.email.fromName = own.hospital
      if (opts.replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.replyTo)) n.email.replyTo = opts.replyTo
    }
    Object.assign(secrets, acc.secrets)
  }
  // template IDs: platform defaults ← the hospital's own registrations (only for the IDs; wording stays)
  const templates: Record<string, any> = {}
  const events = new Set([...Object.keys(own.n?.templates ?? {}), ...Object.keys(shared), ...Object.keys(mine)])
  for (const e of events) {
    const base = own.n?.templates?.[e] ?? {}
    const p = { ...(shared[e] ?? {}), ...stripEmpty(mine[e] ?? {}) }
    templates[e] = { ...base, waTemplate: p.waTemplate ?? '', waParams: p.waParams ?? '', smsTemplateId: p.smsTemplateId ?? '' }
  }
  n.templates = templates
  return { ...own, n, secrets }
}
const stripEmpty = (t: PlatformTemplate) => Object.fromEntries(Object.entries(t).filter(([, v]) => v != null && String(v).trim() !== '')) as PlatformTemplate

/** Message for a channel set to the platform with no account behind it (matches isPermanent: "not configured"). */
export const missingAccountError = (channel: Channel) => `Hospital Comrade ${channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'} is not configured yet — ask Hospital Comrade support, or switch this channel to your own account`

/** First day of the current month in India — the metering period. */
export const usageMonth = (now = Date.now()) => new Date(now + 5.5 * 3600_000).toISOString().slice(0, 7) + '-01'

/** OTPs always go out (patients must be able to book and sign in) — they are still counted. */
export const exemptFromLimit = (event: string) => event === 'otp' || event === 'password_otp'

/** null when allowed, otherwise the reason (matches isPermanent: "allowance"). */
export function overAllowance(m: Pick<Msg, 'event' | 'channel'>, used: number, tenant?: TenantMessaging | null): string | null {
  const limit = tenant?.limits?.[m.channel as PlatformChannel]
  if (limit == null || !Number.isFinite(Number(limit)) || exemptFromLimit(m.event)) return null
  return used >= Number(limit) ? `This month's Hospital Comrade ${m.channel === 'sms' ? 'SMS' : m.channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'} allowance (${Number(limit).toLocaleString('en-IN')}) is used up — ask Hospital Comrade to raise it, or use your own account` : null
}

/** Running count of this month's platform messages per channel, for one hospital (loaded once per batch). */
export interface Meter { used: Partial<Record<PlatformChannel, number>>; tenant?: TenantMessaging | null }

/**
 * Deliver one message through the account its channel is set to: the hospital's own (`own`) or Hospital Comrade's
 * (`platform`, see platformCtx). Checks the monthly allowance and counts successful platform sends on `meter`.
 */
export async function deliverRouted(m: Msg, own: Ctx, platform: Ctx, meter?: Meter): Promise<Result & { source: Source }> {
  const source = sourceOf(own.n, m.channel)
  if (source === 'own') return { ...(await deliver(m, own)), source }
  const ch = m.channel as PlatformChannel
  if (String(platform.n?.[ch]?.provider ?? '').endsWith('-missing') && (platform.n?.[ch]?.enabled || m.event === 'test')) return { ok: false, error: missingAccountError(ch), source }
  const blocked = meter ? overAllowance(m, meter.used[ch] ?? 0, meter.tenant) : null
  if (blocked) return { ok: false, error: blocked, source }
  const r = await deliver(m, platform)
  if (r.ok && meter) meter.used[ch] = (meter.used[ch] ?? 0) + 1
  return { ...r, source }
}

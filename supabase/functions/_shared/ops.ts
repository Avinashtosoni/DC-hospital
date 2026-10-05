// Control panel → Messaging & alerts and System health, shared by the `ops` and `notify` Edge Functions.
//
//  • Shared-account settings and keys are saved in the control panel (public.platform_settings 'messaging_accounts' +
//    public.platform_secrets, Vault-encrypted) under the PLATFORM_* names; platform_env() returns them to the service
//    role. A value saved there wins over an Edge secret of the same name, so existing `supabase secrets set` setups
//    keep working until someone saves the field in the panel.
//  • platformSendCtx(): the shared accounts as a provider context for messages that belong to no hospital (team
//    alerts, broadcasts, tests) — every configured channel switched on, Hospital Comrade's own name.
//  • runChecks(): the live checks behind System health (site, auth, storage, Edge Functions, providers).
//
// Pure functions with an injectable fetch, unit-tested in tests/notify/ops.test.ts.
// deno-lint-ignore-file no-explicit-any
import { parseServiceAccount, accessToken } from './fcm.ts'
import { openwaStatus, type Ctx } from './providers.ts'
import { platformAccounts, PLATFORM_CHANNELS, type Env, type PlatformTemplate } from './platform.ts'

/** control-panel values first, then the Edge secret */
export const mergeEnv = (saved: Record<string, unknown> | null | undefined, fallback: Env): Env => (k) => {
  const v = saved?.[k]
  return v != null && String(v).trim() !== '' ? String(v) : fallback(k)
}

/** platform_env() for up to a minute per function instance (one query per batch, not per message) */
let cached: { at: number; env: Env } | null = null
export async function loadPlatformEnv(admin: any, fallback: Env, maxAgeMs = 60_000): Promise<Env> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.env
  let saved: Record<string, unknown> = {}
  try {
    const { data, error } = await admin.rpc('platform_env')
    if (!error && data && typeof data === 'object') saved = data
  } catch { /* the database is older than cp_notify.sql → Edge secrets only */ }
  cached = { at: Date.now(), env: mergeEnv(saved, fallback) }
  return cached.env
}
export const clearPlatformEnv = () => { cached = null }

export interface TeamDevices { tokens(userId: string): Promise<string[]>; forget(tokens: string[]): Promise<void> }

/** the shared accounts, ready for providers.deliver(), for messages that belong to no hospital */
export function platformSendCtx(env: Env, opts: { templates?: Record<string, PlatformTemplate>; siteUrl?: string; devices?: TeamDevices } = {}): Ctx {
  const v = (k: string) => (env(k) ?? '').trim()
  const name = v('PLATFORM_NAME') || 'Hospital Comrade'
  const accounts = platformAccounts(env)
  const n: Record<string, any> = { templates: opts.templates ?? {} }
  const secrets: Record<string, string> = {}
  for (const ch of PLATFORM_CHANNELS) {
    const a = accounts[ch]
    if (!a) { n[ch] = { enabled: true, provider: `platform-${ch}-missing` }; continue }
    n[ch] = { ...a.cfg, enabled: true, provider: a.provider, ...(ch === 'email' ? { fromName: name } : {}) }
    Object.assign(secrets, a.secrets)
  }
  const sa = v('PLATFORM_FCM_SERVICE_ACCOUNT')
  n.push = { enabled: !!sa }
  if (sa) secrets.fcm_service_account = sa
  const site = /^https:\/\//.test(opts.siteUrl ?? '') ? opts.siteUrl!.replace(/\/$/, '') : undefined
  return {
    n, secrets, hospital: name,
    devices: opts.devices ? { tokens: opts.devices.tokens, forget: opts.devices.forget, siteUrl: site ? `${site}/control-panel/` : undefined, icon: site ? `${site}/favicon.svg` : undefined } : undefined,
  }
}

/** a link inside the control panel ('/health') → an absolute address for e-mails and notifications */
export const panelLink = (siteUrl: string | undefined, link: string | undefined) => {
  if (!link) return ''
  if (/^https:\/\//.test(link)) return link
  const site = /^https:\/\//.test(siteUrl ?? '') ? siteUrl!.replace(/\/$/, '') : ''
  return site && link.startsWith('/') ? `${site}/control-panel${link}` : ''
}

// ------------------------------------------------------------------ health checks
export type Status = 'ok' | 'warn' | 'fail' | 'off'
export interface Check { service: string; label: string; group: string; status: Status; latency_ms?: number; detail?: string }
type Fetch = typeof fetch

async function timed(f: Fetch, url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<{ r?: Response; ms: number; error?: string }> {
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await f(url, { ...init, signal: ctl.signal, redirect: 'manual' })
    return { r, ms: Date.now() - t0 }
  } catch (e) {
    return { ms: Date.now() - t0, error: (e as Error).name === 'AbortError' ? `no answer in ${timeoutMs / 1000} s` : (e as Error).message }
  } finally { clearTimeout(timer) }
}

export const EDGE_FUNCTIONS = ['notify', 'billing', 'domains', 'impersonate', 'whatsapp-bot'] as const

export interface CheckOpts { supabaseUrl: string; serviceKey: string; anonKey?: string; siteUrl?: string; env: Env; fetch?: Fetch; self?: string }

export async function checkSite(o: CheckOpts): Promise<Check> {
  const base: Omit<Check, 'status'> = { service: 'site', label: 'Website & apps', group: 'Platform' }
  if (!/^https:\/\//.test(o.siteUrl ?? '')) return { ...base, status: 'off', detail: 'Set the platform address in Messaging & alerts → Settings' }
  const { r, ms, error } = await timed(o.fetch ?? fetch, `${o.siteUrl!.replace(/\/$/, '')}/healthz`)
  if (!r) return { ...base, status: 'fail', latency_ms: ms, detail: error }
  const text = (await r.text().catch(() => '')).trim().slice(0, 60)
  return { ...base, status: r.ok ? 'ok' : 'fail', latency_ms: ms, detail: r.ok ? `HTTP ${r.status}${text ? ` · ${text}` : ''}` : `HTTP ${r.status}` }
}

export async function checkAuth(o: CheckOpts): Promise<Check> {
  const base = { service: 'auth', label: 'Sign-in (Auth)', group: 'Supabase' }
  const { r, ms, error } = await timed(o.fetch ?? fetch, `${o.supabaseUrl}/auth/v1/health`, { headers: { apikey: o.anonKey || o.serviceKey } })
  if (!r) return { ...base, status: 'fail', latency_ms: ms, detail: error }
  return { ...base, status: r.ok ? 'ok' : 'fail', latency_ms: ms, detail: `HTTP ${r.status}` }
}

export async function checkStorage(o: CheckOpts): Promise<Check> {
  const base = { service: 'storage', label: 'File storage', group: 'Supabase' }
  const { r, ms, error } = await timed(o.fetch ?? fetch, `${o.supabaseUrl}/storage/v1/bucket`, { headers: { apikey: o.serviceKey, Authorization: `Bearer ${o.serviceKey}` } })
  if (!r) return { ...base, status: 'fail', latency_ms: ms, detail: error }
  if (!r.ok) return { ...base, status: 'fail', latency_ms: ms, detail: `HTTP ${r.status}` }
  const list = await r.json().catch(() => [])
  return { ...base, status: 'ok', latency_ms: ms, detail: `${Array.isArray(list) ? list.length : 0} buckets` }
}

/** a deployed function answers (anything but "not found" / a server error); { ping: true } is harmless everywhere */
export async function checkFunction(o: CheckOpts, name: string): Promise<Check> {
  const base = { service: `fn:${name}`, label: `${name} function`, group: 'Edge Functions' }
  const { r, ms, error } = await timed(o.fetch ?? fetch, `${o.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST', headers: { Authorization: `Bearer ${o.serviceKey}`, apikey: o.serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ ping: true }),
  })
  if (!r) return { ...base, status: 'fail', latency_ms: ms, detail: error }
  const text = await r.text().catch(() => '')
  if (r.status === 404 && /not.?found/i.test(text)) return { ...base, status: 'fail', latency_ms: ms, detail: `Not deployed — supabase functions deploy ${name}` }
  if (r.status >= 500) return { ...base, status: 'fail', latency_ms: ms, detail: `HTTP ${r.status}: ${text.slice(0, 120)}` }
  return { ...base, status: 'ok', latency_ms: ms, detail: `HTTP ${r.status}` }
}

/** the shared accounts: is the key accepted? (no message is sent; providers without a key check are "configured") */
export async function checkProviders(o: CheckOpts): Promise<Check[]> {
  const f = o.fetch ?? fetch
  const v = (k: string) => (o.env(k) ?? '').trim()
  const accounts = platformAccounts(o.env)
  const out: Check[] = []
  const LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'E-mail' } as const
  for (const ch of PLATFORM_CHANNELS) {
    const base = { service: `provider:${ch}`, label: `${LABEL[ch]} (shared account)`, group: 'Providers' }
    const a = accounts[ch]
    if (!a) { out.push({ ...base, status: 'off', detail: 'Not configured' }); continue }
    const key = Object.values(a.secrets)[0]
    if (!key) { out.push({ ...base, status: 'fail', detail: `${a.provider}: API key missing` }); continue }
    let res: { r?: Response; ms: number; error?: string } | null = null
    let ok = (r: Response) => r.ok
    if (a.provider === 'resend') {
      res = await timed(f, 'https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } })
      // a "sending access" key cannot list domains — Resend answers 401 restricted_api_key, which still proves the key is real
      if (res.r?.status === 401 && /restricted/i.test(await res.r.clone().text().catch(() => ''))) ok = () => true
    } else if (a.provider === 'sendgrid') {
      res = await timed(f, 'https://api.sendgrid.com/v3/scopes', { headers: { Authorization: `Bearer ${key}` } })
    } else if (a.provider === 'meta') {
      res = await timed(f, `https://graph.facebook.com/v20.0/${encodeURIComponent(String(a.cfg.phoneNumberId ?? ''))}?fields=display_phone_number`, { headers: { Authorization: `Bearer ${key}` } })
    } else if (a.provider === 'openwa') {
      const t0 = Date.now()
      const st = await openwaStatus({ n: { whatsapp: a.cfg }, secrets: a.secrets, hospital: '' })
      out.push({ ...base, status: st.ok ? 'ok' : 'fail', latency_ms: Date.now() - t0, detail: st.ok ? `OpenWA connected${st.phone ? ` · ${st.phone}` : ''}` : st.error })
      continue
    }
    if (!res) { out.push({ ...base, status: 'ok', detail: `${a.provider} · configured (key not checked)` }); continue }
    if (!res.r) { out.push({ ...base, status: 'fail', latency_ms: res.ms, detail: `${a.provider}: ${res.error}` }); continue }
    const good = ok(res.r)
    out.push({ ...base, status: good ? 'ok' : 'fail', latency_ms: res.ms, detail: good ? `${a.provider} · key accepted` : `${a.provider} rejected the key (HTTP ${res.r.status})` })
  }
  // push for the team (Firebase service account)
  const sa = v('PLATFORM_FCM_SERVICE_ACCOUNT')
  const base = { service: 'provider:push', label: 'Browser push (Firebase)', group: 'Providers' }
  if (!sa) out.push({ ...base, status: 'off', detail: 'Not configured' })
  else {
    const t0 = Date.now()
    try { const acc = parseServiceAccount(sa); await accessToken(acc); out.push({ ...base, status: 'ok', latency_ms: Date.now() - t0, detail: `${acc.project_id} · service account accepted` }) }
    catch (e) { out.push({ ...base, status: 'fail', latency_ms: Date.now() - t0, detail: (e as Error).message.slice(0, 200) }) }
  }
  return out
}

export async function runChecks(o: CheckOpts): Promise<Check[]> {
  const t0 = Date.now()
  const fns = EDGE_FUNCTIONS.filter((n) => n !== o.self)
  const results = await Promise.all([checkSite(o), checkAuth(o), checkStorage(o), ...fns.map((n) => checkFunction(o, n)), checkProviders(o).catch(() => [] as Check[])])
  const flat = results.flat()
  if (o.self) flat.push({ service: `fn:${o.self}`, label: `${o.self} function`, group: 'Edge Functions', status: 'ok', latency_ms: Date.now() - t0, detail: 'running these checks' })
  return flat
}

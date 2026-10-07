// wacrm (github.com/ArnasDon/wacrm) — a WhatsApp CRM built on the Meta Cloud API, used as a WhatsApp provider.
// Public API v1 (docs/public-api.md in that repo):
//   Authorization: Bearer wacrm_live_…            account-scoped key, shown once when created
//   GET  /api/v1/me                               → { data: { account: { id, name }, key: { id, scopes[] } } }   (no scope)
//   POST /api/v1/messages                         { to: "+91…", type: "text", text } | { type: "template", template: { name, language, params[] } }
//                                                 → 201 { data: { message_id, whatsapp_message_id, conversation_id, contact_id } }   (messages:send)
//   GET  /api/v1/contacts/{id}                    → { data: { id, phone, name } }                                                    (contacts:read)
//   POST /api/v1/webhooks                         { url, events: ["message.received"] } → { data: { id, secret: "whsec_…" } }       (webhooks:manage)
//   errors: { error: { code, message } } — unauthorized 401, forbidden 403, rate_limited 429, bad_request 400,
//           whatsapp_not_configured 400, meta_error 502, template_malformed 500
// Webhooks are signed: X-Wacrm-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>.
// The message.received payload carries no phone number — only contact_id — so replies look the contact up first.
//
// Pure (fetch is injectable) — unit-tested in tests/notify/wacrm.test.ts.
// deno-lint-ignore-file no-explicit-any

type Fetch = typeof fetch
export const WACRM_SCOPES_SEND = ['messages:send'] as const
/** what the chatbot needs on top of sending: the sender's number (contacts:read) and webhook registration */
export const WACRM_SCOPES_REPLIES = ['contacts:read', 'webhooks:manage'] as const

/** "https://crm.example.in/", ".../api/v1" → "https://crm.example.in" */
export function wacrmBase(url: string) {
  const u = String(url ?? '').trim().replace(/\/+$/, '').replace(/\/api(\/v1)?$/, '')
  if (!/^https:\/\/[^/\s]+/.test(u)) throw new Error('wacrm URL must start with https:// (e.g. https://crm.example.in)')
  return u
}

/** 10-digit Indian mobile (or anything with digits) → E.164 "+91XXXXXXXXXX" — wacrm rejects numbers without "+" */
export function e164(recipient: string) {
  const d = String(recipient ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+91${d}`
  if (d.length === 12 && d.startsWith('91')) return `+${d}`
  if (d.length > 10 && String(recipient).trim().startsWith('+')) return `+${d}`
  return `+91${d.slice(-10)}`
}

/** Human error for a failed wacrm call. Texts line up with providers.isPermanent where retrying cannot help. */
export async function wacrmError(r: Response, what = 'wacrm') {
  let code = '', message = ''
  const t = await r.text().catch(() => '')
  try { const j = JSON.parse(t); code = String(j?.error?.code ?? ''); message = String(j?.error?.message ?? j?.message ?? '') } catch { message = t.slice(0, 160) }
  if (r.status === 401 || code === 'unauthorized') return `${what} rejected the API key (401) — create a new key in wacrm → Settings → API keys`
  if (r.status === 403 || code === 'forbidden') return `${what}: this API key is missing the required scope${message ? ` (${message.slice(0, 120)})` : ''}`
  if (r.status === 429 || code === 'rate_limited') return `${what} is rate limiting (429) — will retry${r.headers.get('retry-after') ? ` after ${r.headers.get('retry-after')} s` : ''}`
  if (code === 'whatsapp_not_configured') return `${what}: WhatsApp is not configured in wacrm yet — connect the Meta number in wacrm first`
  if (code === 'template_malformed') return `${what}: the approved template is malformed in wacrm (template_malformed) — check its name, language and number of parameters`
  if (code === 'meta_error' || r.status === 502) {
    const window = /131047|re-?engagement|24.?hour/i.test(message)
    return window
      ? `${what}: WhatsApp only allows free text within 24 hours of the patient's last message — it cannot send free-text here; use an approved template`
      : `${what}: Meta refused the message${message ? ` — ${message.slice(0, 160)}` : ''}`
  }
  return `${what} HTTP ${r.status}${message ? `: ${message.slice(0, 160)}` : ''}`
}

const call = (f: Fetch, base: string, key: string, path: string, init: RequestInit = {}) => f(`${base}${path}`, {
  ...init, redirect: 'manual',   // never re-send the key to a redirect target
  headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
})

export interface WacrmMe { ok: boolean; account?: string; scopes?: string[]; missing?: string[]; error?: string; latency_ms?: number }

/** GET /api/v1/me — is the key valid, which account, which scopes (and which of `need` are missing) */
export async function wacrmMe(url: string, key: string | undefined, opts: { fetch?: Fetch; need?: readonly string[] } = {}): Promise<WacrmMe> {
  const t0 = Date.now()
  try {
    if (!key) throw new Error('wacrm API key is not configured')
    const r = await call(opts.fetch ?? fetch, wacrmBase(url), key, '/api/v1/me')
    if (!r.ok) return { ok: false, error: await wacrmError(r), latency_ms: Date.now() - t0 }
    const j: any = await r.json().catch(() => ({}))
    const scopes: string[] = Array.isArray(j?.data?.key?.scopes) ? j.data.key.scopes.map(String) : []
    const missing = (opts.need ?? WACRM_SCOPES_SEND).filter((s) => !scopes.includes(s))
    return { ok: missing.length === 0, account: j?.data?.account?.name ? String(j.data.account.name) : undefined, scopes, missing,
      error: missing.length ? `wacrm key is missing the ${missing.join(', ')} scope${missing.length > 1 ? 's' : ''}` : undefined, latency_ms: Date.now() - t0 }
  } catch (e) { return { ok: false, error: (e as Error).message, latency_ms: Date.now() - t0 } }
}

export interface WacrmSend { to: string; text?: string; template?: { name: string; language: string; params: string[] } }

/** POST /api/v1/messages — returns the wacrm message id */
export async function wacrmSend(url: string, key: string | undefined, m: WacrmSend, opts: { fetch?: Fetch } = {}): Promise<string> {
  if (!key) throw new Error('wacrm API key is not configured')
  const body = m.template
    ? { to: e164(m.to), type: 'template', template: { name: m.template.name, language: m.template.language || 'en', params: m.template.params } }
    : { to: e164(m.to), type: 'text', text: m.text ?? '' }
  const r = await call(opts.fetch ?? fetch, wacrmBase(url), key, '/api/v1/messages', { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) throw new Error(await wacrmError(r))
  const j: any = await r.json().catch(() => ({}))
  return String(j?.data?.whatsapp_message_id ?? j?.data?.message_id ?? 'accepted')
}

/** GET /api/v1/contacts/{id} → the contact's 10-digit Indian mobile, or '' */
export async function wacrmContactPhone(url: string, key: string, contactId: string, opts: { fetch?: Fetch } = {}): Promise<string> {
  if (!/^[\w-]{1,80}$/.test(contactId)) return ''
  const r = await call(opts.fetch ?? fetch, wacrmBase(url), key, `/api/v1/contacts/${encodeURIComponent(contactId)}`)
  if (!r.ok) throw new Error(await wacrmError(r))
  const j: any = await r.json().catch(() => ({}))
  const d = String(j?.data?.phone ?? '').replace(/\D/g, '')
  // only Indian mobiles: the booking bot identifies patients by their 10-digit number
  if (d.length === 12 && d.startsWith('91')) return d.slice(2)
  if (d.length === 10) return d
  return ''
}

/** POST /api/v1/webhooks for message.received → { id, secret } (the secret is shown only this once) */
export async function wacrmRegisterWebhook(url: string, key: string, hookUrl: string, opts: { fetch?: Fetch } = {}): Promise<{ id: string; secret: string }> {
  if (!/^https:\/\//.test(hookUrl)) throw new Error('The webhook address must be public https://')
  const r = await call(opts.fetch ?? fetch, wacrmBase(url), key, '/api/v1/webhooks', { method: 'POST', body: JSON.stringify({ url: hookUrl, events: ['message.received'] }) })
  if (!r.ok) throw new Error(await wacrmError(r))
  const j: any = await r.json().catch(() => ({}))
  const d = j?.data ?? j
  if (!d?.secret) throw new Error('wacrm did not return a webhook secret')
  return { id: String(d.id ?? ''), secret: String(d.secret) }
}

// ------------------------------------------------------------------ incoming webhooks
const enc = new TextEncoder()
async function hmacHex(key: string, data: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data))), (x) => x.toString(16).padStart(2, '0')).join('')
}
const safeEq = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

/** the X-Wacrm-Signature header value for a body (tests, and to document the scheme) */
export const wacrmSignature = async (secret: string, raw: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${await hmacHex(secret, `${t}.${raw}`)}`

/** true when the header is a valid, fresh (±5 min) signature of the raw body */
export async function verifyWacrmSignature(raw: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300) {
  if (!header || !secret) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2)) as Record<string, string>
  const t = Number(parts.t)
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSec - t) > toleranceSec) return false
  return safeEq(await hmacHex(secret, `${t}.${raw}`), parts.v1.toLowerCase())
}

export type WacrmInbound =
  | { kind: 'reject'; status: number; reason: string }
  | { kind: 'ignore'; reason: string }
  | { kind: 'message'; contactId: string; text: string; key: string }

/**
 * The sender's number is the patient's identity for booking / cancelling, so unsigned or stale deliveries are rejected.
 * Only message.received with text is a chat message; status updates and new-conversation events are acknowledged.
 */
export async function parseWacrm(raw: string, signature: string | null, opts: { secret?: string; account?: string; nowSec?: number }): Promise<WacrmInbound> {
  if (!opts.secret) return { kind: 'reject', status: 401, reason: 'wacrm webhook secret is not configured' }
  if (!await verifyWacrmSignature(raw, signature, opts.secret, opts.nowSec)) return { kind: 'reject', status: 401, reason: 'bad or expired signature' }
  let body: any
  try { body = JSON.parse(raw) } catch { return { kind: 'reject', status: 400, reason: 'invalid JSON' } }
  if (opts.account && body.account_id && String(body.account_id) !== opts.account) return { kind: 'ignore', reason: 'other account' }
  if (body.event !== 'message.received') return { kind: 'ignore', reason: `event ${body.event}` }
  const d = body.data ?? {}
  if (!d.contact_id) return { kind: 'ignore', reason: 'no contact' }
  const text = d.content_type && d.content_type !== 'text' ? '' : String(d.text ?? '').trim()
  return { kind: 'message', contactId: String(d.contact_id), text: text || 'menu', key: String(body.id ?? d.whatsapp_message_id ?? '') }
}

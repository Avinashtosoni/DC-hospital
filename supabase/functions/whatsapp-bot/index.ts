// Supabase Edge Function: WhatsApp booking chatbot for DC Hospital.
//
//   supabase functions deploy whatsapp-bot --no-verify-jwt
//
// Incoming webhooks (point your provider here):
//   Meta Cloud API  GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   (webhook verification)
//                   POST JSON { entry: [{ changes: [{ value: { messages: [...] } }] }] }  — signed with X-Hub-Signature-256
//   Twilio          POST form  From=whatsapp:+91…&Body=…                               — signed with X-Twilio-Signature
//   OpenWA / WA CRM POST JSON { event: "message.received", sessionId, data: { id, from, body, fromMe } }
//                   — signed with X-OpenWA-Signature: sha256=<hmac of the raw body> (secret required)
// In-app simulator (Settings → Notifications → WhatsApp chatbot):
//   POST JSON { simulate: { from: "98…", text: "hi" } } with a signed-in owner / receptionist token → { state, replies }
//
// Conversation logic lives in ../_shared/bot.ts (shared with the browser simulator and the tests).
// Chat state is kept per hospital and phone number in public.wa_sessions (service role only).
//
// Multi-hospital: each hospital points its provider at its own address — `…/whatsapp-bot?hospital=<slug>` (Settings
// shows the right one); no `?hospital` = the primary hospital. Settings, credentials, signatures, doctors, slots and
// bookings all come from that hospital. The simulator uses the hospital the signed-in user works in.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { botReply, type BotDeps, type BotState } from '../_shared/bot.ts'
import { deliver, type Ctx } from '../_shared/providers.ts'
import { parseOpenwa } from '../_shared/openwa.ts'
import { corsHeaders, resolveCaller, webhookTenantRef, type TenantRow } from '../_shared/tenant.ts'

const cors = corsHeaders('GET, POST, OPTIONS')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
/** the hospital's RPCs (doctors, slots, booking) — current_tenant() takes x-tenant-id when there is no signed-in user */
const clients = new Map<string, any>()
const forTenant = (tenant: string) => {
  let c = clients.get(tenant)
  if (!c) clients.set(tenant, c = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, global: { headers: { 'x-tenant-id': tenant } } }))
  return c
}
const userClient = (jwt: string, headers: Record<string, string>) => createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, ...headers } },
})

const TENANT_COLS = 'id, slug, name, status, is_primary'
async function tenantFor(url: URL): Promise<TenantRow | null> {
  const ref = webhookTenantRef(url)
  if ('invalid' in ref) return null
  const q = admin.from('tenants').select(TENANT_COLS)
  const { data } = await ('primary' in ref ? q.eq('is_primary', true) : 'id' in ref ? q.eq('id', ref.id) : q.eq('slug', ref.slug)).maybeSingle()
  return (data as TenantRow | null) ?? null
}
const tenantById = async (id: string) => ((await admin.from('tenants').select(TENANT_COLS).eq('id', id).maybeSingle()).data as TenantRow | null) ?? null

interface Setup { tenant: TenantRow; ctx: Ctx; bot: boolean; site: any }
/** one hospital's settings and credentials (the service role skips RLS → filter on tenant_id) */
async function loadSetup(tenant: TenantRow): Promise<Setup> {
  const [{ data: s }, { data: sec }, { data: site }] = await Promise.all([
    admin.from('app_settings').select('data').eq('tenant_id', tenant.id).eq('key', 'app').maybeSingle(),
    admin.from('app_secrets').select('key, value').eq('tenant_id', tenant.id),
    admin.from('site_content').select('data').eq('tenant_id', tenant.id).eq('key', 'settings').maybeSingle(),
  ])
  const n = (s?.data as any)?.notifications ?? {}
  const siteData = (site?.data as any) ?? {}
  return {
    tenant,
    ctx: { n, secrets: Object.fromEntries((sec ?? []).map((r: any) => [r.key, r.value])), hospital: siteData.name || tenant.name || 'DC Hospital' },
    // a suspended hospital's bot stays quiet
    // the chatbot answers on the hospital's own number — never on Hospital Comrade's shared WhatsApp account
    bot: !!n.whatsapp?.botEnabled && n.whatsapp?.source !== 'platform' && tenant.status !== 'suspended',
    site: siteData,
  }
}

const phone10 = (p: string) => (p ?? '').replace(/\D/g, '').slice(-10)
function depsFor(phone: string, setup: Setup): BotDeps {
  const site = setup.site
  const db = forTenant(setup.tenant.id)
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data as T
  }
  return {
    hospital: { name: setup.ctx.hospital, phone: site.appointmentsPhone || site.phone || '', address: site.address || '', site: site.siteUrl || '' },
    doctors: async () => (await rpc<any[]>('public_doctors', {})).map((d) => ({ id: d.id, name: d.full_name, specialization: d.specialization, department: d.department, fee: Number(d.consultation_fee) })),
    freeSlots: async (doctorId) => (await rpc<any[]>('bot_free_slots', { p_doctor: doctorId, p_limit: 8 })).map((r) => ({ date: r.slot_date, time: r.slot_time })),
    patient: async () => rpc<{ full_name: string } | null>('bot_patient', { p_phone: phone }),
    book: async (i) => {
      const r = await rpc<any>('whatsapp_book_appointment', { p_phone: phone, p_doctor: i.doctorId, p_date: i.date, p_time: i.time, p_name: i.name, p_reason: i.reason })
      return { ref: r.ref, date: i.date, time: i.time, doctor: r.doctor?.full_name ?? '', total: Number(r.invoice?.total ?? 0), mrn: r.patient?.mrn }
    },
    upcoming: async () => rpc<any[]>('bot_upcoming', { p_phone: phone }),
    cancel: async (id) => { await rpc('whatsapp_cancel_appointment', { p_phone: phone, p_appt: id }) },
  }
}

async function converse(phone: string, text: string, setup: Setup) {
  const tenant_id = setup.tenant.id
  const { data: row } = await admin.from('wa_sessions').select('state').eq('tenant_id', tenant_id).eq('phone', phone).maybeSingle()
  const res = await botReply((row?.state as BotState) ?? null, text, depsFor(phone, setup))
  await admin.from('wa_sessions').upsert({ tenant_id, phone, state: res.state, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,phone' })
  return res
}

// ------------------------------------------------------------------ signatures
const enc = new TextEncoder()
async function hmac(alg: 'SHA-256' | 'SHA-1', key: string, data: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: alg }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)))
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const seen = new Set<string>()   // recently handled OpenWA message ids (per instance)
const safeEq = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

// ------------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const raw = req.method === 'POST' ? await req.text() : ''
  const type = req.headers.get('content-type') ?? ''

  // ---- in-app simulator (staff only) — the hospital the signed-in user works in
  let simulate: any = null
  if (req.method === 'POST' && !type.includes('application/x-www-form-urlencoded')) {
    try { simulate = JSON.parse(raw || '{}').simulate ?? null } catch { /* handled below */ }
  }
  if (simulate) {
    const who = await resolveCaller(req, { serviceKey: SERVICE_KEY, admin, userClient })
    if (who.kind !== 'user' || !who.tenant || !['owner', 'receptionist'].includes(who.role ?? '')) return json({ error: 'Only the owner or reception can use the simulator.' }, 403)
    const phone = phone10(simulate.from)
    if (!/^[6-9]\d{9}$/.test(phone)) return json({ error: 'Enter a valid 10-digit mobile number.' }, 400)
    const tenant = await tenantById(who.tenant)
    if (!tenant) return json({ error: 'Hospital not found.' }, 404)
    return json(await converse(phone, String(simulate.text ?? ''), await loadSetup(tenant)))
  }

  // ---- webhooks: the hospital comes from the address (?hospital=<slug>)
  const tenant = await tenantFor(url)
  if (!tenant) return new Response('unknown hospital', { status: 404 })
  const setup = await loadSetup(tenant)

  // Meta webhook verification handshake
  if (req.method === 'GET') {
    const token = setup.ctx.secrets.whatsapp_verify_token
    if (url.searchParams.get('hub.mode') === 'subscribe' && token && url.searchParams.get('hub.verify_token') === token) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // ---- Twilio (form-encoded)
  if (type.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(raw)
    const tok = setup.ctx.secrets.twilio_auth_token
    if (tok) {   // https://www.twilio.com/docs/usage/security#validating-requests
      // Twilio signs the full address it calls, including ?hospital=…
      const publicUrl = `${SUPABASE_URL}/functions/v1/whatsapp-bot${url.search}`
      const data = publicUrl + [...form.keys()].sort().map((k) => k + form.get(k)).join('')
      const sig = b64(await hmac('SHA-1', tok, data))
      if (!safeEq(sig, req.headers.get('x-twilio-signature') ?? '')) return new Response('bad signature', { status: 403 })
    }
    const twiml = (msgs: string[]) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msgs.map((m) => `<Message>${m.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Message>`).join('')}</Response>`, { headers: { 'Content-Type': 'text/xml' } })
    if (!setup.bot) return twiml([])
    const res = await converse(phone10(form.get('From') ?? ''), form.get('Body') ?? '', setup)
    return twiml(res.replies)
  }

  let body: any = {}
  try { body = JSON.parse(raw || '{}') } catch { return json({ error: 'invalid JSON' }, 400) }

  // ---- OpenWA / WA CRM (self-hosted WhatsApp Web gateway) — see ../_shared/openwa.ts
  const owaSig = req.headers.get('x-openwa-signature')
  if (owaSig !== null || (typeof body.event === 'string' && body.data && body.sessionId)) {
    const cfg = setup.ctx.n.whatsapp ?? {}
    const m = await parseOpenwa(raw, owaSig, { secret: setup.ctx.secrets.openwa_webhook_secret, session: cfg.openwaSession })
    if (m.kind === 'reject') return new Response(m.reason, { status: m.status })
    if (m.kind === 'ignore' || !setup.bot || cfg.provider !== 'openwa') return json({ ok: true })
    if (m.key && seen.has(m.key)) return json({ ok: true, duplicate: true })   // OpenWA retries deliveries
    if (m.key) { seen.add(m.key); if (seen.size > 500) seen.delete(seen.values().next().value!) }
    try {
      const res = await converse(m.phone, m.text, setup)
      for (const reply of res.replies) await deliver({ event: 'bot', channel: 'whatsapp', recipient: m.phone, body: reply, vars: {} }, setup.ctx)
    } catch (e) { console.error('whatsapp-bot (openwa)', e) }
    return json({ ok: true })
  }

  // ---- Meta Cloud API
  const secret = setup.ctx.secrets.meta_app_secret
  if (secret) {
    const sig = 'sha256=' + hex(await hmac('SHA-256', secret, raw))
    if (!safeEq(sig, req.headers.get('x-hub-signature-256') ?? '')) return new Response('bad signature', { status: 403 })
  }
  const messages: any[] = (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.messages ?? []))
  if (!setup.bot || !messages.length) return json({ ok: true })   // status updates etc. — acknowledge
  for (const m of messages) {
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''
    const phone = phone10(m.from)
    if (!phone) continue
    try {
      const res = await converse(phone, text || 'menu', setup)
      for (const reply of res.replies) {
        await deliver({ event: 'bot', channel: 'whatsapp', recipient: phone, body: reply, vars: {} }, setup.ctx)
      }
    } catch (e) { console.error('whatsapp-bot', e) }
  }
  return json({ ok: true })   // Meta retries on non-200, so always acknowledge
})

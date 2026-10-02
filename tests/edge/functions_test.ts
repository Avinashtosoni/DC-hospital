// Runs the real `notify` and `whatsapp-bot` Edge Functions (Deno) against an in-memory Supabase, two hospitals and a
// capturing message provider — no network, no ports. Checks that every hospital's messages, webhooks, settings,
// credentials and chat state stay with that hospital (phase 1.6 of docs/MULTI_TENANCY.md).
//
//   npm run test:edge
// deno-lint-ignore-file no-explicit-any
import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict'

const SB = 'http://supabase.test'
const SERVICE = 'service-role-key'
const DC = 'a0000000-0000-4000-8000-000000000001'
const CITY = 'b0000000-0000-4000-8000-000000000002'
Deno.env.set('SUPABASE_URL', SB)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE)
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key')
Deno.env.set('PLATFORM_DOMAIN', 'hospital.digitalcomrade.in')

// ------------------------------------------------------------------ the database
const sms = (url: string) => ({ notifications: { sms: { enabled: true, provider: 'webhook', webhookUrl: url }, whatsapp: { enabled: true, provider: 'webhook', webhookUrl: url.replace('sms', 'wa'), botEnabled: true }, templates: {} } })
const db: Record<string, any[]> = {
  tenants: [
    { id: DC, slug: 'main', name: 'DC Hospital', status: 'active', is_primary: true },
    { id: CITY, slug: 'citycare', name: 'City Care Clinic', status: 'trial', is_primary: false },
  ],
  app_settings: [
    { tenant_id: DC, key: 'app', data: sms('https://hooks.dc.test/sms') },
    { tenant_id: CITY, key: 'app', data: sms('https://hooks.city.test/sms') },
  ],
  app_secrets: [
    { tenant_id: DC, key: 'sms_webhook_secret', value: 'dc-secret' },
    { tenant_id: DC, key: 'whatsapp_webhook_secret', value: 'dc-wa-secret' },
    { tenant_id: DC, key: 'whatsapp_verify_token', value: 'dc-verify' },
    { tenant_id: CITY, key: 'sms_webhook_secret', value: 'city-secret' },
    { tenant_id: CITY, key: 'whatsapp_webhook_secret', value: 'city-wa-secret' },
    { tenant_id: CITY, key: 'whatsapp_verify_token', value: 'city-verify' },
    { tenant_id: CITY, key: 'meta_app_secret', value: 'city-meta-secret' },
  ],
  site_content: [
    { tenant_id: DC, key: 'settings', data: { name: 'DC Hospital' } },
    { tenant_id: CITY, key: 'settings', data: { name: 'City Care Clinic', phone: '+91 612 400 1100' } },
  ],
  notification_templates: [], push_tokens: [], wa_sessions: [], notification_outbox: [], message_usage: [], billing_payments: [],
  platform_settings: [{ key: 'messaging', data: { templates: {} } }],
  tenant_domains: [{ domain: 'dchospital.example', tenant_id: DC, is_primary: true, method: 'manual' }],
}
/** signed-in users → what my_context() says for them (providers depend on the x-tenant-id they send) */
const users: Record<string, { id: string; ctx: (tenantHeader: string | null) => any }> = {
  'tok-city-owner': { id: 'c1c-1', ctx: () => ({ tenant: { id: CITY }, role: 'owner', provider_role: null }) },
  'tok-city-reception': { id: 'c1c-3', ctx: () => ({ tenant: { id: CITY }, role: 'receptionist', provider_role: null }) },
  'tok-dc-patient': { id: 'd0c-6', ctx: () => ({ tenant: { id: DC }, role: 'patient', provider_role: null }) },
  'tok-admin': { id: 'e0e-1', ctx: (h) => ({ tenant: h ? { id: h } : null, role: h ? 'owner' : null, provider_role: 'admin' }) },
}
let claimRows: any[] = []

interface Call { url: URL; method: string; headers: Headers; body: any }
const calls: Call[] = []
const sent: { url: string; auth: string | null; body: any }[] = []
const reset = () => { calls.length = 0; sent.length = 0 }

function filterRows(table: string, q: URLSearchParams) {
  let rows = db[table] ?? []
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue
    if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')); rows = rows.filter((r) => set.includes(String(r[k]))) }
  }
  return rows
}
const reply = (data: unknown, h: Headers, status = 200) => {
  const single = (h.get('accept') ?? '').includes('vnd.pgrst.object')
  const body = single ? (Array.isArray(data) ? data[0] ?? null : data) : data
  if (single && body === null) return new Response(JSON.stringify({ code: 'PGRST116', message: 'no rows' }), { status: 406 })
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function supabase(url: URL, init: RequestInit & { headers: Headers }): Promise<Response> {
  const h = init.headers
  const method = (init.method ?? 'GET').toUpperCase()
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ url, method, headers: h, body })
  const token = (h.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (url.pathname === '/auth/v1/user') {
    const u = users[token]
    return u ? reply({ id: u.id, aud: 'authenticated' }, new Headers()) : new Response('{"msg":"bad jwt"}', { status: 401 })
  }
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
  if (rpc) {
    const fn = rpc[1]
    if (fn === 'my_context') return reply(users[token]?.ctx(h.get('x-tenant-id')) ?? null, h)
    if (fn === 'claim_notifications' || fn === 'claim_notifications_for') {
      const rows = body?.p_tenant ? claimRows.filter((r) => r.tenant_id === body.p_tenant) : claimRows
      return reply(rows, h)
    }
    if (fn === 'record_message_usage') {
      const month = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7) + '-01'
      let row = db.message_usage.find((r) => r.tenant_id === body.p_tenant && r.month === month && r.channel === body.p_channel && r.source === body.p_source)
      if (!row) db.message_usage.push(row = { tenant_id: body.p_tenant, month, channel: body.p_channel, source: body.p_source, sent: 0, failed: 0 })
      row.sent += body.p_sent; row.failed += body.p_failed
      return reply(null, h)
    }
    if (fn === 'billing_quote') {
      if (body.p_kind === 'plan' && body.p_months !== 1 && body.p_months !== 12) return new Response('{"message":"Choose 1 month or 12 months."}', { status: 400 })
      const plan = body.p_kind === 'plan' ? body.p_plan ?? 'clinic' : null
      const price: Record<string, number> = { clinic: 99900, hospital: 299900 }
      if (plan && !price[plan]) return new Response('{"message":"Unknown plan"}', { status: 400 })
      const base = plan ? price[plan] * (body.p_months === 12 ? 10 : 1) : Math.round(body.p_amount * 100)
      return reply({ kind: body.p_kind, plan, months: body.p_kind === 'plan' ? body.p_months : null, base_paise: base, gst_paise: Math.round(base * 0.18), total_paise: base + Math.round(base * 0.18) }, h)
    }
    if (fn === 'apply_payment') {
      const row = db.billing_payments.find((r) => r.id === body.p_payment)
      if (row.status === 'paid') return reply({ ok: true, already: true, invoice_no: row.invoice_no }, h)
      Object.assign(row, { status: 'paid', payment_id: body.p_ref, invoice_no: `HC/2026-27/${String(db.billing_payments.filter((r) => r.status === 'paid').length + 1).padStart(6, '0')}` })
      return reply({ ok: true, already: false, invoice_no: row.invoice_no }, h)
    }
    if (fn === 'public_doctors') {
      const t = h.get('x-tenant-id')
      return reply(t === CITY ? [{ id: 'doc-city', full_name: 'Dr. Vivek Mishra', specialization: 'General Medicine', department: 'Medicine', consultation_fee: 300 }] : [{ id: 'doc-dc', full_name: 'Dr. DC Only', specialization: 'Cardiology', department: 'Cardiology', consultation_fee: 900 }], h)
    }
    return reply([], h)
  }
  const tbl = url.pathname.match(/^\/rest\/v1\/(\w+)$/)
  if (tbl) {
    const table = tbl[1]
    if (method === 'GET') return reply(filterRows(table, url.searchParams), h)
    if (method === 'POST') { const rows = Array.isArray(body) ? body : [body]; db[table].push(...rows); return reply(rows, h, 201) }
    if (method === 'PATCH') { for (const r of filterRows(table, url.searchParams)) Object.assign(r, body); return reply([], h) }
    if (method === 'DELETE') { const gone = new Set(filterRows(table, url.searchParams)); db[table] = db[table].filter((r) => !gone.has(r)); return reply([], h) }
  }
  return new Response('not mocked: ' + url.pathname, { status: 404 })
}

// ------------------------------------------------------------------ Cloudflare for SaaS (custom hostnames)
const cfHosts = new Map<string, any>()
const cfCalls: { method: string; path: string; auth: string | null; body: any }[] = []
const cfOk = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, errors: [], result }), { status, headers: { 'content-type': 'application/json' } })
const cfErr = (code: number, message: string, status = 400) => new Response(JSON.stringify({ success: false, errors: [{ code, message }], result: null }), { status })
function cloudflare(url: URL, method: string, h: Headers, body: any): Response {
  cfCalls.push({ method, path: url.pathname + url.search, auth: h.get('authorization'), body })
  const m = url.pathname.match(/^\/client\/v4\/zones\/([^/]+)\/custom_hostnames(?:\/([^/]+))?$/)
  if (!m || m[1] !== 'zone-1') return cfErr(7003, 'Could not route', 404)
  const id = m[2]
  if (method === 'POST') {
    if ([...cfHosts.values()].some((x) => x.hostname === body.hostname)) return cfErr(1406, 'Duplicate custom hostname found.')
    const hid = `cfh-${cfHosts.size + 1}`
    const host = { id: hid, hostname: body.hostname, status: 'pending', verification_errors: ['custom hostname does not CNAME to this zone.'],
      ownership_verification: { type: 'txt', name: `_cf-custom-hostname.${body.hostname}`, value: 'txt-value' },
      ssl: { status: 'pending_validation', method: body.ssl.method, type: body.ssl.type } }
    cfHosts.set(hid, host); return cfOk(host)
  }
  if (method === 'GET' && !id) return cfOk([...cfHosts.values()].filter((x) => x.hostname === url.searchParams.get('hostname')))
  if (!cfHosts.has(id)) return cfErr(1436, 'Custom hostname not found', 404)
  if (method === 'GET') return cfOk(cfHosts.get(id))
  if (method === 'DELETE') { cfHosts.delete(id); return cfOk({ id }) }
  return cfErr(1000, 'bad method', 405)
}

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const req = input instanceof Request ? input : null
  const url = new URL(req ? req.url : String(input))
  const headers = new Headers(init.headers ?? req?.headers)
  const body = init.body ?? (req ? await req.text() : undefined)
  if (url.origin === SB) return supabase(url, { ...init, method: init.method ?? req?.method, headers, body })
  if (url.origin === 'https://api.razorpay.com') {
    const b = JSON.parse(String(body))
    rzpCalls.push({ path: url.pathname, auth: headers.get('authorization'), body: b })
    if (headers.get('authorization') !== `Basic ${btoa('rzp_test_key:rzp_secret')}`) return new Response('{"error":{"description":"Authentication failed"}}', { status: 401 })
    return new Response(JSON.stringify({ id: `order_${rzpCalls.length}`, amount: b.amount, currency: b.currency, status: 'created' }), { status: 200 })
  }
  if (url.origin === 'https://api.cloudflare.com') return cloudflare(url, init.method ?? req?.method ?? 'GET', headers, body ? JSON.parse(String(body)) : null)
  sent.push({ url: url.href, auth: headers.get('authorization'), body: body ? JSON.parse(String(body)) : null })
  return new Response('{}', { status: 200, headers: { 'x-request-id': 'req-1' } })
}) as typeof fetch

const rzpCalls: { path: string; auth: string | null; body: any }[] = []

// capture each function's handler instead of starting a server
const handlers: ((req: Request) => Promise<Response>)[] = []
;(Deno as any).serve = (h: any) => { handlers.push(h); return { finished: Promise.resolve(), shutdown() {} } }
await import('../../supabase/functions/notify/index.ts')
await import('../../supabase/functions/whatsapp-bot/index.ts')
await import('../../supabase/functions/domains/index.ts')
await import('../../supabase/functions/billing/index.ts')
const [notify, bot, domains, billing] = handlers

const post = (fn: typeof notify, body: unknown, token?: string, headers: Record<string, string> = {}, path = '') =>
  fn(new Request(`${SB}/functions/v1/x${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) }))
const outRow = (id: string, tenant_id: string, recipient: string) => ({ id, tenant_id, event: 'appointment_booked', channel: 'sms', recipient, subject: null, body: `hello ${recipient}`, vars: {}, attempts: 1 })
const settingsReads = () => calls.filter((c) => c.method === 'GET' && /\/rest\/v1\/(app_settings|app_secrets|site_content|push_tokens|wa_sessions|notification_templates)$/.test(c.url.pathname))

// ------------------------------------------------------------------ notify
Deno.test('CORS lets the app send its hospital headers', async () => {
  for (const fn of [notify, bot]) {
    const r = await fn(new Request(`${SB}/x`, { method: 'OPTIONS' }))
    assert(/x-tenant-id/.test(r.headers.get('access-control-allow-headers') ?? ''))
    assert(/x-provider-mode/.test(r.headers.get('access-control-allow-headers') ?? ''))
  }
})

Deno.test('the scheduler delivers every hospital with its own credentials', async () => {
  reset()
  db.notification_outbox = [outRow('m1', DC, '9810000001'), outRow('m2', CITY, '9810000002'), outRow('m3', DC, '9810000003')].map((r) => ({ ...r, status: 'sending' }))
  claimRows = db.notification_outbox.map((r) => ({ ...r }))
  const r = await post(notify, { flush: true }, SERVICE)
  assertEquals(await r.json(), { processed: 3, sent: 3, failed: 0 })
  const claim = calls.find((c) => c.url.pathname.endsWith('/claim_notifications'))!
  assertEquals(claim.body.p_tenant, undefined)
  const dc = sent.filter((s) => s.url === 'https://hooks.dc.test/sms')
  const city = sent.filter((s) => s.url === 'https://hooks.city.test/sms')
  assertEquals(dc.map((s) => s.body.to).sort(), ['+919810000001', '+919810000003'])
  assertEquals(dc.every((s) => s.auth === 'Bearer dc-secret'), true)
  assertEquals(city.map((s) => [s.body.to, s.auth]), [['+919810000002', 'Bearer city-secret']])
  // service role skips RLS → every settings read names the hospital
  assert(settingsReads().length > 0)
  for (const c of settingsReads()) assert(c.url.searchParams.get('tenant_id')?.startsWith('eq.'), `unfiltered read of ${c.url.pathname}`)
  assertEquals(db.notification_outbox.map((r) => r.status), ['sent', 'sent', 'sent'])
})

Deno.test("a staff member's 'deliver now' only takes their own hospital's queue", async () => {
  reset()
  claimRows = [outRow('m4', DC, '9810000004'), outRow('m5', CITY, '9810000005')]
  db.notification_outbox.push(...claimRows.map((r) => ({ ...r })))
  const r = await post(notify, { flush: true }, 'tok-city-reception')
  assertEquals((await r.json()).processed, 1)
  assertEquals(calls.find((c) => c.url.pathname.endsWith('/claim_notifications'))!.body.p_tenant, CITY)
  assertEquals(sent.map((s) => s.url), ['https://hooks.city.test/sms'])
  assertEquals((await post(notify, { flush: true }, 'tok-dc-patient')).status, 403)
  assertEquals((await post(notify, { flush: true })).status, 403)
})

Deno.test("a test message uses the owner's hospital — and a provider's chosen hospital", async () => {
  reset()
  const r = await post(notify, { test: { channel: 'sms', to: '98100 50011' } }, 'tok-city-owner')
  assertEquals((await r.json()).ok, true)
  assertEquals(sent.map((s) => [s.url, s.auth]), [['https://hooks.city.test/sms', 'Bearer city-secret']])
  assert(sent[0].body.message.includes('City Care Clinic'))
  assertEquals(db.notification_outbox.at(-1).tenant_id, CITY)

  reset()
  const p = await post(notify, { test: { channel: 'sms', to: '9810050011' } }, 'tok-admin', { 'x-tenant-id': DC, 'x-provider-mode': 'admin' })
  assertEquals((await p.json()).ok, true)
  assertEquals(sent.map((s) => s.url), ['https://hooks.dc.test/sms'])
  // the forwarded headers reach my_context, which applies the database's provider rules
  assertEquals(calls.find((c) => c.url.pathname.endsWith('/my_context'))!.headers.get('x-tenant-id'), DC)
  // no hospital picked → no hospital to test
  assertEquals((await post(notify, { test: { channel: 'sms', to: '9810050011' } }, 'tok-admin')).status, 403)
  assertEquals((await post(notify, { test: { channel: 'sms', to: '9810050011' } }, 'tok-city-reception')).status, 403)
})

// ------------------------------------------------------------------ whatsapp-bot
async function metaSig(secret: string, body: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const b = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))
  return 'sha256=' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
Deno.test("Meta's webhook check uses the hospital in the address", async () => {
  const verify = (q: string) => bot(new Request(`${SB}/functions/v1/whatsapp-bot?${q}`))
  assertEquals(await (await verify('hospital=citycare&hub.mode=subscribe&hub.verify_token=city-verify&hub.challenge=42')).text(), '42')
  assertEquals((await verify('hospital=citycare&hub.mode=subscribe&hub.verify_token=dc-verify&hub.challenge=42')).status, 403)
  assertEquals(await (await verify('hub.mode=subscribe&hub.verify_token=dc-verify&hub.challenge=7')).text(), '7')   // no ?hospital = main
  assertEquals((await verify('hospital=nowhere&hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status, 404)
  assertEquals((await verify('hospital=../etc&hub.mode=subscribe')).status, 404)
})

Deno.test("incoming chats are answered from that hospital's doctors, number and chat state", async () => {
  reset()
  db.wa_sessions = [{ tenant_id: DC, phone: '9876500001', state: { step: 'doctor', lang: 'en', at: Date.now() } }]   // same phone, other hospital
  const meta = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '919876500001', text: { body: '1' } }] } }] }] })
  const r = await bot(new Request(`${SB}/functions/v1/whatsapp-bot?hospital=citycare`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': await metaSig('city-meta-secret', meta) }, body: meta }))
  assertEquals(r.status, 200)
  const doctors = calls.find((c) => c.url.pathname.endsWith('/public_doctors'))!
  assertEquals(doctors.headers.get('x-tenant-id'), CITY)
  assertEquals(doctors.headers.get('authorization'), `Bearer ${SERVICE}`)
  const upsert = calls.find((c) => c.url.pathname.endsWith('/wa_sessions') && c.method === 'POST')!
  assertEquals(upsert.body.tenant_id ?? upsert.body[0]?.tenant_id, CITY)
  assertEquals(upsert.url.searchParams.get('on_conflict'), 'tenant_id,phone')
  for (const c of settingsReads()) assert(c.url.searchParams.get('tenant_id') === `eq.${CITY}`, `read of ${c.url.pathname} without City's filter`)
  // the reply went out through City's WhatsApp, and mentions City's doctor (not DC's)
  assert(sent.length > 0)
  assert(sent.every((s) => s.url === 'https://hooks.city.test/wa' && s.auth === 'Bearer city-wa-secret'))
  assert(sent.some((s) => /Medicine|Vivek/.test(s.body.message)) && !sent.some((s) => /Cardiology|DC Only/.test(s.body.message)))
})

Deno.test('Meta and Twilio chats must be signed — the sender number is the patient identity', async () => {
  reset()
  const meta = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '919876500001', text: { body: '1' } }] } }] }] })
  const post = (q: string, headers: Record<string, string>, body: string) => bot(new Request(`${SB}/functions/v1/whatsapp-bot?${q}`, { method: 'POST', headers, body }))
  // DC has no Meta app secret → rejected, even with a made-up signature
  assertEquals((await post('hospital=main', { 'content-type': 'application/json' }, meta)).status, 401)
  assertEquals((await post('hospital=main', { 'content-type': 'application/json', 'x-hub-signature-256': await metaSig('guess', meta) }, meta)).status, 401)
  // City has one → a missing or wrong signature is refused
  assertEquals((await post('hospital=citycare', { 'content-type': 'application/json' }, meta)).status, 403)
  assertEquals((await post('hospital=citycare', { 'content-type': 'application/json', 'x-hub-signature-256': await metaSig('wrong', meta) }, meta)).status, 403)
  // Twilio without an auth token → rejected
  const form = 'From=whatsapp%3A%2B919876500001&Body=1'
  assertEquals((await post('hospital=citycare', { 'content-type': 'application/x-www-form-urlencoded' }, form)).status, 401)
  assertEquals(sent.length, 0)
  assert(!calls.some((c) => c.url.pathname.endsWith('/wa_sessions') && c.method === 'POST'))
})

Deno.test('the simulator runs in the hospital of the signed-in user', async () => {
  reset()
  const r = await post(bot, { simulate: { from: '9876500002', text: '1' } }, 'tok-city-reception', {}, '/whatsapp-bot')
  const out = await r.json()
  assertEquals(r.status, 200, JSON.stringify(out))
  assert(out.replies.join('\n').match(/Medicine|Vivek/))
  assertEquals(calls.find((c) => c.url.pathname.endsWith('/public_doctors'))!.headers.get('x-tenant-id'), CITY)
  assertEquals((await post(bot, { simulate: { from: '9876500002', text: '1' } }, 'tok-dc-patient', {}, '/whatsapp-bot')).status, 403)
  assertEquals((await post(bot, { simulate: { from: '9876500002', text: '1' } }, undefined, {}, '/whatsapp-bot')).status, 403)
})

// ------------------------------------------------------------------ domains (phase 2.3)
const dom = (body: unknown, token?: string, headers: Record<string, string> = {}) => post(domains, body, token, headers, '/domains')
const asAdmin = (tenant: string) => ({ 'x-tenant-id': tenant, 'x-provider-mode': 'admin' })

Deno.test('domains: an owner sees only their own hospital and cannot change anything', async () => {
  const r = await (await dom({ action: 'list' }, 'tok-city-owner')).json()
  assertEquals(r.domains, [])
  assertEquals(r.canManage, false)
  assertEquals((await dom({ action: 'add', domain: 'www.citycare.in' }, 'tok-city-owner')).status, 403)
  assertEquals((await dom({ action: 'list' }, 'tok-city-reception')).status, 403)
  assertEquals((await dom({ action: 'list' })).status, 403)
  // the service role skips RLS → every read names the hospital
  for (const c of calls.filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/tenant_domains'))) {
    assert(c.url.searchParams.get('tenant_id') === `eq.${CITY}` || c.url.searchParams.has('domain'))
  }
})

Deno.test('domains: without Cloudflare secrets a provider admin adds a manual domain', async () => {
  reset()
  Deno.env.delete('CF_API_TOKEN'); Deno.env.delete('CF_ZONE_ID')
  const r = await (await dom({ action: 'add', domain: 'https://WWW.CityCare.in/' }, 'tok-admin', asAdmin(CITY))).json()
  assertEquals(r.cloudflare, false)
  assertEquals(r.domains.map((d: any) => [d.domain, d.method, d.is_primary, d.status]), [['www.citycare.in', 'manual', true, 'manual']])
  assertEquals(cfCalls.length, 0)
  // platform sub-domains are in our own zone → active straight away
  const s = await (await dom({ action: 'add', domain: 'citycare.hospital.digitalcomrade.in' }, 'tok-admin', asAdmin(CITY))).json()
  assertEquals(s.domains.find((d: any) => d.domain === 'citycare.hospital.digitalcomrade.in').status, 'active')
  // rules: the platform itself, another hospital's domain, junk
  assertEquals((await dom({ action: 'add', domain: 'hospital.digitalcomrade.in' }, 'tok-admin', asAdmin(CITY))).status, 400)
  assertEquals((await dom({ action: 'add', domain: 'dchospital.example' }, 'tok-admin', asAdmin(CITY))).status, 409)
  assertEquals((await dom({ action: 'add', domain: 'not a domain' }, 'tok-admin', asAdmin(CITY))).status, 400)
  await dom({ action: 'remove', domain: 'www.citycare.in' }, 'tok-admin', asAdmin(CITY))
  await dom({ action: 'remove', domain: 'citycare.hospital.digitalcomrade.in' }, 'tok-admin', asAdmin(CITY))
  assertEquals(db.tenant_domains.filter((d) => d.tenant_id === CITY), [])
})

Deno.test('domains: Cloudflare custom hostname — add, check until active, make primary, remove', async () => {
  reset(); cfCalls.length = 0
  Deno.env.set('CF_API_TOKEN', 'cf-token'); Deno.env.set('CF_ZONE_ID', 'zone-1'); Deno.env.set('CF_CNAME_TARGET', 'customers.hospital.digitalcomrade.in')
  const a = await (await dom({ action: 'add', domain: 'www.citycare.in' }, 'tok-admin', asAdmin(CITY))).json()
  assertEquals(a.target, 'customers.hospital.digitalcomrade.in')
  const d = a.domains[0]
  assertEquals([d.method, d.status, d.ssl_status, d.dns_target, d.is_primary, d.verified_at ?? null], ['cloudflare', 'pending', 'pending_validation', 'customers.hospital.digitalcomrade.in', true, null])
  assert(/CNAME/.test(d.last_error))
  assertEquals(d.verification.txt.name, '_cf-custom-hostname.www.citycare.in')
  assertEquals(cfCalls[0].auth, 'Bearer cf-token')
  assertEquals(cfCalls[0].body, { hostname: 'www.citycare.in', ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } })
  // the hospital adds its CNAME → Cloudflare validates; the owner may refresh the status
  Object.assign(cfHosts.get('cfh-1'), { status: 'active', verification_errors: [], ssl: { status: 'active' } })
  const c = await (await dom({ action: 'check', domain: 'www.citycare.in' }, 'tok-city-owner')).json()
  assertEquals([c.domains[0].status, c.domains[0].ssl_status, !!c.domains[0].verified_at, c.domains[0].last_error], ['active', 'active', true, null])
  // a second address, then make it the primary one
  await dom({ action: 'add', domain: 'citycare.hospital.digitalcomrade.in' }, 'tok-admin', asAdmin(CITY))
  const p = await (await dom({ action: 'primary', domain: 'citycare.hospital.digitalcomrade.in' }, 'tok-admin', asAdmin(CITY))).json()
  assertEquals(p.domains.filter((x: any) => x.is_primary).map((x: any) => x.domain), ['citycare.hospital.digitalcomrade.in'])
  // re-adding something Cloudflare already knows adopts it instead of failing
  await dom({ action: 'remove', domain: 'citycare.hospital.digitalcomrade.in' }, 'tok-admin', asAdmin(CITY))
  db.tenant_domains = db.tenant_domains.filter((x) => x.domain !== 'www.citycare.in')   // removed here only
  const again = await (await dom({ action: 'add', domain: 'www.citycare.in' }, 'tok-admin', asAdmin(CITY))).json()
  assertEquals(again.domains[0].status, 'active')
  assertEquals(cfHosts.size, 1)
  // remove → gone at Cloudflare too
  await dom({ action: 'remove', domain: 'www.citycare.in' }, 'tok-admin', asAdmin(CITY))
  assertEquals(cfHosts.size, 0)
  assertEquals(db.tenant_domains.filter((x) => x.tenant_id === CITY), [])
  // DC Hospital's address was never touched
  assertEquals(db.tenant_domains.map((x) => x.domain), ['dchospital.example'])
})

// ------------------------------------------------------------------ Hospital Comrade messaging (phase 3)
Deno.test('a hospital on Hospital Comrade messaging sends through the shared account with its own sender ID; usage is metered', async () => {
  reset()
  Deno.env.set('PLATFORM_SMS_PROVIDER', 'fast2sms'); Deno.env.set('PLATFORM_FAST2SMS_API_KEY', 'platform-f2s'); Deno.env.set('PLATFORM_SMS_SENDER_ID', 'HSPCMR')
  const city = db.app_settings.find((r) => r.tenant_id === CITY)!
  const before = structuredClone(city.data)
  city.data.notifications.sms = { enabled: true, source: 'platform', provider: 'webhook', webhookUrl: 'https://hooks.city.test/sms' }
  city.data.notifications.templates = { appointment_booked: { text: 'x', waParams: 'name' } }
  db.platform_settings[0].data = { templates: { appointment_booked: { smsTemplateId: 'PLAT-1' } } }
  const tenant = db.tenants.find((t) => t.id === CITY)!
  tenant.messaging = { smsSenderId: 'citycl', templates: { appointment_booked: { smsTemplateId: 'CITY-7' } } }
  db.message_usage = []
  try {
    db.notification_outbox = [outRow('p1', CITY, '9810000021'), outRow('p2', DC, '9810000022')].map((r) => ({ ...r, status: 'sending' }))
    claimRows = db.notification_outbox.map((r) => ({ ...r }))
    assertEquals(await (await post(notify, { flush: true }, SERVICE)).json(), { processed: 2, sent: 2, failed: 0 })
    // City: the platform's Fast2SMS key, City's own DLT header + template; nothing to City's own webhook
    const f2s = sent.filter((s) => s.url === 'https://www.fast2sms.com/dev/bulkV2')
    assertEquals(f2s.length, 1)
    assertEquals(f2s[0].body.sender_id, 'CITYCL'); assertEquals(f2s[0].body.message, 'CITY-7'); assertEquals(f2s[0].body.numbers, '9810000021')
    assertEquals(calls.length > 0, true)
    assert(!sent.some((s) => s.url === 'https://hooks.city.test/sms'))
    // DC stays on its own account
    assertEquals(sent.filter((s) => s.url === 'https://hooks.dc.test/sms').map((s) => s.auth), ['Bearer dc-secret'])
    assertEquals(db.notification_outbox.map((r) => [r.id, r.source]), [['p1', 'platform'], ['p2', 'own']])
    const usage = db.message_usage.map((r) => [r.tenant_id, r.channel, r.source, r.sent]).sort()
    assertEquals(usage, [[CITY, 'sms', 'platform', 1], [DC, 'sms', 'own', 1]].sort())
    // ping says which shared accounts exist — never a key
    const ping = await (await post(notify, { ping: true })).json()
    assertEquals(ping.platform, { sms: 'fast2sms', whatsapp: null, email: null })
    assert(!JSON.stringify(ping).includes('platform-f2s'))
  } finally {
    city.data = before; delete tenant.messaging; db.platform_settings[0].data = { templates: {} }
    for (const k of ['PLATFORM_SMS_PROVIDER', 'PLATFORM_FAST2SMS_API_KEY', 'PLATFORM_SMS_SENDER_ID']) Deno.env.delete(k)
  }
})

Deno.test('the monthly allowance stops platform messages (OTPs still go out); a missing shared account fails for good', async () => {
  reset()
  Deno.env.set('PLATFORM_SMS_PROVIDER', 'fast2sms'); Deno.env.set('PLATFORM_FAST2SMS_API_KEY', 'platform-f2s')
  const city = db.app_settings.find((r) => r.tenant_id === CITY)!
  const before = structuredClone(city.data)
  city.data.notifications.sms = { enabled: true, source: 'platform' }
  city.data.notifications.whatsapp = { enabled: true, source: 'platform' }
  const tenant = db.tenants.find((t) => t.id === CITY)!
  tenant.messaging = { limits: { sms: 5 } }
  const month = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7) + '-01'
  db.message_usage = [{ tenant_id: CITY, month, channel: 'sms', source: 'platform', sent: 5, failed: 0 }]
  try {
    db.notification_outbox = [outRow('q1', CITY, '9810000031'), { ...outRow('q2', CITY, '9810000032'), event: 'otp', vars: { code: '123456' } },
      { ...outRow('q3', CITY, '9810000033'), channel: 'whatsapp' }].map((r) => ({ ...r, status: 'sending' }))
    claimRows = db.notification_outbox.map((r) => ({ ...r }))
    assertEquals(await (await post(notify, { flush: true }, SERVICE)).json(), { processed: 3, sent: 1, failed: 2 })
    const byId = Object.fromEntries(db.notification_outbox.map((r) => [r.id, r]))
    assertEquals(byId.q1.status, 'failed'); assert(/allowance \(5\) is used up/.test(byId.q1.error))
    assertEquals(byId.q2.status, 'sent')            // OTP is exempt
    assertEquals(byId.q3.status, 'failed'); assert(/WhatsApp is not configured/.test(byId.q3.error))
    assertEquals(sent.filter((s) => s.url.includes('fast2sms')).length, 1)
    const sms = db.message_usage.find((r) => r.tenant_id === CITY && r.channel === 'sms')!
    assertEquals([sms.sent, sms.failed], [6, 1])
  } finally {
    city.data = before; delete tenant.messaging; db.message_usage = []
    for (const k of ['PLATFORM_SMS_PROVIDER', 'PLATFORM_FAST2SMS_API_KEY']) Deno.env.delete(k)
  }
})

Deno.test('phase 4: beyond the included messages an empty wallet stops platform messages for good; OTPs still go', async () => {
  reset()
  Deno.env.set('PLATFORM_SMS_PROVIDER', 'fast2sms'); Deno.env.set('PLATFORM_FAST2SMS_API_KEY', 'platform-f2s')
  const city = db.app_settings.find((r) => r.tenant_id === CITY)!
  const before = structuredClone(city.data)
  city.data.notifications.sms = { enabled: true, source: 'platform' }
  const tenant = db.tenants.find((t) => t.id === CITY)!
  Object.assign(tenant, { plan: 'clinic', wallet_paise: 0, billing: {} })
  db.platform_settings.push({ key: 'billing', data: { plans: { clinic: { included: { sms: 100 } } }, ratesPaise: { sms: 30 } } })
  const month = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7) + '-01'
  db.message_usage = [{ tenant_id: CITY, month, channel: 'sms', source: 'platform', sent: 100, failed: 0 }]
  try {
    db.notification_outbox = [outRow('w1', CITY, '9810000041'), { ...outRow('w2', CITY, '9810000042'), event: 'otp', vars: { code: '123456' } },
      { ...outRow('w3', CITY, '9810000043'), event: 'billing_reminder' }]
      .map((r) => ({ ...r, status: 'sending' }))
    claimRows = db.notification_outbox.map((r) => ({ ...r }))
    assertEquals(await (await post(notify, { flush: true }, SERVICE)).json(), { processed: 3, sent: 2, failed: 1 })
    const byId = Object.fromEntries(db.notification_outbox.map((r) => [r.id, r]))
    assertEquals(byId.w1.status, 'failed'); assert(/wallet balance is too low/.test(byId.w1.error))
    assertEquals(byId.w2.status, 'sent')
    assertEquals(byId.w3.status, 'sent')                            // phase 6: "your plan ends" must reach the owner
  } finally {
    city.data = before; db.message_usage = []; db.platform_settings = db.platform_settings.filter((r) => r.key !== 'billing')
    delete tenant.plan; delete tenant.wallet_paise; delete tenant.billing
    for (const k of ['PLATFORM_SMS_PROVIDER', 'PLATFORM_FAST2SMS_API_KEY']) Deno.env.delete(k)
  }
})

// ------------------------------------------------------------------ billing (phase 4.3, Razorpay mocked)
import { paymentSignature, webhookSignature } from '../../supabase/functions/_shared/razorpay.ts'
const rzpEnv = (on: boolean) => {
  for (const [k, v] of [['RAZORPAY_KEY_ID', 'rzp_test_key'], ['RAZORPAY_KEY_SECRET', 'rzp_secret'], ['RAZORPAY_WEBHOOK_SECRET', 'whsec']]) {
    if (on) Deno.env.set(k, v)
    else Deno.env.delete(k)
  }
}

Deno.test('billing: only the owner (or platform admin/finance) can pay; without Razorpay keys it says so', async () => {
  reset(); rzpEnv(false)
  assertEquals((await post(billing, { action: 'order', kind: 'plan', months: 1 })).status, 403)
  assertEquals((await post(billing, { action: 'order', kind: 'plan', months: 1 }, 'tok-city-reception')).status, 403)
  assertEquals(await (await post(billing, { action: 'config' }, 'tok-city-owner')).json(), { enabled: false, key_id: null })
  const r = await post(billing, { action: 'order', kind: 'plan', months: 1 }, 'tok-city-owner')
  assertEquals(r.status, 503); assert(/not set up/.test((await r.json()).error))
})

Deno.test('billing: order → checkout → verify applies the payment once; a forged signature is refused', async () => {
  reset(); rzpEnv(true); rzpCalls.length = 0; db.billing_payments = []
  try {
    const o = await (await post(billing, { action: 'order', kind: 'plan', months: 12, amount: 1 }, 'tok-city-owner')).json()
    assertEquals([o.key_id, o.amount, o.currency, o.description], ['rzp_test_key', 1178820, 'INR', 'Clinic plan · 12 months'])
    assertEquals(rzpCalls[0].body.amount, 1178820)                  // the price comes from the database, not the browser
    assertEquals(rzpCalls[0].body.notes.tenant, CITY)
    const row = db.billing_payments[0]
    assertEquals([row.tenant_id, row.order_id, row.status ?? 'created', row.created_by], [CITY, o.order_id, 'created', 'c1c-1'])

    const bad = await post(billing, { action: 'verify', order_id: o.order_id, payment_id: 'pay_1', signature: 'deadbeef' }, 'tok-city-owner')
    assertEquals(bad.status, 400)
    const signature = await paymentSignature('rzp_secret', o.order_id, 'pay_1')
    const ok = await (await post(billing, { action: 'verify', order_id: o.order_id, payment_id: 'pay_1', signature }, 'tok-city-owner')).json()
    assertEquals(ok, { ok: true, already: false, invoice_no: 'HC/2026-27/000001' })
    // another hospital can't claim it
    const dc = await post(billing, { action: 'verify', order_id: o.order_id, payment_id: 'pay_1', signature }, 'tok-admin', { 'x-tenant-id': DC })
    assertEquals(dc.status, 404)
    // the webhook arriving later changes nothing
    const ev = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: o.order_id, method: 'upi' } } } })
    const wh = await billing(new Request(`${SB}/functions/v1/billing?webhook=razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': await webhookSignature('whsec', ev) }, body: ev }))
    assertEquals((await wh.json()).already, true)
  } finally { rzpEnv(false) }
})

Deno.test('billing: the webhook applies a payment when the browser never returned; bad signatures and unknown orders are ignored', async () => {
  reset(); rzpEnv(true); rzpCalls.length = 0; db.billing_payments = []
  try {
    const o = await (await post(billing, { action: 'order', kind: 'wallet', amount: 1000 }, 'tok-admin', { 'x-tenant-id': CITY, 'x-provider-mode': 'finance' })).json()
    assertEquals(o.amount, 118000)
    const ev = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: o.order_id } }, payment: { entity: { id: 'pay_9', order_id: o.order_id, method: 'card' } } } })
    const forged = await billing(new Request(`${SB}/functions/v1/billing?webhook=razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': 'abc' }, body: ev }))
    assertEquals(forged.status, 401)
    assertEquals(db.billing_payments[0].status ?? 'created', 'created')
    const r = await billing(new Request(`${SB}/functions/v1/billing?webhook=razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': await webhookSignature('whsec', ev) }, body: ev }))
    assertEquals((await r.json()).invoice_no, 'HC/2026-27/000001')
    assertEquals([db.billing_payments[0].status, db.billing_payments[0].payment_id], ['paid', 'pay_9'])
    const other = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_other_app' } } } })
    const ig = await billing(new Request(`${SB}/functions/v1/billing?webhook=razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': await webhookSignature('whsec', other) }, body: other }))
    assertEquals(await ig.json(), { ok: true, ignored: 'unknown order' })
    // bad plan length → the database's message
    const bad = await post(billing, { action: 'order', kind: 'plan', months: 3 }, 'tok-city-owner')
    assertEquals(bad.status, 400); assert(/1 month or 12/.test((await bad.json()).error))
  } finally { rzpEnv(false) }
})

Deno.test('billing (phase 6): an order may renew on another plan — priced by the database, recorded on the payment', async () => {
  reset(); rzpEnv(true); rzpCalls.length = 0; db.billing_payments = []
  try {
    const o = await (await post(billing, { action: 'order', kind: 'plan', months: 1, plan: 'hospital' }, 'tok-city-owner')).json()
    assertEquals([o.amount, o.description], [353882, 'Hospital plan · 1 month'])
    assertEquals(db.billing_payments[0].plan, 'hospital')
    const bad = await post(billing, { action: 'order', kind: 'plan', months: 1, plan: 'gold' }, 'tok-city-owner')
    assertEquals(bad.status, 400)
  } finally { rzpEnv(false) }
})

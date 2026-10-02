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
  ],
  site_content: [
    { tenant_id: DC, key: 'settings', data: { name: 'DC Hospital' } },
    { tenant_id: CITY, key: 'settings', data: { name: 'City Care Clinic', phone: '+91 612 400 1100' } },
  ],
  notification_templates: [], push_tokens: [], wa_sessions: [], notification_outbox: [],
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
    if (method === 'DELETE') return reply([], h)
  }
  return new Response('not mocked: ' + url.pathname, { status: 404 })
}

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const req = input instanceof Request ? input : null
  const url = new URL(req ? req.url : String(input))
  const headers = new Headers(init.headers ?? req?.headers)
  const body = init.body ?? (req ? await req.text() : undefined)
  if (url.origin === SB) return supabase(url, { ...init, method: init.method ?? req?.method, headers, body })
  sent.push({ url: url.href, auth: headers.get('authorization'), body: body ? JSON.parse(String(body)) : null })
  return new Response('{}', { status: 200, headers: { 'x-request-id': 'req-1' } })
}) as typeof fetch

// capture each function's handler instead of starting a server
const handlers: ((req: Request) => Promise<Response>)[] = []
;(Deno as any).serve = (h: any) => { handlers.push(h); return { finished: Promise.resolve(), shutdown() {} } }
await import('../../supabase/functions/notify/index.ts')
await import('../../supabase/functions/whatsapp-bot/index.ts')
const [notify, bot] = handlers

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
  const meta = { entry: [{ changes: [{ value: { messages: [{ from: '919876500001', text: { body: '1' } }] } }] }] }
  const r = await bot(new Request(`${SB}/functions/v1/whatsapp-bot?hospital=citycare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) }))
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

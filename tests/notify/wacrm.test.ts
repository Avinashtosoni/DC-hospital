/**
 * wacrm (github.com/ArnasDon/wacrm) — the WhatsApp provider, its key / scope check, the shared platform account,
 * the System-health check and the signed message.received webhook that feeds the booking chatbot.
 * fetch is mocked; shapes follow wacrm's docs/public-api.md.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { deliver, isPermanent, wacrmStatus, type Ctx, type Msg } from '../../supabase/functions/_shared/providers'
import { e164, parseWacrm, verifyWacrmSignature, wacrmBase, wacrmContactPhone, wacrmMe, wacrmRegisterWebhook, wacrmSignature } from '../../supabase/functions/_shared/wacrm'
import { platformAccounts, PLATFORM_PROVIDERS } from '../../supabase/functions/_shared/platform'
import { checkProviders } from '../../supabase/functions/_shared/ops'
import { ACCOUNTS, fieldsFor } from '../../control-panel/src/pages/messaging/accounts'

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } }
let calls: Call[] = []
function mockFetch(...replies: Array<[number, unknown]>) {
  calls = []
  let i = 0
  const f = vi.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init })
    const [status, body] = replies[Math.min(i++, replies.length - 1)] ?? [200, {}]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  })
  vi.stubGlobal('fetch', f)
  return f as unknown as typeof fetch
}
afterEach(() => vi.unstubAllGlobals())
const body = (n = 0) => JSON.parse(String(calls[n].init.body))
const ctx = (n: Record<string, unknown>, secrets: Record<string, string> = { wacrm_api_key: 'wacrm_live_abc' }): Ctx => ({ n, secrets, hospital: 'DC Hospital' })
const wa = { whatsapp: { enabled: true, provider: 'wacrm', wacrmUrl: 'https://crm.example.in/', language: 'en' } }
const confirm: Msg = { event: 'appointment_confirmed', channel: 'whatsapp', recipient: '98765 43210', body: 'Hi Asha, confirmed', vars: { name: 'Asha', date: '12 Oct', time: '10:30' } }
const me = (scopes: string[]) => ({ data: { account: { id: 'acc_1', name: 'DC Hospital CRM' }, key: { id: 'key_1', scopes } } })

describe('helpers', () => {
  test('base URL and E.164 numbers', () => {
    expect(wacrmBase('https://crm.example.in/api/v1/')).toBe('https://crm.example.in')
    expect(() => wacrmBase('http://crm.example.in')).toThrow(/https/)
    expect(e164('98765 43210')).toBe('+919876543210')
    expect(e164('+91 98765 43210')).toBe('+919876543210')
    expect(e164('919876543210')).toBe('+919876543210')
  })
})

describe('sending', () => {
  test('business messages use the approved template with the mapped parameters', async () => {
    mockFetch([201, { data: { message_id: 'm1', whatsapp_message_id: 'wamid.X' } }])
    const r = await deliver(confirm, ctx({ ...wa, templates: { appointment_confirmed: { waTemplate: 'appt_confirmed', waParams: 'name,date,time' } } }))
    expect(r).toEqual({ ok: true, ref: 'wamid.X' })
    expect(calls[0].url).toBe('https://crm.example.in/api/v1/messages')
    expect(calls[0].init.headers.Authorization).toBe('Bearer wacrm_live_abc')
    expect(calls[0].init.redirect).toBe('manual')
    expect(body()).toEqual({ to: '+919876543210', type: 'template', template: { name: 'appt_confirmed', language: 'en', params: ['Asha', '12 Oct', '10:30'] } })
  })
  test('no template for a business message → permanent config error, nothing sent', async () => {
    mockFetch()
    const r = await deliver(confirm, ctx(wa))
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
    expect(isPermanent(r.error)).toBe(true)
  })
  test('test and chatbot replies go as free text', async () => {
    mockFetch([201, { data: { message_id: 'm2' } }])
    const r = await deliver({ ...confirm, event: 'bot', body: 'Pick a doctor' }, ctx(wa))
    expect(r).toEqual({ ok: true, ref: 'm2' })
    expect(body()).toEqual({ to: '+919876543210', type: 'text', text: 'Pick a doctor' })
  })
  test('errors: bad key and missing scope are permanent, rate limit retries, 24-hour window explained', async () => {
    mockFetch([401, { error: { code: 'unauthorized', message: 'Invalid API key' } }])
    let r = await deliver({ ...confirm, event: 'test' }, ctx(wa))
    expect(r.error).toMatch(/rejected the API key/); expect(isPermanent(r.error)).toBe(true)
    mockFetch([403, { error: { code: 'forbidden', message: 'missing scope messages:send' } }])
    r = await deliver({ ...confirm, event: 'test' }, ctx(wa))
    expect(isPermanent(r.error)).toBe(true)
    mockFetch([429, { error: { code: 'rate_limited', message: 'slow down' } }])
    r = await deliver({ ...confirm, event: 'test' }, ctx(wa))
    expect(r.error).toMatch(/429/); expect(isPermanent(r.error)).toBe(false)
    mockFetch([502, { error: { code: 'meta_error', message: '(#131047) Re-engagement message' } }])
    r = await deliver({ ...confirm, event: 'test' }, ctx(wa))
    expect(r.error).toMatch(/24 hours/); expect(isPermanent(r.error)).toBe(true)
    mockFetch([400, { error: { code: 'whatsapp_not_configured', message: 'x' } }])
    r = await deliver({ ...confirm, event: 'test' }, ctx(wa))
    expect(isPermanent(r.error)).toBe(true)
  })
})

describe('key check (GET /api/v1/me)', () => {
  test('valid key with messages:send', async () => {
    mockFetch([200, me(['messages:send', 'contacts:read'])])
    const r = await wacrmStatus(ctx(wa))
    expect(r).toMatchObject({ ok: true, account: 'DC Hospital CRM', scopes: ['messages:send', 'contacts:read'], missing: [] })
    expect(calls[0].url).toBe('https://crm.example.in/api/v1/me')
  })
  test('missing scope and missing key', async () => {
    mockFetch([200, me(['contacts:read'])])
    expect(await wacrmStatus(ctx(wa))).toMatchObject({ ok: false, missing: ['messages:send'], error: expect.stringMatching(/messages:send/) })
    expect((await wacrmMe('https://crm.example.in', '')).error).toMatch(/not configured/)
  })
})

describe('chatbot', () => {
  test('signature: valid, tampered, stale, missing secret', async () => {
    const raw = JSON.stringify({ id: 'evt_1', event: 'message.received', account_id: 'acc_1', data: { contact_id: 'c_1', content_type: 'text', text: 'hi' } })
    const now = 1_760_000_000
    const sig = await wacrmSignature('whsec_s', raw, now)
    expect(await verifyWacrmSignature(raw, sig, 'whsec_s', now + 10)).toBe(true)
    expect(await verifyWacrmSignature(raw + ' ', sig, 'whsec_s', now)).toBe(false)
    expect(await verifyWacrmSignature(raw, sig, 'whsec_s', now + 301)).toBe(false)
    expect(await parseWacrm(raw, sig, { secret: 'whsec_s', nowSec: now })).toEqual({ kind: 'message', contactId: 'c_1', text: 'hi', key: 'evt_1' })
    expect(await parseWacrm(raw, sig, { nowSec: now })).toMatchObject({ kind: 'reject', status: 401 })
    expect(await parseWacrm(raw, 't=1,v1=00', { secret: 'whsec_s', nowSec: now })).toMatchObject({ kind: 'reject' })
  })
  test('other events are acknowledged, media becomes "menu"', async () => {
    const now = 1_760_000_000
    const status = JSON.stringify({ id: 'e2', event: 'message.status_updated', data: {} })
    expect(await parseWacrm(status, await wacrmSignature('k', status, now), { secret: 'k', nowSec: now })).toMatchObject({ kind: 'ignore' })
    const img = JSON.stringify({ id: 'e3', event: 'message.received', data: { contact_id: 'c', content_type: 'image', text: null } })
    expect(await parseWacrm(img, await wacrmSignature('k', img, now), { secret: 'k', nowSec: now })).toMatchObject({ kind: 'message', text: 'menu' })
  })
  test('contact lookup → 10-digit Indian mobile only', async () => {
    mockFetch([200, { data: { id: 'c_1', phone: '+919876543210' } }])
    expect(await wacrmContactPhone('https://crm.example.in', 'k', 'c_1')).toBe('9876543210')
    expect(calls[0].url).toBe('https://crm.example.in/api/v1/contacts/c_1')
    mockFetch([200, { data: { id: 'c_2', phone: '+14155550100' } }])
    expect(await wacrmContactPhone('https://crm.example.in', 'k', 'c_2')).toBe('')
    expect(await wacrmContactPhone('https://crm.example.in', 'k', '../me')).toBe('')
  })
  test('register the webhook and get its secret', async () => {
    mockFetch([201, { data: { id: 'wh_1', secret: 'whsec_new', url: 'https://x.supabase.co/functions/v1/whatsapp-bot' } }])
    expect(await wacrmRegisterWebhook('https://crm.example.in', 'k', 'https://x.supabase.co/functions/v1/whatsapp-bot')).toEqual({ id: 'wh_1', secret: 'whsec_new' })
    expect(body()).toEqual({ url: 'https://x.supabase.co/functions/v1/whatsapp-bot', events: ['message.received'] })
    mockFetch([403, { error: { code: 'forbidden', message: 'webhooks:manage required' } }])
    await expect(wacrmRegisterWebhook('https://crm.example.in', 'k', 'https://x.supabase.co/f')).rejects.toThrow(/scope/)
  })
})

describe('shared platform account', () => {
  const env = (o: Record<string, string>) => (k: string) => o[k]
  test('PLATFORM_WACRM_* → a WhatsApp account; the control panel card has the same fields', () => {
    expect(PLATFORM_PROVIDERS.whatsapp).toContain('wacrm')
    expect(platformAccounts(env({ PLATFORM_WHATSAPP_PROVIDER: 'wacrm', PLATFORM_WACRM_URL: 'https://crm.example.in', PLATFORM_WACRM_API_KEY: 'wacrm_live_x' })).whatsapp)
      .toEqual({ provider: 'wacrm', cfg: { language: 'en', wacrmUrl: 'https://crm.example.in' }, secrets: { wacrm_api_key: 'wacrm_live_x' } })
    const spec = ACCOUNTS.find((a) => a.channel === 'whatsapp')!
    expect(fieldsFor(spec, 'wacrm').map((f) => f.key)).toEqual(expect.arrayContaining(['PLATFORM_WACRM_URL', 'PLATFORM_WACRM_API_KEY']))
    expect(fieldsFor(spec, 'wacrm').find((f) => f.key === 'PLATFORM_WACRM_API_KEY')?.secret).toBe(true)
  })
  test('System health: provider:whatsapp reads /me', async () => {
    const f = mockFetch([200, me(['messages:send'])])
    const out = await checkProviders({ env: env({ PLATFORM_WHATSAPP_PROVIDER: 'wacrm', PLATFORM_WACRM_URL: 'https://crm.example.in', PLATFORM_WACRM_API_KEY: 'k' }), fetch: f } as never)
    const w = out.find((c) => c.service === 'provider:whatsapp')!
    expect(w).toMatchObject({ status: 'ok', detail: expect.stringContaining('DC Hospital CRM') })
    mockFetch([401, { error: { code: 'unauthorized', message: 'bad' } }])
    const bad = await checkProviders({ env: env({ PLATFORM_WHATSAPP_PROVIDER: 'wacrm', PLATFORM_WACRM_URL: 'https://crm.example.in', PLATFORM_WACRM_API_KEY: 'k' }), fetch: fetch } as never)
    expect(bad.find((c) => c.service === 'provider:whatsapp')).toMatchObject({ status: 'fail' })
  })
})

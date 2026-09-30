/**
 * Contract tests for the SMS / WhatsApp / email adapters used by the notify Edge Function.
 * fetch is mocked: each test checks the exact URL, auth header and payload shape the provider's public
 * API expects, plus how provider errors are surfaced. (Real delivery still needs your keys: Settings →
 * Notifications → "Send test".)
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { deliver, isPermanent, retryDelayMs, type Ctx, type Msg } from '../../supabase/functions/_shared/providers'

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } }
let calls: Call[] = []
function mockFetch(status = 200, body: unknown = {}, headers: Record<string, string> = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
  }))
}
afterEach(() => vi.unstubAllGlobals())
const jsonBody = () => JSON.parse(String(calls[0].init.body))
const formBody = () => Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))

const otp: Msg = { event: 'otp', channel: 'sms', recipient: '+91 98765 43210', body: 'Your code is 123456', vars: { code: '123456', otp: '123456', name: 'Asha' } }
const confirm: Msg = { event: 'appointment_confirmed', channel: 'whatsapp', recipient: '9876543210', body: 'Hi Asha, confirmed', vars: { name: 'Asha', date: '12 Oct', time: '10:30' } }
const mail: Msg = { event: 'invoice_created', channel: 'email', recipient: 'asha@example.in', subject: 'Your bill', body: 'Total <₹500>', vars: {} }
const ctx = (n: Record<string, unknown>, secrets: Record<string, string> = {}): Ctx => ({ n, secrets, hospital: 'DC Hospital' })

describe('SMS', () => {
  test('MSG91 flow API', async () => {
    mockFetch(200, { type: 'success', message: 'req-1' })
    const r = await deliver(otp, ctx({ sms: { enabled: true, provider: 'msg91' }, templates: { otp: { smsTemplateId: 'tmpl-9' } } }, { msg91_auth_key: 'AK' }))
    expect(r).toEqual({ ok: true, ref: 'req-1' })
    expect(calls[0].url).toBe('https://control.msg91.com/api/v5/flow')
    expect(calls[0].init.headers.authkey).toBe('AK')
    expect(jsonBody()).toMatchObject({ template_id: 'tmpl-9', recipients: [{ mobiles: '919876543210', code: '123456' }] })
  })
  test('MSG91 without a DLT template is a config error, no request sent', async () => {
    mockFetch()
    const r = await deliver(otp, ctx({ sms: { enabled: true, provider: 'msg91' } }, { msg91_auth_key: 'AK' }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/template ID/)
    expect(isPermanent(r.error)).toBe(true)
    expect(calls).toHaveLength(0)
  })
  test('MSG91 error responses are reported', async () => {
    mockFetch(200, { type: 'error', message: 'Invalid authkey' })
    const r = await deliver(otp, ctx({ sms: { enabled: true, provider: 'msg91' }, templates: { otp: { smsTemplateId: 't' } } }, { msg91_auth_key: 'bad' }))
    expect(r).toEqual({ ok: false, error: 'Invalid authkey' })
  })
  test('Twilio Messages API (form encoded, basic auth)', async () => {
    mockFetch(201, { sid: 'SM1' })
    const r = await deliver(otp, ctx({ sms: { enabled: true, provider: 'twilio', twilioAccountSid: 'AC1', twilioFrom: '+15550001' } }, { twilio_auth_token: 'tok' }))
    expect(r.ref).toBe('SM1')
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')
    expect(calls[0].init.headers.Authorization).toBe('Basic ' + btoa('AC1:tok'))
    expect(formBody()).toEqual({ To: '+919876543210', From: '+15550001', Body: 'Your code is 123456' })
  })
  test('Fast2SMS quick route and DLT route', async () => {
    mockFetch(200, { return: true, request_id: 'f1' })
    await deliver(otp, ctx({ sms: { enabled: true, provider: 'fast2sms' } }, { fast2sms_api_key: 'FK' }))
    expect(calls[0].url).toBe('https://www.fast2sms.com/dev/bulkV2')
    expect(calls[0].init.headers.authorization).toBe('FK')
    expect(jsonBody()).toEqual({ route: 'q', message: 'Your code is 123456', numbers: '9876543210' })
    mockFetch(200, { return: true, request_id: 'f2' })
    await deliver(otp, ctx({ sms: { enabled: true, provider: 'fast2sms', senderId: 'DCHOSP' }, templates: { otp: { smsTemplateId: '1107', waParams: 'code' } } }, { fast2sms_api_key: 'FK' }))
    expect(jsonBody()).toEqual({ route: 'dlt', sender_id: 'DCHOSP', message: '1107', variables_values: '123456', numbers: '9876543210' })
  })
  test('Fast2SMS return:false is a failure', async () => {
    mockFetch(200, { return: false, message: ['Invalid Authentication'] })
    const r = await deliver(otp, ctx({ sms: { enabled: true, provider: 'fast2sms' } }, { fast2sms_api_key: 'FK' }))
    expect(r).toEqual({ ok: false, error: 'Invalid Authentication' })
  })
  test('switched-off channel sends nothing', async () => {
    mockFetch()
    const r = await deliver(otp, ctx({ sms: { enabled: false, provider: 'twilio' } }))
    expect(r.error).toMatch(/switched off/)
    expect(calls).toHaveLength(0)
  })
})

describe('WhatsApp', () => {
  const meta = { whatsapp: { enabled: true, provider: 'meta', phoneNumberId: 'PN1', language: 'en' }, templates: { appointment_confirmed: { waTemplate: 'appt_ok', waParams: 'name,date,time' }, otp: { waTemplate: 'otp_auth', waParams: 'code' } } }
  test('Meta Cloud API template message with body parameters', async () => {
    mockFetch(200, { messages: [{ id: 'wamid.1' }] })
    const r = await deliver(confirm, ctx(meta, { meta_access_token: 'EAAG' }))
    expect(r.ref).toBe('wamid.1')
    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/PN1/messages')
    expect(calls[0].init.headers.Authorization).toBe('Bearer EAAG')
    expect(jsonBody()).toEqual({ messaging_product: 'whatsapp', to: '919876543210', type: 'template', template: {
      name: 'appt_ok', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: '12 Oct' }, { type: 'text', text: '10:30' }] }] } })
  })
  test('Meta authentication template carries the code on the copy-code button', async () => {
    mockFetch(200, { messages: [{ id: 'wamid.2' }] })
    await deliver({ ...otp, channel: 'whatsapp' }, ctx(meta, { meta_access_token: 'EAAG' }))
    expect(jsonBody().template.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] })
  })
  test('Meta bot replies are plain text; API errors are surfaced', async () => {
    mockFetch(200, { messages: [{ id: 'wamid.3' }] })
    await deliver({ ...confirm, event: 'bot', body: 'Choose a doctor' }, ctx(meta, { meta_access_token: 'EAAG' }))
    expect(jsonBody()).toMatchObject({ type: 'text', text: { body: 'Choose a doctor' } })
    mockFetch(401, { error: { message: 'Invalid OAuth access token.' } })
    expect(await deliver(confirm, ctx(meta, { meta_access_token: 'x' }))).toEqual({ ok: false, error: 'Invalid OAuth access token.' })
  })
  test('Interakt template API', async () => {
    mockFetch(201, { id: 'ik-1' })
    await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'interakt', language: 'en' }, templates: meta.templates }, { interakt_api_key: 'IKEY' }))
    expect(calls[0].url).toBe('https://api.interakt.ai/v1/public/message/')
    expect(calls[0].init.headers.Authorization).toBe('Basic IKEY')
    expect(jsonBody()).toEqual({ countryCode: '+91', phoneNumber: '9876543210', type: 'Template', template: { name: 'appt_ok', languageCode: 'en', bodyValues: ['Asha', '12 Oct', '10:30'] } })
  })
  test('Twilio WhatsApp prefixes whatsapp:', async () => {
    mockFetch(201, { sid: 'SM2' })
    await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'twilio', twilioAccountSid: 'AC1', twilioFrom: '+14155238886' } }, { twilio_auth_token: 't' }))
    expect(formBody()).toMatchObject({ To: 'whatsapp:+919876543210', From: 'whatsapp:+14155238886' })
  })
})

describe('Email', () => {
  test('Resend', async () => {
    mockFetch(200, { id: 're_1' })
    await deliver(mail, ctx({ email: { enabled: true, provider: 'resend', fromEmail: 'care@dc.in', fromName: 'DC Care' } }, { resend_api_key: 're_key' }))
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    expect(calls[0].init.headers.Authorization).toBe('Bearer re_key')
    const b = jsonBody()
    expect(b).toMatchObject({ from: 'DC Care <care@dc.in>', to: ['asha@example.in'], subject: 'Your bill', text: 'Total <₹500>' })
    expect(b.html).toContain('Total &lt;₹500&gt;')   // escaped
  })
  test('SendGrid v3', async () => {
    mockFetch(202, '', { 'x-message-id': 'sg-1' })
    const r = await deliver(mail, ctx({ email: { enabled: true, provider: 'sendgrid', fromEmail: 'care@dc.in', replyTo: 'desk@dc.in' } }, { sendgrid_api_key: 'SG' }))
    expect(r.ref).toBe('sg-1')
    expect(jsonBody()).toMatchObject({ personalizations: [{ to: [{ email: 'asha@example.in' }] }], from: { email: 'care@dc.in', name: 'DC Hospital' }, reply_to: { email: 'desk@dc.in' } })
  })
  test('SMTP on blocked ports is refused up front', async () => {
    const r = await deliver(mail, ctx({ email: { enabled: true, provider: 'smtp', fromEmail: 'a@b.in', smtpHost: 'smtp.x', smtpUser: 'u', smtpPort: 587 } }, { smtp_password: 'p' }))
    expect(r.error).toMatch(/465/)
  })
})

describe('webhook + retry policy', () => {
  test('webhook must be https and gets a bearer secret', async () => {
    expect((await deliver(otp, ctx({ sms: { enabled: true, provider: 'webhook', webhookUrl: 'http://x' } }))).error).toMatch(/https/)
    mockFetch(200, 'ok')
    await deliver(otp, ctx({ sms: { enabled: true, provider: 'webhook', webhookUrl: 'https://hooks.example/sms' } }, { sms_webhook_secret: 'S' }))
    expect(calls[0].init.headers.Authorization).toBe('Bearer S')
    expect(jsonBody()).toMatchObject({ channel: 'sms', to: '+919876543210', event: 'otp', message: 'Your code is 123456' })
  })
  test('backoff grows 2 → 4 → 8 minutes', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([120_000, 240_000, 480_000])
    expect(isPermanent('HTTP 503')).toBe(false)
  })
})

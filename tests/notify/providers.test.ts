/**
 * Contract tests for the SMS / WhatsApp / email adapters used by the notify Edge Function.
 * fetch is mocked: each test checks the exact URL, auth header and payload shape the provider's public
 * API expects, plus how provider errors are surfaced. (Real delivery still needs your keys: Settings →
 * Notifications → "Send test".)
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { chatIdFor, deliver, isPermanent, openwaStatus, phoneFromChatId, retryDelayMs, type Ctx, type Msg } from '../../supabase/functions/_shared/providers'

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

describe('WhatsApp — OpenWA gateway', () => {
  const KEY = 'owa_k1_test'
  const SESSION = '9b11cfeb-b5a2-4636-8415-d29cf3555089'
  const wa = (extra: Record<string, unknown> = {}) => ctx({ whatsapp: { enabled: true, provider: 'openwa', openwaUrl: 'https://wacrm.example.in/', openwaSession: SESSION, ...extra } }, { openwa_api_key: KEY })

  test('send-text: URL, X-API-Key header and { chatId, text } body (chat ID from the mobile)', async () => {
    mockFetch(201, { messageId: 'true_919876543210@c.us_3EB0' })
    const r = await deliver(confirm, wa())
    expect(r).toEqual({ ok: true, ref: 'true_919876543210@c.us_3EB0' })
    expect(calls[0].url).toBe(`https://wacrm.example.in/api/sessions/${SESSION}/messages/send-text`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers['X-API-Key']).toBe(KEY)
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
    expect(calls[0].init.redirect).toBe('manual')   // key never follows a redirect
    expect(jsonBody()).toEqual({ chatId: '919876543210@c.us', text: 'Hi Asha, confirmed' })
  })
  test('the OTP goes out as plain text — no Meta template needed', async () => {
    mockFetch(200, { id: 'm1' })
    const r = await deliver({ ...otp, channel: 'whatsapp' }, wa())
    expect(r.ok).toBe(true)
    expect(jsonBody()).toEqual({ chatId: '919876543210@c.us', text: 'Your code is 123456' })
  })
  test('custom chat ID format, and a pasted /api base URL is tolerated', async () => {
    mockFetch(200, {})
    await deliver(confirm, wa({ chatIdFormat: '{phone}@s.whatsapp.net', openwaUrl: 'https://wacrm.example.in/api' }))
    expect(calls[0].url).toBe(`https://wacrm.example.in/api/sessions/${SESSION}/messages/send-text`)
    expect(jsonBody().chatId).toBe('9876543210@s.whatsapp.net')
  })
  test('missing key / session / URL are permanent config errors, nothing sent', async () => {
    mockFetch()
    for (const c of [ctx({ whatsapp: { enabled: true, provider: 'openwa', openwaUrl: 'https://x.in', openwaSession: SESSION } }),
      ctx({ whatsapp: { enabled: true, provider: 'openwa', openwaUrl: 'https://x.in' } }, { openwa_api_key: KEY }),
      ctx({ whatsapp: { enabled: true, provider: 'openwa', openwaUrl: 'wacrm.example.in', openwaSession: SESSION } }, { openwa_api_key: KEY })]) {
      const r = await deliver(confirm, c)
      expect(r.ok).toBe(false)
      expect(isPermanent(r.error)).toBe(true)
    }
    expect(calls).toHaveLength(0)
  })
  test('gateway errors are explained; disconnected phone and pacing are retried, bad key is not', async () => {
    mockFetch(409, { statusCode: 409, message: 'Session not ready', error: 'Conflict' })
    let r = await deliver(confirm, wa())
    expect(r.error).toMatch(/not connected.*scan the QR/)
    expect(isPermanent(r.error)).toBe(false)
    mockFetch(429, { statusCode: 429, code: 'SEND_PACING_LIMITED', message: 'Slow down', retryAfterSeconds: 5 })
    r = await deliver(confirm, wa())
    expect(r.error).toMatch(/pacing/)
    expect(isPermanent(r.error)).toBe(false)
    mockFetch(401, { statusCode: 401, message: 'Invalid API key' })
    r = await deliver(confirm, wa())
    expect(r.error).toMatch(/rejected the API key/)
    expect(isPermanent(r.error)).toBe(true)
  })
  test('session status check (used by Send test)', async () => {
    mockFetch(200, { id: SESSION, status: 'ready', phone: '919000000001' })
    expect(await openwaStatus(wa())).toEqual({ ok: true, status: 'ready', phone: '919000000001', error: undefined })
    expect(calls[0].url).toBe(`https://wacrm.example.in/api/sessions/${SESSION}`)
    expect(calls[0].init.headers['X-API-Key']).toBe(KEY)
    mockFetch(200, { id: SESSION, status: 'qr_ready' })
    const st = await openwaStatus(wa())
    expect(st.ok).toBe(false)
    expect(st.error).toMatch(/"qr_ready".*scan the QR/)
  })
  test('chat ID helpers', () => {
    expect(chatIdFor('+91 98765 43210')).toBe('919876543210@c.us')
    expect(() => chatIdFor('9876543210', '91@c.us')).toThrow(/\{phone\}/)
    expect(phoneFromChatId('919876543210@c.us')).toBe('9876543210')
    expect(phoneFromChatId('whatsapp:+919876543210')).toBe('9876543210')
    expect(phoneFromChatId('120363025@g.us')).toBe('')
    expect(phoneFromChatId('status@broadcast')).toBe('')
    expect(phoneFromChatId('2401234567@lid')).toBe('')   // privacy ID, not a phone
    expect(phoneFromChatId('919876543210@s.whatsapp.net')).toBe('9876543210')
  })
})

describe('WhatsApp — AiSensy and MSG91 (Phase 3)', () => {
  const templates = { appointment_confirmed: { waTemplate: 'appt_ok', waParams: 'name, date, time' }, otp: { waTemplate: 'otp_auth', waParams: 'code' } }
  test('AiSensy API campaign: key in the body, campaign = template field, params in order', async () => {
    mockFetch(200, { success: 'true', submitted_message_id: 'as-1' })
    const r = await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'aisensy' }, templates }, { aisensy_api_key: 'AS' }))
    expect(r).toEqual({ ok: true, ref: 'as-1' })
    expect(calls[0].url).toBe('https://backend.aisensy.com/campaign/t1/api/v2')
    expect(jsonBody()).toMatchObject({ apiKey: 'AS', campaignName: 'appt_ok', destination: '919876543210', userName: 'Asha', templateParams: ['Asha', '12 Oct', '10:30'] })
    expect(jsonBody().buttons).toBeUndefined()
  })
  test('AiSensy OTP adds the copy-code button; test uses the test campaign', async () => {
    mockFetch(200, {})
    await deliver({ ...otp, channel: 'whatsapp' }, ctx({ whatsapp: { enabled: true, provider: 'aisensy' }, templates }, { aisensy_api_key: 'AS' }))
    expect(jsonBody()).toMatchObject({ campaignName: 'otp_auth', templateParams: ['123456'], buttons: [{ sub_type: 'url', parameters: [{ text: '123456' }] }] })
    mockFetch(200, {})
    const t = await deliver({ event: 'test', channel: 'whatsapp', recipient: '9876543210', body: 'x', vars: { hospital: 'City Care' } }, ctx({ whatsapp: { provider: 'aisensy', aisensyTestCampaign: 'hc_test' } }, { aisensy_api_key: 'AS' }))
    expect(t.ok).toBe(true)
    expect(jsonBody()).toMatchObject({ campaignName: 'hc_test', templateParams: ['City Care'] })
  })
  test('AiSensy: missing campaign / bot replies are permanent, nothing sent; errors surfaced', async () => {
    mockFetch()
    const a = await deliver({ ...confirm, event: 'lab_report_ready' }, ctx({ whatsapp: { enabled: true, provider: 'aisensy' }, templates }, { aisensy_api_key: 'AS' }))
    const b = await deliver({ ...confirm, event: 'bot' }, ctx({ whatsapp: { enabled: true, provider: 'aisensy' }, templates }, { aisensy_api_key: 'AS' }))
    expect(calls).toHaveLength(0)
    expect(isPermanent(a.error)).toBe(true); expect(isPermanent(b.error)).toBe(true)
    mockFetch(400, { message: 'Campaign not live' })
    const c = await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'aisensy' }, templates }, { aisensy_api_key: 'AS' }))
    expect(c).toEqual({ ok: false, error: 'AiSensy: Campaign not live' })
    mockFetch(401, 'Unauthorized')
    const d = await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'aisensy' }, templates }, { aisensy_api_key: 'AS' }))
    expect(isPermanent(d.error)).toBe(true)
  })
  test('MSG91 WhatsApp template via bulk endpoint: body_n variables, OTP button, namespace, language', async () => {
    mockFetch(200, { status: 'success', hasError: false, request_id: 'm-1' })
    const r = await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'msg91', msg91Number: '+91 80000 11111', language: 'en_US', msg91Namespace: 'ns-1' }, templates }, { msg91_auth_key: 'AK' }))
    expect(r).toEqual({ ok: true, ref: 'm-1' })
    expect(calls[0].url).toBe('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/')
    expect(calls[0].init.headers.authkey).toBe('AK')
    const b = jsonBody()
    expect(b).toMatchObject({ integrated_number: '918000011111', content_type: 'template' })
    expect(b.payload.template).toMatchObject({ name: 'appt_ok', namespace: 'ns-1', language: { code: 'en_US', policy: 'deterministic' } })
    expect(b.payload.template.to_and_components[0]).toEqual({ to: ['919876543210'], components: { body_1: { type: 'text', value: 'Asha' }, body_2: { type: 'text', value: '12 Oct' }, body_3: { type: 'text', value: '10:30' } } })
    mockFetch(200, { status: 'success' })
    await deliver({ ...otp, channel: 'whatsapp' }, ctx({ whatsapp: { enabled: true, provider: 'msg91', msg91Number: '918000011111' }, templates }, { msg91_auth_key: 'AK' }))
    expect(jsonBody().payload.template.to_and_components[0].components.button_1).toEqual({ subtype: 'url', type: 'text', value: '123456' })
  })
  test('MSG91 WhatsApp free text for test / bot; hasError is a failure; missing number is permanent', async () => {
    mockFetch(200, { status: 'success', request_id: 'm-2' })
    await deliver({ ...confirm, event: 'bot', body: 'Hello!' }, ctx({ whatsapp: { enabled: true, provider: 'msg91', msg91Number: '918000011111' } }, { msg91_auth_key: 'AK' }))
    expect(calls[0].url).toBe('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/')
    expect(jsonBody()).toEqual({ integrated_number: '918000011111', recipient_number: '919876543210', content_type: 'text', text: 'Hello!' })
    mockFetch(200, { hasError: true, errors: 'Template not approved' })
    const e = await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'msg91', msg91Number: '918000011111' }, templates }, { msg91_auth_key: 'AK' }))
    expect(e).toEqual({ ok: false, error: 'MSG91 WhatsApp: Template not approved' })
    mockFetch()
    const n = await deliver(confirm, ctx({ whatsapp: { enabled: true, provider: 'msg91' }, templates }, { msg91_auth_key: 'AK' }))
    expect(calls).toHaveLength(0); expect(isPermanent(n.error)).toBe(true)
  })
})

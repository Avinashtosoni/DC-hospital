// Provider adapters for SMS / WhatsApp / email. Shared by the `notify` and `whatsapp-bot` Edge Functions
// and unit-tested with a mocked fetch in tests/notify/providers.test.ts (request shapes follow each
// provider's public API docs), so a typo in a URL or payload is caught before it reaches production.
// deno-lint-ignore-file no-explicit-any
import { parseServiceAccount, sendPush } from './fcm.ts'

export type Channel = 'sms' | 'whatsapp' | 'email' | 'push'
export interface Msg { id?: string; event: string; channel: Channel; recipient: string; subject?: string | null; body: string; vars: Record<string, string> }
export interface Ctx {
  n: any; secrets: Record<string, string>; hospital: string
  /** push: the person's registered devices, and a way to forget the ones Firebase says are gone */
  devices?: { tokens(profileId: string): Promise<string[]>; forget(tokens: string[]): Promise<void>; siteUrl?: string; icon?: string }
}
export interface Result { ok: boolean; ref?: string; error?: string }

/** Errors that will not fix themselves on retry (bad config) → mark failed immediately. */
export const isPermanent = (error = '') => /not configured|switched off|Choose an?|must start with|needs an approved template|rejected the (API|auth) key|cannot send free-text|session was not found|Chat ID format|No devices|no longer registered|service-account JSON/i.test(error)
/** Wait before retry n (1-based): 2, 4, 8 … minutes. */
export const retryDelayMs = (attempts: number) => 2 ** Math.max(1, attempts) * 60_000

const err = async (r: Response) => { const t = await r.text(); try { const j = JSON.parse(t); return j.message || j.error?.message || j.error || j.errors?.[0]?.message || t } catch { return t } }
const need = (v: unknown, what: string) => { if (!v) throw new Error(`${what} is not configured`) }
const basic = (u: string, p: string) => 'Basic ' + btoa(`${u}:${p}`)
const params = (list: string | undefined, vars: Record<string, string>) => (list ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((k) => vars[k] ?? '')

// ------------------------------------------------------------------ SMS
async function sms(m: Msg, c: Ctx): Promise<Result> {
  const cfg = c.n.sms ?? {}
  const tpl = c.n.templates?.[m.event] ?? {}
  const to = m.recipient.replace(/\D/g, '').slice(-10)
  switch (cfg.provider) {
    case 'msg91': {
      need(c.secrets.msg91_auth_key, 'MSG91 auth key')
      if (tpl.smsTemplateId || m.event !== 'test') {
        need(tpl.smsTemplateId, `MSG91 flow/template ID for "${m.event}"`)
        const r = await fetch('https://control.msg91.com/api/v5/flow', {
          method: 'POST', headers: { authkey: c.secrets.msg91_auth_key, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ template_id: tpl.smsTemplateId, short_url: '0', recipients: [{ mobiles: `91${to}`, ...m.vars }] }),
        })
        if (!r.ok) throw new Error(await err(r))
        const j = await r.json(); if (j.type === 'error') throw new Error(j.message)
        return { ok: true, ref: j.message }
      }
      // test without a template: MSG91 needs DLT templates for every SMS, so just validate the key
      const r = await fetch('https://control.msg91.com/api/balance.php?type=4&authkey=' + encodeURIComponent(c.secrets.msg91_auth_key))
      const t = await r.text()
      if (!r.ok || /invalid|error/i.test(t)) throw new Error('MSG91 rejected the auth key: ' + t.slice(0, 120))
      return { ok: true, ref: `key valid · balance ${t.trim()}` }
    }
    case 'twilio': {
      need(cfg.twilioAccountSid, 'Twilio Account SID'); need(c.secrets.twilio_auth_token, 'Twilio auth token'); need(cfg.twilioFrom, 'Twilio from number')
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Messages.json`, {
        method: 'POST', headers: { Authorization: basic(cfg.twilioAccountSid, c.secrets.twilio_auth_token), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `+91${to}`, From: cfg.twilioFrom, Body: m.body }),
      })
      if (!r.ok) throw new Error(await err(r))
      return { ok: true, ref: (await r.json()).sid }
    }
    case 'fast2sms': {
      need(c.secrets.fast2sms_api_key, 'Fast2SMS API key')
      const dlt = !!tpl.smsTemplateId && m.event !== 'test'
      const r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST', headers: { authorization: c.secrets.fast2sms_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify(dlt
          ? { route: 'dlt', sender_id: cfg.senderId, message: tpl.smsTemplateId, variables_values: params(tpl.waParams, m.vars).join('|'), numbers: to }
          : { route: 'q', message: m.body, numbers: to }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.return === false) throw new Error(j.message?.toString() || `HTTP ${r.status}`)
      return { ok: true, ref: j.request_id }
    }
    case 'webhook': return webhook(cfg.webhookUrl, c.secrets.sms_webhook_secret, m)
    default: throw new Error('Choose an SMS provider')
  }
}

// ------------------------------------------------------------------ WhatsApp
/** Mobile number → WhatsApp Web chat ID using the configured format (default 91{phone}@c.us). */
export function chatIdFor(recipient: string, format?: string) {
  const fmt = (format || '').trim() || '91{phone}@c.us'
  if (!fmt.includes('{phone}')) throw new Error('Chat ID format must contain {phone}')
  return fmt.replace('{phone}', recipient.replace(/\D/g, '').slice(-10))
}
/** Chat ID / JID from an incoming message (919876543210@c.us, whatsapp:+91…, 91…) → 10-digit mobile, or '' for groups etc. */
export function phoneFromChatId(id: string) {
  // only real phone JIDs: @lid is a privacy ID (not a number), groups / channels / status are not people
  if (!id || (id.includes('@') && !/@(c\.us|s\.whatsapp\.net)$/.test(id))) return ''
  const digits = id.split('@')[0].replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}
const openwaBase = (url: string) => {
  const u = (url ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '')
  if (!/^https?:\/\//.test(u)) throw new Error('WA CRM / OpenWA URL must start with https:// (e.g. https://wacrm.example.in)')
  return u
}

/** Is the OpenWA WhatsApp session connected? Used by the Send-test button for a clear error. */
export async function openwaStatus(c: Ctx): Promise<{ ok: boolean; status?: string; phone?: string; error?: string }> {
  const cfg = c.n.whatsapp ?? {}
  try {
    need(cfg.openwaSession, 'OpenWA session ID'); need(c.secrets.openwa_api_key, 'WA CRM / OpenWA API key')
    const r = await fetch(`${openwaBase(cfg.openwaUrl)}/api/sessions/${encodeURIComponent(cfg.openwaSession)}`, { headers: { 'X-API-Key': c.secrets.openwa_api_key }, redirect: 'manual' })
    if (r.status === 401) throw new Error('OpenWA rejected the API key (401)')
    if (r.status === 403) throw new Error('This API key is not allowed to use that session (403)')
    if (r.status === 404) throw new Error('OpenWA session was not found — check the session ID')
    if (!r.ok) throw new Error(`OpenWA HTTP ${r.status}: ${String(await err(r)).slice(0, 160)}`)
    const j = await r.json()
    return { ok: j.status === 'ready', status: j.status, phone: j.phone ?? undefined, error: j.status === 'ready' ? undefined : `WhatsApp session is "${j.status}" — open WA CRM and scan the QR code / reconnect` }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

async function openwa(m: Msg, c: Ctx): Promise<Result> {
  const cfg = c.n.whatsapp ?? {}
  need(cfg.openwaSession, 'OpenWA session ID'); need(c.secrets.openwa_api_key, 'WA CRM / OpenWA API key')
  const base = openwaBase(cfg.openwaUrl)
  const chatId = chatIdFor(m.recipient, cfg.chatIdFormat)
  const r = await fetch(`${base}/api/sessions/${encodeURIComponent(cfg.openwaSession)}/messages/send-text`, {
    method: 'POST', redirect: 'manual',   // never re-send the key to a redirect target
    headers: { 'Content-Type': 'application/json', 'X-API-Key': c.secrets.openwa_api_key },
    body: JSON.stringify({ chatId, text: m.body }),
  })
  if (!r.ok) {
    const msg = String(await err(r)).slice(0, 200)
    if (r.status === 401) throw new Error('OpenWA rejected the API key (401)')
    if (r.status === 404) throw new Error(`OpenWA session was not found — check the session ID (${msg})`)
    if (r.status === 409) throw new Error('WhatsApp session is not connected (409) — open WA CRM and scan the QR code')
    if (r.status === 429) throw new Error(`OpenWA is pacing sends (429) — will retry: ${msg}`)
    throw new Error(`OpenWA HTTP ${r.status}: ${msg}`)
  }
  const j = await r.json().catch(() => ({}))
  return { ok: true, ref: j.messageId ?? j.id ?? j.waMessageId ?? chatId }
}

async function whatsapp(m: Msg, c: Ctx): Promise<Result> {
  const cfg = c.n.whatsapp ?? {}
  const tpl = c.n.templates?.[m.event] ?? {}
  const to = m.recipient.replace(/\D/g, '').slice(-10)
  const lang = cfg.language || 'en'
  switch (cfg.provider) {
    case 'openwa': return openwa(m, c)
    case 'meta': {
      need(cfg.phoneNumberId, 'WhatsApp phone number ID'); need(c.secrets.meta_access_token, 'Meta access token')
      let payload: any
      if (m.event === 'test') payload = { type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }
      else if (m.event !== 'bot' && tpl.waTemplate) {
        const values = params(tpl.waParams, m.vars)
        const components: any[] = values.length ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }] : []
        // authentication (OTP) templates also need the code on the copy-code button
        if ((m.event === 'otp' || m.event === 'password_otp')) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.vars.code }] })
        payload = { type: 'template', template: { name: tpl.waTemplate, language: { code: lang }, components } }
      } else payload = { type: 'text', text: { body: m.body, preview_url: false } }
      const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${c.secrets.meta_access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: `91${to}`, ...payload }),
      })
      if (!r.ok) throw new Error(await err(r))
      return { ok: true, ref: (await r.json()).messages?.[0]?.id }
    }
    case 'twilio': {
      need(cfg.twilioAccountSid, 'Twilio Account SID'); need(c.secrets.twilio_auth_token, 'Twilio auth token'); need(cfg.twilioFrom, 'Twilio WhatsApp sender')
      const from = cfg.twilioFrom.startsWith('whatsapp:') ? cfg.twilioFrom : `whatsapp:${cfg.twilioFrom}`
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Messages.json`, {
        method: 'POST', headers: { Authorization: basic(cfg.twilioAccountSid, c.secrets.twilio_auth_token), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `whatsapp:+91${to}`, From: from, Body: m.body }),
      })
      if (!r.ok) throw new Error(await err(r))
      return { ok: true, ref: (await r.json()).sid }
    }
    case 'interakt': {
      need(c.secrets.interakt_api_key, 'Interakt API key')
      const freeText = m.event === 'test' || m.event === 'bot'
      const template = freeText ? null : tpl.waTemplate
      if (!template && !freeText) throw new Error(`Interakt needs an approved template name for "${m.event}"`)
      const r = await fetch('https://api.interakt.ai/v1/public/message/', {
        method: 'POST', headers: { Authorization: `Basic ${c.secrets.interakt_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(template
          ? { countryCode: '+91', phoneNumber: to, type: 'Template', template: { name: template, languageCode: lang, bodyValues: params(tpl.waParams, m.vars) } }
          : { countryCode: '+91', phoneNumber: to, type: 'Text', data: { message: m.body } }),
      })
      if (!r.ok) throw new Error(await err(r))
      return { ok: true, ref: (await r.json()).id }
    }
    case 'aisensy': return aisensy(m, c)
    case 'msg91': return msg91Whatsapp(m, c)
    case 'webhook': return webhook(cfg.webhookUrl, c.secrets.whatsapp_webhook_secret, m)
    default: throw new Error('Choose a WhatsApp provider')
  }
}

const isOtp = (event: string) => event === 'otp' || event === 'password_otp'

/** AiSensy: every message is an "API campaign" (Campaigns → Launch → API campaign) bound to one approved template.
 *  Put the campaign name in the event's WhatsApp template field. Free text (chatbot replies) is not possible. */
async function aisensy(m: Msg, c: Ctx): Promise<Result> {
  const cfg = c.n.whatsapp ?? {}
  const tpl = c.n.templates?.[m.event] ?? {}
  need(c.secrets.aisensy_api_key, 'AiSensy API key')
  if (m.event === 'bot') throw new Error('AiSensy cannot send free-text chatbot replies — use WA CRM / OpenWA, Meta Cloud API or Twilio for the chatbot')
  let campaign: string, values: string[]
  if (m.event === 'test') {
    need(cfg.aisensyTestCampaign, 'AiSensy test campaign name')
    campaign = cfg.aisensyTestCampaign; values = [m.vars.hospital || c.hospital]
  } else {
    if (!tpl.waTemplate) throw new Error(`AiSensy needs an approved template (API campaign name) for "${m.event}"`)
    campaign = tpl.waTemplate; values = params(tpl.waParams, m.vars)
  }
  const r = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: c.secrets.aisensy_api_key, campaignName: campaign, destination: `91${m.recipient.replace(/\D/g, '').slice(-10)}`,
      userName: m.vars.name || 'Patient', source: c.hospital, templateParams: values,
      // authentication (OTP) templates also need the code on the copy-code button
      ...(isOtp(m.event) && m.vars.code ? { buttons: [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.vars.code }] }] } : {}),
    }),
  })
  if (r.status === 401 || r.status === 403) throw new Error(`AiSensy rejected the API key (${r.status})`)
  if (!r.ok) throw new Error(`AiSensy: ${String(await err(r)).slice(0, 200)}`)
  const j = await r.json().catch(() => ({}))
  if (j.success === false || j.success === 'false') throw new Error(`AiSensy: ${j.message || 'request rejected'}`)
  return { ok: true, ref: j.submitted_message_id ?? j.messageId ?? j.id ?? `campaign ${campaign}` }
}

/** MSG91 WhatsApp: approved templates through the bulk endpoint (body_1…n variables), free text (test / chatbot,
 *  inside the 24-hour window) through the single-message endpoint. The auth key is shared with MSG91 SMS. */
async function msg91Whatsapp(m: Msg, c: Ctx): Promise<Result> {
  const cfg = c.n.whatsapp ?? {}
  const tpl = c.n.templates?.[m.event] ?? {}
  need(c.secrets.msg91_auth_key, 'MSG91 auth key'); need(cfg.msg91Number, 'MSG91 integrated WhatsApp number')
  const from = String(cfg.msg91Number).replace(/\D/g, '')
  const to = `91${m.recipient.replace(/\D/g, '').slice(-10)}`
  const headers = { authkey: c.secrets.msg91_auth_key, 'content-type': 'application/json', accept: 'application/json' }
  const freeText = m.event === 'test' || m.event === 'bot'
  if (!freeText && !tpl.waTemplate) throw new Error(`MSG91 WhatsApp needs an approved template name for "${m.event}"`)
  const r = freeText
    ? await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/', {
      method: 'POST', headers, body: JSON.stringify({ integrated_number: from, recipient_number: to, content_type: 'text', text: m.body }),
    })
    : await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
      method: 'POST', headers,
      body: JSON.stringify({
        integrated_number: from, content_type: 'template',
        payload: {
          messaging_product: 'whatsapp', type: 'template',
          template: {
            name: tpl.waTemplate, language: { code: cfg.language || 'en', policy: 'deterministic' },
            ...(cfg.msg91Namespace ? { namespace: cfg.msg91Namespace } : {}),
            to_and_components: [{
              to: [to],
              components: Object.fromEntries([
                ...params(tpl.waParams, m.vars).map((value, i) => [`body_${i + 1}`, { type: 'text', value }]),
                ...(isOtp(m.event) && m.vars.code ? [['button_1', { subtype: 'url', type: 'text', value: m.vars.code }]] : []),
              ]),
            }],
          },
        },
      }),
    })
  if (r.status === 401) throw new Error('MSG91 rejected the auth key (401)')
  if (!r.ok) throw new Error(`MSG91 WhatsApp: ${String(await err(r)).slice(0, 200)}`)
  const j = await r.json().catch(() => ({}))
  if (j.hasError || j.status === 'fail' || j.type === 'error') throw new Error(`MSG91 WhatsApp: ${String(j.errors ?? j.message ?? 'request rejected').slice(0, 200)}`)
  return { ok: true, ref: j.request_id ?? j.data?.request_id ?? j.message ?? 'accepted' }
}

// ------------------------------------------------------------------ Email
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!))
const html = (m: Msg, hospital: string) => `<!doctype html><html><body style="margin:0;background:#f5f5ff;font-family:Inter,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e6f5">
<tr><td style="background:#292966;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${esc(hospital)}</td></tr>
<tr><td style="padding:24px;color:#1e293b;font-size:15px;line-height:1.6">${esc(m.body).replace(/\n/g, '<br>')}</td></tr>
<tr><td style="padding:14px 24px;background:#f8f8ff;color:#64748b;font-size:12px">This message was sent by ${esc(hospital)}. Please do not reply with medical questions — call the hospital instead.</td></tr>
</table></td></tr></table></body></html>`

async function email(m: Msg, c: Ctx): Promise<Result> {
  const cfg = c.n.email ?? {}
  need(cfg.fromEmail, 'Sender email')
  const fromName = cfg.fromName || c.hospital
  const subject = m.subject || `Message from ${c.hospital}`
  switch (cfg.provider) {
    case 'resend': {
      need(c.secrets.resend_api_key, 'Resend API key')
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${c.secrets.resend_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${cfg.fromEmail}>`, to: [m.recipient], subject, text: m.body, html: html(m, c.hospital), ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) }),
      })
      if (!r.ok) throw new Error(await err(r))
      return { ok: true, ref: (await r.json()).id }
    }
    case 'sendgrid': {
      need(c.secrets.sendgrid_api_key, 'SendGrid API key')
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST', headers: { Authorization: `Bearer ${c.secrets.sendgrid_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: m.recipient }] }], from: { email: cfg.fromEmail, name: fromName }, subject,
          ...(cfg.replyTo ? { reply_to: { email: cfg.replyTo } } : {}),
          content: [{ type: 'text/plain', value: m.body }, { type: 'text/html', value: html(m, c.hospital) }],
        }),
      })
      if (!r.ok) throw new Error(await err(r))
      return { ok: true, ref: r.headers.get('x-message-id') ?? 'accepted' }
    }
    case 'smtp': {
      need(cfg.smtpHost, 'SMTP host'); need(cfg.smtpUser, 'SMTP username'); need(c.secrets.smtp_password, 'SMTP password')
      if (Number(cfg.smtpPort) === 25 || Number(cfg.smtpPort) === 587) throw new Error('Supabase Edge Functions block ports 25 and 587 — use port 465 (SSL) or Resend/SendGrid')
      const mod = 'https://deno.land/x/denomailer@1.6.0/mod.ts'
      const { SMTPClient } = await import(/* @vite-ignore */ mod)
      const client = new SMTPClient({ connection: { hostname: cfg.smtpHost, port: Number(cfg.smtpPort) || 465, tls: cfg.smtpSecure !== false, auth: { username: cfg.smtpUser, password: c.secrets.smtp_password } } })
      try {
        await client.send({ from: `${fromName} <${cfg.fromEmail}>`, to: m.recipient, subject, content: m.body, html: html(m, c.hospital), ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}) })
      } finally { await client.close() }
      return { ok: true, ref: 'smtp' }
    }
    default: throw new Error('Choose an email provider')
  }
}

async function webhook(url: string, secret: string | undefined, m: Msg): Promise<Result> {
  if (!/^https:\/\//.test(url ?? '')) throw new Error('Webhook URL must start with https://')
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ channel: m.channel, to: `+91${m.recipient.replace(/\D/g, '').slice(-10)}`, event: m.event, message: m.body, subject: m.subject, vars: m.vars }),
  })
  if (!r.ok) throw new Error(`Webhook HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return { ok: true, ref: r.headers.get('x-request-id') ?? `HTTP ${r.status}` }
}

// ------------------------------------------------------------------ push (FCM HTTP v1). recipient = profile id
async function push(m: Msg, c: Ctx): Promise<Result> {
  const sa = parseServiceAccount(c.secrets.fcm_service_account)
  if (!c.devices) throw new Error('Push devices are not configured')
  const tokens = await c.devices.tokens(m.recipient)
  const link = m.vars?.link?.startsWith('https://') ? m.vars.link : c.devices.siteUrl ? `${c.devices.siteUrl.replace(/\/$/, '')}/` : undefined
  const r = await sendPush(sa, tokens, { title: m.subject || c.hospital, body: m.body, link, icon: c.devices.icon, tag: m.event,
    data: { event: m.event, ...(m.id ? { id: m.id } : {}) } })
  if (r.invalid.length) await c.devices.forget(r.invalid).catch(() => { /* best effort */ })
  return r.ok ? { ok: true, ref: r.ref } : { ok: false, error: r.error }
}

export async function deliver(m: Msg, c: Ctx): Promise<Result> {
  if (!c.n[m.channel]?.enabled && m.event !== 'test') return { ok: false, error: `${m.channel} channel is switched off` }
  try {
    return await (m.channel === 'sms' ? sms(m, c) : m.channel === 'whatsapp' ? whatsapp(m, c) : m.channel === 'push' ? push(m, c) : email(m, c))
  } catch (e) {
    return { ok: false, error: (e as Error).message?.slice(0, 500) || 'Unknown error' }
  }
}


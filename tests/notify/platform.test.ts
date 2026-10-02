/**
 * Hospital Comrade messaging (phase 3) — supabase/functions/_shared/platform.ts: which shared accounts exist, how a
 * hospital's settings are switched onto them (keeping its own wording and identity), and the monthly allowance.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { deliverRouted, overAllowance, platformAccounts, platformCtx, platformStatus, sourceOf, usageMonth, walletBlocked, walletOf } from '../../supabase/functions/_shared/platform'
import { isPermanent } from '../../supabase/functions/_shared/providers'
import { BILLING_DEFAULTS } from '../../src/platform/billing'
import type { Ctx } from '../../supabase/functions/_shared/providers'

const envOf = (vars: Record<string, string>) => (k: string) => vars[k]
const own = (n: Record<string, any>): Ctx => ({ hospital: 'City Care Clinic', secrets: { msg91_auth_key: 'HOSPITAL-KEY', resend_api_key: 'HOSPITAL-RESEND' }, n })
const FULL = {
  PLATFORM_SMS_PROVIDER: 'MSG91', PLATFORM_MSG91_AUTH_KEY: 'P-MSG91', PLATFORM_SMS_SENDER_ID: 'hspcmr',
  PLATFORM_WHATSAPP_PROVIDER: 'aisensy', PLATFORM_AISENSY_API_KEY: 'P-AIS', PLATFORM_WHATSAPP_LANGUAGE: 'en',
  PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_RESEND_API_KEY: 'P-RESEND', PLATFORM_EMAIL_FROM: 'notifications@hospital.digitalcomrade.in',
}

afterEach(() => vi.unstubAllGlobals())

describe('shared accounts from PLATFORM_* secrets', () => {
  test('providers are recognised per channel; unknown or empty → no account', () => {
    expect(platformStatus(envOf(FULL))).toEqual({ sms: 'msg91', whatsapp: 'aisensy', email: 'resend' })
    expect(platformStatus(envOf({}))).toEqual({ sms: null, whatsapp: null, email: null })
    expect(platformStatus(envOf({ PLATFORM_SMS_PROVIDER: 'twilio', PLATFORM_WHATSAPP_PROVIDER: 'interakt', PLATFORM_EMAIL_PROVIDER: 'smtp' }))).toEqual({ sms: null, whatsapp: null, email: null })
    for (const wa of ['meta', 'msg91', 'openwa', 'aisensy']) expect(platformAccounts(envOf({ PLATFORM_WHATSAPP_PROVIDER: wa })).whatsapp?.provider).toBe(wa)
    expect(platformAccounts(envOf({ PLATFORM_WHATSAPP_PROVIDER: 'msg91', PLATFORM_MSG91_AUTH_KEY: 'K', PLATFORM_MSG91_WA_NUMBER: '918000011111' })).whatsapp)
      .toMatchObject({ cfg: { msg91Number: '918000011111' }, secrets: { msg91_auth_key: 'K' } })
  })
})

describe('platformCtx', () => {
  const n = {
    sms: { enabled: true, source: 'platform', provider: 'twilio', senderId: 'OWNHDR' },
    whatsapp: { enabled: false, source: 'platform', provider: 'openwa' },
    email: { enabled: true, source: 'own', provider: 'resend', fromEmail: 'desk@citycare.in' },
    templates: { appointment_booked: { text: 'Hi {name}', subject: 'Booked', waTemplate: 'own_tpl', waParams: 'name', smsTemplateId: 'OWN-1', waText: '' } },
  }
  test('platform channels get the shared account, keep the on/off switch and wording; own channels are untouched', () => {
    const c = platformCtx(own(n), envOf(FULL), { platform: { templates: { appointment_booked: { waTemplate: 'hc_booked', waParams: 'hospital,name', smsTemplateId: 'PLAT-1' } } } })
    expect(c.n.sms).toEqual({ senderId: 'HSPCMR', dltEntityId: '', enabled: true, source: 'platform', provider: 'msg91' })
    expect(c.n.whatsapp).toMatchObject({ enabled: false, source: 'platform', provider: 'aisensy' })
    expect(c.n.email).toBe(n.email)
    // secrets: only the shared ones — never the hospital's own keys mixed in
    expect(c.secrets).toEqual({ msg91_auth_key: 'P-MSG91', aisensy_api_key: 'P-AIS' })
    expect(c.n.templates.appointment_booked).toEqual({ text: 'Hi {name}', subject: 'Booked', waText: '', waTemplate: 'hc_booked', waParams: 'hospital,name', smsTemplateId: 'PLAT-1' })
    expect(c.hospital).toBe('City Care Clinic')
  })
  test("the hospital's registered sender ID and DLT templates win over the platform's; empty overrides are ignored", () => {
    const c = platformCtx(own(n), envOf(FULL), {
      platform: { templates: { appointment_booked: { smsTemplateId: 'PLAT-1', waTemplate: 'hc_booked' } } },
      tenant: { smsSenderId: 'citycl', templates: { appointment_booked: { smsTemplateId: 'CITY-7', waTemplate: '' } } },
    })
    expect(c.n.sms.senderId).toBe('CITYCL')
    expect(c.n.templates.appointment_booked).toMatchObject({ smsTemplateId: 'CITY-7', waTemplate: 'hc_booked' })
  })
  test('platform e-mail: from the platform address, in the hospital\'s name, replies go to the hospital', () => {
    const c = platformCtx(own({ email: { enabled: true, source: 'platform' } }), envOf(FULL), { replyTo: 'desk@citycare.in' })
    expect(c.n.email).toMatchObject({ provider: 'resend', fromEmail: 'notifications@hospital.digitalcomrade.in', fromName: 'City Care Clinic', replyTo: 'desk@citycare.in' })
    expect(platformCtx(own({ email: { enabled: true, source: 'platform' } }), envOf(FULL), { replyTo: 'not-an-email' }).n.email.replyTo).toBeUndefined()
  })
  test('source defaults to own (older settings) and push is always own', () => {
    expect(sourceOf({ sms: { enabled: true } }, 'sms')).toBe('own')
    expect(sourceOf({ push: { source: 'platform' } }, 'push')).toBe('own')
    expect(sourceOf({ whatsapp: { source: 'platform' } }, 'whatsapp')).toBe('platform')
  })
})

describe('deliverRouted', () => {
  const calls: string[] = []
  const stub = () => { calls.length = 0; vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return new Response('{"type":"success","message":"r1"}', { status: 200 }) })) }
  const msg = { event: 'appointment_booked', channel: 'sms' as const, recipient: '9876543210', body: 'Hi', vars: {} }
  test('own channel → hospital account; platform → shared account, counted on the meter', async () => {
    stub()
    const hospital = own({ sms: { enabled: true, source: 'platform' }, templates: {} })
    const meter = { used: { sms: 2 }, tenant: { limits: { sms: 10 } } }
    const r = await deliverRouted(msg, hospital, platformCtx(hospital, envOf(FULL), { platform: { templates: { appointment_booked: { smsTemplateId: 'PLAT-1' } } } }), meter)
    expect(r).toEqual({ ok: true, ref: 'r1', source: 'platform' })
    expect(meter.used.sms).toBe(3)
    expect(calls).toEqual(['https://control.msg91.com/api/v5/flow'])
  })
  test('allowance used up → refused without a request; OTP still goes; no shared account → clear permanent error', async () => {
    stub()
    const hospital = own({ sms: { enabled: true, source: 'platform' }, templates: {} })
    const plat = platformCtx(hospital, envOf(FULL), { platform: { templates: { otp: { smsTemplateId: 'P-OTP' } } } })
    const meter = { used: { sms: 10 }, tenant: { limits: { sms: 10 } } }
    const r = await deliverRouted(msg, hospital, plat, meter)
    expect(r.ok).toBe(false); expect(r.error).toMatch(/SMS allowance \(10\) is used up/)
    expect(calls).toHaveLength(0)
    expect((await deliverRouted({ ...msg, event: 'otp', vars: { code: '1' } }, hospital, plat, meter)).ok).toBe(true)
    const none = await deliverRouted(msg, hospital, platformCtx(hospital, envOf({})), meter)
    expect(none).toMatchObject({ ok: false, source: 'platform' }); expect(none.error).toMatch(/Hospital Comrade SMS is not configured/)
  })
})

describe('allowance + metering period', () => {
  test('no limit = unlimited; limit reached = refused', () => {
    expect(overAllowance({ event: 'invoice_created', channel: 'sms' }, 10_000, {})).toBeNull()
    expect(overAllowance({ event: 'invoice_created', channel: 'sms' }, 99, { limits: { sms: 100 } })).toBeNull()
    expect(overAllowance({ event: 'invoice_created', channel: 'sms' }, 100, { limits: { sms: 100 } })).toMatch(/used up/)
    expect(overAllowance({ event: 'test', channel: 'whatsapp' }, 5, { limits: { whatsapp: 5 } })).toMatch(/WhatsApp allowance/)
    expect(overAllowance({ event: 'invoice_created', channel: 'email' }, 5, { limits: { email: null } })).toBeNull()
  })
  test('the month is the Indian calendar month', () => {
    expect(usageMonth(Date.parse('2026-10-31T19:00:00Z'))).toBe('2026-11-01')   // 00:30 IST on 1 Nov
    expect(usageMonth(Date.parse('2026-10-31T18:00:00Z'))).toBe('2026-10-01')
  })
})

describe('prepaid wallet (phase 4)', () => {
  const t = { plan: 'clinic', is_primary: false, wallet_paise: 100, billing: { ratesPaise: { sms: 40 } } }
  test('walletOf: plan allowance + hospital overrides; the primary hospital is never charged', () => {
    expect(walletOf(t, BILLING_DEFAULTS)).toEqual({ balance: 100, included: { sms: 100, whatsapp: 300, email: 1000 }, rates: { sms: 40, whatsapp: 40, email: 2 } })
    expect(walletOf({ ...t, is_primary: true }, BILLING_DEFAULTS)).toBeNull()
  })
  test('free within the allowance; beyond it the balance must cover one message; OTPs always go', () => {
    const w = walletOf(t, BILLING_DEFAULTS)!
    expect(walletBlocked({ event: 'invoice_created', channel: 'sms' }, 99, { ...w, balance: 0 })).toBeNull()
    expect(walletBlocked({ event: 'invoice_created', channel: 'sms' }, 100, w)).toBeNull()                 // 100 ≥ 40
    const msg = walletBlocked({ event: 'invoice_created', channel: 'sms' }, 100, { ...w, balance: 39 })
    expect(msg).toMatch(/wallet balance is too low for more SMS/); expect(isPermanent(msg!)).toBe(true)
    expect(walletBlocked({ event: 'otp', channel: 'sms' }, 100, { ...w, balance: -500 })).toBeNull()
  })
  test('deliverRouted spends the local balance so a batch stops when it runs out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"type":"success","message":"r1"}', { status: 200 })))
    const hospital = own({ sms: { enabled: true, source: 'platform' }, templates: {} })
    const plat = platformCtx(hospital, envOf(FULL), { platform: { templates: { appointment_booked: { smsTemplateId: 'P' } } } })
    const meter = { used: { sms: 100 }, wallet: { balance: 80, included: { sms: 100 }, rates: { sms: 40 } } }
    const m = { event: 'appointment_booked', channel: 'sms' as const, recipient: '9876543210', body: 'Hi', vars: {} }
    expect((await deliverRouted(m, hospital, plat, meter)).ok).toBe(true)
    expect((await deliverRouted(m, hospital, plat, meter)).ok).toBe(true)
    const third = await deliverRouted(m, hospital, plat, meter)
    expect(third.ok).toBe(false); expect(meter.wallet.balance).toBe(0); expect(meter.used.sms).toBe(102)
  })
})

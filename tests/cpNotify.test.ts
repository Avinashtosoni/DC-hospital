/**
 * Control panel → Platform settings → Integrations, Messaging, Alerts, Broadcasts, live health: the pure pieces of the screens.
 */
import { describe, expect, test, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => ({ supabase: null, supabaseUrl: 'https://p.supabase.co', platformName: 'Hospital Comrade', platformDomain: 'hospital.digitalcomrade.in' }))
import { ACCOUNTS, diffAccount, fieldsFor, isSetUp, keyMode, keysOf, providerOf } from '../control-panel/src/pages/messaging/accounts'
import { keySource, webhookUrl } from '../control-panel/src/pages/settings/IntegrationsTab'
import { broadcastCost } from '../control-panel/src/pages/BroadcastsPage'
import { dayCells, hourCells, overall } from '../control-panel/src/pages/health/LiveChecks'
import { validTo } from '../control-panel/src/pages/messaging/TestTab'
import { canRetry } from '../control-panel/src/pages/messaging/DeliveryLogTab'
import { TEMPLATE_EVENTS } from '../control-panel/src/pages/messaging/TemplatesTab'

const spec = (c: string) => ACCOUNTS.find((a) => a.channel === c)!

describe('shared accounts form', () => {
  test('every field is a PLATFORM_* name the database accepts', () => {
    for (const a of ACCOUNTS) for (const p of Object.keys(a.providers)) for (const f of fieldsFor(a, p)) expect(f.key).toMatch(/^PLATFORM_[A-Z0-9_]{2,60}$/)
  })
  test('provider fields + the common ones; push is always Firebase', () => {
    expect(fieldsFor(spec('sms'), 'msg91').map((f) => f.key)).toEqual(['PLATFORM_SMS_SENDER_ID', 'PLATFORM_DLT_ENTITY_ID', 'PLATFORM_MSG91_AUTH_KEY'])
    expect(fieldsFor(spec('sms'), '')).toEqual([])
    expect(providerOf(spec('push'), {})).toBe('firebase')
    expect(providerOf(spec('email'), { PLATFORM_EMAIL_PROVIDER: 'Resend' })).toBe('resend')
  })
  test('only changes are sent; empty key inputs keep the saved key; Remove sends ""', () => {
    const saved = { PLATFORM_EMAIL_PROVIDER: 'resend', PLATFORM_EMAIL_FROM: 'a@hc.in' }
    expect(diffAccount(spec('email'), saved, { ...saved }, {}, [])).toEqual({ settings: {}, secrets: {} })
    expect(diffAccount(spec('email'), saved, { ...saved, PLATFORM_EMAIL_FROM: ' b@hc.in ' }, { PLATFORM_RESEND_API_KEY: ' re_new ' }, []))
      .toEqual({ settings: { PLATFORM_EMAIL_FROM: 'b@hc.in' }, secrets: { PLATFORM_RESEND_API_KEY: 're_new' } })
    expect(diffAccount(spec('email'), saved, { ...saved }, {}, ['PLATFORM_RESEND_API_KEY'])).toEqual({ settings: {}, secrets: { PLATFORM_RESEND_API_KEY: '' } })
  })
  test('switching provider sends the provider and upper-cases the sender ID', () => {
    const d = diffAccount(spec('sms'), {}, { PLATFORM_SMS_PROVIDER: 'fast2sms', PLATFORM_SMS_SENDER_ID: 'hcomrd' }, {}, [])
    expect(d.settings).toEqual({ PLATFORM_SMS_PROVIDER: 'fast2sms', PLATFORM_SMS_SENDER_ID: 'HCOMRD' })
    expect(diffAccount(spec('sms'), { PLATFORM_SMS_PROVIDER: 'msg91' }, { PLATFORM_SMS_PROVIDER: '' }, {}, []).settings).toEqual({ PLATFORM_SMS_PROVIDER: '' })
  })
  test('templates cover the platform messages and every hospital event once', () => {
    const ids = TEMPLATE_EVENTS.map((e) => e.id)
    expect(ids.slice(0, 2)).toEqual(['platform_alert', 'platform_broadcast'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_:-]{2,64}$/)
  })
})

describe('broadcasts', () => {
  test('cost counts only the paid channels that are ticked', () => {
    const p = { email: 100, sms: 10, whatsapp: 20 }
    expect(broadcastCost(p, ['inapp', 'push'])).toBe(0)
    expect(broadcastCost(p, ['email', 'sms', 'whatsapp'], { email: 2, sms: 30, whatsapp: 40 })).toBe((200 + 300 + 800) / 100)
  })
})

describe('delivery log', () => {
  test('failed messages can be retried, except one-time codes and tests', () => {
    expect(canRetry({ status: 'failed', kind: 'appointment_booked' })).toBe(true)
    expect(canRetry({ status: 'skipped', kind: 'broadcast' })).toBe(true)
    expect(canRetry({ status: 'failed', kind: 'otp' })).toBe(false)
    expect(canRetry({ status: 'failed', kind: 'test' })).toBe(false)
    expect(canRetry({ status: 'sent', kind: 'alert' })).toBe(false)
  })
})

describe('live health', () => {
  test('overall state', () => {
    expect(overall([{ status: 'ok' }, { status: 'off' }])).toBe('ok')
    expect(overall([{ status: 'ok' }, { status: 'warn' }])).toBe('warn')
    expect(overall([{ status: 'warn' }, { status: 'fail' }])).toBe('fail')
    expect(overall([{ status: 'off' }])).toBe('off')
  })
  test('24 hourly cells, oldest first, gaps empty', () => {
    const now = Date.parse('2026-10-05T10:30:00Z')
    const cells = hourCells([{ h: '2026-10-05T10:00:00Z', ok: 6, n: 12, ms: 300 }, { h: '2026-10-05T08:00:00Z', ok: 12, n: 12, ms: 200 }], now)
    expect(cells).toHaveLength(24)
    expect(cells[23]).toMatchObject({ pct: 50, ms: 300 })
    expect(cells[22].pct).toBeNull()
    expect(cells[21]).toMatchObject({ pct: 100, ms: 200 })
  })
  test('7 daily cells on India dates, oldest first', () => {
    const now = Date.parse('2026-10-05T20:00:00Z')   // 6 Oct 01:30 IST
    const cells = dayCells([{ d: '2026-10-06', ok: 280, n: 288, ms: 210 }, { d: '2026-10-01', ok: 0, n: 288, ms: null }], now)
    expect(cells.map((c) => c.t)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'])
    expect(cells[6]).toMatchObject({ pct: 97, ms: 210 })
    expect(cells[1].pct).toBe(0)
    expect(cells[0].pct).toBeNull()
  })
})

describe('test send', () => {
  test('recipient checks per channel', () => {
    expect(validTo('email', ' a@b.in ')).toBe(true)
    expect(validTo('email', 'nope')).toBe(false)
    expect(validTo('sms', '+91 98765 43210')).toBe(true)
    expect(validTo('whatsapp', '98765')).toBe(false)
    expect(validTo('push', '')).toBe(true)
  })
})

describe('integrations', () => {
  test('Razorpay first, then the four shared channels', () => {
    expect(ACCOUNTS.map((a) => a.channel)).toEqual(['razorpay', 'sms', 'whatsapp', 'email', 'push'])
    expect(providerOf(spec('razorpay'), {})).toBe('razorpay')
    expect(fieldsFor(spec('razorpay'), 'razorpay').map((f) => [f.key, !!f.secret])).toEqual([
      ['PLATFORM_RAZORPAY_KEY_ID', false], ['PLATFORM_RAZORPAY_KEY_SECRET', true], ['PLATFORM_RAZORPAY_WEBHOOK_SECRET', true]])
  })
  test('set up = provider picked, or the single provider\'s main field filled', () => {
    expect(isSetUp(spec('razorpay'), {})).toBe(false)
    expect(isSetUp(spec('razorpay'), { PLATFORM_RAZORPAY_KEY_ID: 'rzp_live_1' })).toBe(true)
    expect(isSetUp(spec('push'), { PLATFORM_FCM_PROJECT_ID: 'hc' })).toBe(true)
    expect(isSetUp(spec('sms'), { PLATFORM_SMS_PROVIDER: '' })).toBe(false)
    expect(keyMode('rzp_live_x')).toBe('live'); expect(keyMode('rzp_test_x')).toBe('test'); expect(keyMode('')).toBeNull()
  })
  test('Razorpay never sends a provider setting; a new key pair is two secrets + the key ID', () => {
    expect(diffAccount(spec('razorpay'), {}, { PLATFORM_RAZORPAY_KEY_ID: ' rzp_live_1 ' }, { PLATFORM_RAZORPAY_KEY_SECRET: 's', PLATFORM_RAZORPAY_WEBHOOK_SECRET: 'w' }, []))
      .toEqual({ settings: { PLATFORM_RAZORPAY_KEY_ID: 'rzp_live_1' }, secrets: { PLATFORM_RAZORPAY_KEY_SECRET: 's', PLATFORM_RAZORPAY_WEBHOOK_SECRET: 'w' } })
  })
  test('key source: panel, Edge fallback, both or none', () => {
    const none = { settings: {}, secrets: [] }
    expect(keysOf(spec('sms'))).toEqual(expect.arrayContaining(['PLATFORM_SMS_PROVIDER', 'PLATFORM_MSG91_AUTH_KEY', 'PLATFORM_FAST2SMS_API_KEY']))
    expect(keySource(spec('sms'), none, {})).toBe('none')
    expect(keySource(spec('sms'), none, { PLATFORM_SMS_PROVIDER: { panel: false, edge: true } })).toBe('edge')
    expect(keySource(spec('sms'), { settings: { PLATFORM_SMS_PROVIDER: 'msg91' }, secrets: [] }, {})).toBe('panel')
    const rzpSecret = [{ key: 'PLATFORM_RAZORPAY_KEY_SECRET', hint: '••••', updated_at: '', updated_by_name: null }]
    expect(keySource(spec('razorpay'), { settings: { PLATFORM_RAZORPAY_KEY_ID: 'rzp_live_1' }, secrets: [] }, {})).toBe('none')   // half a pair is not enough
    expect(keySource(spec('razorpay'), { settings: { PLATFORM_RAZORPAY_KEY_ID: 'rzp_live_1' }, secrets: rzpSecret }, { PLATFORM_RAZORPAY_KEY_SECRET: { panel: true, edge: true } })).toBe('both')
  })
  test('webhook URL points at the billing function', () => {
    expect(webhookUrl('https://p.supabase.co/')).toBe('https://p.supabase.co/functions/v1/billing?webhook=razorpay')
  })
})

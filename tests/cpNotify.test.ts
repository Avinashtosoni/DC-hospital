/**
 * Control panel → Messaging & alerts, Broadcasts, live health: the pure pieces of the screens.
 */
import { describe, expect, test, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => ({ supabase: null, platformName: 'Hospital Comrade', platformDomain: 'hospital.digitalcomrade.in' }))
import { ACCOUNTS, diffAccount, fieldsFor, providerOf } from '../control-panel/src/pages/messaging/accounts'
import { broadcastCost } from '../control-panel/src/pages/BroadcastsPage'
import { hourCells, overall } from '../control-panel/src/pages/health/LiveChecks'
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
})

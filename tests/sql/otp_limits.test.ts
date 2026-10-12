/**
 * Per-connection OTP limits (booking + password reset): one visitor can't cycle through phone numbers to run up the
 * SMS bill or use up the hospital's hourly allowance. The connection is read from the request headers PostgREST
 * passes in (`request.headers`) and only a hash is stored.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'

let db: Db
beforeAll(async () => { db = await freshDb('master') }, 180_000)

/** what Supabase's API gateway forwards for a visitor */
const from = (headers: Record<string, string> | null) =>
  db.exec(`select set_config('request.headers', '${headers ? JSON.stringify(headers) : ''}', false)`)
const book = (phone: string) => db.one<{ r: { sent: boolean; ref: string } }>('anon', 'select public.request_booking_otp($1) r', [phone])
const reset = (phone: string) => db.one<{ r: { sent: boolean } }>('anon', `select public.request_password_otp('someone@example.com', $1, 'whatsapp') r`, [phone])
const phone = (i: number) => `98${String(70000000 + i).padStart(8, '0')}`

describe('per-connection OTP limits', () => {
  test('booking: 10 codes an hour from one connection, then refused — other visitors are unaffected', async () => {
    await from({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    for (let i = 0; i < 10; i++) expect((await book(phone(i))).r).toHaveProperty('ref')
    await expect(book(phone(10))).rejects.toThrow(/Too many codes requested from this connection/)
    // a forged X-Forwarded-For doesn't help — Cloudflare's header wins
    await from({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })
    await expect(book(phone(11))).rejects.toThrow(/from this connection/)
    // someone else
    await from({ 'cf-connecting-ip': '198.51.100.20' })
    expect((await book(phone(12))).r).toHaveProperty('ref')
    // only a hash is kept, never the address
    const rows = await db.as<{ ip_hash: string }>(null, `select distinct ip_hash from public.booking_otps where ip_hash is not null`)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.ip_hash))).toBe(true)
    expect(JSON.stringify(await db.as(null, `select * from public.booking_otps`))).not.toContain('203.0.113.7')
  })

  test('the limit can be tuned per hospital (minimum 3); requests outside the API (no headers) are not limited', async () => {
    await db.as(null, `insert into public.site_content (key, data) values ('settings', '{"booking": {"otpIpHourlyLimit": 3}}')
      on conflict (tenant_id, key) do update set data = public.site_content.data || '{"booking": {"otpIpHourlyLimit": 3}}'`)
    await from({ 'x-real-ip': '192.0.2.55' })
    for (let i = 20; i < 23; i++) await book(phone(i))
    await expect(book(phone(23))).rejects.toThrow(/from this connection/)
    await from(null)
    expect((await book(phone(24))).r).toHaveProperty('ref')
  })

  test('password reset: same per-connection limit', async () => {
    const n = structuredClone(DEFAULT_APP_SETTINGS.notifications) as typeof DEFAULT_APP_SETTINGS.notifications
    n.whatsapp.enabled = true
    await db.as(null, `insert into public.app_settings (key, data) values ('app', jsonb_build_object('notifications', $1::jsonb))
      on conflict (tenant_id, key) do update set data = excluded.data`, [JSON.stringify(n)])
    await from({ 'x-forwarded-for': '192.0.2.99, 10.0.0.1' })
    for (let i = 30; i < 33; i++) expect((await reset(phone(i))).r.sent).toBe(true)   // limit 3 from the test above
    await expect(reset(phone(33))).rejects.toThrow(/Too many reset requests from this connection/)
    await from({ 'x-forwarded-for': '192.0.2.100' })
    expect((await reset(phone(34))).r.sent).toBe(true)
    await from(null)
  })
})

/**
 * Free-trial sign-up — mobile verification (scripts/sql/signup_otp.sql): settings, sending on the platform's
 * accounts, limits, wrong codes, the one-time token and that platform_trial_signup refuses without it.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000011'

async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)))
  return r.r
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)
const form = (o: Record<string, unknown> = {}) => ({ organisation: 'Kosi Care Clinic', name: 'Dr. Asha Rai', email: 'asha@kosi.in', phone: '98111 22334', city: 'Saharsa', terms_version: '2026-10-02', ...o })
const signup = (o: Record<string, unknown> = {}) => call('anon', 'platform_trial_signup', [form(o)], ['jsonb'])
const request = (phone: string, channel: string | null = null) => call('anon', 'request_signup_otp', [phone, channel], ['text', 'text'])
const verify = (phone: string, code: string) => call('anon', 'verify_signup_otp', [phone, code], ['text', 'text'])
const lastCode = async (ref: string) => (await db.one<{ c: string }>(null, `select vars ->> 'code' as c from public.platform_outbox where kind = 'signup_otp' and ref_id = $1`, [ref])).c
/** pretend the code was asked for a minute ago (the 30 s gap between codes) */
const age = (phone: string) => db.as(null, `update public.platform_signup_otps set created_at = created_at - interval '1 minute' where phone = $1`, [phone])

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'admin2@hc.in', 'x', '{"full_name":"Admin"}'::jsonb)`, [P_ADMIN])
  await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
  await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [P_ADMIN])
  await db.as(null, `select set_config('app.tenant_move', '', false)`)
  await db.as(null, `delete from public.patients where profile_id = $1`, [P_ADMIN])
  await db.as(null, `insert into public.provider_users (user_id, role) values ($1, 'admin')`, [P_ADMIN])
}, 240_000)

describe('sign-up mobile verification', () => {
  test('on by default, WhatsApp first; the admin changes it (validated)', async () => {
    expect((await call<any>('anon', 'platform_signup_info')).otp).toEqual({ required: true, channels: ['whatsapp', 'sms'] })
    await fails(call(P_ADMIN, 'cp_save_signup_settings', [{ otp: { enabled: true, channels: ['email'] } }], ['jsonb']), /WhatsApp, SMS/)
    await fails(call(P_ADMIN, 'cp_save_signup_settings', [{ otp: { enabled: true, channels: [] } }], ['jsonb']), /pick WhatsApp/)
    await fails(call('anon', 'cp_save_signup_settings', [{ otp: { enabled: false, channels: [] } }], ['jsonb']), /permission denied/)
    expect((await call<any>(P_ADMIN, 'cp_save_signup_settings', [{ otp: { enabled: true, channels: ['sms', 'whatsapp'] } }], ['jsonb'])).otp).toEqual({ enabled: true, channels: ['sms', 'whatsapp'] })
    expect((await call<any>('anon', 'platform_signup_info')).otp.channels).toEqual(['whatsapp', 'sms'])   // WhatsApp stays first
  })

  test('without a verified number the sign-up is refused', async () => {
    await fails(signup(), /verify your mobile number/)
    await fails(signup({ otp_token: 'made-up' }), /check has expired/)
    expect(await db.one<{ n: number }>(null, `select count(*)::int as n from public.platform_signups`)).toEqual({ n: 0 })
  })

  test('code on WhatsApp → queued on the platform outbox; wrong codes, then the right one → one-time token', async () => {
    await fails(request('12345'), /10-digit/)
    await fails(request('98111 22334', 'email'), /can't be sent on email/)
    const r = await request('+91 98111 22334')
    expect(r).toMatchObject({ sent: true, channel: 'whatsapp', to: '+91 98•••• 2334', expires_in: 600 })
    const row = await db.one<any>(null, `select kind, channel, recipient, status, body from public.platform_outbox where ref_id = $1`, [r.ref])
    expect(row).toMatchObject({ kind: 'signup_otp', channel: 'whatsapp', recipient: '9811122334', status: 'pending' })
    expect(row.body).toMatch(/^\d{6} is your verification code/)
    await fails(request('9811122334'), /wait 30 seconds/)

    const code = await lastCode(r.ref)
    const wrong = code === '000000' ? '111111' : '000000'
    expect(await verify('9811122334', wrong)).toEqual({ ok: false, error: 'That code is not correct — 4 attempts left.' })
    const ok = await verify('9811122334', code)
    expect(ok).toMatchObject({ ok: true, channel: 'whatsapp' })
    expect(ok.token).toMatch(/^[0-9a-f]{48}$/)

    await fails(signup({ phone: '9811100000', otp_token: ok.token }), /verify your mobile/)   // the token belongs to another number
    expect(await signup({ otp_token: ok.token })).toMatchObject({ status: 'pending' })
    expect(await db.one<any>(null, `select phone_verified_via, phone_verified_at is not null as v from public.platform_signups where email = 'asha@kosi.in'`)).toEqual({ phone_verified_via: 'whatsapp', v: true })
    await fails(signup({ email: 'other@kosi.in', otp_token: ok.token }), /check has expired/)   // used once
  })

  test('SMS fallback, 5 wrong attempts, expiry and the hourly limit', async () => {
    const r = await request('9822233445', 'sms')
    expect(r.channel).toBe('sms')
    for (let i = 0; i < 4; i++) await verify('9822233445', '999999' === (await lastCode(r.ref)) ? '888888' : '999999')
    expect((await verify('9822233445', '999999' === (await lastCode(r.ref)) ? '888888' : '999999')).error).toMatch(/Too many wrong attempts/)
    expect((await verify('9822233445', await lastCode(r.ref))).ok).toBe(false)   // locked even with the right code

    await age('9822233445')
    const r2 = await request('9822233445', 'sms')
    await db.as(null, `update public.platform_signup_otps set expires_at = now() - interval '1 second' where id = $1`, [r2.ref])
    expect((await verify('9822233445', await lastCode(r2.ref))).error).toMatch(/expired/)

    for (let i = 0; i < 3; i++) { await age('9822233445'); await request('9822233445') }
    await age('9822233445')
    await fails(request('9822233445'), /Too many codes for this number/)
  })

  test('switched off: sign-up works without a code; nothing is exposed to visitors', async () => {
    await call(P_ADMIN, 'cp_save_signup_settings', [{ otp: { enabled: false, channels: ['whatsapp'] } }], ['jsonb'])
    expect((await call<any>('anon', 'platform_signup_info')).otp.required).toBe(false)
    expect(await signup({ email: 'nocode@kosi.in', phone: '9833344556' })).toMatchObject({ status: 'pending' })
    await fails(db.as('anon', `select * from public.platform_signup_otps`), /permission denied/)
    await fails(call('anon', 'signup_otp_consume', ['9833344556', 'x'], ['text', 'text']), /permission denied/)
    await db.as(null, `update public.platform_signup_otps set created_at = now() - interval '3 days'`)
    expect(await call(null, 'signup_otp_cleanup')).toBeGreaterThan(0)
  })
})

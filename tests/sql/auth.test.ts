/**
 * "Forgot password" by WhatsApp / SMS code (scripts/sql/auth.sql).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'
import { DEMO_USERS } from '../../src/data/seed'

let db: Db
beforeAll(async () => { db = await freshDb('master') }, 180_000)

const patient = DEMO_USERS.find((u) => u.role === 'patient')!
const setNotify = (mut: (n: typeof DEFAULT_APP_SETTINGS.notifications & { events: Record<string, unknown> }) => void) => {
  const n = structuredClone(DEFAULT_APP_SETTINGS.notifications) as typeof DEFAULT_APP_SETTINGS.notifications & { events: Record<string, unknown> }
  mut(n)
  return db.as(null, `insert into public.app_settings (key, data) values ('app', jsonb_build_object('notifications', $1::jsonb))
    on conflict (key) do update set data = excluded.data`, [JSON.stringify(n)])
}
type Req = { sent: boolean; ref: string; channels: string[]; demo_code?: string }
const request = (email: string, phone: string, ch: string | null = 'whatsapp') =>
  db.one<{ r: Req }>('anon', 'select public.request_password_otp($1, $2, $3) r', [email, phone, ch]).then((x) => x.r)
const outbox = (ref: string) => db.as<{ channel: string; body: string; recipient: string }>(null,
  'select channel, body, recipient from public.notification_outbox where related_id = $1', [ref])
/** the code is only in the outbox message — read it from there, as the patient would on their phone */
const codeOf = async (ref: string) => (await outbox(ref))[0]?.body.match(/\d{6}/)?.[0] ?? ''
const fresh = () => db.exec(`delete from public.password_reset_otps`)

describe('password reset by mobile OTP', () => {
  test('the OTP table is unreachable through the API', async () => {
    await expect(db.as('anon', 'select * from public.password_reset_otps')).rejects.toThrow(/permission denied/)
    await expect(db.as(USER.patient, 'select * from public.password_reset_otps')).rejects.toThrow(/permission denied/)
  })

  test('no WhatsApp / SMS gateway → the option is off and no code ever reaches the browser', async () => {
    await setNotify(() => {})
    expect((await db.one<{ c: string[] }>('anon', 'select public.password_otp_channels() c')).c).toEqual([])
    await expect(request(patient.email, patient.phone)).rejects.toThrow(/MOBILE_RESET_OFF/)
  })

  test('matching e-mail + mobile → code on WhatsApp; verify → token → new password works, token is one-time', async () => {
    await fresh()
    await setNotify((n) => { n.whatsapp.enabled = true; n.sms.enabled = true })
    const r = await request(patient.email.toUpperCase(), patient.phone)
    expect(r).toMatchObject({ sent: true, channels: ['whatsapp'] })
    expect(r.demo_code).toBeUndefined()
    const msgs = await outbox(r.ref)
    expect(msgs.map((m) => m.channel)).toEqual(['whatsapp'])
    expect(msgs[0].recipient).toBe(patient.phone.replace(/\D/g, '').slice(-10))
    const code = await codeOf(r.ref)

    const bad = await db.one<{ r: { ok: boolean; error: string } }>('anon', 'select public.verify_password_otp($1, $2, $3) r', [patient.email, patient.phone, code === '000000' ? '111111' : '000000'])
    expect(bad.r).toMatchObject({ ok: false }); expect(bad.r.error).toMatch(/4 attempts left/)
    // right code but another account's e-mail → refused
    const other = await db.one<{ r: { ok: boolean } }>('anon', 'select public.verify_password_otp($1, $2, $3) r', ['owner@dchospital.com', patient.phone, code])
    expect(other.r.ok).toBe(false)

    const ok = await db.one<{ r: { ok: boolean; token: string } }>('anon', 'select public.verify_password_otp($1, $2, $3) r', [patient.email, patient.phone, code])
    expect(ok.r.ok).toBe(true)
    await expect(db.as('anon', 'select public.reset_password_with_otp($1, $2)', [ok.r.token, 'short'])).rejects.toThrow(/8 characters/)
    const done = await db.one<{ r: { ok: boolean; email: string } }>('anon', 'select public.reset_password_with_otp($1, $2) r', [ok.r.token, 'NewPass@2026'])
    expect(done.r).toMatchObject({ ok: true, email: patient.email })
    const pw = await db.one<{ ok: boolean }>(null, `select encrypted_password = extensions.crypt('NewPass@2026', encrypted_password) ok from auth.users where id = $1`, [USER.patient])
    expect(pw.ok).toBe(true)
    await expect(db.as('anon', 'select public.reset_password_with_otp($1, $2)', [ok.r.token, 'Another@2026'])).rejects.toThrow(/OTP_REQUIRED/)
  })

  test('e-mail and mobile of different accounts → same answer, but nothing is sent and it can never verify', async () => {
    await fresh()
    await setNotify((n) => { n.whatsapp.enabled = true })
    const r = await request('owner@dchospital.com', patient.phone)
    expect(r).toMatchObject({ sent: true, channels: ['whatsapp'] })
    expect(await outbox(r.ref)).toEqual([])
    const v = await db.one<{ r: { ok: boolean } }>('anon', 'select public.verify_password_otp($1, $2, $3) r', ['owner@dchospital.com', patient.phone, '123456'])
    expect(v.r.ok).toBe(false)
  })

  test('rate limits: 30 s between codes, banned (locked demo) accounts get nothing', async () => {
    await fresh()
    await setNotify((n) => { n.sms.enabled = true })
    await request(patient.email, patient.phone, 'sms')
    await expect(request(patient.email, patient.phone, 'sms')).rejects.toThrow(/30 seconds/)
    await fresh()
    await db.exec(`update auth.users set banned_until = now() + interval '100 years' where id = '${USER.patient}'`)
    const r = await request(patient.email, patient.phone, 'sms')
    expect(await outbox(r.ref)).toEqual([])
    await db.exec(`update auth.users set banned_until = null where id = '${USER.patient}'`)
  })

  test('a saved "Password reset OTP" event is used instead of the booking OTP wording', async () => {
    await fresh()
    await setNotify((n) => { n.whatsapp.enabled = true; n.events.password_otp = { sms: false, whatsapp: true } })
    const r = await request(patient.email, patient.phone)
    expect((await outbox(r.ref))[0].body).toMatch(/reset/i)
  })

  test('the upgrade script ships the same SQL', () => {
    const upgrade = readFileSync(resolve(__dirname, '../../supabase/upgrade-2026-10.sql'), 'utf8')
    expect(upgrade).toContain(readFileSync(resolve(__dirname, '../../scripts/sql/auth.sql'), 'utf8').trim())
  })
})

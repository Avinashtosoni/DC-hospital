/**
 * OTP verification (scripts/sql/otp_verify.sql + booking.sql):
 *  - sign-in OTP for hospital accounts: nothing of the hospital is visible until this session entered its code;
 *    per-session, carried over a password re-confirmation, never locks out someone with no reachable channel,
 *    impersonation sessions count as verified, turning it on needs a verified session
 *  - sign-in OTP for the control-panel team: provider_role() (and with it every cp_*) waits for the code
 *  - booking OTP: on/off switch, channel choice incl. e-mail, direct booking (rate limited) when it is off
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, knownOtp, USER, type Db } from './harness'

let db: Db
beforeAll(async () => { db = await freshDb('master') }, 180_000)

const CODE = '135790'
const session = (sid: string | null) => db.as(null, `select set_config('request.jwt.claims', $1, false)`, [sid ? JSON.stringify({ session_id: sid }) : ''])
/** deep-set app_settings 'app' → path (creating the row and every missing level) */
async function setApp(path: string, value: unknown) {
  await db.as(null, `insert into public.app_settings (key, data) values ('app', '{}') on conflict (tenant_id, key) do nothing`)
  const parts = path.replace(/[{}]/g, '').split(',')
  for (let i = 1; i < parts.length; i++) {
    await db.as(null, `update public.app_settings set data = jsonb_set(data, $1::text[], case when jsonb_typeof(data #> $1::text[]) = 'object' then data #> $1::text[] else '{}' end, true) where key = 'app'`, [`{${parts.slice(0, i).join(',')}}`])
  }
  await db.as(null, `update public.app_settings set data = jsonb_set(data, $1::text[], $2::jsonb, true) where key = 'app'`, [path, JSON.stringify(value)])
}
const tenantOf = async (who: string) => (await db.one<{ t: string | null }>(who, 'select public.current_tenant() t')).t
const knownLoginCode = (ref: string) => db.as(null, `update public.login_otps set code_hash = extensions.crypt($2, extensions.gen_salt('bf', 4)) where id = $1`, [ref, CODE])
const status = async (who: string) => (await db.one<{ s: any }>(who, 'select public.login_otp_status() s')).s
const request = async (who: string, ch: string | null = null) => (await db.one<{ r: any }>(who, 'select public.request_login_otp($1) r', [ch])).r
const verify = async (who: string, code: string) => (await db.one<{ r: any }>(who, 'select public.verify_login_otp($1) r', [code])).r
const waitOut = () => db.as(null, `update public.login_otps set created_at = created_at - interval '1 minute'`)

describe('sign-in OTP — hospital', () => {
  test('setup: WhatsApp on, owner has a mobile, sign-in OTP on for staff', async () => {
    await setApp('{notifications,whatsapp,enabled}', true)
    await setApp('{notifications,email,enabled}', true)
    await db.as(null, `update public.profiles set phone = '9876500001' where id = $1`, [USER.owner])
    await setApp('{security,otp,login}', { enabled: true, channels: ['whatsapp', 'email'], roles: 'staff' })
  })

  test('until the code is entered the hospital is invisible; then it is back — for this session only', async () => {
    await session('sess-1')
    const tenant = await db.one<{ t: string }>(null, 'select tenant_id t from public.profiles where id = $1', [USER.owner])
    expect(await tenantOf(USER.owner)).toBeNull()
    expect(await db.as(USER.owner, 'select id from public.patients limit 1')).toEqual([])
    const s = await status(USER.owner)
    expect(s).toMatchObject({ scope: 'hospital', required: true, verified: false, passed: false })
    expect(s.channels).toEqual([{ channel: 'whatsapp', to: '+91 •••••00001' }, { channel: 'email', to: expect.stringMatching(/^ow•••@/) }])

    const r = await request(USER.owner, 'whatsapp')
    expect(r).toMatchObject({ sent: true, channel: 'whatsapp', to: '+91 •••••00001', expires_in: 600 })
    // queued for the owner's own hospital, on WhatsApp only, with the code in it
    const q = await db.one<any>(null, `select tenant_id, channel, recipient, body from public.notification_outbox where related_id = $1`, [r.ref])
    expect(q).toMatchObject({ tenant_id: tenant.t, channel: 'whatsapp', recipient: '9876500001' })
    expect(q.body).toMatch(/^\d{6} is your .* sign-in code/)
    // the code itself is only stored hashed
    expect(JSON.stringify(await db.as(null, 'select * from public.login_otps'))).not.toContain(q.body.slice(0, 6))

    await knownLoginCode(r.ref)
    expect(await verify(USER.owner, '000000')).toMatchObject({ ok: false, error: expect.stringMatching(/4 attempts left/) })
    expect(await verify(USER.owner, CODE)).toEqual({ ok: true, scope: 'hospital' })
    expect(await tenantOf(USER.owner)).toBe(tenant.t)
    expect((await db.as(USER.owner, 'select id from public.patients limit 1')).length).toBe(1)

    await session('sess-2')   // signed in somewhere else
    expect(await tenantOf(USER.owner)).toBeNull()
    // "confirm your password" → a new session that carries the verified one over
    expect((await db.one<{ c: boolean }>(USER.owner, `select public.login_otp_carry('sess-1') c`)).c).toBe(true)
    expect(await tenantOf(USER.owner)).toBe(tenant.t)
    await session('sess-3')
    expect((await db.one<{ c: boolean }>(USER.owner, `select public.login_otp_carry('nope') c`)).c).toBe(false)
    expect(await tenantOf(USER.owner)).toBeNull()
  })

  test('limits: 30 s between codes, 5 wrong attempts burn the code', async () => {
    await session('sess-4')
    await waitOut()
    const r = await request(USER.owner, 'whatsapp')
    await expect(request(USER.owner, 'whatsapp')).rejects.toThrow(/wait 30 seconds/)
    await knownLoginCode(r.ref)
    for (let i = 0; i < 5; i++) await verify(USER.owner, '111111')
    expect(await verify(USER.owner, CODE)).toMatchObject({ ok: false, error: expect.stringMatching(/Too many wrong attempts/) })
    expect(await tenantOf(USER.owner)).toBeNull()
  })

  test('patients are not asked with roles = staff; are with roles = all', async () => {
    await session('sess-p')
    expect(await tenantOf(USER.patient)).not.toBeNull()
    await db.as(null, `update public.profiles set phone = '9876500006' where id = $1`, [USER.patient])
    await setApp('{security,otp,login,roles}', 'all')
    expect(await tenantOf(USER.patient)).toBeNull()
    await setApp('{security,otp,login,roles}', 'staff')
  })

  test('never locks out: no reachable channel → let in (status says so)', async () => {
    await session('sess-5')
    await db.as(null, `update public.profiles set phone = null where id = $1`, [USER.doctor])
    await setApp('{security,otp,login,channels}', ['whatsapp'])
    expect(await tenantOf(USER.doctor)).not.toBeNull()
    expect(await status(USER.doctor)).toMatchObject({ required: true, verified: false, passed: true, channels: [] })
    await setApp('{security,otp,login,channels}', ['whatsapp', 'email'])
  })

  test('a control-panel "sign in as user" session counts as verified', async () => {
    await session('sess-imp')
    expect(await tenantOf(USER.owner)).toBeNull()
    await db.as(null, `insert into public.impersonations (admin_id, target_id, hospital_id, reason, expires_at, session_id, bound_at)
      values ($1, $1, public.primary_tenant(), 'checking a reported problem', now() + interval '20 minutes', 'sess-imp', now())`, [USER.owner])
    expect(await tenantOf(USER.owner)).not.toBeNull()
  })

  test('turning it on needs a verified session; the format is checked', async () => {
    await setApp('{security,otp,login,enabled}', false)
    await session('sess-6')
    const on = `update public.app_settings set data = jsonb_set(data, '{security,otp,login,enabled}', 'true') where key = 'app'`
    await expect(db.as(USER.owner, on)).rejects.toThrow(/OTP_SETUP/)
    await expect(db.as(USER.owner, `update public.app_settings set data = jsonb_set(data, '{security,otp,login,channels}', '["pigeon"]') where key = 'app'`)).rejects.toThrow(/Unknown OTP channel/)
    // "Send me a code" works while it is still off
    await waitOut()
    const r = await request(USER.owner, null)
    await knownLoginCode(r.ref)
    expect((await verify(USER.owner, CODE)).ok).toBe(true)
    await db.as(USER.owner, on)
    expect(await tenantOf(USER.owner)).not.toBeNull()
    await setApp('{security,otp,login,enabled}', false)
  })

  test('the tables are out of reach of the API', async () => {
    await expect(db.as(USER.owner, 'select * from public.login_otps')).rejects.toThrow(/permission denied/)
    await expect(db.as(USER.owner, 'select * from public.login_otp_sessions')).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', 'select public.request_login_otp(null)')).rejects.toThrow(/permission denied/)
  })
})

describe('sign-in OTP — control-panel team', () => {
  const ADMIN = 'e0e00000-0000-4000-8000-0000000000a1'
  test('provider_role() waits for the code; cp_me() still answers with what the screen needs', async () => {
    await db.as(null, `insert into auth.users (id, email, encrypted_password) values ($1, 'admin@hc.in', 'x')`, [ADMIN])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, 'admin')`, [ADMIN])
    await session('team-1')
    expect((await db.one<{ r: string }>(ADMIN, 'select public.provider_role() r')).r).toBe('admin')
    // shared e-mail account saved in the panel
    await db.as(null, `insert into public.platform_settings (key, data) values ('messaging_accounts', '{"PLATFORM_EMAIL_PROVIDER":"resend"}')
      on conflict (key) do update set data = public.platform_settings.data || excluded.data`)
    // turning it on needs a verified session
    await expect(db.as(ADMIN, `select public.cp_save_security('{"loginOtp":{"enabled":true,"channels":["email"]}}')`)).rejects.toThrow(/OTP_SETUP/)
    const r = await request(ADMIN, 'email')
    expect(r).toMatchObject({ sent: true, scope: 'team', channel: 'email', to: 'ad•••@hc.in' })
    expect(await db.one(null, `select kind, channel, recipient from public.platform_outbox where ref_id = $1`, [r.ref])).toEqual({ kind: 'otp', channel: 'email', recipient: 'admin@hc.in' })
    await knownLoginCode(r.ref)
    expect(await verify(ADMIN, CODE)).toEqual({ ok: true, scope: 'team' })
    const saved = (await db.one<{ r: any }>(ADMIN, `select public.cp_save_security('{"loginOtp":{"enabled":true,"channels":["email"]}}') r`)).r
    expect(saved.loginOtp).toEqual({ enabled: true, channels: ['email'] })
    expect(saved.team).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'admin@hc.in', channels: ['email'] })]))

    await session('team-2')   // a new sign-in
    expect((await db.one<{ r: string | null }>(ADMIN, 'select public.provider_role() r')).r).toBeNull()
    await expect(db.as(ADMIN, 'select public.cp_hospitals()')).rejects.toThrow(/Hospital Comrade team/)
    const me = (await db.one<{ r: any }>(ADMIN, 'select public.cp_me() r')).r
    expect(me).toMatchObject({ role: 'admin', otp: { scope: 'team', required: true, verified: false, passed: false, channels: [{ channel: 'email' }] } })
  })

  test('the team edits a hospital\'s OTP switches (Hospital → Security)', async () => {
    await session('team-1')
    const t = (await db.one<{ t: string }>(null, 'select public.primary_tenant() t')).t
    const r = (await db.one<{ r: any }>(ADMIN, `select public.cp_set_hospital_otp($1, '{"booking":{"enabled":false},"login":{"enabled":true,"channels":["sms"],"roles":"all"}}') r`, [t])).r
    expect(r.otp).toEqual({ login: { enabled: true, channels: ['sms'], roles: 'all' }, booking: { enabled: false, channels: null } })
    expect(r).toHaveProperty('people'); expect(r).toHaveProperty('reachable')
    await expect(db.as(ADMIN, `select public.cp_set_hospital_otp($1, '{"login":{"channels":["fax"]}}')`, [t])).rejects.toThrow(/Unknown OTP channel/)
    // back to normal for the booking tests
    await db.as(ADMIN, `select public.cp_set_hospital_otp($1, '{"booking":{"enabled":true},"login":{"enabled":false}}')`, [t])
    await db.as(null, `update public.platform_settings set data = '{}' where key = 'security'`)
    await session(null)
  })
})

describe('booking OTP switch', { timeout: 30_000 }, () => {
  const freeSlot = async () => db.one<{ doc: string; day: string; tm: string }>(null, `
    select d.id doc, g.day::date::text as day, t.tm from public.doctors d,
      generate_series(current_date + 2, current_date + 25, interval '1 day') g(day),
      (select to_char(time '08:00' + k * interval '30 min', 'HH24:MI') tm from generate_series(0, 21) k) t
    where d.status = 'active' and public.slot_problem(d.id, g.day::date, t.tm, true) is null
      and not exists (select 1 from public.appointments a where a.doctor_id = d.id and a.appointment_date = g.day::date and a.appointment_time = t.tm and a.status not in ('cancelled', 'no_show'))
      -- one booking per doctor per day per patient: pick a day nobody booked on the web yet
      and not exists (select 1 from public.appointments a where a.doctor_id = d.id and a.appointment_date = g.day::date and a.source = 'website')
    order by d.full_name, 2, 3 limit 1`)
  const book = (token: string | null, phone: string | null, s: { doc: string; day: string; tm: string }) => db.one<{ r: any }>('anon',
    `select public.public_book_appointment($1, $2, $3::date, $4, 'Direct Booker', 'male', null, null, null, $5) r`, [token, s.doc, s.day, s.tm, phone])

  test('on (default): a code is needed', async () => {
    expect((await db.one<{ c: any }>('anon', 'select public.booking_otp_config() c')).c).toMatchObject({ required: true })
    await expect(book(null, '9876555001', await freeSlot())).rejects.toThrow(/OTP_REQUIRED/)
  })

  test('off: books straight away with the mobile number, still rate limited per number', async () => {
    await setApp('{security,otp,booking,enabled}', false)
    expect((await db.one<{ c: any }>('anon', 'select public.booking_otp_config() c')).c).toMatchObject({ required: false })
    const r = await book(null, '9876555002', await freeSlot())
    expect(r.r.patient.phone).toMatch(/98765 ?55002$/)
    expect(r.r.appointment.source).toBe('website')
    await expect(book(null, '12345', await freeSlot())).rejects.toThrow(/valid 10-digit/)
    for (let i = 0; i < 5; i++) await book(null, '9876555003', await freeSlot())
    await expect(book(null, '9876555003', await freeSlot())).rejects.toThrow(/Too many bookings for this number/)
    await setApp('{security,otp,booking,enabled}', true)
  })

  test('channels picked in Security win over the events matrix; e-mail needs an address', async () => {
    await setApp('{notifications,email,enabled}', true)
    await setApp('{security,otp,booking,channels}', ['email'])
    expect((await db.one<{ c: string[] }>('anon', 'select public.booking_otp_channels() c')).c).toEqual(['email'])
    await expect(db.as('anon', `select public.request_booking_otp('9876555010', 'email')`)).rejects.toThrow(/email address/)
    const r = (await db.one<{ r: any }>('anon', `select public.request_booking_otp('9876555010', 'email', 'Visitor@Example.in') r`)).r
    expect(r).toMatchObject({ sent: true, channels: ['email'] })
    expect(await db.one(null, `select channel, recipient, subject from public.notification_outbox where related_id = $1`, [r.ref]))
      .toEqual({ channel: 'email', recipient: 'visitor@example.in', subject: 'Your booking code' })
    // the verified code still books for the mobile number
    const v = (await db.one<{ r: any }>('anon', 'select public.verify_booking_otp($1, $2) r', ['9876555010', await knownOtp(db, r.ref)])).r
    expect((await book(v.token, null, await freeSlot())).r.patient.phone).toMatch(/98765 ?55010$/)
    await setApp('{security,otp,booking,channels}', ['whatsapp', 'sms'])
    expect((await db.one<{ c: string[] }>('anon', 'select public.booking_otp_channels() c')).c).toEqual(['whatsapp'])
  })
})

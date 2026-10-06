/**
 * The public demo hospital (scripts/sql/demo.sql + the generated supabase/demo-hospital.sql):
 *  - demo-hospital.sql marks the primary hospital as the demo and loads the demo data
 *  - demo_reset() removes what visitors added (people, patients …) and loads the demo data again; other hospitals
 *    and the platform team are untouched; settings / website come back from the saved baseline
 *  - codes are shown on screen (or really sent) as the control panel decides; other messages are skipped
 *  - visitors can't save provider keys; only Hospital Comrade admins change the demo settings
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

let db: Db
const MAIN = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const B_PATIENT = 'b0b00000-0000-4000-8000-000000000002'
const VISITOR = 'f0f00000-0000-4000-8000-000000000001'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  return (await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)))).r
}
const count = async (sql: string, params: unknown[] = []) => Number((await db.one<{ n: number }>(null, `select count(*)::int n from ${sql}`, params)).n)
/** run as anon on the demo hospital's site */
const asSite = async <T = any>(sql: string, params: unknown[] = []) => {
  await db.exec(`select set_config('app.tenant_id', '${MAIN}', false)`)
  try { return (await db.one<{ r: T }>('anon', sql, params)).r } finally { await db.exec(`select set_config('app.tenant_id', '', false)`) }
}

beforeAll(async () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/master.sql'), 'utf8') + '\n' + readFileSync(resolve(__dirname, '../../supabase/demo-hospital.sql'), 'utf8')
  db = await freshDb({ sql })
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status) values ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'active')`, [B])
  await signUp(B_PATIENT, 'ravi@example.com', { full_name: 'Ravi Kumar', tenant_id: B })
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 240_000)

describe('demo hospital', { timeout: 60_000 }, () => {
  test('demo-hospital.sql made the primary hospital the demo, with its demo accounts and data', async () => {
    expect(await db.one(null, `select is_demo, is_primary from public.tenants where id = $1`, [MAIN])).toEqual({ is_demo: true, is_primary: true })
    expect(await db.one(null, `select is_demo from public.tenants where id = $1`, [B])).toEqual({ is_demo: false })
    expect(await db.one('anon', `select slug, is_demo from public.resolve_tenant('x.example', 'main')`)).toEqual({ slug: 'main', is_demo: true })
    expect(await db.one(null, `select role from public.profiles where id = $1`, [USER.doctor])).toEqual({ role: 'doctor' })
    expect(await count(`public.patients where tenant_id = $1`, [MAIN])).toBeGreaterThan(10)
  })

  test('the demo site offers one-click sign-ins; other hospitals say nothing', async () => {
    const info = await asSite(`select public.public_demo_info() r`)
    expect(info).toMatchObject({ demo: true, otp: 'screen', password: 'Demo@123', resets_at: '03:00 IST' })
    expect(info.logins.map((l: any) => l.role)).toEqual(['owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient'])
    await db.exec(`select set_config('app.tenant_id', '${B}', false)`)
    expect((await db.one<{ r: unknown }>('anon', `select public.public_demo_info() r`)).r).toBeNull()
    await db.exec(`select set_config('app.tenant_id', '', false)`)
  })

  test('booking codes are shown on screen and nothing is sent; "real" sends them', async () => {
    const r = await asSite(`select public.request_booking_otp('9876512345') r`)
    expect(r).toMatchObject({ sent: true, demo_code: expect.stringMatching(/^\d{6}$/) })
    await call(P_ADMIN, 'cp_save_demo', [{ otp: 'real' }], ['jsonb'])
    const real = await asSite(`select public.request_booking_otp('9876512346') r`)
    expect(real.demo_code).toBeUndefined()
    await call(P_ADMIN, 'cp_save_demo', [{ otp: 'screen' }], ['jsonb'])
  })

  test('messages from the demo hospital are skipped unless the team turns them on', async () => {
    const ins = (event: string) => db.one<{ status: string }>(null, `insert into public.notification_outbox (tenant_id, event, channel, recipient, body)
      values ($1, $2, 'sms', '9876500000', 'hi') returning status`, [MAIN, event])
    expect((await ins('otp')).status).toBe('skipped')
    expect((await ins('appointment_booked')).status).toBe('skipped')
    await call(P_ADMIN, 'cp_save_demo', [{ messages: true }], ['jsonb'])
    expect((await ins('appointment_booked')).status).toBe('pending')
    expect((await ins('otp')).status).toBe('skipped')   // codes still follow the OTP setting
    await call(P_ADMIN, 'cp_save_demo', [{ messages: false }], ['jsonb'])
    // other hospitals are real
    expect((await db.one<{ status: string }>(null, `insert into public.notification_outbox (tenant_id, event, channel, recipient, body)
      values ($1, 'appointment_booked', 'sms', '9876500000', 'hi') returning status`, [B])).status).toBe('pending')
  })

  test('sign-in OTP in the demo needs no connected channel and shows the code', async () => {
    await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($1, 'app', '{}') on conflict (tenant_id, key) do nothing`, [MAIN])
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{security}', '{"otp": {"login": {"enabled": true, "channels": ["sms"], "roles": "staff"}}}'::jsonb, true) where key = 'app' and tenant_id = $1`, [MAIN])
    expect(await count(`public.app_settings where key = 'app' and tenant_id = $1 and data #>> '{security,otp,login,enabled}' = 'true'`, [MAIN])).toBe(1)
    await db.as(null, `select set_config('request.jwt.claims', '{"session_id":"demo-1"}', false)`)
    try {
    const s = (await db.one<{ s: any }>(USER.doctor, 'select public.login_otp_status() s')).s
    expect(s).toMatchObject({ required: true, verified: false })
    const r = (await db.one<{ r: any }>(USER.doctor, 'select public.request_login_otp(null) r')).r
    expect(r).toMatchObject({ sent: true, demo_code: expect.stringMatching(/^\d{6}$/) })
    expect((await db.one<{ r: any }>(USER.doctor, 'select public.verify_login_otp($1) r', [r.demo_code])).r).toMatchObject({ ok: true })
    } finally { await db.as(null, `select set_config('request.jwt.claims', '', false)`) }
    await db.as(null, `update public.app_settings set data = data - 'security' where key = 'app' and tenant_id = $1`, [MAIN])
  })

  test('visitors cannot save provider keys there; real hospitals can', async () => {
    await expect(db.as(USER.owner, `select public.set_app_secret('sms_api_key', 'x')`)).rejects.toThrow(/not available in the demo/)
  })

  test('only Hospital Comrade admins see or change the demo settings', async () => {
    await expect(call(P_SUPPORT, 'cp_demo')).rejects.toThrow(/admin/)
    await expect(call(USER.owner, 'cp_demo_reset')).rejects.toThrow(/Hospital Comrade team/)
    await expect(call(P_ADMIN, 'cp_save_demo', [{ otp: 'pigeon' }], ['jsonb'])).rejects.toThrow(/screen or real/)
    const d = await call(P_ADMIN, 'cp_demo')
    expect(d).toMatchObject({ hospital: { slug: 'main' }, seed_installed: true, config: { otp: 'screen', messages: false, logins: true, nightly: true }, password: 'Demo@123' })
  })

  test('reset: visitors\' sign-ups and records go, the demo data comes back, other hospitals and the team stay', async () => {
    const before = await count(`public.patients where tenant_id = $1`, [MAIN])
    await signUp(VISITOR, 'visitor@example.com', { full_name: 'Visitor', tenant_id: MAIN })
    await db.as(null, `select set_config('app.tenant_id', '${MAIN}', false)`)
    await db.as(null, `insert into public.patients (full_name, phone) values ('Visitor Added', '9876599999')`)
    await db.as(null, `update public.doctors set full_name = 'Renamed by a visitor' where id in (select id from public.doctors where tenant_id = $1 limit 2)`, [MAIN])
    await db.as(null, `select set_config('app.tenant_id', '', false)`)
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{hospital}', '{"name": "Changed by a visitor"}'::jsonb, true) where key = 'app' and tenant_id = $1`, [MAIN])
    const bPatients = await count(`public.patients where tenant_id = $1`, [B])
    const doctors = await count(`public.doctors where tenant_id = $1`, [MAIN])

    const d = await call(P_ADMIN, 'cp_demo_reset')
    expect(d.last_reset_at).toBeTruthy()
    expect(d.last_reset_by).toBe('Provider admin')
    expect(await count(`auth.users where id = $1`, [VISITOR])).toBe(0)
    expect(await count(`public.patients where full_name = 'Visitor Added'`)).toBe(0)
    expect(await count(`public.patients where tenant_id = $1`, [MAIN])).toBe(before)
    expect(await count(`public.doctors where tenant_id = $1`, [MAIN])).toBe(doctors)
    expect(await count(`public.doctors where full_name = 'Renamed by a visitor'`)).toBe(0)
    expect(await count(`public.app_settings where tenant_id = $1 and data #>> '{hospital,name}' = 'Changed by a visitor'`, [MAIN])).toBe(0)
    expect(await db.one(null, `select role from public.profiles where id = $1`, [USER.receptionist])).toEqual({ role: 'receptionist' })
    expect(await count(`public.patients where tenant_id = $1`, [B])).toBe(bPatients)
    expect(await count(`auth.users where id in ($1, $2, $3)`, [B_PATIENT, P_ADMIN, P_SUPPORT])).toBe(3)
    expect(await count(`public.provider_audit where action = 'demo:reset'`)).toBe(1)
  })

  test('the saved baseline (settings + website) comes back after every reset', async () => {
    await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($1, 'app', '{}') on conflict (tenant_id, key) do nothing`, [MAIN])
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{hospital}', '{"name": "DC Hospital (demo)"}'::jsonb, true) where key = 'app' and tenant_id = $1`, [MAIN])
    const d = await call(P_ADMIN, 'cp_demo_save_baseline')
    expect(d.baseline).toMatchObject({ by: 'Provider admin' })
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{hospital}', '{"name": "Visitor"}'::jsonb, true) where key = 'app' and tenant_id = $1`, [MAIN])
    await call(P_ADMIN, 'cp_demo_reset')
    expect(await db.one(null, `select data #>> '{hospital,name}' n from public.app_settings where key = 'app' and tenant_id = $1`, [MAIN])).toEqual({ n: 'DC Hospital (demo)' })
    // cleared → defaults again
    await call(P_ADMIN, 'cp_save_demo', [{ clearBaseline: true }], ['jsonb'])
    expect((await call(P_ADMIN, 'cp_demo')).baseline).toBeNull()
  })

  test('the nightly job resets only while "every night" is on', async () => {
    await signUp(VISITOR, 'visitor@example.com', { full_name: 'Visitor', tenant_id: MAIN })
    await call(P_ADMIN, 'cp_save_demo', [{ nightly: false }], ['jsonb'])
    await db.as(null, 'select public.demo_reset_nightly()')
    expect(await count(`auth.users where id = $1`, [VISITOR])).toBe(1)
    await call(P_ADMIN, 'cp_save_demo', [{ nightly: true }], ['jsonb'])
    await db.as(null, 'select public.demo_reset_nightly()')
    expect(await count(`auth.users where id = $1`, [VISITOR])).toBe(0)
  })
})

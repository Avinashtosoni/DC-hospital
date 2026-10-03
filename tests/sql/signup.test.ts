/**
 * Phase 8.2 — self-service free-trial sign-up (scripts/sql/signup.sql): settings, validation, rate limits,
 * instant vs approve, the admin's decisions and the nightly clean-up of unclaimed trials.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const OWNER = 'f0f00000-0000-4000-8000-000000000001'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)))
  return r.r
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)
const form = (o: Record<string, unknown> = {}) => ({ organisation: 'Sunrise Care Clinic', name: 'Dr. Meera Jha', email: 'meera@sunrise.in', phone: '98765 43210', city: 'Purnia', terms_version: '2026-10-02', ...o })
const signup = (o: Record<string, unknown> = {}) => call('anon', 'platform_trial_signup', [form(o)], ['jsonb'])
const settings = (p: object) => call(P_ADMIN, 'cp_save_signup_settings', [p], ['jsonb'])

beforeAll(async () => {
  db = await freshDb('master')
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 240_000)

describe('self-service sign-up', () => {
  test('the page learns the settings; the admin changes them (validated)', async () => {
    expect(await call('anon', 'platform_signup_info')).toMatchObject({ enabled: true, mode: 'approve', trialDays: 14, plan: 'clinic' })
    expect((await call<any>('anon', 'platform_signup_info')).plans).toContain('hospital')
    await fails(call(P_SUPPORT, 'cp_signup_settings'), /\(admin\)/)
    await fails(call('anon', 'cp_signups'), /permission denied/)
    await fails(call('anon', 'signup_activate', ['00000000-0000-4000-8000-000000000000'], ['uuid']), /permission denied/)
    await fails(call('anon', 'hospital_create', [{}], ['jsonb']), /permission denied/)
    await fails(settings({ mode: 'auto' }), /instant or approve/)
    await fails(settings({ trialDays: 120 }), /1 to 90/)
    await fails(settings({ plan: 'gold' }), /Unknown plan/)
    await fails(settings({ foo: 1 }), /Unknown setting/)
    await fails(settings({ platformUrl: 'javascript:alert(1)' }), /https/)
    expect(await settings({ trialDays: 30, platformUrl: 'https://hospital.digitalcomrade.in' })).toMatchObject({ trialDays: 30, pending: 0 })
  })

  test('validation, honeypot and the Terms checkbox', async () => {
    await fails(signup({ organisation: 'X' }), /hospital or clinic/)
    await fails(signup({ email: 'nope' }), /valid e-mail/)
    await fails(signup({ phone: '12345' }), /10-digit/)
    await fails(signup({ terms_version: '' }), /Terms of Service/)
    await fails(signup({ website: 'spam.example' }), /Could not sign up/)
    await fails(signup({ email: 'owner@dchospital.com' }), /already belongs/)
  })

  test('approve mode: the request waits; the admin approves → hospital + bootstrap owner + welcome e-mail', async () => {
    expect(await signup()).toEqual({ status: 'pending', email: 'meera@sunrise.in' })
    await fails(signup(), /already have a request/)
    const list = await call<any[]>(P_ADMIN, 'cp_signups')
    expect(list[0]).toMatchObject({ organisation: 'Sunrise Care Clinic', slug: 'sunrisecareclinic', code: 'SCC', plan: 'clinic', trial_days: 30, status: 'pending', phone: '9876543210', terms_version: '2026-10-02' })
    expect(list[0]).not.toHaveProperty('ip_hash')
    const done = await call(P_ADMIN, 'cp_signup_decide', [list[0].id, 'approve'], ['uuid', 'text'])
    expect(done).toMatchObject({ status: 'created', decided_by_name: 'Provider admin' })
    const t = await db.one<any>(null, `select id, status, plan, round(extract(epoch from trial_ends_at - now()) / 86400)::int as days from public.tenants where slug = 'sunrisecareclinic'`)
    expect(t).toMatchObject({ status: 'trial', plan: 'clinic', days: 30 })
    expect((await db.one<any>(null, `select data from public.app_settings where tenant_id = $1 and key = 'bootstrap'`, [t.id])).data.owner_email).toBe('meera@sunrise.in')
    const mail = await db.one<any>(null, `select channel, recipient, subject, body from public.notification_outbox where tenant_id = $1 and event = 'signup_welcome'`, [t.id])
    expect(mail).toMatchObject({ channel: 'email', recipient: 'meera@sunrise.in', subject: 'Your free trial of Sunrise Care Clinic is ready' })
    expect(mail.body).toContain('https://hospital.digitalcomrade.in/register?hospital=sunrisecareclinic')
    expect(mail.body).toContain('Namaste Meera')
    await fails(call(P_ADMIN, 'cp_signup_decide', [list[0].id, 'reject'], ['uuid', 'text']), /already handled/)
    // the e-mail is now taken (bootstrap) — one account = one hospital
    await fails(signup({ phone: '9876500000' }), /already belongs/)
    // signing up with it on that hospital makes the owner
    await signUp(OWNER, 'meera@sunrise.in', { full_name: 'Dr. Meera Jha', tenant_id: t.id })
    expect((await db.one<any>(null, `select role from public.profiles where id = $1`, [OWNER])).role).toBe('owner')
  })

  test('reject, instant mode, unique short names, closed sign-up', async () => {
    await signup({ email: 'a@spam.in', phone: '9000000001', organisation: 'Spam' })
    const s = (await call<any[]>(P_ADMIN, 'cp_signups', ['pending'], ['text']))[0]
    expect(s.slug).toBe('spam')
    expect(await call(P_ADMIN, 'cp_signup_decide', [s.id, 'reject', 'Not a hospital'], ['uuid', 'text', 'text'])).toMatchObject({ status: 'rejected', reason: 'Not a hospital' })
    expect((await db.one<any>(null, `select count(*)::int as n from public.tenants where slug = 'spam'`)).n).toBe(0)

    await settings({ mode: 'instant', trialDays: 7 })
    const r = await signup({ email: 'b@sunrise2.in', phone: '9000000002' })
    expect(r).toMatchObject({ status: 'created', slug: 'sunrisecareclinic-2', trial_days: 7 })
    expect((await db.one<any>(null, `select status from public.tenants where slug = 'sunrisecareclinic-2'`)).status).toBe('trial')

    await settings({ enabled: false })
    await fails(signup({ email: 'c@x.in', phone: '9000000003' }), /sign-up is closed/)
    expect((await call<any>('anon', 'platform_signup_info')).enabled).toBe(false)
    await settings({ enabled: true })
  })

  test('rate limits: per phone and per day', async () => {
    await fails(signup({ email: 'd@x.in', phone: '9000000002', organisation: 'Again Clinic' }).then(() => signup({ email: 'e@x.in', phone: '9000000002', organisation: 'Again2' })), /mobile number/)
    await settings({ maxPerDay: 1 })
    await fails(signup({ email: 'f@x.in', phone: '9000000009', organisation: 'Busy Day' }), /lot of sign-ups/)
    await settings({ maxPerDay: 25 })
  })

  test('nightly clean-up closes trials nobody claimed and expires stale requests', async () => {
    await db.as(null, `update public.platform_signups set created_at = now() - interval '40 days'`)
    await settings({ mode: 'approve' })
    const before = await db.one<any>(null, `select count(*)::int as n from public.platform_signups where status = 'pending'`)
    expect(before.n).toBe(0)
    await db.as(null, `insert into public.platform_signups (organisation, contact_name, email, phone, plan, trial_days, slug, code, terms_version, created_at)
      values ('Old Req', 'Someone', 'old@x.in', '9111111111', 'clinic', 14, 'oldreq', 'OR', '2026-10-02', now() - interval '31 days')`)
    const r = await call(null, 'signup_cleanup')
    expect(r).toMatchObject({ expired: 1 })
    const closed = (await db.one<any>(null, `select jsonb_agg(jsonb_build_object('slug', slug, 'closing', closing_at is not null, 'close_reason', close_reason) order by slug) as j from public.tenants where slug like 'sunrise%'`)).j
    // Sunrise (owner joined) stays open; the instant one nobody claimed closes
    expect(closed).toEqual([
      { slug: 'sunrisecareclinic', closing: false, close_reason: null },
      { slug: 'sunrisecareclinic-2', closing: true, close_reason: 'Unclaimed free trial (self-service sign-up)' },
    ])
    expect((await call<any>(P_ADMIN, 'run_retention')).signups).toMatchObject({ closed: 0 })
  })
})

describe('launch check (phase 8.3)', () => {
  test('admins only; flags demo logins, one admin, missing seller details and unscheduled jobs', async () => {
    await fails(call(P_SUPPORT, 'cp_launch_check'), /\(admin\)/)
    await fails(call('anon', 'cp_launch_check'), /permission denied/)
    const r = await call<{ checks: { id: string; status: string; detail: string }[] }>(P_ADMIN, 'cp_launch_check')
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]))
    expect(by.demo_logins.status).toBe('fail')                // master.sql ships the sample accounts
    expect(by.demo_logins.detail).toContain('owner@dchospital.com')
    expect(by.admins.status).toBe('warn')                     // one admin in this test database
    expect(by.seller).toMatchObject({ status: 'fail', detail: expect.stringContaining('GSTIN') })
    expect(by.jobs.status).toBe('fail')                       // PGlite has no pg_cron
    expect(by.rls.status).toBe('ok')
    expect(by.isolation.status).toBe('ok')
    expect(by.signup.status).toBe('ok')                       // platformUrl was set earlier
    expect(Object.keys(by)).toEqual(['demo_logins', 'demo_hospital', 'admins', 'seller', 'jobs', 'pg_net', 'rls', 'isolation', 'retention', 'signup', 'messages', 'primary_owner'])
  })
  test('on production.sql the sample logins are gone', async () => {
    const prod = await freshDb('production')
    await prod.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'boss@hc.in', 'x', '{}'::jsonb)`, [P_ADMIN])
    await prod.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await prod.as(null, `update public.profiles set tenant_id = null where id = $1`, [P_ADMIN])
    await prod.as(null, `insert into public.provider_users (user_id, role) values ($1, 'admin')`, [P_ADMIN])
    const r = (await prod.one<{ r: { checks: { id: string; status: string }[] } }>(P_ADMIN, `select public.cp_launch_check() as r`)).r
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c.status]))
    expect(by).toMatchObject({ demo_logins: 'ok', demo_hospital: 'ok', rls: 'ok', isolation: 'ok' })
  }, 240_000)
})

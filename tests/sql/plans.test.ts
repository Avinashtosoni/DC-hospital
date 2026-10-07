/**
 * The plans catalogue (scripts/sql/plans.sql): public read, add / edit / archive / reorder / delete from the Control
 * Panel, the price-change choice for existing hospitals, owner notices, and the checks in sign-up / leads / billing.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const n = structuredClone(DEFAULT_APP_SETTINGS.notifications)
n.email.enabled = true

async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a)))
  return r.r
}
const plans = async () => (await db.one<{ p: Record<string, any> }>(null, `select data -> 'plans' p from public.platform_settings where key = 'billing'`)).p

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.app_settings (key, data) values ('app', jsonb_build_object('notifications', $1::jsonb))
    on conflict (tenant_id, key) do update set data = excluded.data`, [JSON.stringify(n)])
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status) values ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'active'),
    ($2, 'care', 'Care Clinic', 'CRC', 'clinic', 'active')`, [B, C])
  await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'owner@city.in', 'x', $2::jsonb)`,
    [B_OWNER, JSON.stringify({ full_name: 'City Owner', tenant_id: B })])
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
  await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($2, 'app', jsonb_build_object('notifications', $1::jsonb))
    on conflict (tenant_id, key) do update set data = excluded.data`, [JSON.stringify(n), B])
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support']]) {
    await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify({ full_name: `Provider ${role}` })])
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 240_000)

describe('catalogue', () => {
  test('a fresh install has the four built-in plans with every field', async () => {
    const p = await plans()
    expect(Object.keys(p).sort()).toEqual(['clinic', 'custom', 'enterprise', 'hospital'])
    expect(p.hospital).toMatchObject({ name: 'Hospital', price: 2999, highlight: true, public: true, archived: false, signup: true, order: 1 })
    expect(p.hospital.features.length).toBeGreaterThan(3)
  })

  test('older databases ({ price, included } only) get the rest filled in, saved values kept', async () => {
    const old = await plans()
    await db.as(null, `update public.platform_settings set data = jsonb_set(data, '{plans}', $1::jsonb) where key = 'billing'`,
      [JSON.stringify({ clinic: { price: 1111, included: { sms: 1, whatsapp: 2, email: 3 } }, multi: { price: 5000, included: { sms: 0, whatsapp: 0, email: 0 } } })])
    const sql = (await import('node:fs')).readFileSync('scripts/sql/plans.sql', 'utf8')
    const backfill = sql.slice(sql.indexOf('with d as'), sql.indexOf('-- ------------------------------------------------------------------ read'))
    const { BILLING_DEFAULTS } = await import('../../src/platform/billing')
    await db.as(null, backfill.replace('@@PLAN_DEFAULTS@@', JSON.stringify(BILLING_DEFAULTS.plans)))
    const p = await plans()
    expect(p.clinic).toMatchObject({ name: 'Clinic', price: 1111, included: { sms: 1 }, public: true, order: 0 })
    expect(p.multi).toMatchObject({ name: 'Multi', price: 5000, public: true, archived: false })
    await db.as(null, `update public.platform_settings set data = jsonb_set(data, '{plans}', $1::jsonb) where key = 'billing'`, [JSON.stringify(old)])
  })

  test('platform_plans(): visitors see offered plans in order, the team sees every plan', async () => {
    await call(P_ADMIN, 'cp_save_plan', ['custom', { public: false }], ['text', 'jsonb'])
    const anon = await call<{ plans: { id: string }[]; gstPercent: number }>(null, 'platform_plans')
    expect(anon.plans.map((p) => p.id)).toEqual(['clinic', 'hospital', 'enterprise'])
    expect(anon.gstPercent).toBe(18)
    const team = await call<{ plans: { id: string }[] }>(P_SUPPORT, 'platform_plans')
    expect(team.plans.map((p) => p.id)).toEqual(['clinic', 'hospital', 'enterprise', 'custom'])
    await call(P_ADMIN, 'cp_save_plan', ['custom', { public: true }], ['text', 'jsonb'])
  })
})

describe('editing', () => {
  test('only platform admins can change plans; bad input is refused', async () => {
    await expect(call(P_SUPPORT, 'cp_save_plan', ['clinic', { price: 1 }], ['text', 'jsonb'])).rejects.toThrow()
    await expect(call(B_OWNER, 'cp_save_plan', ['clinic', { price: 1 }], ['text', 'jsonb'])).rejects.toThrow()
    await expect(call(P_ADMIN, 'cp_save_plan', ['Bad ID', { name: 'X' }], ['text', 'jsonb'])).rejects.toThrow(/Plan ID/)
    await expect(call(P_ADMIN, 'cp_save_plan', ['clinic', { price: -5 }], ['text', 'jsonb'])).rejects.toThrow(/Price/)
    await expect(call(P_ADMIN, 'cp_save_plan', ['clinic', { colour: 'red' }], ['text', 'jsonb'])).rejects.toThrow(/Unknown plan field/)
    await expect(call(P_ADMIN, 'cp_save_plan', ['clinic', { features: ['ok', ''] }], ['text', 'jsonb'])).rejects.toThrow(/Features/)
    await expect(call(P_ADMIN, 'cp_save_plan', ['brand-new', { price: 10 }], ['text', 'jsonb'])).rejects.toThrow(/name/)
  })

  test('a new plan gets defaults, goes last, and "most popular" moves to it', async () => {
    const r = await call<{ billing: { plans: Record<string, any> } }>(P_ADMIN, 'cp_save_plan',
      ['multi-branch', { name: 'Multi-branch', price: 14999, features: ['Up to 5 branches'], highlight: true, signup: true }], ['text', 'jsonb'])
    expect(r.billing.plans['multi-branch']).toMatchObject({ name: 'Multi-branch', price: 14999, public: true, archived: false, order: 4, cta: 'Get started' })
    expect(r.billing.plans.hospital.highlight).toBe(false)
    const audit = await db.one<{ n: number }>(null, `select count(*)::int n from public.provider_audit where action = 'plan:create' and target = 'multi-branch'`)
    expect(audit.n).toBe(1)
    // leads and sign-ups accept it
    await db.as(null, `select public.submit_platform_lead('Dr Test', 'Test Clinic', '9876500001', null, null, 'multi-branch')`)
    expect((await db.one<{ plan: string }>(null, `select plan from public.platform_leads where phone = '9876500001'`)).plan).toBe('multi-branch')
    const info = await call<{ plans: string[] }>(null, 'platform_signup_info')
    expect(info.plans).toEqual(['clinic', 'hospital', 'multi-branch'])
  })

  test('price change, "apply": owners are told (bell + e-mail), the plan keeps a notice', async () => {
    await db.as(null, 'delete from public.notification_outbox'); await db.as(null, 'delete from public.user_notifications')
    const r = await call<{ notified: number; kept: number }>(P_ADMIN, 'cp_save_plan',
      ['clinic', { price: 1199, included: { sms: 100, whatsapp: 500, email: 1000 } }, 'apply', true], ['text', 'jsonb', 'text', 'boolean'])
    expect(r).toMatchObject({ kept: 0 })
    const mail = await db.as<{ event: string; body: string; channel: string }>(null, `select event, body, channel from public.notification_outbox where event = 'plan_updated'`)
    expect(mail.some((m) => m.channel === 'email' && m.body.includes('₹999 → ₹1,199') && m.body.includes('WhatsApp messages included each month: 300 → 500'))).toBe(true)
    const bell = await db.as<{ body: string }>(null, `select body from public.user_notifications where profile_id = $1 and event = 'plan_updated'`, [B_OWNER])
    expect(bell).toHaveLength(1)
    const p = await plans()
    expect(p.clinic.notice.text).toContain('₹999 → ₹1,199')
    // owners see the new price when they renew
    const s = await db.one<{ r: { price: number } }>(B_OWNER, `select public.billing_summary() r`)
    expect(s.r.price).toBe(1199)
  })

  test('price change, "keep": hospitals on the plan keep today\'s price as their own, nobody gets a price notice', async () => {
    await db.as(null, 'delete from public.notification_outbox')
    const r = await call<{ kept: number }>(P_ADMIN, 'cp_save_plan', ['clinic', { price: 1499 }, 'keep', true], ['text', 'jsonb', 'text', 'boolean'])
    expect(r.kept).toBe(2)
    const t = await db.as<{ price: string }>(null, `select billing ->> 'price' price from public.tenants where id in ($1, $2)`, [B, C])
    expect(t.map((x) => Number(x.price))).toEqual([1199, 1199])
    expect((await db.as(null, `select 1 from public.notification_outbox where event = 'plan_updated'`)).length).toBe(0)
    // put them back on the list price for the next tests
    await db.as(null, `update public.tenants set billing = billing - 'price' where id in ($1, $2)`, [B, C])
  })

  test('p_notify = false saves quietly', async () => {
    await db.as(null, 'delete from public.notification_outbox')
    await call(P_ADMIN, 'cp_save_plan', ['clinic', { name: 'Clinic Plus' }, 'apply', false], ['text', 'jsonb', 'text', 'boolean'])
    expect((await db.as(null, `select 1 from public.notification_outbox`)).length).toBe(0)
    expect((await db.one<{ n: string }>(null, `select public.plan_name('clinic') n`)).n).toBe('Clinic Plus')
  })

  test('archived plans: hidden from visitors and sign-up, owners can\'t pick them, their own hospitals keep them', async () => {
    await call(P_ADMIN, 'cp_save_plan', ['hospital', { archived: true }], ['text', 'jsonb'])
    const anon = await call<{ plans: { id: string }[] }>(null, 'platform_plans')
    expect(anon.plans.map((p) => p.id)).not.toContain('hospital')
    expect((await call<{ plans: string[] }>(null, 'platform_signup_info')).plans).not.toContain('hospital')
    await expect(db.one(B_OWNER, `select public.my_billing_quote('plan', 1, null, 'hospital')`)).rejects.toThrow(/no longer offered/)
    await call(P_ADMIN, 'cp_save_plan', ['hospital', { archived: false }], ['text', 'jsonb'])
  })

  test('reorder and delete (only unused plans)', async () => {
    const r = await call<{ billing: { plans: Record<string, { order: number }> } }>(P_ADMIN, 'cp_reorder_plans',
      [['multi-branch', 'clinic', 'hospital', 'enterprise', 'custom']], ['text[]'])
    expect(r.billing.plans['multi-branch'].order).toBe(0)
    expect(r.billing.plans.custom.order).toBe(4)
    await expect(call(P_ADMIN, 'cp_delete_plan', ['clinic'])).rejects.toThrow(/hospital\(s\) are on/)
    await call(P_ADMIN, 'cp_delete_plan', ['multi-branch'])
    expect(Object.keys(await plans())).not.toContain('multi-branch')
    const h = await call<{ action: string }[]>(P_ADMIN, 'cp_plan_history', [20], ['int'])
    expect(h.map((x) => x.action)).toEqual(expect.arrayContaining(['plan:create', 'plan:update', 'plan:reorder', 'plan:delete']))
  })
})

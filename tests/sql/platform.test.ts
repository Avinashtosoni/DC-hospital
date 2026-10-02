/**
 * Phase 2 — platform-level pieces: leads from the Hospital Comrade product page.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

const ADMIN = '2e000000-0000-4000-8000-000000000001'
const SUPPORT = '2e000000-0000-4000-8000-000000000002'
let db: Db

const lead = (who: string | null, phone: string, extra: Record<string, string | null> = {}) => db.as(who,
  `select public.submit_platform_lead(p_name => $1, p_organisation => $2, p_phone => $3, p_email => $4, p_city => $5, p_plan => $6, p_message => $7, p_source => $8)`,
  [extra.name ?? 'Dr. Asha Verma', extra.organisation ?? 'Verma Clinic', phone, extra.email ?? 'asha@example.com', 'Patna', extra.plan ?? 'clinic', 'Two doctors', 'hospital.digitalcomrade.in'])

beforeAll(async () => {
  db = await freshDb('master')
  for (const [id, email, role] of [[ADMIN, 'admin@hc.test', 'admin'], [SUPPORT, 'support@hc.test', 'support']]) {
    await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', '{}'::jsonb)`, [id, email])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 120_000)

describe('product page leads', () => {
  test('a visitor can send a request; it is normalised and stored', async () => {
    await lead('anon', '+91 98765 43210', { plan: 'enterprise', email: ' Asha@Example.com ' })
    const r = await db.one(null, `select name, organisation, phone, email, plan, status, source from public.platform_leads`)
    expect(r).toEqual({ name: 'Dr. Asha Verma', organisation: 'Verma Clinic', phone: '+919876543210', email: 'asha@example.com', plan: 'enterprise', status: 'new', source: 'hospital.digitalcomrade.in' })
  })

  test('bad input is rejected with a friendly message; unknown plans are dropped', async () => {
    await expect(lead('anon', '12345')).rejects.toThrow(/valid mobile/)
    await expect(lead('anon', '9876500000', { name: 'A' })).rejects.toThrow(/your name/)
    await expect(lead('anon', '9876500000', { email: 'not-an-email' })).rejects.toThrow(/valid email/)
    await lead('anon', '9876500001', { plan: 'free-forever', email: '' })
    expect(await db.one(null, `select plan, email from public.platform_leads where phone = '9876500001'`)).toEqual({ plan: null, email: null })
  })

  test('a repeat from the same number within 10 minutes is accepted but not stored twice', async () => {
    await lead('anon', '9876500002'); await lead('anon', '9876500002')
    expect(Number((await db.one<{ n: string }>(null, `select count(*) n from public.platform_leads where phone = '9876500002'`)).n)).toBe(1)
  })

  test('only Hospital Comrade admins can read them — not visitors, hospital owners or support', async () => {
    await expect(db.as('anon', `select * from public.platform_leads`)).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', `insert into public.platform_leads (name, organisation, phone) values ('xx', 'yy', '9876500003')`)).rejects.toThrow(/permission denied/)
    expect(await db.as(USER.owner, `select * from public.platform_leads`)).toHaveLength(0)
    expect(await db.as(SUPPORT, `select * from public.platform_leads`)).toHaveLength(0)
    expect((await db.as(ADMIN, `select * from public.platform_leads`)).length).toBeGreaterThanOrEqual(3)
    await db.as(ADMIN, `update public.platform_leads set status = 'contacted' where phone = '9876500002'`)
    expect((await db.one<{ status: string }>(null, `select status from public.platform_leads where phone = '9876500002'`)).status).toBe('contacted')
  })
})

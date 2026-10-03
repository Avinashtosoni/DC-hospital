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

// ------------------------------------------------------------------ phase 3 — Hospital Comrade messaging
describe('Hospital Comrade messaging (phase 3)', () => {
  const MAIN = 'a0000000-0000-4000-8000-000000000001'
  const NEW = 'f3000000-0000-4000-8000-000000000003'

  test('a new hospital starts with full settings on Hospital Comrade messaging; re-seeding keeps its changes', async () => {
    await db.as(null, `insert into public.tenants (id, slug, name, code) values ($1, 'phase3', 'Phase Three Clinic', 'PTC')`, [NEW])
    await db.as(null, `select public.seed_hospital_defaults($1)`, [NEW])
    const { data } = await db.one<{ data: any }>(null, `select data from public.app_settings where tenant_id = $1 and key = 'app'`, [NEW])
    for (const ch of ['sms', 'whatsapp', 'email']) expect(data.notifications[ch]).toMatchObject({ source: 'platform', enabled: true })
    expect(data.notifications.push.enabled).toBe(false)
    expect(Object.keys(data.notifications.events).length).toBeGreaterThan(10)        // events + wording → messages get queued
    expect(data.notifications.templates.appointment_booked.text).toContain('{name}')
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{notifications,sms,source}', '"own"') where tenant_id = $1 and key = 'app'`, [NEW])
    await db.as(null, `select public.seed_hospital_defaults($1)`, [NEW])
    expect((await db.one<{ s: string }>(null, `select data #>> '{notifications,sms,source}' s from public.app_settings where tenant_id = $1 and key = 'app'`, [NEW])).s).toBe('own')
    // the primary hospital is untouched (its own accounts, as before)
    expect(await db.as(null, `select 1 from public.app_settings where tenant_id = $1 and data #>> '{notifications,sms,source}' = 'platform'`, [MAIN])).toHaveLength(0)
  })

  test('message usage: only the notify function writes it; it adds up; owner and accountant read their own hospital only', async () => {
    await expect(db.as(USER.owner, `select public.record_message_usage($1, 'sms', 'platform', 1, 0)`, [MAIN])).rejects.toThrow(/permission denied/)
    await expect(db.as(USER.owner, `insert into public.message_usage (month, channel, sent) values (current_date, 'sms', 5)`)).rejects.toThrow(/permission denied/)
    await db.as(null, `select public.record_message_usage($1, 'sms', 'platform', 3, 1)`, [MAIN])
    await db.as(null, `select public.record_message_usage($1, 'sms', 'platform', 2, 0)`, [MAIN])
    await db.as(null, `select public.record_message_usage($1, 'whatsapp', 'own', 4, 0)`, [MAIN])
    await db.as(null, `select public.record_message_usage($1, 'sms', 'platform', 9, 0)`, [NEW])
    await db.as(null, `select public.record_message_usage($1, 'email', 'platform', 0, 0)`, [MAIN])      // nothing to add → no row
    const mine = await db.as<{ channel: string; source: string; sent: number; failed: number }>(USER.owner, `select channel, source, sent, failed from public.message_usage order by channel`)
    expect(mine).toEqual([{ channel: 'sms', source: 'platform', sent: 5, failed: 1 }, { channel: 'whatsapp', source: 'own', sent: 4, failed: 0 }])
    expect(await db.as(USER.accountant, `select 1 from public.message_usage`)).toHaveLength(2)
    expect(await db.as(USER.receptionist, `select 1 from public.message_usage`)).toHaveLength(0)
    expect(await db.as(USER.patient, `select 1 from public.message_usage`)).toHaveLength(0)
    const month = await db.one<{ m: string }>(null, `select month::text m from public.message_usage limit 1`)
    expect(month.m).toMatch(/^\d{4}-\d{2}-01$/)
  })

  test('platform settings: Hospital Comrade admins only; a hospital cannot change its own sender identity or allowance', async () => {
    await expect(db.as('anon', `select * from public.platform_settings`)).rejects.toThrow(/permission denied/)
    expect(await db.as(USER.owner, `select * from public.platform_settings`)).toHaveLength(0)
    expect(await db.as(SUPPORT, `select * from public.platform_settings`)).toHaveLength(0)
    await db.as(USER.owner, `update public.platform_settings set data = '{"templates":{"otp":{"smsTemplateId":"HACK"}}}'::jsonb where key = 'messaging'`)
    expect((await db.one<{ data: any }>(null, `select data from public.platform_settings where key = 'messaging'`)).data).toEqual({ templates: {} })
    await db.as(ADMIN, `update public.platform_settings set data = '{"templates":{"otp":{"smsTemplateId":"1707-OTP"}}}'::jsonb where key = 'messaging'`)
    expect((await db.as<{ data: any }>(ADMIN, `select data from public.platform_settings where key = 'messaging'`))[0].data.templates.otp.smsTemplateId).toBe('1707-OTP')
    // tenants.messaging (sender ID, allowance): readable by the hospital, changeable only by a platform admin
    await db.as(USER.owner, `update public.tenants set messaging = '{"limits":{"sms":999999}}'::jsonb where id = $1`, [MAIN])
    expect((await db.one<{ m: any }>(null, `select messaging m from public.tenants where id = $1`, [MAIN])).m).toEqual({})
    await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-tenant-id': MAIN, 'x-provider-mode': 'admin' })])
    try { await db.as(ADMIN, `update public.tenants set messaging = '{"smsSenderId":"DCHOSP","limits":{"sms":500}}'::jsonb where id = $1`, [MAIN]) }
    finally { await db.query(`select set_config('request.headers', '', false)`) }
    expect((await db.as<{ m: any }>(USER.owner, `select messaging m from public.tenants where id = $1`, [MAIN]))[0].m).toEqual({ smsSenderId: 'DCHOSP', limits: { sms: 500 } })
  })
})

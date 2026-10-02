/**
 * Phase 6 — the owner's billing page: changing plans (on renewal / during the trial), seller snapshot on invoices,
 * usage history for the chart and renewal reminders (scripts/sql/billing.sql).
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_ACC = 'b0b00000-0000-4000-8000-000000000003'
const B_PATIENT = 'b0b00000-0000-4000-8000-000000000002'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
const setDates = (trial: string | null, paid: string | null, status = 'trial') => db.as(null,
  `update public.tenants set trial_ends_at = now() + $1::interval, paid_until = now() + $2::interval, status = $3 where id = $4`, [trial, paid, status, B])
const quote = async (who: string, sql: string) => (await db.one<{ q: Record<string, unknown> }>(who, sql)).q
const plan = async () => (await db.one<{ p: string }>(null, `select plan p from public.tenants where id = $1`, [B])).p

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan) values ($1, 'city', 'City Hospital', 'CTY', 'clinic')`, [B])
  for (const [id, email, role] of [[B_OWNER, 'owner@cityhospital.in', 'owner'], [B_ACC, 'accounts@cityhospital.in', 'accountant'], [B_PATIENT, 'ravi@example.com', 'patient']]) {
    await signUp(id, email, { full_name: `City ${role}`, tenant_id: B })
    if (role !== 'patient') {
      await db.as(null, `update public.profiles set role = $2 where id = $1`, [id, role])
      await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    }
  }
  const n = structuredClone(DEFAULT_APP_SETTINGS.notifications)
  n.email.enabled = true
  await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($1, 'app', jsonb_build_object('notifications', $2::jsonb))
    on conflict (tenant_id, key) do update set data = excluded.data`, [B, JSON.stringify(n)])
  await db.as(null, `update public.site_content set data = data || '{"name": "City Hospital"}' where tenant_id = $1 and key = 'settings'`, [B])
}, 240_000)

describe('changing plans', () => {
  test('a renewal quote may name another plan; unknown, individually priced and custom-price hospitals are refused', async () => {
    await setDates('5 days', null)
    expect(await quote(B_OWNER, `select public.my_billing_quote('plan', 1, null, 'hospital') q`)).toMatchObject({ plan: 'hospital', base_paise: 299900 })
    expect(await quote(B_OWNER, `select public.my_billing_quote('plan', 1) q`)).toMatchObject({ plan: 'clinic', base_paise: 99900 })
    expect(await quote(B_ACC, `select public.my_billing_quote('plan', 12, null, 'enterprise') q`)).toMatchObject({ plan: 'enterprise', base_paise: 7999000 })
    await expect(db.as(B_OWNER, `select public.my_billing_quote('plan', 1, null, 'gold')`)).rejects.toThrow(/Unknown plan/)
    await expect(db.as(B_OWNER, `select public.my_billing_quote('plan', 1, null, 'custom')`)).rejects.toThrow(/priced individually/)
    await db.as(null, `update public.tenants set billing = billing || '{"price": 1500}' where id = $1`, [B])
    await expect(db.as(B_OWNER, `select public.my_billing_quote('plan', 1, null, 'hospital')`)).rejects.toThrow(/agreed with Hospital Comrade/)
    expect(await quote(B_OWNER, `select public.my_billing_quote('plan', 1, null, 'clinic') q`)).toMatchObject({ base_paise: 150000 })
    await db.as(null, `update public.tenants set billing = billing - 'price' where id = $1`, [B])
  })

  test('paying for another plan switches it, numbers the invoice and keeps the seller as it was', async () => {
    await setDates('5 days', null)
    const q = await quote('service', `select public.billing_quote('${B}', 'plan', 1, null, 'hospital') q`)
    const { id } = await db.one<{ id: string }>(null, `insert into public.billing_payments (tenant_id, kind, plan, months, base_paise, gst_paise, total_paise, provider, period_from, period_to)
      values ($1, 'plan', $2, 1, $3, $4, $5, 'razorpay', $6, $7) returning id`, [B, q.plan, q.base_paise, q.gst_paise, q.total_paise, q.period_from, q.period_to])
    await db.as('service', `select public.apply_payment($1, 'pay_P6', 'upi')`, [id])
    expect(await plan()).toBe('hospital')
    const row = await db.one<{ seller: { name: string } }>(null, `select seller from public.billing_payments where id = $1`, [id])
    expect(row.seller.name).toBeTruthy()
    await db.as(null, `update public.platform_settings set data = jsonb_set(data, '{seller,name}', '"New Seller Pvt Ltd"') where key = 'billing'`)
    expect((await db.one<{ seller: { name: string } }>(null, `select seller from public.billing_payments where id = $1`, [id])).seller.name).toBe(row.seller.name)
    // the owner's page sees the new seller for future invoices, the plan list and whether the price is custom
    const s = (await db.one<{ s: Record<string, any> }>(B_OWNER, `select public.billing_summary() s`)).s
    expect(s.seller.name).toBe('New Seller Pvt Ltd')
    expect(s.plans.clinic.price).toBe(999)
    expect(s.plans.hospital.included.sms).toBeGreaterThan(0)
    expect(s.custom_price).toBe(false)
  })

  test('during the trial (nothing paid) the owner switches plans straight away; not once paid, not for others', async () => {
    await db.as(null, `update public.tenants set plan = 'clinic' where id = $1`, [B])
    await setDates('5 days', null)
    const s = (await db.one<{ s: { plan: string } }>(B_OWNER, `select public.change_trial_plan('hospital') s`)).s
    expect(s.plan).toBe('hospital')
    expect(await plan()).toBe('hospital')
    await expect(db.as(B_OWNER, `select public.change_trial_plan('custom')`)).rejects.toThrow(/priced individually/)
    await expect(db.as(B_ACC, `select public.change_trial_plan('clinic')`)).rejects.toThrow(/Only the owner/)
    await expect(db.as(B_PATIENT, `select public.change_trial_plan('clinic')`)).rejects.toThrow(/Only the owner/)
    await setDates('-30 days', '20 days', 'active')
    await expect(db.as(B_OWNER, `select public.change_trial_plan('clinic')`)).rejects.toThrow(/Your plan is paid/)
  })
})

describe('usage history', () => {
  test('six months of platform messages, own-account messages and wallet charges; owner / accountant only', async () => {
    await db.as('service', `select public.record_message_usage($1, 'sms', 'platform', 40, 0)`, [B])
    await db.as('service', `select public.record_message_usage($1, 'email', 'platform', 12, 0)`, [B])
    await db.as('service', `select public.record_message_usage($1, 'whatsapp', 'own', 7, 0)`, [B])
    await db.as(null, `insert into public.message_usage (tenant_id, month, channel, source, sent) values ($1, date_trunc('month', now() - interval '2 months')::date, 'sms', 'platform', 9)`, [B])
    const h = (await db.one<{ h: { month: string; sent: Record<string, number>; own: number; charged_paise: number }[] }>(B_ACC, `select public.billing_usage_history() h`)).h
    expect(h).toHaveLength(6)
    const last = h[5]
    expect(last.sent).toMatchObject({ sms: 40, email: 12 })
    expect(Number(last.own)).toBe(7)
    expect(h[3].sent).toEqual({ sms: 9 })
    expect(h[0].sent).toEqual({})
    expect((await db.one<{ h: unknown[] }>(B_OWNER, `select public.billing_usage_history(12) h`)).h).toHaveLength(12)
    await expect(db.as(B_PATIENT, `select public.billing_usage_history()`)).rejects.toThrow(/owner or accountant/)
  })
})

describe('renewal reminders', () => {
  const outbox = () => db.as<{ recipient: string; subject: string; body: string; vars: Record<string, string> }>(null,
    `select recipient, subject, body, vars from public.notification_outbox where event = 'billing_reminder' order by created_at`)

  test('7 / 3 / 1 days before the end and once in grace, to the owner, never twice for the same milestone', async () => {
    await db.as(null, `delete from public.notification_outbox`)
    await setDates('7 days 2 hours', null)
    expect(Number((await db.one<{ n: number }>('service', `select public.queue_billing_reminders() n`)).n)).toBe(1)
    expect(Number((await db.one<{ n: number }>('service', `select public.queue_billing_reminders() n`)).n)).toBe(0)
    const [m] = await outbox()
    expect(m.recipient).toBe('owner@cityhospital.in')
    expect(m.subject).toBe('City Hospital: your free trial ends ' + m.vars.date)
    expect(m.body).toContain('in 7 days')
    expect(m.body).toContain('the app → Billing & plan')       // no domain yet
    await db.as(null, `insert into public.tenant_domains (domain, tenant_id, is_primary, verified_at) values ('cityhospital.in', $1, true, now())`, [B])
    expect(m.vars.milestone).toBe('d7')

    await setDates('5 days', null)                      // not a milestone
    expect(Number((await db.one<{ n: number }>('service', `select public.queue_billing_reminders() n`)).n)).toBe(0)
    await setDates('-30 days', '1 day 1 hour', 'active')
    await db.as('service', `select public.queue_billing_reminders()`)
    const paid = (await outbox()).at(-1)!
    expect(paid.subject).toContain('your plan renews')
    expect(paid.body).toContain('tomorrow')
    expect(paid.body).toContain('https://cityhospital.in/billing')
    await setDates('-30 days', '-2 days', 'active')
    await db.as('service', `select public.queue_billing_reminders()`)
    await db.as('service', `select public.queue_billing_reminders()`)
    const all = await outbox()
    expect(all.filter((o) => o.vars.milestone === 'grace')).toHaveLength(1)
    expect(all.at(-1)!.body).toContain('read-only')
  })

  test('only the scheduler (or a platform admin) may run it; the primary hospital and suspended ones get nothing', async () => {
    await expect(db.as(B_OWNER, `select public.queue_billing_reminders()`)).rejects.toThrow(/permission denied/)
    await db.as(null, `delete from public.notification_outbox`)
    await setDates('3 days 1 hour', null, 'suspended')
    expect(Number((await db.one<{ n: number }>('service', `select public.queue_billing_reminders() n`)).n)).toBe(0)
    expect(await db.as(null, `select 1 from public.notification_outbox where tenant_id <> $1`, [B])).toHaveLength(0)
  })
})

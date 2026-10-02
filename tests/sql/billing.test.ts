/**
 * Phase 4 — licence (trial → active → grace → read-only), wallet charging for platform messages, prices,
 * payments and the platform team's billing tools (scripts/sql/billing.sql + tenant_license in tenancy_core.sql).
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

let db: Db
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_PATIENT = 'b0b00000-0000-4000-8000-000000000002'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const P_FINANCE = 'e0e00000-0000-4000-8000-000000000003'

async function asH<T = Record<string, unknown>>(who: string | null, headers: Record<string, string>, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)])
  try { return await db.as<T>(who, sql, params) } finally { await db.query(`select set_config('request.headers', '', false)`) }
}
const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
const setDates = (trial: string | null, paid: string | null, status = 'trial') => db.as(null,
  `update public.tenants set trial_ends_at = now() + $1::interval, paid_until = now() + $2::interval, status = $3 where id = $4`, [trial, paid, status, B])
const license = async () => (await db.one<{ s: string }>(null, `select public.tenant_license($1) s`, [B])).s
const wallet = async () => Number((await db.one<{ w: string }>(null, `select wallet_paise w from public.tenants where id = $1`, [B])).w)
const asProvider = (who: string, mode: string, sql: string, params: unknown[] = []) => asH(who, { 'x-tenant-id': B, 'x-provider-mode': mode }, sql, params)

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan) values ($1, 'city', 'City Hospital', 'CTY', 'clinic')`, [B])
  await signUp(B_OWNER, 'owner@cityhospital.in', { full_name: 'City Owner', tenant_id: B })
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
  await db.as(null, `delete from public.patients where profile_id = $1`, [B_OWNER])
  await signUp(B_PATIENT, 'ravi@example.com', { full_name: 'Ravi Kumar', tenant_id: B })
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support'], [P_FINANCE, 'finance@hc.in', 'finance']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
  await db.as(null, `insert into public.provider_assignments (user_id, tenant_id) values ($1, $3), ($2, $3)`, [P_SUPPORT, P_FINANCE, B])
  // stands in for a website RPC such as online booking: SECURITY DEFINER, so RLS does not apply — the guard must
  await db.exec(`reset role; create function public.test_definer_notice() returns void language sql security definer set search_path = public as
    $$ insert into public.notices (tenant_id, title, body, audience, priority) values ('${B}', 'Via RPC', 'x', 'all', 'normal') $$;
    grant execute on function public.test_definer_notice() to anon, authenticated;`)
}, 240_000)

describe('licence status', () => {
  test('follows the dates: trial → active → grace → read-only; manual suspend wins; the primary is always active', async () => {
    await setDates(null, null, 'trial')
    expect(await license()).toBe('trial')                         // no dates → the status as set by hand
    await setDates('10 days', null); expect(await license()).toBe('trial')
    await setDates('-3 days', null); expect(await license()).toBe('grace')
    await setDates('-8 days', null); expect(await license()).toBe('read_only')
    await setDates('-30 days', '5 days'); expect(await license()).toBe('active')
    await setDates('-30 days', '-2 days'); expect(await license()).toBe('grace')
    await setDates('10 days', null, 'suspended'); expect(await license()).toBe('suspended')
    await db.as(null, `update public.tenants set paid_until = now() - interval '1 year' where id = $1`, [A])
    expect((await db.one<{ s: string }>(null, `select public.tenant_license($1) s`, [A])).s).toBe('active')
  })

  test('grace days come from the platform billing settings', async () => {
    await setDates('-8 days', null)
    await db.as(null, `update public.platform_settings set data = data || '{"graceDays": 10}' where key = 'billing'`)
    expect(await license()).toBe('grace')
    await db.as(null, `update public.platform_settings set data = data || '{"graceDays": 7}' where key = 'billing'`)
    expect(await license()).toBe('read_only')
  })

  test('my_context and resolve_tenant report the effective status; the wallet only reaches owner / accountant', async () => {
    await setDates('-20 days', null)
    const ctx = (await db.one<{ c: { tenant: { status: string }; license: Record<string, unknown> } }>(B_OWNER, `select public.my_context() c`)).c
    expect(ctx.tenant.status).toBe('read_only')
    expect(ctx.license).toMatchObject({ status: 'read_only', wallet_paise: 0 })
    expect(ctx.license.read_only_from).toBeTruthy()
    const pat = (await db.one<{ c: { license: Record<string, unknown> } }>(B_PATIENT, `select public.my_context() c`)).c
    expect(pat.license.status).toBe('read_only')
    expect(pat.license).not.toHaveProperty('wallet_paise')
    const r = await db.as<{ status: string }>(null, `select status from public.resolve_tenant(null, 'city')`)
    expect(r[0]?.status).toBe('read_only')
  })
})

describe('read-only hospitals', () => {
  test('reading works; nobody in the hospital can add, change or delete — also through SECURITY DEFINER RPCs', async () => {
    await setDates('10 days', null)
    await db.as(B_OWNER, `insert into public.departments (name) values ('Trial dept')`)
    await setDates('-20 days', null)
    expect(await db.as(B_OWNER, `select name from public.departments`)).toEqual([{ name: 'Trial dept' }])
    await expect(db.as(B_OWNER, `insert into public.departments (name) values ('Blocked')`)).rejects.toThrow(/LICENSE_READ_ONLY/)
    await expect(db.as(B_OWNER, `update public.departments set name = 'X'`)).rejects.toThrow(/LICENSE_READ_ONLY/)
    await expect(db.as(B_OWNER, `delete from public.departments`)).rejects.toThrow(/LICENSE_READ_ONLY/)
    await expect(db.as('anon', `select public.test_definer_notice()`)).rejects.toThrow(/LICENSE_READ_ONLY/)
    await expect(db.as(B_PATIENT, `select public.test_definer_notice()`)).rejects.toThrow(/LICENSE_READ_ONLY/)
  })

  test('the platform team (admin / finance), Edge Functions and the database itself still can; support cannot', async () => {
    await setDates('-20 days', null)
    await asProvider(P_ADMIN, 'admin', `insert into public.departments (name) values ('By admin')`)
    await db.as(null, `insert into public.departments (tenant_id, name) values ($1, 'By db')`, [B])
    expect(await db.as(null, `select count(*)::int n from public.departments where tenant_id = $1 and name in ('By admin', 'By db')`, [B])).toEqual([{ n: 2 }])
    // support is read-only anyway: blocked either by the licence guard or the support policy
    await expect(asProvider(P_SUPPORT, 'support', `update public.departments set name = 'S' returning id`).then((r) => { if (!r.length) throw new Error('blocked') }))
      .rejects.toThrow(/LICENSE_READ_ONLY|blocked|row-level/)
  })

  test('grace still allows everything; other hospitals are not affected', async () => {
    await setDates('-3 days', null)
    await db.as(B_OWNER, `insert into public.departments (name) values ('In grace')`)
    await setDates('-20 days', null)
    await db.as(USER.owner, `insert into public.departments (name) values ('Primary unaffected')`)
    await db.as(USER.owner, `insert into public.notices (title, body, audience, priority) values ('ok', 'x', 'all', 'normal')`)
  })
})

describe('wallet', () => {
  test('platform messages beyond the plan allowance are charged per message, one ledger row per day and channel', async () => {
    await setDates('10 days', null)
    await db.as('service', `update public.tenants set wallet_paise = 10000 where id = $1`, [B])
    await db.as('service', `select public.record_message_usage($1, 'sms', 'platform', 90, 2)`, [B])     // clinic includes 100 SMS
    expect(await wallet()).toBe(10000)
    await db.as('service', `select public.record_message_usage($1, 'sms', 'platform', 20, 0)`, [B])     // 10 over × 30 paise
    expect(await wallet()).toBe(9700)
    await db.as('service', `select public.record_message_usage($1, 'sms', 'platform', 5, 0)`, [B])
    expect(await wallet()).toBe(9550)
    await db.as('service', `select public.record_message_usage($1, 'sms', 'own', 500, 0)`, [B])         // own account: free
    await db.as('service', `select public.record_message_usage($1, 'sms', 'platform', 500, 0)`, [A])    // primary: never charged
    expect(await wallet()).toBe(9550)
    const rows = await db.as<{ kind: string; channel: string; units: number; amount_paise: string; balance_paise: string }>(null,
      `select kind, channel, units, amount_paise, balance_paise from public.wallet_ledger where tenant_id = $1`, [B])
    expect(rows).toEqual([{ kind: 'usage', channel: 'sms', units: 15, amount_paise: -450, balance_paise: 9550 }])
  })

  test('a hospital-specific allowance / rate overrides the plan; OTP-style overdraft may go negative', async () => {
    await db.as(null, `update public.tenants set billing = '{"included": {"whatsapp": 0}, "ratesPaise": {"whatsapp": 100}}', wallet_paise = 50 where id = $1`, [B])
    await db.as('service', `select public.record_message_usage($1, 'whatsapp', 'platform', 2, 0)`, [B])
    expect(await wallet()).toBe(-150)
    await db.as(null, `update public.tenants set billing = '{}' where id = $1`, [B])
  })
})

describe('prices and payments', () => {
  test('quotes: monthly / yearly (10 months) + 18% GST; custom plans have no self-serve price; top-up limits', async () => {
    await setDates('10 days', null)
    const m = (await db.one<{ q: Record<string, unknown> }>('service', `select public.billing_quote($1, 'plan', 1) q`, [B])).q
    expect(m).toMatchObject({ plan: 'clinic', base_paise: 99900, gst_paise: 17982, total_paise: 117882 })
    expect(new Date(m.period_from as string).getTime()).toBeGreaterThan(Date.now() + 8 * 864e5)   // starts after the trial
    const y = (await db.one<{ q: Record<string, unknown> }>('service', `select public.billing_quote($1, 'plan', 12) q`, [B])).q
    expect(y).toMatchObject({ base_paise: 999000, total_paise: 1178820 })
    await expect(db.as('service', `select public.billing_quote($1, 'plan', 3)`, [B])).rejects.toThrow(/1 month or 12/)
    await expect(db.as('service', `select public.billing_quote($1, 'wallet', 1, 100)`, [B])).rejects.toThrow(/Top up between/)
    expect((await db.one<{ q: Record<string, unknown> }>('service', `select public.billing_quote($1, 'wallet', 1, 1000) q`, [B])).q).toMatchObject({ base_paise: 100000, total_paise: 118000 })
    await db.as(null, `update public.tenants set plan = 'custom' where id = $1`, [B])
    await expect(db.as('service', `select public.billing_quote($1, 'plan', 1)`, [B])).rejects.toThrow(/priced individually/)
    await db.as(null, `update public.tenants set billing = '{"price": 1500}' where id = $1`, [B])
    expect((await db.one<{ q: Record<string, unknown> }>('service', `select public.billing_quote($1, 'plan', 1) q`, [B])).q).toMatchObject({ base_paise: 150000 })
    await db.as(null, `update public.tenants set plan = 'clinic', billing = '{}' where id = $1`, [B])
    // the owner sees the same through my_billing_quote; a patient can't
    expect((await db.one<{ q: Record<string, unknown> }>(B_OWNER, `select public.my_billing_quote('plan', 1) q`)).q).toMatchObject({ total_paise: 117882 })
    await expect(db.as(B_PATIENT, `select public.my_billing_quote('plan', 1)`)).rejects.toThrow(/owner or accountant/)
    await expect(db.as(B_OWNER, `select public.billing_quote($1, 'plan', 1)`, [B])).rejects.toThrow(/permission denied/)
  })

  test('a paid plan extends paid_until after the trial, numbers the invoice, unlocks a read-only hospital and is applied once', async () => {
    await setDates('-20 days', null)
    expect(await license()).toBe('read_only')
    const [{ id }] = await db.as<{ id: string }>('service', `insert into public.billing_payments (tenant_id, kind, plan, months, base_paise, gst_paise, total_paise, order_id)
      values ($1, 'plan', 'hospital', 1, 299900, 53982, 353882, 'order_TEST1') returning id`, [B])
    const r = (await db.one<{ r: { invoice_no: string; already: boolean } }>('service', `select public.apply_payment($1, 'pay_TEST1', 'upi') r`, [id])).r
    expect(r.already).toBe(false)
    expect(r.invoice_no).toMatch(/^HC\/\d{4}-\d{2}\/000001$/)
    expect(await license()).toBe('active')
    const t = await db.one<{ plan: string; days: number }>(null, `select plan, extract(day from paid_until - now())::int days from public.tenants where id = $1`, [B])
    expect(t.plan).toBe('hospital')
    expect(t.days).toBeGreaterThanOrEqual(27)
    const again = (await db.one<{ r: { already: boolean; invoice_no: string } }>('service', `select public.apply_payment($1, 'pay_TEST1') r`, [id])).r
    expect(again).toMatchObject({ already: true, invoice_no: r.invoice_no })
    expect((await db.one<{ days: number }>(null, `select extract(day from paid_until - now())::int days from public.tenants where id = $1`, [B])).days).toBe(t.days)
    const p = await db.one<{ status: string; buyer: { name: string } }>(null, `select status, buyer from public.billing_payments where id = $1`, [id])
    expect(p).toMatchObject({ status: 'paid', buyer: { name: 'City Hospital' } })
  })

  test('a wallet top-up credits the amount before GST', async () => {
    await db.as(null, `update public.tenants set wallet_paise = 0 where id = $1`, [B])
    const [{ id }] = await db.as<{ id: string }>('service', `insert into public.billing_payments (tenant_id, kind, base_paise, gst_paise, total_paise, order_id)
      values ($1, 'wallet', 100000, 18000, 118000, 'order_TEST2') returning id`, [B])
    await db.as('service', `select public.apply_payment($1, 'pay_TEST2', 'card')`, [id])
    await db.as('service', `select public.apply_payment($1, 'pay_TEST2', 'card')`, [id])
    expect(await wallet()).toBe(100000)
    expect(await db.as(null, `select kind, amount_paise from public.wallet_ledger where payment = $1`, [id])).toEqual([{ kind: 'topup', amount_paise: 100000 }])
  })

  test('the hospital owner reads its billing; patients, other hospitals and the API cannot touch it', async () => {
    expect((await db.as(B_OWNER, `select id from public.billing_payments`)).length).toBe(2)
    expect((await db.as(B_OWNER, `select id from public.wallet_ledger`)).length).toBeGreaterThanOrEqual(2)
    expect(await db.as(B_PATIENT, `select id from public.billing_payments`)).toHaveLength(0)
    expect(await db.as(USER.owner, `select id from public.billing_payments`)).toHaveLength(0)
    await expect(db.as(B_OWNER, `insert into public.wallet_ledger (kind, amount_paise, balance_paise) values ('topup', 1, 1)`)).rejects.toThrow(/permission denied/)
    expect(await db.as(B_OWNER, `update public.tenants set wallet_paise = 99999999 returning id`)).toHaveLength(0)   // only platform admins
    await expect(db.as(B_OWNER, `select wallet_paise from public.tenants`)).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', `select billing from public.tenants`)).rejects.toThrow(/permission denied/)
    expect(await db.as('anon', `select name from public.tenants`)).toHaveLength(1)
    await expect(db.as(B_OWNER, `select public.apply_payment(gen_random_uuid())`)).rejects.toThrow(/permission denied/)
    await expect(db.as(B_OWNER, `select public.record_message_usage($1, 'sms', 'platform', 1, 0)`, [B])).rejects.toThrow(/permission denied/)
    const s = (await db.one<{ s: Record<string, unknown> }>(B_OWNER, `select public.billing_summary() s`)).s
    expect(s).toMatchObject({ plan: 'hospital', price: 2999, wallet_paise: 100000, gst_percent: 18, included: { sms: 500 } })
    await expect(db.as(B_PATIENT, `select public.billing_summary()`)).rejects.toThrow(/owner or accountant/)
  })

  test('the owner sets the name and GSTIN printed on invoices', async () => {
    await expect(db.as(B_OWNER, `select public.set_billing_details('City Hospital Pvt Ltd', 'BAD', '')`)).rejects.toThrow(/GSTIN/)
    await db.as(B_OWNER, `select public.set_billing_details('City Hospital Pvt Ltd', '10abcde1234f1z5', 'Patna')`)
    expect((await db.one<{ b: Record<string, string> }>(null, `select billing b from public.tenants where id = $1`, [B])).b).toMatchObject({ legalName: 'City Hospital Pvt Ltd', gstin: '10ABCDE1234F1Z5' })
  })
})

describe('platform team billing tools', () => {
  test('finance records a manual payment and adjusts the wallet; only admin extends trials or changes plans', async () => {
    const before = await wallet()
    const r = await asProvider(P_FINANCE, 'finance', `select public.provider_billing('manual_payment', '{"kind": "wallet", "amount": 2000, "method": "bank", "reference": "UTR123"}') r`)
    expect((r[0].r as { invoice_no: string }).invoice_no).toMatch(/^HC\//)
    expect(await wallet()).toBe(before + 200000)
    await expect(asProvider(P_FINANCE, 'finance', `select public.provider_billing('wallet_adjust', '{"amount": -50}')`)).rejects.toThrow(/note/)
    await asProvider(P_FINANCE, 'finance', `select public.provider_billing('wallet_adjust', '{"amount": -50, "note": "Refund of test"}')`)
    expect(await wallet()).toBe(before + 195000)
    await expect(asProvider(P_FINANCE, 'finance', `select public.provider_billing('extend_trial', '{"days": 7}')`)).rejects.toThrow(/admin/)
    await expect(asProvider(P_SUPPORT, 'support', `select public.provider_billing('wallet_adjust', '{"amount": 5, "note": "x"}')`)).rejects.toThrow(/admins or finance/)
    await expect(db.as(B_OWNER, `select public.provider_billing('wallet_adjust', '{"amount": 5, "note": "x"}')`)).rejects.toThrow(/admins or finance/)
    expect(Number((await db.one<{ n: string }>(null, `select count(*) n from public.provider_audit where action like 'billing:%'`)).n)).toBe(2)
  })

  test('admin: extend trial, custom price, suspend / resume', async () => {
    await setDates('-20 days', null)
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('extend_trial', '{"days": 7}')`)
    expect(await license()).toBe('trial')
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('set_plan', '{"plan": "custom", "price": 4500}')`)
    expect((await db.one<{ q: Record<string, unknown> }>('service', `select public.billing_quote($1, 'plan', 1) q`, [B])).q).toMatchObject({ plan: 'custom', base_paise: 450000 })
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('set_plan', '{"plan": "clinic", "price": null}')`)
    expect((await db.one<{ q: Record<string, unknown> }>('service', `select public.billing_quote($1, 'plan', 1) q`, [B])).q).toMatchObject({ plan: 'clinic', base_paise: 99900 })
    // a manual payment may move the hospital to another plan (phase 6)
    await asProvider(P_FINANCE, 'finance', `select public.provider_billing('manual_payment', '{"kind": "plan", "months": 1, "plan": "hospital", "method": "bank"}')`)
    expect((await db.one<{ p: string }>(null, `select plan p from public.tenants where id = $1`, [B])).p).toBe('hospital')
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('set_plan', '{"plan": "clinic"}')`)
    await setDates('-20 days', null)
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('extend_trial', '{"days": 7}')`)
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('suspend')`)
    expect(await license()).toBe('suspended')
    await asProvider(P_ADMIN, 'admin', `select public.provider_billing('resume')`)
    expect(await license()).toBe('trial')
  })
})

describe('onboarding snippet', () => {
  test('add-hospital.sql starts a trial for the platform trial days', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const sql = readFileSync(resolve(__dirname, '../../supabase/snippets/add-hospital.sql'), 'utf8').replace(/'citycare'/g, `'trialtest'`).replace(/'CCC'/, `'TTT'`)
      .replace(/'citycare\.hospital\.digitalcomrade\.in'/, `''`).replace(/owner@citycare\.in/, 'owner@trialtest.in')
    await db.exec(sql)
    const t = await db.one<{ status: string; days: number }>(null, `select public.tenant_license(id) status, round(extract(epoch from trial_ends_at - now()) / 86400)::int days from public.tenants where slug = 'trialtest'`)
    expect(t).toEqual({ status: 'trial', days: 14 })
  })
})

/**
 * Control panel — hospital operations (scripts/sql/control_panel_ops.sql): details, owner transfer, users, data
 * counts / browse / import, messaging limits, credit notes, announcements and "sign in as user".
 * Each block checks what admin / support / finance / hospital accounts may and may not do.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_PATIENT = 'b0b00000-0000-4000-8000-000000000002'
const B_DOCTOR = 'b0b00000-0000-4000-8000-000000000003'
const C_OWNER = 'c0c00000-0000-4000-8000-000000000001'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const P_FINANCE = 'e0e00000-0000-4000-8000-000000000003'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = [], claims?: Record<string, unknown>): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  if (claims) await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
  try {
    const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)))
    return r.r
  } finally {
    if (claims) await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)
const now = () => Math.floor(Date.now() / 1000)
const lastAudit = async (action: string) => (await db.one<any>(null, `select * from public.provider_audit where action = $1 order by at desc limit 1`, [action]))

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status, trial_ends_at) values
    ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'trial', now() + interval '10 days'), ($2, 'third', 'Third Clinic', 'TRD', 'hospital', 'active', null)`, [B, C])
  for (const [id, email, name, t, role] of [[B_OWNER, 'owner@cityhospital.in', 'City Owner', B, 'owner'], [B_DOCTOR, 'dr.mehta@cityhospital.in', 'Dr Mehta', B, 'doctor'],
    [C_OWNER, 'owner@third.in', 'Third Owner', C, 'owner']]) {
    await signUp(id, email, { full_name: name, tenant_id: t })
    await db.as(null, `update public.profiles set role = $2 where id = $1`, [id, role])
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
  }
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
}, 240_000)

describe('A · details, owner', () => {
  test('profile: admin / support edit, finance reads, hospital accounts refused; validation; logged', async () => {
    await fails(call(B_OWNER, 'cp_hospital_profile', [B]), /Hospital Comrade team/)
    await fails(call(P_SUPPORT, 'cp_hospital_profile', [C]), /not assigned/)
    expect(await call(P_FINANCE, 'cp_hospital_profile', [B])).toMatchObject({ name: 'City Hospital' })
    await fails(call(P_FINANCE, 'cp_save_hospital_profile', [B, { name: 'X Y' }], ['uuid', 'jsonb']), /admin \/ support/)
    await fails(call(P_SUPPORT, 'cp_save_hospital_profile', [B, { gstin: 'bad' }], ['uuid', 'jsonb']), /GSTIN/)
    await fails(call(P_SUPPORT, 'cp_save_hospital_profile', [B, { logoUrl: 'http://x.in/l.png' }], ['uuid', 'jsonb']), /https/)
    await fails(call(P_SUPPORT, 'cp_save_hospital_profile', [B, { phone: '123' }], ['uuid', 'jsonb']), /phone/)
    await fails(call(P_SUPPORT, 'cp_save_hospital_profile', [B, { wallet: 1 }], ['uuid', 'jsonb']), /Unknown field/)
    const r = await call(P_SUPPORT, 'cp_save_hospital_profile', [B, { name: 'City Care Hospital', phone: '+91 98765 43210', email: 'hello@city.in',
      logoUrl: 'https://cdn.city.in/logo.png', legalName: 'City Care Pvt Ltd', gstin: '10abcde1234f1z5', pan: 'abcde1234f', billingAddress: 'Patna' }], ['uuid', 'jsonb'])
    expect(r).toMatchObject({ name: 'City Care Hospital', gstin: '10ABCDE1234F1Z5', pan: 'ABCDE1234F', logoUrl: 'https://cdn.city.in/logo.png', legalName: 'City Care Pvt Ltd' })
    const t = await db.one<any>(null, `select name, billing from public.tenants where id = $1`, [B])
    expect(t.name).toBe('City Care Hospital'); expect(t.billing).toMatchObject({ legalName: 'City Care Pvt Ltd', address: 'Patna' })
    const s = await db.one<any>(null, `select data from public.site_content where tenant_id = $1 and key = 'settings'`, [B])
    expect(s.data.brand.logoUrl).toBe('https://cdn.city.in/logo.png'); expect(s.data.email).toBe('hello@city.in')
    expect(await lastAudit('hospital:profile')).toMatchObject({ user_id: P_SUPPORT, tenant_id: B })
  })

  test('owner transfer: admin only, staff target, old owner demoted, a hospital never loses its owner', async () => {
    await fails(call(P_SUPPORT, 'cp_transfer_owner', [B, B_DOCTOR, 'doctor']), /\(admin\)/)
    await fails(call(P_ADMIN, 'cp_transfer_owner', [B, B_PATIENT, 'staff']), /patient/)
    await fails(call(P_ADMIN, 'cp_transfer_owner', [B, C_OWNER, 'staff']), /not in this hospital/)
    await call(P_ADMIN, 'cp_transfer_owner', [B, B_DOCTOR, 'doctor'])
    const roles = await db.as<any>(null, `select id, role from public.profiles where id in ($1, $2) order by role`, [B_OWNER, B_DOCTOR])
    expect(Object.fromEntries(roles.map((r: any) => [r.id, r.role]))).toEqual({ [B_DOCTOR]: 'owner', [B_OWNER]: 'doctor' })
    // and back, so later tests have the original owner
    await call(P_ADMIN, 'cp_transfer_owner', [B, B_OWNER, 'doctor'])
    expect((await db.one<any>(null, `select role from public.profiles where id = $1`, [B_OWNER])).role).toBe('owner')
    expect((await lastAudit('hospital:owner')).detail).toMatchObject({ new_owner: 'owner@cityhospital.in' })
  })

  test('owner invite resend: refused once the owner joined; queued with a link when the platform address is known', async () => {
    await fails(call(P_SUPPORT, 'cp_resend_owner_invite', [B]), /already signed up/)
    const D = 'd0000000-0000-4000-8000-000000000004'
    await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status) values ($1, 'newone', 'New One', 'NEW', 'clinic', 'trial')`, [D])
    await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($1, 'bootstrap', '{"owner_email":"owner@your-hospital.in"}')
                       on conflict (tenant_id, key) do update set data = excluded.data`, [D])
    await fails(call(P_ADMIN, 'cp_resend_owner_invite', [D]), /owner’s e-mail first/)
    await db.as(null, `update public.app_settings set data = '{"owner_email":"Boss@NewOne.in"}' where tenant_id = $1 and key = 'bootstrap'`, [D])
    // no platform address yet → nothing queued, the panel shows the link to copy
    expect(await call(P_ADMIN, 'cp_resend_owner_invite', [D])).toMatchObject({ email: 'boss@newone.in', path: '/register?hospital=newone', link: null, queued: 0 })
    await db.as(null, `insert into public.platform_settings (key, data) values ('signup', '{"platformUrl":"https://hospital.digitalcomrade.in/"}')
                       on conflict (key) do update set data = public.platform_settings.data || excluded.data`)
    await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($1, 'app', '{"notifications":{"email":{"enabled":true}}}')
                       on conflict (tenant_id, key) do update set data = excluded.data`, [D])
    const r = await call(P_ADMIN, 'cp_resend_owner_invite', [D])
    expect(r).toMatchObject({ link: 'https://hospital.digitalcomrade.in/register?hospital=newone', queued: 1 })
    const o = await db.one<any>(null, `select tenant_id, recipient, body from public.notification_outbox where event = 'owner_invite' order by created_at desc limit 1`)
    expect(o.tenant_id).toBe(D); expect(o.recipient).toBe('boss@newone.in'); expect(o.body).toContain('https://hospital.digitalcomrade.in/register?hospital=newone')
    await fails(call(P_FINANCE, 'cp_resend_owner_invite', [B]), /admin \/ support/)
  })
})

describe('B · users', () => {
  test('list: admin / support only, own hospital only, search + role filter, pending invites', async () => {
    await fails(call(P_FINANCE, 'cp_hospital_users', [B]), /admin \/ support/)
    await fails(call(B_OWNER, 'cp_hospital_users', [B]), /Hospital Comrade team/)
    const all = await call(P_SUPPORT, 'cp_hospital_users', [B])
    expect(all.total).toBe(3)
    expect(all.rows.map((r: any) => r.email)).not.toContain('owner@third.in')
    expect(all.rows[0]).toHaveProperty('last_sign_in_at'); expect(all.rows[0]).not.toHaveProperty('ord')
    expect((await call(P_SUPPORT, 'cp_hospital_users', [B, null, 'staff_all'])).total).toBe(2)
    expect((await call(P_SUPPORT, 'cp_hospital_users', [B, 'mehta'])).rows.map((r: any) => r.id)).toEqual([B_DOCTOR])
  })

  test('actions: role change, block / unblock, invite / revoke; delete is admin only; last owner protected', async () => {
    await call(P_SUPPORT, 'cp_user_action', [B, 'update', B_DOCTOR, { role: 'receptionist' }], ['uuid', 'text', 'uuid', 'jsonb'])
    expect((await db.one<any>(null, `select role from public.profiles where id = $1`, [B_DOCTOR])).role).toBe('receptionist')
    await fails(call(P_SUPPORT, 'cp_user_action', [B, 'update', B_OWNER, { role: 'staff' }], ['uuid', 'text', 'uuid', 'jsonb']), /owner/i)
    await fails(call(P_SUPPORT, 'cp_user_action', [B, 'update', C_OWNER, { role: 'staff' }], ['uuid', 'text', 'uuid', 'jsonb']), /not in this hospital/)
    await call(P_SUPPORT, 'cp_user_action', [B, 'disable', B_DOCTOR, {}], ['uuid', 'text', 'uuid', 'jsonb'])
    expect((await call(P_SUPPORT, 'cp_hospital_users', [B, 'mehta'])).rows[0].blocked).toBe(true)
    await call(P_SUPPORT, 'cp_user_action', [B, 'enable', B_DOCTOR, {}], ['uuid', 'text', 'uuid', 'jsonb'])
    expect((await call(P_SUPPORT, 'cp_hospital_users', [B, 'mehta'])).rows[0].blocked).toBe(false)

    const inv = await call(P_SUPPORT, 'cp_user_action', [B, 'invite', null, { full_name: 'Nurse Asha', email: 'Asha@City.in', role: 'staff' }], ['uuid', 'text', 'uuid', 'jsonb'])
    expect(inv.token).toMatch(/^[0-9a-f]{36}$/)
    const row = await db.one<any>(null, `select tenant_id, email from public.staff_invites where id = $1`, [inv.invite_id])
    expect(row).toEqual({ tenant_id: B, email: 'asha@city.in' })
    expect((await call(P_SUPPORT, 'cp_hospital_users', [B])).invites).toHaveLength(1)
    await fails(call(P_SUPPORT, 'cp_user_action', [B, 'invite', null, { full_name: 'X', email: 'p@x.in', role: 'patient' }], ['uuid', 'text', 'uuid', 'jsonb']), /staff role/)
    await call(P_SUPPORT, 'cp_user_action', [B, 'revoke_invite', null, { invite_id: inv.invite_id }], ['uuid', 'text', 'uuid', 'jsonb'])
    expect((await call(P_SUPPORT, 'cp_hospital_users', [B])).invites).toHaveLength(0)

    await fails(call(P_SUPPORT, 'cp_user_action', [B, 'delete', B_PATIENT, {}], ['uuid', 'text', 'uuid', 'jsonb']), /\(admin\)/)
    await fails(call(P_ADMIN, 'cp_user_action', [B, 'delete', B_OWNER, {}], ['uuid', 'text', 'uuid', 'jsonb']), /owner/i)
    await call(P_SUPPORT, 'cp_user_action', [B, 'update', B_DOCTOR, { role: 'doctor' }], ['uuid', 'text', 'uuid', 'jsonb'])
    expect(await lastAudit('user:update')).toMatchObject({ user_id: P_SUPPORT, tenant_id: B, target: 'dr.mehta@cityhospital.in' })
  })
})

describe('C · data', () => {
  test('counts for all three roles; browse: finance bills only, logged; never another hospital', async () => {
    await db.as(null, `insert into public.patients (tenant_id, full_name, phone) values ($1, 'Sita Devi', '9876500001'), ($2, 'Other Hospital Patient', '9876500002')`, [B, C])
    const d = await call(P_FINANCE, 'cp_hospital_data', [B])
    expect(d.counts.patients).toBe(2)
    expect(d.users).toBe(2)
    await fails(call(P_FINANCE, 'cp_browse', [B, 'patients']), /bills only/)
    expect((await call(P_FINANCE, 'cp_browse', [B, 'invoices'])).total).toBe(0)
    const p = await call(P_SUPPORT, 'cp_browse', [B, 'patients', 'sita'])
    expect(p.total).toBe(1); expect(p.rows[0]).toMatchObject({ full_name: 'Sita Devi' })
    expect((await call(P_SUPPORT, 'cp_browse', [B, 'patients'])).rows.map((r: any) => r.full_name)).not.toContain('Other Hospital Patient')
    await fails(call(P_SUPPORT, 'cp_browse', [B, 'salaries']), /Unknown list/)
    expect(await lastAudit('data:browse')).toMatchObject({ user_id: P_SUPPORT, tenant_id: B, target: 'patients' })
  })

  test('import: admin only; per-row errors; duplicates skipped; dry run writes nothing; doctors need an existing department', async () => {
    const rows = [
      { full_name: 'Amit Sharma', phone: '+91 98111 22233', gender: 'M', date_of_birth: '1990-05-01', blood_group: 'b+' },
      { full_name: 'Sita Devi', phone: '9876500001' },              // already there
      { full_name: 'X', phone: '9876500003' },                      // bad name
      { full_name: 'Bad Date', date_of_birth: '31/12/1990' },
      { full_name: 'Bad Phone', phone: '12345' },
    ]
    await fails(call(P_SUPPORT, 'cp_import', [B, 'patients', rows, false], ['uuid', 'text', 'jsonb', 'boolean']), /\(admin\)/)
    const dry = await call(P_ADMIN, 'cp_import', [B, 'patients', rows, true], ['uuid', 'text', 'jsonb', 'boolean'])
    expect(dry).toMatchObject({ dry_run: true, imported: 1, duplicates: 1, failed: 3 })
    expect((await db.one<any>(null, `select count(*)::int n from public.patients where tenant_id = $1`, [B])).n).toBe(2)
    const r = await call(P_ADMIN, 'cp_import', [B, 'patients', rows, false], ['uuid', 'text', 'jsonb', 'boolean'])
    expect(r).toMatchObject({ imported: 1, duplicates: 1, failed: 3 })
    expect(r.errors.map((e: any) => e.row)).toEqual([3, 4, 5])
    const amit = await db.one<any>(null, `select tenant_id, gender, blood_group, phone, mrn from public.patients where full_name = 'Amit Sharma'`)
    expect(amit).toMatchObject({ tenant_id: B, gender: 'male', blood_group: 'B+', phone: '9811122233' })
    expect(amit.mrn).toMatch(/^CTY/)

    await db.as(null, `insert into public.departments (tenant_id, name) values ($1, 'Cardiology')`, [B])
    const docs = await call(P_ADMIN, 'cp_import', [B, 'doctors', [
      { full_name: 'Dr Rao', specialization: 'Cardiologist', department: 'cardiology', consultation_fee: '1,000', experience_years: '12' },
      { full_name: 'Dr Nobody', specialization: 'ENT', department: 'Neurology' },
    ], false], ['uuid', 'text', 'jsonb', 'boolean'])
    expect(docs).toMatchObject({ imported: 1, failed: 1 })
    expect(docs.errors[0].error).toMatch(/department "Neurology"/)
    expect(await db.one<any>(null, `select consultation_fee::int fee, experience_years, tenant_id from public.doctors where full_name = 'Dr Rao'`)).toEqual({ fee: 1000, experience_years: 12, tenant_id: B })
  })
})

describe('D · messaging', () => {
  test('admin turns channels on/off and caps the shared accounts; support / finance read only; the cap stops queuing', async () => {
    const m = await call(P_FINANCE, 'cp_messaging', [B])
    expect(m.channels).toHaveProperty('sms')
    await fails(call(P_SUPPORT, 'cp_save_messaging', [B, { monthlyLimit: { email: 1 } }], ['uuid', 'jsonb']), /\(admin\)/)
    await fails(call(P_ADMIN, 'cp_save_messaging', [B, { monthlyLimit: { email: -1 } }], ['uuid', 'jsonb']), /whole number/)
    await fails(call(P_ADMIN, 'cp_save_messaging', [B, { channels: { fax: { enabled: true } } }], ['uuid', 'jsonb']), /Unknown channel/)
    const r = await call(P_ADMIN, 'cp_save_messaging', [B, { channels: { email: { enabled: true, source: 'platform' } }, monthlyLimit: { email: 1, sms: null } }], ['uuid', 'jsonb'])
    expect(r.channels.email).toEqual({ enabled: true, source: 'platform' })
    expect(r.monthlyLimit).toEqual({ email: 1 })

    const enqueue = () => db.one<any>(null, `select set_config('app.tenant_id', $1, false), public.notify_enqueue_raw('test', '{"text":"hi"}'::jsonb, array['email'], null, 'a@b.in', null, '{}'::jsonb) n`, [B])
    expect((await enqueue()).n).toBe(1)
    expect((await enqueue()).n).toBe(0)     // cap of 1 reached (one pending)
    await db.as(null, `select set_config('app.tenant_id', '', false)`)
    await call(P_ADMIN, 'cp_save_messaging', [B, { monthlyLimit: {} }], ['uuid', 'jsonb'])
    expect((await db.one<any>(null, `select billing from public.tenants where id = $1`, [B])).billing).not.toHaveProperty('monthlyLimit')
  })
})

describe('E · credit notes + wallet', () => {
  test('finance / admin only; amount within what is left; wallet credit or refund; full credit marks the invoice refunded', async () => {
    const pay = await call(P_FINANCE, 'cp_billing', [B, 'manual_payment', { kind: 'plan', months: 1, method: 'upi', reference: 'UTR1' }], ['uuid', 'text', 'jsonb'])
    const p = await db.one<any>(null, `select id, total_paise, gst_paise from public.billing_payments where invoice_no = $1`, [pay.invoice_no])
    await fails(call(P_SUPPORT, 'cp_credit_note', [p.id, { reason: 'Billing mistake' }], ['uuid', 'jsonb']), /admin \/ finance/)
    await fails(call(P_FINANCE, 'cp_credit_note', [p.id, { reason: 'x' }], ['uuid', 'jsonb']), /reason/)
    await fails(call(P_FINANCE, 'cp_credit_note', [p.id, { reason: 'Too much', amount: p.total_paise / 100 + 1 }], ['uuid', 'jsonb']), /between ₹1/)
    const before = (await db.one<any>(null, `select wallet_paise from public.tenants where id = $1`, [B])).wallet_paise
    const cn = await call(P_FINANCE, 'cp_credit_note', [p.id, { reason: 'Goodwill, outage on 2 Oct', amount: 100, mode: 'wallet' }], ['uuid', 'jsonb'])
    expect(cn.credit_no).toMatch(/^HC-CN\/\d{4}-\d{2}\/\d{5}$/)
    expect(cn.total_paise).toBe(10000); expect(cn.base_paise + cn.gst_paise).toBe(10000)
    expect(Number((await db.one<any>(null, `select wallet_paise from public.tenants where id = $1`, [B])).wallet_paise)).toBe(Number(before) + 10000)
    const rest = await call(P_ADMIN, 'cp_credit_note', [p.id, { reason: 'Plan cancelled, refunded by UPI', mode: 'refund' }], ['uuid', 'jsonb'])
    expect(rest.total_paise).toBe(p.total_paise - 10000)
    expect((await db.one<any>(null, `select status from public.billing_payments where id = $1`, [p.id])).status).toBe('refunded')
    await fails(call(P_ADMIN, 'cp_credit_note', [p.id, { reason: 'Again please' }], ['uuid', 'jsonb']), /paid invoice/)

    expect(await call(P_FINANCE, 'cp_credit_notes', [B])).toHaveLength(2)
    const ledger = await call(P_FINANCE, 'cp_wallet_ledger', [B])
    expect(ledger[0]).toMatchObject({ kind: 'refund', amount_paise: 10000 })
    await fails(call(P_SUPPORT, 'cp_wallet_ledger', [B]), /admin \/ finance/)
    // the hospital's owner can read its own credit notes, not another hospital's
    expect(await db.as<any>(B_OWNER, `select credit_no from public.billing_credit_notes`)).toHaveLength(2)
    expect(await db.as<any>(C_OWNER, `select credit_no from public.billing_credit_notes`)).toHaveLength(0)
  })

  test('a wallet top-up can only be refunded, and not more than is left in the wallet', async () => {
    const pay = await call(P_ADMIN, 'cp_billing', [C, 'manual_payment', { kind: 'wallet', amount: 500, method: 'upi' }], ['uuid', 'text', 'jsonb'])
    const p = await db.one<any>(null, `select id from public.billing_payments where invoice_no = $1`, [pay.invoice_no])
    await fails(call(P_ADMIN, 'cp_credit_note', [p.id, { reason: 'Credit it back', mode: 'wallet' }], ['uuid', 'jsonb']), /only be refunded/)
    await fails(call(P_FINANCE, 'cp_credit_note', [p.id, { reason: 'Not my hospital', mode: 'refund' }], ['uuid', 'jsonb']), /not found/)
    await db.as(null, `update public.tenants set wallet_paise = 10000 where id = $1`, [C])
    await fails(call(P_ADMIN, 'cp_credit_note', [p.id, { reason: 'Refund the top-up', mode: 'refund' }], ['uuid', 'jsonb']), /wallet has only/)
    await call(P_ADMIN, 'cp_credit_note', [p.id, { reason: 'Refund part of top-up', mode: 'refund', amount: 59 }], ['uuid', 'jsonb'])
    expect(Number((await db.one<any>(null, `select wallet_paise from public.tenants where id = $1`, [C])).wallet_paise)).toBe(5000)
  })
})

describe('F · announcements', () => {
  test('admin writes, support reads, hospital users see the ones for their hospital + role (never patients)', async () => {
    await fails(call(P_SUPPORT, 'cp_save_announcement', [{ title: 'Hi there' }], ['jsonb']), /\(admin\)/)
    await fails(call(P_FINANCE, 'cp_announcements'), /admin \/ support/)
    await fails(call(P_ADMIN, 'cp_save_announcement', [{ title: 'Hi', roles: ['patient'] }], ['jsonb']), /staff roles/)
    const a = await call(P_ADMIN, 'cp_save_announcement', [{ title: 'Maintenance tonight', body: '11 pm – 12 am', level: 'warning', roles: ['owner', 'doctor'] }], ['jsonb'])
    await call(P_ADMIN, 'cp_save_announcement', [{ title: 'Only for Third', hospital_ids: [C] }], ['jsonb'])
    await call(P_ADMIN, 'cp_save_announcement', [{ title: 'Old news', ends_at: new Date(Date.now() - 1000).toISOString(), starts_at: new Date(Date.now() - 864e5).toISOString() }], ['jsonb'])
    expect(await call(P_SUPPORT, 'cp_announcements')).toHaveLength(3)
    const mine = async (who: string) => (await call<any[]>(who, 'my_announcements')).map((x) => x.title)
    expect(await mine(B_OWNER)).toEqual(['Maintenance tonight'])
    expect(await mine(B_DOCTOR)).toEqual(['Maintenance tonight'])
    expect(await mine(B_PATIENT)).toEqual([])
    await fails(call('anon', 'my_announcements'), /permission denied/)
    await call(P_ADMIN, 'cp_save_announcement', [{ id: a.id, title: 'Maintenance tonight', active: false, roles: ['owner'] }], ['jsonb'])
    expect(await mine(B_OWNER)).toEqual([])
    await fails(call(P_SUPPORT, 'cp_delete_announcement', [a.id]), /\(admin\)/)
    await call(P_ADMIN, 'cp_delete_announcement', [a.id])
    expect(await call(P_ADMIN, 'cp_announcements')).toHaveLength(2)
  })
})

describe('sign in as user', () => {
  const fresh = () => ({ sub: P_ADMIN, amr: [{ method: 'password', timestamp: now() }] })

  test('admin only, fresh password, a reason, staff accounts only', async () => {
    await fails(call(P_SUPPORT, 'impersonation_start', [B_DOCTOR, 'Checking a reported bug', 30], [], { sub: P_SUPPORT, amr: [{ method: 'password', timestamp: now() }] }), /\(admin\)/)
    await fails(call(P_ADMIN, 'impersonation_start', [B_DOCTOR, 'Checking a reported bug', 30]), /REAUTH_REQUIRED/)
    await fails(call(P_ADMIN, 'impersonation_start', [B_DOCTOR, 'bug', 30], [], fresh()), /at least 10/)
    await fails(call(P_ADMIN, 'impersonation_start', [B_PATIENT, 'Checking a reported bug', 30], [], fresh()), /patient/)
    await fails(call(P_ADMIN, 'impersonation_start', [P_SUPPORT, 'Checking a reported bug', 30], [], fresh()), /not found|team member/)
    await fails(call(B_OWNER, 'impersonation_start', [B_DOCTOR, 'Checking a reported bug', 30], [], { sub: B_OWNER, amr: [{ method: 'password', timestamp: now() }] }), /Hospital Comrade team/)
  })

  test('start → bind once (only the target, within 5 minutes) → status → end; capped at 30 minutes; audited', async () => {
    const s = await call(P_ADMIN, 'impersonation_start', [B_DOCTOR, 'Doctor cannot see appointments', 90], [], fresh())
    expect(s).toMatchObject({ email: 'dr.mehta@cityhospital.in', slug: 'city', role: 'doctor' })
    expect(Date.parse(s.expires_at) - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5_000)
    expect(await lastAudit('impersonate:start')).toMatchObject({ user_id: P_ADMIN, tenant_id: B, target: 'dr.mehta@cityhospital.in' })

    const sid = '11111111-1111-4111-8111-111111111111'
    await fails(call(B_OWNER, 'impersonation_bind', [s.id], [], { sub: B_OWNER, session_id: sid }), /expired/)
    const b = await call(B_DOCTOR, 'impersonation_bind', [s.id], [], { sub: B_DOCTOR, session_id: sid })
    expect(b).toMatchObject({ admin_name: 'Provider admin', reason: 'Doctor cannot see appointments' })
    await fails(call(B_DOCTOR, 'impersonation_bind', [s.id], [], { sub: B_DOCTOR, session_id: sid }), /expired/)     // once
    expect((await call(B_DOCTOR, 'impersonation_status', [s.id], [], { sub: B_DOCTOR, session_id: sid })).active).toBe(true)
    expect((await call(B_DOCTOR, 'impersonation_status', [s.id], [], { sub: B_DOCTOR, session_id: 'other' })).active).toBe(false)
    expect(await call(B_OWNER, 'impersonation_status', [s.id])).toBeNull()

    await fails(call(B_OWNER, 'impersonation_end', [s.id, 'x']), /Not allowed/)
    await call(B_DOCTOR, 'impersonation_end', [s.id, 'ended'])
    expect((await call(B_DOCTOR, 'impersonation_status', [s.id], [], { sub: B_DOCTOR, session_id: sid })).active).toBe(false)
    expect((await lastAudit('impersonate:end')).detail).toMatchObject({ id: s.id, reason: 'ended' })
    const log = await call(P_ADMIN, 'cp_impersonations')
    expect(log[0]).toMatchObject({ id: s.id, active: false, end_reason: 'ended', hospital: 'City Care Hospital' })
    await fails(call(P_SUPPORT, 'cp_impersonations'), /\(admin\)/)
  })

  test('time limit: expired sessions are closed by the cron job; a new start replaces the admin\'s previous one', async () => {
    const a = await call(P_ADMIN, 'impersonation_start', [B_DOCTOR, 'First look at the issue', 30], [], fresh())
    const b = await call(P_ADMIN, 'impersonation_start', [B_OWNER, 'Second look at the issue', 30], [], fresh())
    expect((await db.one<any>(null, `select end_reason from public.impersonations where id = $1`, [a.id])).end_reason).toBe('replaced')
    await db.as(null, `update public.impersonations set expires_at = now() - interval '1 second' where id = $1`, [b.id])
    await db.as(null, `select public.notify_cron_flush()`)
    expect((await db.one<any>(null, `select end_reason from public.impersonations where id = $1`, [b.id])).end_reason).toBe('expired')
    await fails(db.as(P_ADMIN, `select public.impersonation_expire()`), /permission denied/)
  })
})

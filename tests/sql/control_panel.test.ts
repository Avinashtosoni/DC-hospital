/**
 * Phase 5 — the Hospital Comrade control panel's functions (scripts/sql/control_panel.sql):
 * who may call what, creating / editing hospitals, the platform team, billing tools, payments, audit and settings.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_PATIENT = 'b0b00000-0000-4000-8000-000000000002'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const P_FINANCE = 'e0e00000-0000-4000-8000-000000000003'
const NEWBIE = 'e0e00000-0000-4000-8000-000000000009'

const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)))
  return r.r
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status, trial_ends_at) values
    ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'trial', now() + interval '3 days'), ($2, 'third', 'Third Clinic', 'TRD', 'hospital', 'active', null)`, [B, C])
  await db.as(null, `update public.tenants set paid_until = now() + interval '40 days' where id = $1`, [C])
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
}, 240_000)

describe('access', () => {
  test('hospital accounts and visitors are refused; cp_me tells the panel who is signed in', async () => {
    for (const who of [B_OWNER, B_PATIENT]) {
      await fails(call(who, 'cp_hospitals'), /Hospital Comrade team/)
      await fails(call(who, 'cp_overview'), /Hospital Comrade team/)
      expect(await call(who, 'cp_me')).toBeNull()
    }
    await fails(call('anon', 'cp_hospitals'), /permission denied/)
    await fails(call(P_ADMIN, 'cp_require', ['{admin}'], ['text[]']), /permission denied/)   // internal helper
    expect(await call(P_ADMIN, 'cp_me')).toMatchObject({ role: 'admin', email: 'admin@hc.in', full_name: 'Provider admin' })
  })

  test('admin sees every hospital, support / finance only their assigned ones', async () => {
    const names = async (who: string) => (await call<any[]>(who, 'cp_hospitals')).map((h) => h.slug)
    expect(await names(P_ADMIN)).toEqual(['main', 'city', 'third'])
    expect(await names(P_SUPPORT)).toEqual(['city'])
    expect(await names(P_FINANCE)).toEqual(['city'])
    await fails(call(P_SUPPORT, 'cp_hospital', [C]), /not found or not assigned/)
    const h = await call(P_SUPPORT, 'cp_hospital', [B])
    expect(h).toMatchObject({ slug: 'city', staff: 1, patients: 1, owner_joined: true, owner_email: 'owner@cityhospital.in', payments: [] })
    expect(h.license.status).toBe('trial')
  })

  test('only admins create / edit hospitals, team and settings; support cannot use billing tools', async () => {
    for (const who of [P_SUPPORT, P_FINANCE]) {
      await fails(call(who, 'cp_create_hospital', [{ slug: 'x1' }], ['jsonb']), /\(admin\)/)
      await fails(call(who, 'cp_update_hospital', [B, { name: 'Hacked' }], ['uuid', 'jsonb']), /\(admin\)/)
      await fails(call(who, 'cp_team'), /\(admin\)/)
      await fails(call(who, 'cp_audit'), /\(admin\)/)
      await fails(call(who, 'cp_save_billing_settings', [{ gstPercent: 0 }], ['jsonb']), /\(admin\)/)
    }
    await fails(call(P_SUPPORT, 'cp_billing', [B, 'extend_trial', { days: 5 }], ['uuid', 'text', 'jsonb']), /admin \/ finance/)
    await fails(call(P_SUPPORT, 'cp_payments'), /admin \/ finance/)
    await fails(call(P_FINANCE, 'cp_billing', [C, 'manual_payment', { months: 1 }], ['uuid', 'text', 'jsonb']), /not assigned/)
  })
})

describe('hospitals', () => {
  test('create: validated, with address, owner e-mail, default settings and a trial', async () => {
    const bad = (p: object, re: RegExp) => fails(call(P_ADMIN, 'cp_create_hospital', [p], ['jsonb']), re)
    const ok = { slug: 'sunrise', name: 'Sunrise Hospital', code: 'SRH', plan: 'hospital', owner_email: 'Owner@Sunrise.in', domain: 'https://www.SunriseHospital.in/', trial_days: 10 }
    await bad({ ...ok, slug: 'Bad Slug' }, /Short name/)
    await bad({ ...ok, code: 's1' }, /Record prefix/)
    await bad({ ...ok, plan: 'gold' }, /Unknown plan/)
    await bad({ ...ok, owner_email: 'nope' }, /owner's e-mail/)
    await bad({ ...ok, slug: 'city' }, /taken/)
    await bad({ ...ok, owner_email: 'owner@cityhospital.in' }, /one account = one hospital/)
    await bad({ ...ok, owner_email: 'support@hc.in' }, /one account = one hospital/)
    await bad({ ...ok, modules: { billing: 'provider' } }, /Unknown module/)
    await bad({ ...ok, domain: 'not a domain' }, /domain/)

    const r = await call(P_ADMIN, 'cp_create_hospital', [ok], ['jsonb'])
    expect(r).toMatchObject({ slug: 'sunrise', domain: 'www.sunrisehospital.in', owner_email: 'owner@sunrise.in' })
    const h = await call(P_ADMIN, 'cp_hospital', [r.id])
    expect(h).toMatchObject({ name: 'Sunrise Hospital', code: 'SRH', plan: 'hospital', owner_joined: false, owner_email: 'owner@sunrise.in', price: 2999 })
    expect(h.license.status).toBe('trial')
    const days = (new Date(h.license.trial_ends_at).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(9.9); expect(days).toBeLessThan(10.1)
    expect(h.domains).toEqual([expect.objectContaining({ domain: 'www.sunrisehospital.in', is_primary: true })])
    expect(h.modules).toMatchObject({ forms: 'hospital' })
    // the built-in website forms + its name were seeded, the address resolves to it, the action is in the audit
    expect((await db.one<{ n: number }>(null, `select count(*)::int n from public.site_forms where tenant_id = $1`, [r.id])).n).toBeGreaterThan(0)
    expect((await db.one<{ t: string }>(null, `select id::text t from public.resolve_tenant('www.sunrisehospital.in', null)`)).t).toBe(r.id)
    await bad({ ...ok, slug: 'sunrise2' }, /already belongs/)
    const audit = await call<any[]>(P_ADMIN, 'cp_audit', [r.id, 10], ['uuid', 'int'])
    expect(audit[0]).toMatchObject({ action: 'hospital:create', target: 'sunrise', hospital: 'Sunrise Hospital', user_name: 'Provider admin' })

    // the owner signs up with that e-mail on its address → becomes its owner
    await db.as(null, `select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-tenant-id': r.id })])
    await signUp('f0f00000-0000-4000-8000-000000000001', 'owner@sunrise.in', { full_name: 'Sunrise Owner', tenant_id: r.id })
    await db.as(null, `select set_config('request.headers', '', false)`)
    const after = await call(P_ADMIN, 'cp_hospital', [r.id])
    expect(after).toMatchObject({ owner_joined: true, staff: 1 })
  })

  test('active start: paid for the chosen months', async () => {
    const r = await call(P_ADMIN, 'cp_create_hospital', [{ slug: 'paid', name: 'Paid Clinic', code: 'PDC', plan: 'clinic', owner_email: 'o@paid.in', status: 'active', months: 3 }], ['jsonb'])
    const h = await call(P_ADMIN, 'cp_hospital', [r.id])
    expect(h.license.status).toBe('active')
    const days = (new Date(h.license.paid_until).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(88); expect(days).toBeLessThan(93)
  })

  test('edit: name, prefix, notes, modules; owner e-mail only until the owner signs up', async () => {
    const h = await call(P_ADMIN, 'cp_update_hospital', [C, { name: 'Third Care Clinic', code: 'tcc', notes: 'Pilot', modules: { forms: 'provider', cms: 'provider' }, owner_email: 'boss@third.in' }], ['uuid', 'jsonb'])
    expect(h).toMatchObject({ name: 'Third Care Clinic', code: 'TCC', notes: 'Pilot', owner_email: 'boss@third.in', modules: { forms: 'provider', cms: 'provider' } })
    await fails(call(P_ADMIN, 'cp_update_hospital', [B, { owner_email: 'new@city.in' }], ['uuid', 'jsonb']), /already signed up/)
    await fails(call(P_ADMIN, 'cp_update_hospital', [C, { modules: { forms: 'everyone' } }], ['uuid', 'jsonb']), /Unknown module/)
    // the hospital's own settings screens read the module locks from tenants.modules
    expect((await db.one<{ m: any }>(null, `select modules m from public.tenants where id = $1`, [C])).m).toEqual({ forms: 'provider', cms: 'provider' })
  })

  test('billing tools work per hospital through provider_billing (finance on assigned hospitals)', async () => {
    const r = await call(P_FINANCE, 'cp_billing', [B, 'manual_payment', { kind: 'plan', months: 1, method: 'upi', reference: 'UTR123' }], ['uuid', 'text', 'jsonb'])
    expect(r.invoice_no).toMatch(/^HC\/\d{4}-\d{2}\/\d{6}$/)
    const h = await call(P_FINANCE, 'cp_hospital', [B])
    expect(h.license.status).toBe('active')
    expect(h.payments[0]).toMatchObject({ kind: 'plan', status: 'paid', method: 'upi' })
    const pay = await call<any[]>(P_FINANCE, 'cp_payments')
    expect(pay.map((p) => p.hospital)).toEqual(['City Hospital'])
    await call(P_ADMIN, 'cp_billing', [C, 'wallet_adjust', { amount: 250, note: 'Goodwill' }], ['uuid', 'text', 'jsonb'])
    expect((await call(P_ADMIN, 'cp_hospital', [C])).wallet_paise).toBe(25000)
    // the audit row is filed under the right hospital
    const audit = await call<any[]>(P_ADMIN, 'cp_audit', [C, 5], ['uuid', 'int'])
    expect(audit.some((a) => a.action.startsWith('billing:') && a.hospital === 'Third Care Clinic')).toBe(true)
  })

  test('overview: counts, MRR from paying hospitals, hospitals needing attention, new leads (admin only)', async () => {
    await db.as(null, `insert into public.platform_leads (name, organisation, phone) values ('Asha', 'Asha Clinic', '9876543210')`)
    const o = await call(P_ADMIN, 'cp_overview')
    expect(o.hospitals).toBe(5)
    expect(o.by_status).toMatchObject({ active: 3, trial: 1 })
    expect(o.mrr).toBe(999 + 2999 + 999)                       // city (paid now), third, paid clinic
    expect(o.wallet_paise).toBe(25000)
    expect(o.leads_new).toBe(1)
    expect(o.payments_30d_paise).toBeGreaterThan(0)
    const s = await call(P_SUPPORT, 'cp_overview')
    expect(s).toMatchObject({ hospitals: 1, leads_new: null, payments_30d_paise: null })
  })
})

describe('team', () => {
  test('add someone who has signed up: their hospital patient record is removed, assignments saved', async () => {
    await fails(call(P_ADMIN, 'cp_save_provider', [{ email: 'ghost@hc.in', role: 'support' }], ['jsonb']), /ask them to create one first/)
    await fails(call(P_ADMIN, 'cp_save_provider', [{ email: 'owner@cityhospital.in', role: 'support' }], ['jsonb']), /staff account at City Hospital/)
    await signUp(NEWBIE, 'neha@hc.in', { full_name: 'Neha Support' })            // signed up on the platform site → patient of main
    await call(P_ADMIN, 'cp_save_provider', [{ email: 'Neha@hc.in', role: 'support', hospitals: [B, C] }], ['jsonb'])
    expect((await db.one<{ t: string | null }>(null, `select tenant_id t from public.profiles where id = $1`, [NEWBIE])).t).toBeNull()
    expect((await db.one<{ n: number }>(null, `select count(*)::int n from public.patients where profile_id = $1`, [NEWBIE])).n).toBe(0)
    expect((await call<any[]>(NEWBIE, 'cp_hospitals')).map((h) => h.slug).sort()).toEqual(['city', 'third'])
    const team = await call<any[]>(P_ADMIN, 'cp_team')
    expect(team.find((m) => m.email === 'neha@hc.in')).toMatchObject({ role: 'support', active: true, name: 'Neha Support' })
    expect(team.find((m) => m.email === 'neha@hc.in').hospitals).toHaveLength(2)
  })

  test('change role / deactivate; admins have no assignments; you cannot remove your own admin access', async () => {
    await call(P_ADMIN, 'cp_save_provider', [{ email: 'neha@hc.in', role: 'support', active: false, hospitals: [B] }], ['jsonb'])
    await fails(call(NEWBIE, 'cp_hospitals'), /Hospital Comrade team/)
    expect(await call(NEWBIE, 'cp_me')).toBeNull()
    await call(P_ADMIN, 'cp_save_provider', [{ email: 'neha@hc.in', role: 'admin', hospitals: [B] }], ['jsonb'])
    expect((await db.one<{ n: number }>(null, `select count(*)::int n from public.provider_assignments where user_id = $1`, [NEWBIE])).n).toBe(0)
    expect((await call<any[]>(NEWBIE, 'cp_hospitals')).length).toBe(5)
    await fails(call(P_ADMIN, 'cp_save_provider', [{ email: 'admin@hc.in', role: 'support' }], ['jsonb']), /your own admin access/)
    await fails(call(P_ADMIN, 'cp_save_provider', [{ email: 'admin@hc.in', role: 'admin', active: false }], ['jsonb']), /your own admin access/)
  })
})

describe('platform settings', () => {
  test('billing settings: merged, validated, used by prices right away', async () => {
    await fails(call(P_ADMIN, 'cp_save_billing_settings', [{ gstPercent: 99 }], ['jsonb']), /out of range/)
    await fails(call(P_ADMIN, 'cp_save_billing_settings', [{ hacker: 1 }], ['jsonb']), /Unknown setting/)
    await fails(call(P_ADMIN, 'cp_save_billing_settings', [{ ratesPaise: { sms: -1 } }], ['jsonb']), /Message rates/)
    await fails(call(P_ADMIN, 'cp_save_billing_settings', [{ minTopup: 5000, maxTopup: 100 }], ['jsonb']), /minimum top-up/)
    const cfg = await call(P_ADMIN, 'cp_save_billing_settings', [{ trialDays: 21, ratesPaise: { sms: 25 }, plans: { clinic: { price: 1199 } }, seller: { gstin: '10ABCDE1234F1Z5' } }], ['jsonb'])
    expect(cfg).toMatchObject({ trialDays: 21, ratesPaise: { sms: 25, whatsapp: 40 }, seller: { gstin: '10ABCDE1234F1Z5', name: 'Digital Comrade' } })
    expect(cfg.plans.clinic.price).toBe(1199)
    expect(cfg.plans.hospital.price).toBe(2999)
    expect((await call(P_ADMIN, 'cp_settings')).billing.trialDays).toBe(21)
    const h = await call(P_ADMIN, 'cp_hospital', [C])
    expect(h.price).toBe(2999)
    expect((await call(P_ADMIN, 'cp_hospital', [B])).price).toBe(1199)
  })
})

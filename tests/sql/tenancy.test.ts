/**
 * Multi-tenancy (scripts/sql/tenancy.sql): one database, many hospitals.
 * The most important guarantee of the whole SaaS: a hospital never sees or changes another hospital's rows —
 * checked here for EVERY table that has a tenant_id, plus provider (admin / support / finance) access.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, knownOtp, USER, type Db } from './harness'

let db: Db
const A = 'a0000000-0000-4000-8000-000000000001'          // primary hospital (all demo data)
const B = 'b0000000-0000-4000-8000-000000000002'          // a second hospital
const C = 'c0000000-0000-4000-8000-000000000003'          // a third one nobody from support is assigned to
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_PATIENT = 'b0b00000-0000-4000-8000-000000000002'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const P_FINANCE = 'e0e00000-0000-4000-8000-000000000003'

/** run as a user with request headers (what supabase-js sends) */
async function asH<T = Record<string, unknown>>(who: string | null, headers: Record<string, string>, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)])
  try { return await db.as<T>(who, sql, params) } finally { await db.query(`select set_config('request.headers', '', false)`) }
}
const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, extensions.crypt('Secret@123', extensions.gen_salt('bf')), $3::jsonb)`,
  [id, email, JSON.stringify(meta)])

let tenantTables: string[] = []

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code) values ($1, 'city', 'City Hospital', 'CTY'), ($2, 'third', 'Third Clinic', 'TRD')`, [B, C])
  await db.as(null, `insert into public.tenant_domains (domain, tenant_id, is_primary) values ('cityhospital.in', $1, true)`, [B])

  // hospital B: an owner (made owner by the platform) and a patient who signed up on B's website
  await signUp(B_OWNER, 'owner@cityhospital.in', { full_name: 'City Owner', tenant_id: B })
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
  await db.as(null, `delete from public.patients where profile_id = $1`, [B_OWNER])
  await signUp(B_PATIENT, 'ravi@example.com', { full_name: 'Ravi Kumar', tenant_id: B })

  // providers: no hospital of their own
  for (const [id, email, role] of [[P_ADMIN, 'admin@hospitalcomrade.in', 'admin'], [P_SUPPORT, 'support@hospitalcomrade.in', 'support'], [P_FINANCE, 'finance@hospitalcomrade.in', 'finance']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    // platform-only move (the provider panel's create-provider RPC does the same)
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
  await db.as(null, `insert into public.provider_assignments (user_id, tenant_id) values ($1, $3), ($2, $3)`, [P_SUPPORT, P_FINANCE, B])

  // B's owner fills in some data through the normal API (tenant_id comes from the default)
  await db.as(B_OWNER, `insert into public.departments (name) values ('Cardiology')`)          // same name as hospital A — allowed per hospital
  await db.as(B_OWNER, `insert into public.patients (full_name, phone, gender) values ('Sunita Devi', '9800000001', 'female')`)
  await db.as(B_OWNER, `insert into public.notices (title, body, audience, priority) values ('B only', 'For City Hospital', 'all', 'normal')`)
  await db.as(B_OWNER, `insert into public.app_settings (key, data) values ('app', '{"x":1}'::jsonb)`)
  await asH('anon', { 'x-tenant-id': B }, `select 1`) // warm-up
  await db.as(null, `insert into public.site_content (tenant_id, key, data) values ($1, 'brand', '{"name":"City Hospital"}'::jsonb)`, [B])

  tenantTables = (await db.as<{ table_name: string }>(null, `select c.table_name from information_schema.columns c
     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('tenant_domains', 'provider_assignments', 'provider_audit')
    order by 1`)).map((r) => r.table_name)
}, 240_000)

/** rows of `other` hospital this user can reach in each table (permission denied = unreachable = 0) */
async function leaks(who: string, other: string, headers: Record<string, string> = {}) {
  const found: Record<string, number> = {}
  for (const t of tenantTables) {
    try {
      const [r] = await asH<{ n: number }>(who, headers, `select count(*)::int as n from public.${t} where tenant_id = $1`, [other])
      if (r.n) found[t] = r.n
    } catch (e) {
      if (!/permission denied/.test(String(e))) throw e
    }
  }
  return found
}

describe('isolation between hospitals', () => {
  test('every hospital table is covered by the tenant_isolation policy', async () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(30)
    const missing = await db.as<{ t: string }>(null, `select x.t from unnest($1::text[]) x(t)
      where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = x.t and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE')`, [tenantTables])
    expect(missing).toEqual([])
  })

  test("hospital A's staff and patients can't see a single row of hospital B (and the reverse)", async () => {
    for (const who of Object.values(USER)) expect(await leaks(who, B)).toEqual({})
    expect(await leaks(B_OWNER, A)).toEqual({})
    expect(await leaks(B_PATIENT, A)).toEqual({})
  })

  test('a hospital user cannot switch hospital with a header', async () => {
    expect(await leaks(B_OWNER, A, { 'x-tenant-id': A })).toEqual({})
    expect(await leaks(USER.owner, B, { 'x-tenant-id': B })).toEqual({})
    const rows = await asH<{ full_name: string }>(B_OWNER, { 'x-tenant-id': A }, `select full_name from public.patients order by full_name`)
    expect(rows.map((r) => r.full_name)).toEqual(['Ravi Kumar', 'Sunita Devi'])
  })

  test('no writing into another hospital and no moving rows between hospitals', async () => {
    await expect(db.as(B_OWNER, `insert into public.departments (tenant_id, name) values ($1, 'Sneaky')`, [A])).rejects.toThrow(/row-level security|violates/)
    const [dep] = await db.as<{ id: string }>(B_OWNER, `select id from public.departments where name = 'Cardiology'`)
    await expect(db.as(B_OWNER, `update public.departments set tenant_id = $1 where id = $2`, [A, dep.id])).rejects.toThrow()
    // an update aimed at A's rows simply finds nothing
    const res = await db.as(B_OWNER, `update public.departments set description = 'hacked' where tenant_id = $1 returning id`, [A])
    expect(res).toHaveLength(0)
  })

  test('numbers and unique names are per hospital', async () => {
    const [p] = await db.as<{ mrn: string }>(B_OWNER, `select mrn from public.patients where full_name = 'Sunita Devi'`)
    expect(p.mrn).toMatch(/^CTY-1000\d\d$/)
    const deps = await db.as<{ tenant_id: string }>(null, `select tenant_id from public.departments where name = 'Cardiology' order by tenant_id`)
    expect(deps.map((d) => d.tenant_id)).toEqual([A, B])
    const [inv] = await db.as<{ invoice_number: string }>(B_OWNER, `insert into public.invoices (patient_id, items, subtotal, total, due_date)
      select id, '[]'::jsonb, 100, 100, current_date from public.patients where full_name = 'Sunita Devi' returning invoice_number`)
    expect(inv.invoice_number).toBe('INV-10001')
  })

  test('signing up on a hospital website joins that hospital (profile + patient record)', async () => {
    const [prof] = await db.as<{ tenant_id: string; role: string }>(null, `select tenant_id, role from public.profiles where id = $1`, [B_PATIENT])
    expect(prof).toEqual({ tenant_id: B, role: 'patient' })
    const [pat] = await db.as<{ tenant_id: string; mrn: string }>(null, `select tenant_id, mrn from public.patients where profile_id = $1`, [B_PATIENT])
    expect(pat.tenant_id).toBe(B)
    expect(pat.mrn).toMatch(/^CTY-/)
    // a signup without a hospital (single-hospital installs) still lands in the primary hospital
    await signUp('f0f00000-0000-4000-8000-000000000009', 'plain@example.com', { full_name: 'Plain User' })
    expect((await db.one<{ tenant_id: string }>(null, `select tenant_id from public.profiles where id = 'f0f00000-0000-4000-8000-000000000009'`)).tenant_id).toBe(A)
  })
})

describe('website visitors (anon)', () => {
  test('the domain header picks the hospital; no header means the primary hospital', async () => {
    const b = await asH<{ key: string; data: { name: string } }>('anon', { 'x-tenant-id': B }, `select key, data from public.site_content`)
    expect(b).toEqual([{ key: 'brand', data: { name: 'City Hospital' } }])
    const a = await asH<{ tenant_id: string }>('anon', {}, `select distinct tenant_id from public.site_content`)
    expect(a.every((r) => r.tenant_id === A)).toBe(true)
    const t = await db.as<{ id: string; name: string }>('anon', `select id, name from public.resolve_tenant('CityHospital.in:443')`)
    expect(t).toEqual([{ id: B, name: 'City Hospital' }])
    expect(await db.as('anon', `select * from public.resolve_tenant('unknown.example')`)).toEqual([])
    // unmapped hosts (preview / staging) may name a hospital by slug — a mapped domain can't be overridden
    expect(await db.as('anon', `select id from public.resolve_tenant('preview.e2b.app', 'Third')`)).toEqual([{ id: C }])
    expect(await db.as('anon', `select id from public.resolve_tenant('cityhospital.in', 'third')`)).toEqual([{ id: B }])
    // visitors can't list hospitals or domains
    expect((await asH('anon', { 'x-tenant-id': B }, `select id from public.tenants`))).toHaveLength(1)
    await expect(db.as('anon', `select * from public.tenant_domains`)).rejects.toThrow(/permission denied/)
  })
})

describe('providers', () => {
  test('without a chosen hospital a provider sees nothing', async () => {
    for (const p of [P_ADMIN, P_SUPPORT, P_FINANCE]) {
      expect((await db.as(p, `select id from public.patients`))).toHaveLength(0)
      expect((await db.one<{ t: string | null }>(p, `select public.current_tenant() as t`)).t).toBeNull()
    }
  })

  test('support works only in assigned hospitals, as owner, but patient records are read-only', async () => {
    const h = { 'x-tenant-id': B }
    expect((await asH(P_SUPPORT, h, `select id from public.patients`)).length).toBe(2)
    expect((await asH(P_SUPPORT, { 'x-tenant-id': C }, `select id from public.tenants where id = $1`, [C]))).toHaveLength(0)
    expect((await asH<{ t: string | null }>(P_SUPPORT, { 'x-tenant-id': C }, `select public.current_tenant() as t`))[0].t).toBeNull()
    expect(await leaks(P_SUPPORT, A, { 'x-tenant-id': A })).toEqual({})
    // owner-level settings work…
    expect(await asH(P_SUPPORT, h, `update public.app_settings set data = '{"x":2}'::jsonb where key = 'app' returning key`)).toHaveLength(1)
    expect(await asH(P_SUPPORT, h, `update public.notices set title = 'Edited by support' returning id`)).toHaveLength(1)
    // …clinical records don't
    expect(await asH(P_SUPPORT, h, `update public.patients set phone = '9000000000' returning id`)).toHaveLength(0)
    await expect(asH(P_SUPPORT, h, `insert into public.patients (full_name, gender) values ('Nope', 'male')`)).rejects.toThrow(/row-level security/)
    expect(await asH(P_SUPPORT, h, `delete from public.appointments returning id`)).toHaveLength(0)
    const ctx = (await asH<{ c: { tenant: { id: string }; role: string; provider_role: string; provider_mode: string } }>(P_SUPPORT, h, `select public.my_context() as c`))[0].c
    expect(ctx.tenant.id).toBe(B); expect(ctx.role).toBe('owner'); expect(ctx.provider_mode).toBe('support')
    expect((await db.as<{ id: string }>(P_SUPPORT, `select id from public.provider_tenants()`)).map((r) => r.id)).toEqual([B])
  })

  test('finance acts as accountant: invoices yes, clinical and settings no', async () => {
    const h = { 'x-tenant-id': B }
    expect((await asH(P_FINANCE, h, `select id from public.invoices`)).length).toBe(1)
    expect(await asH(P_FINANCE, h, `update public.app_settings set data = '{}'::jsonb returning key`)).toHaveLength(0)
    expect((await asH(P_FINANCE, h, `select id from public.prescriptions`))).toHaveLength(0)
    expect((await asH<{ r: string }>(P_FINANCE, h, `select public.current_app_role()::text as r`))[0].r).toBe('accountant')
  })

  test('admin reaches every hospital and can pick a lower mode; providers write the audit log', async () => {
    expect((await asH(P_ADMIN, { 'x-tenant-id': A }, `select id from public.patients`)).length).toBeGreaterThan(50)
    expect((await asH<{ t: string }>(P_ADMIN, { 'x-tenant-id': C }, `select public.current_tenant() as t`))[0].t).toBe(C)
    expect((await db.as<{ id: string }>(P_ADMIN, `select id from public.provider_tenants()`)).length).toBe(3)
    // support mode → clinical read-only, like a support user
    expect(await asH(P_ADMIN, { 'x-tenant-id': B, 'x-provider-mode': 'support' }, `update public.patients set phone = '1' returning id`)).toHaveLength(0)
    expect(await asH(P_ADMIN, { 'x-tenant-id': B, 'x-provider-mode': 'finance' }, `select public.has_role('owner') as o`)).toEqual([{ o: false }])
    // a support user can't claim admin mode with a header
    expect((await asH<{ m: string }>(P_SUPPORT, { 'x-tenant-id': B, 'x-provider-mode': 'admin' }, `select public.provider_mode() as m`))[0].m).toBe('support')
    // only admins manage hospitals / providers
    await expect(asH(P_SUPPORT, { 'x-tenant-id': B }, `insert into public.tenants (slug, name) values ('x1', 'X')`)).rejects.toThrow(/row-level security/)
    expect(await asH(P_ADMIN, {}, `insert into public.tenants (slug, name) values ('new-clinic', 'New Clinic') returning slug`)).toEqual([{ slug: 'new-clinic' }])
    await asH(P_SUPPORT, { 'x-tenant-id': B }, `select public.provider_log('open_patient', 'patients/123')`)
    await asH(USER.owner, {}, `select public.provider_log('ignored for hospital users')`)
    const log = await db.as<{ user_name: string; mode: string; tenant_id: string; action: string }>(null, `select user_name, mode, tenant_id, action from public.provider_audit`)
    expect(log).toEqual([{ user_name: 'Provider support', mode: 'support', tenant_id: B, action: 'open_patient' }])
  })
})

// SECURITY DEFINER functions skip RLS, so each one filters by current_tenant() itself (phase 1.2)
describe('definer functions stay inside the hospital', () => {
  const B_DOC = 'b0d00000-0000-4000-8000-000000000001'
  beforeAll(async () => {
    await db.as(B_OWNER, `insert into public.doctors (id, full_name, specialization, available_days, shift) values ($1, 'Dr. City', 'General', '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}', 'morning')`, [B_DOC])
  })

  test('website doctors and availability are per hospital', async () => {
    const b = await asH<{ id: string }>('anon', { 'x-tenant-id': B }, `select id from public.public_doctors()`)
    expect(b.map((d) => d.id)).toEqual([B_DOC])
    const a = await asH<{ id: string }>('anon', {}, `select id from public.public_doctors()`)
    expect(a.length).toBeGreaterThan(5)
    expect(a.map((d) => d.id)).not.toContain(B_DOC)
    // a booking on A's website can't use B's doctor
    expect(await asH<{ p: string | null }>(null, {}, `select public.slot_problem($1, current_date + 3, '10:00', false) p`, [B_DOC]))
      .not.toEqual([{ p: null }])
  })

  test("an OTP from one hospital's website can't be verified or used on another", async () => {
    const phone = '9876577777'
    const [otp] = await asH<{ r: { ref: string } }>('anon', {}, `select public.request_booking_otp($1) r`, [phone])
    const code = await knownOtp(db, otp.r.ref)
    const [onB] = await asH<{ r: { ok: boolean } }>('anon', { 'x-tenant-id': B }, `select public.verify_booking_otp($1, $2) r`, [phone, code])
    expect(onB.r.ok).toBe(false)
    const [onA] = await asH<{ r: { ok: boolean; token: string } }>('anon', {}, `select public.verify_booking_otp($1, $2) r`, [phone, code])
    expect(onA.r.ok).toBe(true)
    await expect(asH('anon', { 'x-tenant-id': B }, `select public.public_book_appointment($1, $2, current_date + 3, '10:00', 'X Y', 'male', null, null, null)`,
      [onA.r.token, B_DOC])).rejects.toThrow(/OTP_REQUIRED/)
  })

  test("an owner can't manage another hospital's accounts", async () => {
    await expect(db.as(B_OWNER, `select public.admin_set_user_password($1, 'Hacked@1234')`, [USER.patient])).rejects.toThrow(/User not found/)
    await expect(db.as(B_OWNER, `select public.admin_set_user_active($1, false)`, [USER.doctor])).rejects.toThrow(/User not found/)
    await expect(db.as(B_OWNER, `select public.admin_update_user($1, 'Hacked', 'owner')`, [USER.staff])).rejects.toThrow(/User not found/)
    await expect(db.as(B_OWNER, `select public.admin_delete_user($1)`, [USER.receptionist])).rejects.toThrow(/User not found/)
    expect(await db.as(B_OWNER, `select * from public.admin_user_status($1::uuid[])`, [[USER.owner, B_PATIENT]])).toHaveLength(1)
    // and a new account made by B's owner joins B
    const [made] = await db.as<{ id: string }>(B_OWNER, `select public.admin_create_user('nurse@cityhospital.in', 'City Nurse', 'staff') id`)
    expect((await db.one<{ tenant_id: string; role: string }>(null, `select tenant_id, role from public.profiles where id = $1`, [made.id])))
      .toEqual({ tenant_id: B, role: 'staff' })
  })

  test("a staff invite only works on its own hospital's website", async () => {
    await db.as(USER.owner, `insert into public.staff_invites (full_name, email, role) values ('Sneaky Doc', 'sneaky@example.com', 'owner')`)
    const { token } = await db.one<{ token: string }>(null, `select token from public.staff_invites where email = 'sneaky@example.com'`)
    expect((await asH<{ r: { ok: boolean } }>('anon', { 'x-tenant-id': B }, `select public.invite_lookup($1) r`, [token]))[0].r.ok).toBe(false)
    const id = 'f0f00000-0000-4000-8000-000000000010'
    await signUp(id, 'sneaky@example.com', { full_name: 'Sneaky Doc', invite_token: token, tenant_id: B })
    expect(await db.one(null, `select tenant_id, role from public.profiles where id = $1`, [id])).toEqual({ tenant_id: B, role: 'patient' })
    expect((await db.one<{ status: string }>(null, `select status from public.staff_invites where token = $1`, [token])).status).toBe('pending')
  })

  test('message templates reach only their hospital; the cron runs every hospital, an owner only their own', async () => {
    await db.as(null, `update public.tenants set modules = modules || '{"notifications": "hospital"}' where id = $1`, [B])   // B runs its own messaging here
    const mk = async (who: string, name: string) => {
      const [t] = await db.as<{ id: string }>(who, `insert into public.notification_templates (name, text, audience, schedule, enabled) values ($1, 'Hello', 'everyone', 'daily', true) returning id`, [name])
      await db.as(null, `update public.notification_templates set next_run_at = now() - interval '1 minute' where id = $1`, [t.id])
      return t.id
    }
    const ta = await mk(USER.owner, 'A daily'), tb = await mk(B_OWNER, 'B daily')
    const names = await db.as<{ full_name: string }>(null, `select r.full_name from public.notification_templates t, public.notify_template_recipients(t) r where t.id = $1 order by 1`, [tb])
    expect(names.map((r) => r.full_name)).toEqual(['City Nurse', 'City Owner', 'Ravi Kumar', 'Sneaky Doc', 'Sunita Devi'])
    expect((await db.one<{ r: { total: number } }>(B_OWNER, `select public.notify_template_audience($1) r`, [ta])).r.total).toBe(0)
    await expect(db.as(B_OWNER, `select public.notify_send_template($1)`, [ta])).rejects.toThrow(/not found/)

    await db.as(B_OWNER, `select public.run_scheduled_notifications()`)
    const ran = async () => (await db.as<{ id: string }>(null, `select id from public.notification_templates where id = any ($1::uuid[]) and last_run_at is not null`, [[ta, tb]])).map((r) => r.id)
    expect(await ran()).toEqual([tb])
    await db.as(null, `update public.notification_templates set next_run_at = now() - interval '1 minute' where id = $1`, [tb])
    await db.as(null, `select public.run_scheduled_notifications()`)              // the cron job (no user)
    expect((await ran()).sort()).toEqual([ta, tb].sort())
    // whatever got queued sits under the template's own hospital
    const bad = await db.as(null, `select 1 from public.notification_outbox o join public.notification_templates t on o.event = 'tpl:' || t.id
                                   where t.id = any ($1::uuid[]) and o.tenant_id <> t.tenant_id`, [[ta, tb]])
    expect(bad).toEqual([])
    expect(await db.one<{ n: number }>(null, `select public.queue_appointment_reminders() n`)).toBeTruthy()
    await expect(db.as(B_OWNER, `select public.notify_cron_setup(false)`)).rejects.toThrow(/managed by the platform/)
    await db.as(null, `update public.tenants set modules = modules - 'notifications' where id = $1`, [B])
  })

  test('the WhatsApp bot only sees patients of the hospital it answers for', async () => {
    const [r] = await asH<{ p: unknown }>('service', { 'x-tenant-id': B }, `select public.bot_patient('9800000001') p`)
    expect(r.p).toMatchObject({ full_name: 'Sunita Devi' })
    const [a] = await asH<{ p: unknown }>('service', {}, `select public.bot_patient('9800000001') p`)
    expect(a.p).toBeNull()
  })

  test("the notify queue: a staff flush takes one hospital's messages, the scheduler all — suspended hospitals wait", async () => {
    await db.as(null, `update public.notification_outbox set status = 'skipped' where status in ('pending', 'sending')`)
    await db.as(null, `insert into public.notification_outbox (tenant_id, event, channel, recipient, body) values
      ($1, 'edge', 'sms', 'a-1', 'x'), ($2, 'edge', 'sms', 'b-1', 'x'), ($2, 'edge', 'sms', 'b-2', 'x'), ($3, 'edge', 'sms', 'c-1', 'x')`, [A, B, C])
    await db.as(null, `update public.tenants set status = 'suspended' where id = $1`, [C])
    try {
      const mine = await db.as<{ recipient: string; tenant_id: string }>('service', `select recipient, tenant_id from public.claim_notifications(25, $1) order by recipient`, [B])
      expect(mine.map((r) => r.recipient)).toEqual(['b-1', 'b-2'])
      const rest = await db.as<{ recipient: string }>('service', `select recipient from public.claim_notifications(25) order by recipient`)
      expect(rest.map((r) => r.recipient)).toEqual(['a-1'])          // B's are already taken; C is suspended
      await expect(db.as(B_OWNER, `select * from public.claim_notifications(25, $1)`, [B])).rejects.toThrow(/permission denied/)
    } finally {
      await db.as(null, `update public.tenants set status = 'active' where id = $1`, [C])
    }
    const [c] = await db.as<{ status: string }>(null, `select status from public.notification_outbox where recipient = 'c-1'`)
    expect(c.status).toBe('pending')
  })
})

// locked modules are hidden in the app AND refused by the database (phase 1.4)
describe('module locks', () => {
  const setModules = (m: Record<string, string>) => db.as(null, `update public.tenants set modules = $2::jsonb where id = $1`, [B, JSON.stringify(m)])
  const appData = async () => (await db.one<{ data: Record<string, unknown> }>(null, `select data from public.app_settings where tenant_id = $1 and key = 'app'`, [B])).data

  test('a new hospital: every module is managed by the platform until it is switched over', async () => {
    await setModules({})
    expect((await db.one<{ l: boolean }>(B_OWNER, `select public.module_locked('general') l`)).l).toBe(true)
    // the primary hospital (single installs) manages everything itself
    expect((await db.one<{ l: boolean }>(USER.owner, `select public.module_locked('general') l`)).l).toBe(false)
  })

  test("the owner's save keeps locked sections as they were; unlocked ones change", async () => {
    await setModules({ dashboard: 'hospital' })
    await db.as(null, `update public.app_settings set data = '{"appearance": {"theme": "teal"}, "dashboard": {"showGreeting": true}}'::jsonb where tenant_id = $1 and key = 'app'`, [B])
    await db.as(B_OWNER, `update public.app_settings set data = '{"appearance": {"theme": "rose"}, "dashboard": {"showGreeting": false}, "security": {"idleTimeoutMinutes": 1}}'::jsonb where key = 'app'`)
    expect(await appData()).toEqual({ appearance: { theme: 'teal' }, dashboard: { showGreeting: false } })
    // website settings row: billing & booking always belong to the owner, brand / contacts only when unlocked
    await db.as(B_OWNER, `insert into public.site_content (key, data) values ('settings', '{"name": "Renamed", "billing": {"gstin": "X"}}'::jsonb)`)
    expect((await db.one<{ data: unknown }>(null, `select data from public.site_content where tenant_id = $1 and key = 'settings'`, [B])).data).toEqual({ billing: { gstin: 'X' } })
    await expect(db.as(B_OWNER, `delete from public.site_content where key = 'settings'`)).rejects.toThrow(/MODULE_LOCKED/)
  })

  test('website pages, forms, message templates, credentials and demo tools refuse a locked hospital', async () => {
    await setModules({})
    await expect(db.as(B_OWNER, `update public.site_content set data = '{"name": "x"}'::jsonb where key = 'brand'`)).rejects.toThrow(/MODULE_LOCKED/)
    await expect(db.as(B_OWNER, `insert into public.site_forms (name, slug, fields) values ('Hack', 'hack', '[]'::jsonb)`)).rejects.toThrow(/MODULE_LOCKED/)
    await expect(db.as(B_OWNER, `insert into public.notification_templates (name, text) values ('Hi', 'Hello')`)).rejects.toThrow(/MODULE_LOCKED/)
    await expect(db.as(B_OWNER, `select public.set_app_secret('msg91_auth_key', 'abc')`)).rejects.toThrow(/MODULE_LOCKED/)
    // unlocked → allowed
    await setModules({ cms: 'hospital' })
    await db.as(B_OWNER, `update public.site_content set data = '{"name": "City Hospital+"}'::jsonb where key = 'brand'`)
  })

  test('the platform team is never locked out (support / admin modes)', async () => {
    await setModules({})
    await asH(P_SUPPORT, { 'x-tenant-id': B }, `update public.app_settings set data = data || '{"appearance": {"theme": "support"}}'::jsonb where key = 'app'`)
    expect((await appData()).appearance).toEqual({ theme: 'support' })
    await asH(P_ADMIN, { 'x-tenant-id': B, 'x-provider-mode': 'admin' }, `insert into public.notification_templates (name, text) values ('Platform', 'Hello')`)
    await setModules({})
  })
})

/**
 * Phase 7 — ops & compliance (scripts/sql/compliance.sql): patient privacy rights, offboarding + purge with
 * password re-confirmation, incident register, retention and system health.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'

let db: Db
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const B_PAT = 'b0b00000-0000-4000-8000-000000000002'
const B_PAT2 = 'b0b00000-0000-4000-8000-000000000004'
const C_OWNER = 'c0c00000-0000-4000-8000-000000000001'
const C_PAT = 'c0c00000-0000-4000-8000-000000000002'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'

async function asH<T = Record<string, unknown>>(who: string | null, headers: Record<string, string>, sql: string, params: unknown[] = [], claims?: Record<string, unknown>) {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)])
  if (claims) await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
  try { return await db.as<T>(who, sql, params) } finally {
    await db.query(`select set_config('request.headers', '', false)`)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
const one = async <T,>(who: string | null, sql: string, params: unknown[] = []) => (await db.as<T>(who, sql, params))[0]
const signUp = (id: string, email: string, meta: Record<string, unknown>) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify(meta)])
const asAdmin = <T = Record<string, unknown>>(sql: string, params: unknown[] = [], claims?: Record<string, unknown>) => asH<T>(P_ADMIN, { 'x-provider-mode': 'admin' }, sql, params, claims)
const asSupport = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => asH<T>(P_SUPPORT, {}, sql, params)
const now = () => Math.floor(Date.now() / 1000)

async function hospital(id: string, slug: string, code: string, owner: string, ownerEmail: string, patient: string, patientEmail: string) {
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan) values ($1, $2, $3, $4, 'clinic')`, [id, slug, `${slug} Hospital`, code])
  await signUp(owner, ownerEmail, { full_name: `${slug} Owner`, tenant_id: id })
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [owner])
  await db.as(null, `delete from public.patients where profile_id = $1`, [owner])
  await signUp(patient, patientEmail, { full_name: 'Ravi Kumar', tenant_id: id, phone: '9810012345' })
  await db.as(null, `update public.patients set phone = '9810012345' where profile_id = $1`, [patient])
  const n = structuredClone(DEFAULT_APP_SETTINGS.notifications)
  n.email.enabled = true
  await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($1, 'app', jsonb_build_object('notifications', $2::jsonb))
    on conflict (tenant_id, key) do update set data = excluded.data`, [id, JSON.stringify(n)])
}

beforeAll(async () => {
  db = await freshDb('master')
  await hospital(B, 'city', 'CTY', B_OWNER, 'owner@city.in', B_PAT, 'ravi@example.com')
  await signUp(B_PAT2, 'sita@example.com', { full_name: 'Sita Devi', tenant_id: B })
  await hospital(C, 'gone', 'GON', C_OWNER, 'owner@gone.in', C_PAT, 'mohan@example.com')
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
  await db.as(null, `insert into public.provider_assignments (user_id, tenant_id) values ($1, $2)`, [P_SUPPORT, B])
}, 240_000)

describe('7.1 privacy — the patient', () => {
  test('downloads everything held about them (logged as a fulfilled access request); other patients are not in it', async () => {
    const e = (await one<{ e: Record<string, any> }>(B_PAT, `select public.my_data_export() e`)).e
    expect(e.hospital).toBe('city Hospital')
    expect(e.account.email).toBe('ravi@example.com')
    expect(e.patient.full_name).toBe('Ravi Kumar')
    expect(e.patient.tenant_id).toBeUndefined()
    for (const k of ['appointments', 'prescriptions', 'lab_tests', 'invoices', 'payments']) expect(Array.isArray(e[k])).toBe(true)
    const reqs = await db.as<{ kind: string; status: string }>(B_PAT, `select kind, status from public.privacy_requests`)
    expect(reqs).toEqual([{ kind: 'access', status: 'done' }])
    expect(await db.as(B_PAT2, `select 1 from public.privacy_requests`)).toHaveLength(0)       // RLS: own only
  })

  test('says no to health tips & offers: logged, and custom messages to patients skip them', async () => {
    await one(B_PAT, `select public.set_marketing_consent(false)`)
    expect((await one<{ o: boolean }>(null, `select marketing_opt_out o from public.patients where profile_id = $1`, [B_PAT])).o).toBe(true)
    expect(await db.as<{ purpose: string; granted: boolean }>(B_PAT, `select purpose, granted from public.consent_log`)).toEqual([{ purpose: 'marketing', granted: false }])
    const { id } = await one<{ id: string }>(null, `insert into public.notification_templates (tenant_id, name, text, audience, schedule, enabled) values ($1, 'Tips', 'Drink water', 'patients', 'daily', false) returning id`, [B])
    const names = (await db.as<{ full_name: string }>(null, `select r.full_name from public.notification_templates t, public.notify_template_recipients(t) r where t.id = $1`, [id])).map((r) => r.full_name)
    expect(names).toContain('Sita Devi')
    expect(names).not.toContain('Ravi Kumar')
    await one(B_PAT, `select public.set_marketing_consent(true)`)
    await expect(db.as(B_OWNER, `select public.set_marketing_consent(true)`)).rejects.toThrow(/Only patients/)
  })

  test('asks for correction / erasure: one open request per kind, the owner is e-mailed, works on a read-only hospital too', async () => {
    await db.as(null, `update public.tenants set trial_ends_at = now() - interval '30 days' where id = $1`, [B])
    await expect(db.as(B_PAT, `select public.privacy_submit('correction', '')`)).rejects.toThrow(/what is wrong/)
    await one(B_PAT, `select public.privacy_submit('correction', 'My date of birth is 1990-05-01')`)
    await one(B_PAT, `select public.privacy_submit('erasure', null)`)
    await expect(db.as(B_PAT, `select public.privacy_submit('erasure')`)).rejects.toThrow(/already have an open erasure/)
    await expect(db.as(B_PAT, `select public.privacy_submit('delete_all')`)).rejects.toThrow(/correction or erasure/)
    // friendly errors, never a raw "null value in column" message
    await expect(db.as(B_PAT2, `select public.privacy_submit(null)`)).rejects.toThrow(/correction or erasure/)
    await expect(db.as(B_OWNER, `select public.privacy_submit('erasure')`)).rejects.toThrow(/Only patients/)
    const mail = await db.as<{ recipient: string; subject: string }>(null, `select recipient, subject from public.notification_outbox where event = 'privacy_request' order by created_at`)
    expect(mail.map((m) => m.recipient)).toEqual(['owner@city.in', 'owner@city.in'])
    expect(mail[1].subject).toContain('erasure')
    // the owner sees every request of the hospital, a patient only their own
    expect(await db.as(B_OWNER, `select 1 from public.privacy_requests where status = 'open'`)).toHaveLength(2)
    expect(await db.as(B_PAT2, `select 1 from public.privacy_requests`)).toHaveLength(0)
    await db.as(null, `update public.tenants set trial_ends_at = now() + interval '10 days' where id = $1`, [B])
  })
})

describe('7.1 privacy — the owner answers', () => {
  test('only the owner; a rejection needs a note; erasure anonymises the patient but keeps the medical record', async () => {
    const reqs = await db.as<{ id: string; kind: string }>(B_OWNER, `select id, kind from public.privacy_requests where status = 'open' order by kind`)
    const corr = reqs.find((r) => r.kind === 'correction')!.id, er = reqs.find((r) => r.kind === 'erasure')!.id
    await expect(db.as(B_PAT, `select public.privacy_resolve($1, 'done')`, [corr])).rejects.toThrow(/Only the owner/)
    await expect(db.as(B_OWNER, `select public.privacy_resolve($1, 'rejected', '')`, [corr])).rejects.toThrow(/Say why/)
    expect((await one<{ r: { status: string; resolution: string } }>(B_OWNER, `select public.privacy_resolve($1, 'done', 'Corrected') r`, [corr])).r).toMatchObject({ status: 'done', resolution: 'Corrected' })
    await expect(db.as(B_OWNER, `select public.privacy_resolve($1, 'done')`, [corr])).rejects.toThrow(/already answered/)

    const before = await one<{ id: string; mrn: string }>(null, `select id, mrn from public.patients where profile_id = $1`, [B_PAT])
    await one(B_OWNER, `select public.privacy_resolve($1, 'done', 'Erased as asked')`, [er])
    const p = await one<Record<string, any>>(null, `select * from public.patients where id = $1`, [before.id])
    expect(p.full_name).toBe(`Erased patient ${before.mrn}`)
    expect([p.phone, p.email, p.address, p.profile_id]).toEqual([null, null, null, null])
    expect(p.erased_at).toBeTruthy()
    expect(await db.as(null, `select 1 from auth.users where id = $1`, [B_PAT])).toHaveLength(0)
    // the audit trail no longer names them
    const logs = await db.as<{ summary: string; changes: string }>(null, `select summary, changes::text from public.audit_log where record_id = $1`, [before.id])
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.every((l) => !l.changes.includes('Ravi') && !l.summary.includes('Ravi'))).toBe(true)
    expect(logs.some((l) => l.changes.includes('erased'))).toBe(true)
  })
})

describe('7.3 offboarding', () => {
  test('admin closes a hospital (support cannot): read-only with the dates; reopen undoes it', async () => {
    await expect(asSupport(`select public.cp_close_hospital($1, 'x')`, [C])).rejects.toThrow(/admin/)
    await expect(asAdmin(`select public.cp_close_hospital($1, '', 30)`, [C])).rejects.toThrow(/reason/)
    await expect(asAdmin(`select public.cp_close_hospital($1, 'Moving on', 3)`, [C])).rejects.toThrow(/7 to 90/)
    await expect(asAdmin(`select public.cp_close_hospital($1, 'x')`, [A])).rejects.toThrow(/own hospital/)
    await asAdmin(`select public.cp_close_hospital($1, 'Owner moving to other software', 30)`, [C])
    expect((await one<{ s: string }>(null, `select public.tenant_license($1) s`, [C])).s).toBe('read_only')
    const d = (await one<{ d: Record<string, string> }>(null, `select public.tenant_license_dates($1) d`, [C])).d
    expect(d.closing_at).toBeTruthy(); expect(d.purge_after).toBeTruthy()
    expect((await db.as<{ recipient: string }>(null, `select recipient from public.notification_outbox where event = 'hospital_closing'`)).map((r) => r.recipient)).toEqual(['owner@gone.in'])
    await asAdmin(`select public.cp_reopen_hospital($1)`, [C])
    expect((await one<{ s: string }>(null, `select public.tenant_license($1) s`, [C])).s).toBe('active')
    await asAdmin(`select public.cp_close_hospital($1, 'Owner moving to other software', 30)`, [C])
  })

  test('purge: only after the notice period, with a fresh password and the short name; keeps a tombstone + invoices; other hospitals untouched', async () => {
    // some real data with RESTRICT foreign keys between the rows
    const pat = await one<{ id: string }>(null, `select id from public.patients where profile_id = $1`, [C_PAT])
    const doc = await one<{ id: string }>(null, `insert into public.doctors (tenant_id, full_name, specialization) values ($1, 'Dr Gone', 'GP') returning id`, [C])
    await db.as(null, `insert into public.appointments (tenant_id, patient_id, doctor_id, appointment_date, appointment_time, status) values ($1, $2, $3, current_date - 3, '10:00', 'completed')`, [C, pat.id, doc.id])
    const inv = await one<{ id: string }>(null, `insert into public.invoices (tenant_id, invoice_number, patient_id, total, status) values ($1, 'GON-INV-1', $2, 500, 'unpaid') returning id`, [C, pat.id])
    await db.as(null, `insert into public.payments (tenant_id, invoice_id, patient_id, amount, method) values ($1, $2, $3, 500, 'cash')`, [C, inv.id, pat.id])
    await db.as(null, `insert into public.billing_payments (tenant_id, kind, plan, months, base_paise, gst_paise, total_paise, provider, status, invoice_no, paid_at)
      values ($1, 'plan', 'clinic', 1, 99900, 17982, 117882, 'manual', 'paid', 'HC/2026-27/000777', now())`, [C])
    const aBefore = Number((await one<{ n: number }>(null, `select count(*) n from public.patients where tenant_id = $1`, [A])).n)

    const fresh = { sub: P_ADMIN, amr: [{ method: 'password', timestamp: now() - 30 }] }
    await expect(asAdmin(`select public.cp_purge_hospital($1, 'gone')`, [C], fresh)).rejects.toThrow(/can export its data until/)
    await db.as(null, `update public.tenants set purge_after = now() - interval '1 minute' where id = $1`, [C])
    await expect(asAdmin(`select public.cp_purge_hospital($1, 'gone')`, [C])).rejects.toThrow(/REAUTH_REQUIRED/)
    await expect(asAdmin(`select public.cp_purge_hospital($1, 'gone')`, [C], { sub: P_ADMIN, amr: [{ method: 'password', timestamp: now() - 3600 }] })).rejects.toThrow(/REAUTH_REQUIRED/)
    await expect(asAdmin(`select public.cp_purge_hospital($1, 'GONE!')`, [C], fresh)).rejects.toThrow(/short name/)
    await expect(asSupport(`select public.cp_purge_hospital($1, 'gone')`, [C])).rejects.toThrow(/admin/)

    const r = (await (asAdmin<{ r: { purged: string; counts: Record<string, number> } }>(`select public.cp_purge_hospital($1, 'gone') r`, [C], fresh)))[0].r
    expect(r.purged).toBe('gone')
    expect(r.counts).toMatchObject({ patients: 1, appointments: 1, invoices: 1, payments: 1, billing_payments: 1 })
    expect(await db.as(null, `select 1 from public.tenants where id = $1`, [C])).toHaveLength(0)
    expect(await db.as(null, `select 1 from auth.users where id in ($1, $2)`, [C_OWNER, C_PAT])).toHaveLength(0)
    expect(await db.as(null, `select 1 from public.patients where tenant_id = $1`, [C])).toHaveLength(0)
    const tomb = await one<{ slug: string; billing: { invoice_no: string }[] }>(null, `select slug, billing from public.tenant_purges where hospital_id = $1`, [C])
    expect(tomb.slug).toBe('gone')
    expect(tomb.billing.map((b) => b.invoice_no)).toEqual(['HC/2026-27/000777'])
    expect(await db.as(null, `select 1 from public.provider_audit where action = 'hospital:purge' and tenant_id = $1`, [C])).toHaveLength(1)
    expect(Number((await one<{ n: number }>(null, `select count(*) n from public.patients where tenant_id = $1`, [A])).n)).toBe(aBefore)
    expect(await db.as(null, `select 1 from public.tenants where id = $1`, [B])).toHaveLength(1)
  })
})

describe('7.4 incident register', () => {
  test('admin records, updates (timeline) and notifies the affected owners; support reads; hospitals cannot see it', async () => {
    const i = (await asAdmin<{ i: { id: string; status: string } }>(`select public.cp_save_incident($1::jsonb) i`,
      [JSON.stringify({ title: 'Lost laptop with an export', severity: 'high', personal_data: true, affected_tenants: [B], affected_people: 40 })]))[0].i
    expect(i.status).toBe('open')
    await expect(asSupport(`select public.cp_save_incident('{"title": "nope"}'::jsonb)`)).rejects.toThrow(/admin/)
    await asAdmin(`select public.cp_save_incident($1::jsonb)`, [JSON.stringify({ id: i.id, status: 'contained', note: 'Laptop wiped remotely', board_reported: true })])
    const list = (await asSupport<{ l: any[] }>(`select public.cp_incidents() l`))[0].l
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ status: 'contained', hospitals: [{ id: B, slug: 'city' }] })
    expect(list[0].board_reported_at).toBeTruthy()
    expect(Date.parse(list[0].deadline) - Date.parse(list[0].detected_at)).toBe(72 * 3600_000)
    expect(list[0].timeline.map((t: any) => t.note)).toEqual(['Incident recorded', 'Status: contained — Laptop wiped remotely'])
    await expect(asAdmin(`select public.cp_notify_incident($1, '')`, [i.id])).rejects.toThrow(/Write the notice/)
    const n = (await asAdmin<{ n: any[] }>(`select public.cp_notify_incident($1, 'On 1 Oct a laptop…') n`, [i.id]))[0].n
    expect(n).toEqual([{ id: B, name: 'city Hospital', owner_email: 'owner@city.in', queued: 1 }])
    expect(await db.as(null, `select 1 from public.notification_outbox where event = 'incident_notice' and recipient = 'owner@city.in'`)).toHaveLength(1)
    await expect(db.as(B_OWNER, `select public.cp_incidents()`)).rejects.toThrow(/Hospital Comrade team/)
    await expect(db.as(B_OWNER, `select * from public.platform_incidents`)).rejects.toThrow(/permission denied/)
  })
})

describe('7.6 retention', () => {
  test('deletes what is past its keep-by date, never below the minimums; settings validated; owners cannot run it', async () => {
    await db.as(null, `insert into public.audit_log (tenant_id, table_name, record_id, action, actor_name, actor_role, summary, changes, created_at)
      values ($1, 'patients', gen_random_uuid(), 'update', 'x', 'system', 'old', '{}', now() - interval '4 years'),
             ($1, 'patients', gen_random_uuid(), 'update', 'x', 'system', 'recent', '{}', now() - interval '200 days')`, [B])
    await db.as(null, `insert into public.booking_otps (tenant_id, phone, code_hash, expires_at, created_at) select $1, '9810000000', 'h', now() - interval '9 days', now() - interval '10 days'`, [B]).catch(async () => {
      await db.as(null, `insert into public.booking_otps (tenant_id, phone, expires_at, created_at) values ($1, '9810000000', now() - interval '9 days', now() - interval '10 days')`, [B])
    })
    await expect(db.as(B_OWNER, `select public.run_retention()`)).rejects.toThrow(/Not allowed|permission denied/)
    const r = (await one<{ r: Record<string, number> }>('service', `select public.run_retention() r`)).r
    expect(r.audit_log).toBeGreaterThanOrEqual(1)
    expect(r.booking_otps).toBeGreaterThanOrEqual(1)
    expect(await db.as(null, `select 1 from public.audit_log where summary = 'recent'`)).toHaveLength(1)
    expect(await db.as(null, `select 1 from public.audit_log where summary = 'old'`)).toHaveLength(0)
    await expect(asAdmin(`select public.cp_save_retention('{"auditDays": 100}'::jsonb)`)).rejects.toThrow(/at least 365/)
    await expect(asAdmin(`select public.cp_save_retention('{"foo": 100}'::jsonb)`)).rejects.toThrow(/Unknown setting/)
    expect((await asAdmin<{ c: Record<string, number> }>(`select public.cp_save_retention('{"outboxDays": 200}'::jsonb) c`))[0].c.outboxDays).toBe(200)
    const health = (await asAdmin<{ h: any }>(`select public.cp_health() h`))[0].h
    expect(health.retention.deleted.audit_log).toBeGreaterThanOrEqual(1)
  })
})

describe('7.5 system health', () => {
  test('admin sees every hospital and the database; support only assigned hospitals; hospitals none', async () => {
    await db.as(null, `insert into public.notification_outbox (tenant_id, event, channel, recipient, body, status, error) values ($1, 'x', 'sms', '9810000000', 'b', 'failed', 'Bad key')`, [B])
    const h = (await asAdmin<{ h: any }>(`select public.cp_health() h`))[0].h
    expect(h.extensions).toEqual({ pg_cron: false, pg_net: false })
    expect(h.hospitals.map((x: any) => x.id)).toEqual(expect.arrayContaining([A, B]))
    expect(h.messages.find((m: any) => m.id === B)).toMatchObject({ failed: expect.any(Number) })
    expect(h.recent_failures[0]).toMatchObject({ hospital: 'city Hospital', error: 'Bad key' })
    expect(h.incidents_open).toBe(1)
    const s = (await asSupport<{ h: any }>(`select public.cp_health() h`))[0].h
    expect(s.hospitals.map((x: any) => x.id)).toEqual([B])
    expect(s.database.largest_tables).toEqual([])
    await expect(db.as(B_OWNER, `select public.cp_health()`)).rejects.toThrow(/Hospital Comrade team/)
  })
})

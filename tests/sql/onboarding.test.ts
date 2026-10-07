/**
 * Going multi-hospital on a fresh production.sql: the snippets in supabase/snippets/ run exactly as shipped (they are
 * what the platform team pastes into the SQL editor until the provider panel exists), then a hospital's owner signs
 * up, patients sign up, its website form works — and nothing crosses over to the first hospital.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'
import { DEFAULT_FORMS } from '../../src/forms/schema'

const snippet = (n: string) => readFileSync(resolve(__dirname, `../../supabase/snippets/${n}.sql`), 'utf8')
const PRIMARY = 'a0000000-0000-4000-8000-000000000001'
const ids = { mainOwner: '1e000000-0000-4000-8000-000000000001', cityOwner: '1e000000-0000-4000-8000-000000000002', cityPatient: '1e000000-0000-4000-8000-000000000003', support: '1e000000-0000-4000-8000-000000000004', sneaky: '1e000000-0000-4000-8000-000000000005' }

let db: Db
let CITY: string
const signUp = (id: string, email: string, tenant?: string) => db.as(null,
  `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`,
  [id, email, JSON.stringify({ full_name: email.split('@')[0], ...(tenant ? { tenant_id: tenant } : {}) })])
/** a website visitor / signed-in user on a hospital's address (the app sends x-tenant-id after resolve_tenant) */
async function on<T = Record<string, unknown>>(tenant: string, who: string | null, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-tenant-id': tenant })])
  try { return await db.as<T>(who, sql, params) } finally { await db.query(`select set_config('request.headers', '', false)`) }
}
const profile = (id: string) => db.one<{ role: string; tenant_id: string | null }>(null, `select role, tenant_id from public.profiles where id = $1`, [id])

beforeAll(async () => {
  db = await freshDb('production')
  await signUp(ids.mainOwner, 'owner@your-hospital.in')               // production.sql's bootstrap e-mail
  await db.exec(snippet('add-hospital'))
  CITY = (await db.one<{ id: string }>(null, `select id from public.tenants where slug = 'citycare'`)).id
}, 120_000)

describe('supabase/snippets/add-hospital.sql', () => {
  test('creates the hospital, its address and its starting point', async () => {
    expect(await db.one(null, `select name, code, plan, status, is_primary from public.tenants where id = $1`, [CITY]))
      .toEqual({ name: 'City Care Clinic', code: 'CCC', plan: 'clinic', status: 'trial', is_primary: false })
    const [r] = await db.as<{ id: string }>('anon', `select id from public.resolve_tenant('citycare.hospital.digitalcomrade.in')`)
    expect(r.id).toBe(CITY)
    const forms = await db.as<{ slug: string }>(null, `select slug from public.site_forms where tenant_id = $1 order by sort`, [CITY])
    expect(forms.map((f) => f.slug).sort()).toEqual(DEFAULT_FORMS.map((f) => f.slug).sort())
    const [site] = await on<{ data: { name: string } }>(CITY, 'anon', `select data from public.site_content where key = 'settings'`)
    expect(site.data).toMatchObject({ name: 'City Care Clinic', phone: '', email: '', billing: { legalName: 'City Care Clinic', gstin: '', pan: '', upiId: '' } })
    // the first hospital keeps its own forms (ids unchanged) and its owner
    expect((await profile(ids.mainOwner))).toEqual({ role: 'owner', tenant_id: PRIMARY })
    expect(Number((await db.one<{ n: string }>(null, `select count(*) n from public.site_forms where tenant_id = $1`, [PRIMARY])).n)).toBe(DEFAULT_FORMS.length)
  })

  test("the owner e-mail becomes that hospital's owner; others become its patients", async () => {
    await signUp(ids.sneaky, 'owner@citycare.in'.replace('owner', 'not-owner'), CITY)
    await signUp(ids.cityOwner, 'owner@citycare.in', CITY)
    await signUp(ids.cityPatient, 'ravi@example.com', CITY)
    expect(await profile(ids.cityOwner)).toEqual({ role: 'owner', tenant_id: CITY })
    expect(await profile(ids.sneaky)).toEqual({ role: 'patient', tenant_id: CITY })
    expect(await profile(ids.cityPatient)).toEqual({ role: 'patient', tenant_id: CITY })
    const [p] = await db.as<{ mrn: string }>(null, `select mrn from public.patients where profile_id = $1`, [ids.cityPatient])
    expect(p.mrn).toMatch(/^CCC-\d+$/)
    // the owner's e-mail only counts on its own hospital (a second "owner" there stays a patient)
    expect(await db.as(ids.cityOwner, `select 1 from public.patients where profile_id = $1`, [ids.cityOwner])).toHaveLength(0)
  })

  test("its website's Contact form files enquiries with that hospital only", async () => {
    const [form] = await on<{ id: string }>(CITY, 'anon', `select id from public.site_forms where slug = 'contact' and enabled`)
    const contact = DEFAULT_FORMS.find((f) => f.slug === 'contact')!
    expect(form.id).not.toBe(contact.id)                                   // its own copy
    const answers = Object.fromEntries((contact.fields as { id: string; type: string; required?: boolean; options?: string[] }[])
      .map((f) => [f.id, f.type === 'consent' ? true : f.type === 'email' ? 'a@b.in' : f.type === 'phone' ? '9876543210' : f.type === 'date' ? '2026-12-01'
        : f.type === 'checkboxes' ? (f.options ?? []).slice(0, 1) : f.options?.[0] ?? (f.type === 'rating' ? 5 : 'Hello there, need help')]))
    await on(CITY, 'anon', `select public.submit_site_form($1, $2::jsonb)`, [form.id, JSON.stringify(answers)])
    expect(await db.as(ids.cityOwner, `select 1 from public.site_enquiries`)).toHaveLength(1)
    expect(await db.as(ids.mainOwner, `select 1 from public.site_enquiries`)).toHaveLength(0)
    // and the first hospital's form id can't be used from the other hospital's site
    await expect(on(CITY, 'anon', `select public.submit_site_form($1, $2::jsonb)`, [contact.id, JSON.stringify(answers)])).rejects.toThrow(/not available/)
  })

  test('running it twice is refused (the hospital exists) and seeding again changes nothing', async () => {
    await expect(db.exec(snippet('add-hospital'))).rejects.toThrow(/duplicate|unique/i)
    await db.as(null, `select public.seed_hospital_defaults($1)`, [CITY])
    expect(Number((await db.one<{ n: string }>(null, `select count(*) n from public.site_forms where tenant_id = $1`, [CITY])).n)).toBe(DEFAULT_FORMS.length)
    await expect(db.as(ids.cityOwner, `select public.seed_hospital_defaults($1)`, [CITY])).rejects.toThrow(/permission denied/)
  })
})

describe('supabase/snippets/add-provider.sql', () => {
  test('a signed-up account becomes a support provider for its hospitals only', async () => {
    await signUp(ids.support, 'support@hospitalcomrade.in', CITY)
    await db.exec(snippet('add-provider'))
    expect(await profile(ids.support)).toEqual({ role: 'patient', tenant_id: null })
    expect(await db.as(null, `select 1 from public.patients where profile_id = $1`, [ids.support])).toHaveLength(0)
    const [inCity] = await on<{ c: Record<string, unknown> }>(CITY, ids.support, `select public.my_context() c`)
    expect(inCity.c).toMatchObject({ role: 'owner', provider_role: 'support', tenant: { id: CITY } })
    const [inMain] = await on<{ c: Record<string, unknown> }>(PRIMARY, ids.support, `select public.my_context() c`)
    expect(inMain.c).toMatchObject({ tenant: null, provider_role: 'support' })
    // reads City's patients, can't change them
    expect((await on<{ full_name: string }>(CITY, ids.support, `select full_name from public.patients`)).length).toBeGreaterThan(0)
    await expect(on(CITY, ids.support, `update public.patients set full_name = 'X' where profile_id = $1`, [ids.cityPatient]).then(async () =>
      (await db.one<{ full_name: string }>(null, `select full_name from public.patients where profile_id = $1`, [ids.cityPatient])).full_name)).resolves.not.toBe('X')
  })
})

/**
 * The in-place upgrade (supabase/upgrade-2026-10.sql) on real databases from older releases (fixtures = the
 * production.sql those releases shipped). After the upgrade — run twice, as people do — the database must be
 * exactly a fresh install: same functions (source + SECURITY DEFINER + settings), grants, policies, triggers,
 * columns, constraints, RLS and indexes. And the hospital's data must survive and work in a multi-hospital world.
 *
 * Oldest supported: 50dd18e (September 2026, WhatsApp bot + feedback). Older databases: export, fresh install, import.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

const UPGRADE = readFileSync(resolve(__dirname, '../../supabase/upgrade-2026-10.sql'), 'utf8')
const fixture = (c: string) => gunzipSync(readFileSync(resolve(__dirname, `fixtures/production-${c}.sql.gz`))).toString('utf8')
const PRIMARY = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'

const SNAPSHOT: Record<string, string> = {
  functions: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' k,
                     md5(p.prosrc) || ' definer=' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '') v
                from pg_proc p where p.pronamespace = 'public'::regnamespace`,
  'function grants': `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' k,
                     'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute') v
                from pg_proc p where p.pronamespace = 'public'::regnamespace`,
  policies: `select tablename || '.' || policyname k, cmd || ' ' || permissive || ' ' || array_to_string(roles, ',') || ' ' || coalesce(qual, '') || ' / ' || coalesce(with_check, '') v
               from pg_policies where schemaname in ('public', 'storage')`,
  triggers: `select c.relname || '.' || t.tgname k, pg_get_triggerdef(t.oid) v from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and not t.tgisinternal`,
  columns: `select table_name || '.' || column_name k, data_type || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, '') v
              from information_schema.columns where table_schema = 'public'`,
  constraints: `select conrelid::regclass::text || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) k, '' v from pg_constraint where connamespace = 'public'::regnamespace`,
  rls: `select relname k, relrowsecurity::text v from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
  'table grants': `select table_name || ':' || grantee k, string_agg(privilege_type, ',' order by privilege_type) v from information_schema.role_table_grants
                    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') group by 1`,
  indexes: `select indexname k, indexdef v from pg_indexes where schemaname = 'public'`,
}
type Snap = Record<string, Map<string, string>>
async function snapshot(db: Db): Promise<Snap> {
  const out: Snap = {}
  for (const [name, q] of Object.entries(SNAPSHOT)) out[name] = new Map((await db.query<{ k: string; v: string }>(q)).rows.map((r) => [r.k, r.v]))
  return out
}
/** human-readable differences (empty = identical) */
function diff(fresh: Snap, upgraded: Snap) {
  const out: string[] = []
  for (const name of Object.keys(fresh)) {
    for (const k of fresh[name].keys()) if (!upgraded[name].has(k)) out.push(`${name}: missing ${k}`)
    for (const k of upgraded[name].keys()) if (!fresh[name].has(k)) out.push(`${name}: extra ${k}`)
    for (const [k, v] of fresh[name]) if (upgraded[name].has(k) && upgraded[name].get(k) !== v) out.push(`${name}: different ${k}`)
  }
  return out
}

let fresh: Snap
beforeAll(async () => { fresh = await snapshot(await freshDb('production')) }, 120_000)

describe.each(['50dd18e', '5d7a225'])('upgrading a database from %s', (release) => {
  test('runs twice and ends up identical to a fresh install', async () => {
    const db = await freshDb({ sql: fixture(release) })
    await db.exec(UPGRADE)
    await db.exec(UPGRADE)
    expect(diff(fresh, await snapshot(db))).toEqual([])
  }, 120_000)
})

describe('a live hospital upgraded to multi-hospital', () => {
  let db: Db
  const OWNER = '0e000000-0000-4000-8000-000000000001'
  const B_OWNER = '0e000000-0000-4000-8000-000000000002'
  const signUp = (id: string, email: string, meta: Record<string, unknown> = {}) => db.as(null,
    `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify({ full_name: email, ...meta })])
  const count = async (t: string) => Number((await db.one<{ n: string }>(null, `select count(*) n from public.${t}`)).n)

  beforeAll(async () => {
    // the release before multi-hospital, with a hospital already running on it
    db = await freshDb({ sql: fixture('5d7a225') })
    await signUp(OWNER, 'owner@your-hospital.in')                       // the bootstrap e-mail becomes the owner
    await db.as(OWNER, `insert into public.departments (name) values ('Cardiology'), ('Orthopaedics')`)
    await db.as(OWNER, `insert into public.doctors (full_name, email, specialization, consultation_fee, status) values ('Dr. Old Timer', 'old@h.in', 'Cardiology', 500, 'active')`)
    for (let i = 1; i <= 3; i++) await db.as(OWNER, `insert into public.patients (mrn, full_name, phone, gender) values ('', $1, $2, 'male')`, [`Patient ${i}`, `98000000${i}0`])
    await db.as(OWNER, `insert into public.app_settings (key, data) values ('app', '{"general":{"name":"Old Hospital"}}'::jsonb) on conflict (key) do update set data = excluded.data`)
    await db.as(OWNER, `select public.set_app_secret('openwa_api_key', 'old-secret-key')`)
    await db.as(null, `insert into public.notification_outbox (event, channel, recipient, body) values ('appointment_booked', 'sms', '9800000010', 'hi')`)
    await db.as(null, `insert into public.wa_sessions (phone, state) values ('9800000010', '{"step":"menu"}'::jsonb)`)

    const before = { patients: await count('patients'), doctors: await count('doctors'), outbox: await count('notification_outbox') }
    await db.exec(UPGRADE)
    expect({ patients: await count('patients'), doctors: await count('doctors'), outbox: await count('notification_outbox') }).toEqual(before)
  }, 120_000)

  test('every existing row now belongs to the primary hospital; numbering and settings carry on', async () => {
    for (const t of ['profiles', 'departments', 'doctors', 'patients', 'app_settings', 'app_secrets', 'notification_outbox', 'wa_sessions']) {
      const rows = await db.as<{ tenant_id: string | null }>(null, `select distinct tenant_id from public.${t}`)
      expect(rows.map((r) => r.tenant_id), t).toEqual([PRIMARY])
    }
    const mrns = (await db.as<{ mrn: string }>(OWNER, `select mrn from public.patients order by mrn`)).map((r) => r.mrn)
    expect(mrns).toHaveLength(3)
    await db.as(OWNER, `insert into public.patients (mrn, full_name, phone, gender) values ('', 'Patient 4', '9800000040', 'female')`)
    const [next] = await db.as<{ mrn: string }>(OWNER, `select mrn from public.patients where full_name = 'Patient 4'`)
    expect(next.mrn > mrns[2]).toBe(true)                                            // continues after the old numbers
    expect(new Set([...mrns, next.mrn]).size).toBe(4)
    const [ctx] = await db.as<{ c: { role: string; tenant: { id: string } } }>(OWNER, `select public.my_context() c`)
    expect(ctx.c).toMatchObject({ role: 'owner', tenant: { id: PRIMARY } })
    const [st] = await db.as<{ s: { key: string }[] }>(OWNER, `select public.app_secret_status() s`)
    expect(JSON.stringify(st.s)).toContain('openwa_api_key')
  })

  test('a second hospital added afterwards sees none of it, and the reverse', async () => {
    await db.as(null, `insert into public.tenants (id, slug, name, code) values ($1, 'second', 'Second Hospital', 'SEC')`, [B])
    await signUp(B_OWNER, 'owner@second.in', { tenant_id: B })
    await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
    await db.as(null, `delete from public.patients where profile_id = $1`, [B_OWNER])
    await db.as(B_OWNER, `insert into public.patients (mrn, full_name, phone, gender) values ('', 'B Patient', '9811111111', 'female')`)

    expect((await db.as<{ full_name: string }>(B_OWNER, `select full_name from public.patients`)).map((r) => r.full_name)).toEqual(['B Patient'])
    expect((await db.as(B_OWNER, `select 1 from public.doctors`))).toHaveLength(0)
    expect((await db.as(OWNER, `select 1 from public.patients where full_name = 'B Patient'`))).toHaveLength(0)
    // the website and the bot of each hospital
    await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-tenant-id': B })])
    try {
      expect(await db.as('anon', `select * from public.public_doctors()`)).toHaveLength(0)
      const [p] = await db.as<{ p: unknown }>('service', `select public.bot_patient('9800000010') p`)
      expect(p.p).toBeNull()
    } finally { await db.query(`select set_config('request.headers', '', false)`) }
    expect((await db.as<{ full_name: string }>('anon', `select full_name from public.public_doctors()`)).map((d) => d.full_name)).toEqual(['Dr. Old Timer'])
    // the old pending message is the primary hospital's
    expect(await db.as('service', `select * from public.claim_notifications(25, $1)`, [B])).toHaveLength(0)
    expect((await db.as<{ recipient: string }>('service', `select recipient from public.claim_notifications(25, $1)`, [PRIMARY])).map((r) => r.recipient)).toEqual(['9800000010'])
  })
})

describe('internal helpers are not callable from the API (fresh and upgraded)', () => {
  test.each(['master', 'production', 'upgraded'] as const)('%s', async (kind) => {
    const db = kind === 'upgraded' ? await freshDb({ sql: fixture('5d7a225') }) : await freshDb(kind)
    if (kind === 'upgraded') await db.exec(UPGRADE)
    const open = await db.as<{ f: string }>(null, `select p.proname f from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('tenant_secret', 'tenant_setting', 'tenant_content', 'ensure_tenant_columns', 'claim_notifications', 'claim_notifications_for', 'notify_cron_flush')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)
    expect(open.map((r) => r.f)).toEqual([])
    // and through the API: a signed-in patient can't read the hospital's credentials
    await expect(db.as('anon', `select public.tenant_secret('openwa_api_key')`)).rejects.toThrow(/permission denied/)
  }, 120_000)
})

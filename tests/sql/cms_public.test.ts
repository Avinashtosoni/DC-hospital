/** Public CMS RPC sanitization and tenant-scoped site-media Storage policies. */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

let db: Db
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'

async function asTenant<T = Record<string, unknown>>(who: string | null, tenant: string, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-tenant-id': tenant })])
  try { return await db.as<T>(who, sql, params) } finally { await db.query(`select set_config('request.headers', '', false)`) }
}
const fails = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re)

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.tenants (id, slug, name, code) values ($1, 'cms-clinic', 'CMS Clinic', 'CMS')`, [B])
  await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'owner@cmsclinic.in', 'x', $2::jsonb)`, [B_OWNER, JSON.stringify({ full_name: 'CMS Owner', tenant_id: B })])
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
  await db.as(null, `delete from public.patients where profile_id = $1`, [B_OWNER])
}, 180_000)

describe('public CMS content', () => {
  test('public reads redact billing and hidden content; editors keep full tenant-scoped rows', async () => {
    const data = {
      name: 'DC Hospital',
      billing: { gstin: '27AAAAA0000A1Z5', pan: 'AAAAA0000A', upiId: 'private@upi' },
      nested: { visible: 'public', hiddenBlock: { hidden: true, text: 'not public' } },
    }
    const packages = { title: 'Plans', items: [
      { name: 'Visible plan', price: 10 }, { name: 'Hidden plan', price: 20, hidden: true }, { name: 'Visible plan 2', price: 30 },
    ] }
    await db.as(null, `insert into public.site_content (tenant_id, key, data) values
      ($1, 'settings', $2::jsonb), ($1, 'packages', $3::jsonb), ($4, 'settings', '{"name":"CMS Clinic","billing":{"gstin":"B-PAN-UPI"}}'::jsonb)
      on conflict (tenant_id, key) do update set data = excluded.data`,
      [A, JSON.stringify(data), JSON.stringify(packages), B])

    const publicA = await db.as<{ key: string; data: any }>('anon', `select key, data from public.public_site_content() where key in ('settings', 'packages') order by key`)
    const settings = publicA.find((r) => r.key === 'settings')!.data
    expect(settings).toMatchObject({ name: 'DC Hospital', nested: { visible: 'public' } })
    expect(settings).not.toHaveProperty('billing')
    expect(settings.nested).not.toHaveProperty('hiddenBlock')
    const publicPackages = publicA.find((r) => r.key === 'packages')!.data
    expect(publicPackages.items).toEqual([
      { name: 'Visible plan', price: 10 }, { hidden: true }, { name: 'Visible plan 2', price: 30 },
    ])
    expect(JSON.stringify(publicA)).not.toContain('27AAAAA0000A1Z5')
    expect(JSON.stringify(publicA)).not.toContain('AAAAA0000A')
    expect(JSON.stringify(publicA)).not.toContain('private@upi')
    await fails(db.as('anon', `select * from public.site_content`), /permission denied/)

    const editableA = await db.as<{ key: string; data: any }>(USER.owner, `select key, data from public.public_site_content() order by key`)
    expect(editableA.find((r) => r.key === 'settings')!.data.billing).toEqual(data.billing)
    expect(editableA.find((r) => r.key === 'packages')!.data.items[1].name).toBe('Hidden plan')

    const publicB = await asTenant<{ key: string; data: any }>('anon', B, `select key, data from public.public_site_content() where key = 'settings'`)
    expect(publicB).toEqual([{ key: 'settings', data: { name: 'CMS Clinic' } }])
    const editableB = await asTenant<{ key: string; data: any }>(B_OWNER, B, `select key, data from public.public_site_content() where key = 'settings'`)
    expect(editableB[0].data.billing).toEqual({ gstin: 'B-PAN-UPI' })
  })
})

describe('tenant-scoped site media', () => {
  test('new UUID folders are isolated; the primary hospital can still manage root-level legacy files', async () => {
    await db.as(null, `grant select, insert, update, delete on storage.objects to anon, authenticated`)
    expect((await db.one<{ public: boolean }>(null, `select public from storage.buckets where id = 'site-media'`)).public).toBe(true)

    // Simulate a file that predates tenant folders; new client uploads must use a UUID prefix.
    await db.as(null, `insert into storage.objects (bucket_id, name, owner) values ('site-media', 'legacy.webp', $1)`, [USER.owner])
    await fails(db.as(USER.owner, `insert into storage.objects (bucket_id, name, owner) values ('site-media', 'new-root.webp', $1)`, [USER.owner]), /row-level security/)
    await db.as(USER.owner, `update storage.objects set name = 'legacy-renamed.webp' where bucket_id = 'site-media' and name = 'legacy.webp'`)
    await db.as(USER.owner, `insert into storage.objects (bucket_id, name, owner) values ('site-media', $1 || '/new.webp', $2)`, [A, USER.owner])
    await db.as(B_OWNER, `insert into storage.objects (bucket_id, name, owner) values ('site-media', $1 || '/b.webp', $2)`, [B, B_OWNER])
    await fails(db.as(B_OWNER, `insert into storage.objects (bucket_id, name, owner) values ('site-media', $1 || '/wrong.webp', $2)`, [A, B_OWNER]), /row-level security/)

    const primary = await db.as<{ name: string }>(USER.owner, `select name from storage.objects where bucket_id = 'site-media' order by name`)
    expect(primary.map((r) => r.name)).toEqual([`${A}/new.webp`, 'legacy-renamed.webp'])
    const bFiles = await asTenant<{ name: string }>(B_OWNER, B, `select name from storage.objects where bucket_id = 'site-media'`)
    expect(bFiles.map((r) => r.name)).toEqual([`${B}/b.webp`])
    expect(await asTenant('anon', B, `select name from storage.objects where bucket_id = 'site-media'`)).toEqual([{ name: `${B}/b.webp` }])

    await asTenant(B_OWNER, B, `delete from storage.objects where bucket_id = 'site-media' and name = 'legacy-renamed.webp'`)
    expect((await db.one<{ n: number }>(null, `select count(*)::int n from storage.objects where name = 'legacy-renamed.webp'`)).n).toBe(1)
    await db.as(USER.owner, `delete from storage.objects where bucket_id = 'site-media' and name = 'legacy-renamed.webp'`)
    expect((await db.one<{ n: number }>(null, `select count(*)::int n from storage.objects where name = 'legacy-renamed.webp'`)).n).toBe(0)
  })
})

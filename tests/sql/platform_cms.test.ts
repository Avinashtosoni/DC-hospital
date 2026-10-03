/**
 * Platform website CMS (scripts/sql/platform_cms.sql): draft → publish, history / restore / reset, blog posts,
 * what the public / hospital accounts / support / admin may do, and the media bucket rules.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'

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
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status) values ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'active')`, [B])
  await signUp(B_OWNER, 'owner@cityhospital.in', { full_name: 'City Owner', tenant_id: B })
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support']]) {
    await signUp(id, email, { full_name: `Provider ${role}` })
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 240_000)

describe('pages', () => {
  test('only admins write; support reads; hospitals and the public are refused; bad input rejected', async () => {
    await fails(call(B_OWNER, 'cp_site'), /Hospital Comrade team/)
    await fails(call('anon', 'cp_site'), /permission denied/)
    expect(await call(P_SUPPORT, 'cp_site')).toMatchObject({ canEdit: false, pages: [] })
    await fails(call(P_SUPPORT, 'cp_site_save', ['home', { a: 1 }, false], ['text', 'jsonb', 'boolean']), /admin/)
    await fails(call(B_OWNER, 'cp_site_save', ['home', { a: 1 }, true], ['text', 'jsonb', 'boolean']), /Hospital Comrade team/)
    await fails(call(P_ADMIN, 'cp_site_save', ['nope', { a: 1 }, false], ['text', 'jsonb', 'boolean']), /Unknown page/)
    await fails(call(P_ADMIN, 'cp_site_save', ['home', [1], false], ['text', 'jsonb', 'boolean']), /object/)
    await fails(call(P_ADMIN, 'cp_site_save', ['home', { big: 'x'.repeat(310_000) }, false], ['text', 'jsonb', 'boolean']), /too large/)
    // nobody reads the tables directly
    await fails(db.as('anon', `select * from public.platform_content`), /permission denied/)
    await fails(db.as(B_OWNER, `select * from public.platform_posts`), /permission denied/)
  })

  test('draft is private until published; publish keeps history; restore → draft; reset → defaults', async () => {
    await call(P_ADMIN, 'cp_site_save', ['home', { hero: { title: 'v1' } }, false], ['text', 'jsonb', 'boolean'])
    expect(await call('anon', 'platform_site')).toEqual({})
    expect(await call(B_OWNER, 'platform_site', [true])).toEqual({})                       // preview is for the platform team only
    expect(await call(P_SUPPORT, 'platform_site', [true])).toEqual({ home: { hero: { title: 'v1' } } })

    await call(P_ADMIN, 'cp_site_save', ['home', { hero: { title: 'v1' } }, true], ['text', 'jsonb', 'boolean'])
    expect(await call('anon', 'platform_site')).toEqual({ home: { hero: { title: 'v1' } } })
    await call(P_ADMIN, 'cp_site_save', ['home', { hero: { title: 'v2' } }, true], ['text', 'jsonb', 'boolean'])
    const site = await call(P_SUPPORT, 'cp_site')
    expect(site.pages[0]).toMatchObject({ key: 'home', data: { hero: { title: 'v2' } }, draft: null, published_by: 'Provider admin' })

    const hist = await call(P_SUPPORT, 'cp_site_history', ['home'])
    expect(hist).toHaveLength(1)
    expect(hist[0].data).toEqual({ hero: { title: 'v1' } })
    await fails(call(P_SUPPORT, 'cp_site_restore', [hist[0].id]), /admin/)
    await call(P_ADMIN, 'cp_site_restore', [hist[0].id])
    expect(await call('anon', 'platform_site')).toEqual({ home: { hero: { title: 'v2' } } })   // still the published one
    expect(await call(P_ADMIN, 'platform_site', [true])).toEqual({ home: { hero: { title: 'v1' } } })
    await call(P_ADMIN, 'cp_site_discard', ['home'])
    expect(await call(P_ADMIN, 'platform_site', [true])).toEqual({ home: { hero: { title: 'v2' } } })

    await call(P_ADMIN, 'cp_site_reset', ['home'])
    expect(await call('anon', 'platform_site')).toEqual({})
    expect(await call(P_SUPPORT, 'cp_site_history', ['home'])).toHaveLength(2)
    const audit = await db.one<any>(null, `select count(*)::int n from public.provider_audit where action like 'site:%'`)
    expect(audit.n).toBeGreaterThanOrEqual(4)
  })
})

describe('blog', () => {
  test('drafts hidden, published listed by tag, slugs unique and validated, admin only', async () => {
    const base = { slug: 'gst-for-clinics', title: 'GST for clinics', excerpt: 'What to charge', body: '## Hello\nText', tags: ['GST', 'Billing ', ''], status: 'draft' }
    await fails(call(P_SUPPORT, 'cp_save_post', [base]), /admin/)
    await fails(call(B_OWNER, 'cp_save_post', [base]), /Hospital Comrade team/)
    await fails(call(P_ADMIN, 'cp_save_post', [{ ...base, slug: 'Bad Slug' }]), /slug/)
    await fails(call(P_ADMIN, 'cp_save_post', [{ ...base, cover: 'javascript:alert(1)' }]), /https/)
    const d = await call(P_ADMIN, 'cp_save_post', [base])
    expect(d).toMatchObject({ status: 'draft', published_at: null, tags: ['billing', 'gst'] })
    expect((await call('anon', 'platform_blog')).total).toBe(0)
    expect(await call('anon', 'platform_blog_post', ['gst-for-clinics'])).toBeNull()
    expect(await call(P_SUPPORT, 'platform_blog_post', ['gst-for-clinics', true])).toMatchObject({ status: 'draft' })

    const p = await call(P_ADMIN, 'cp_save_post', [{ ...base, id: d.id, status: 'published' }])
    expect(p.published_at).toBeTruthy()
    await fails(call(P_ADMIN, 'cp_save_post', [{ ...base, title: 'Other' }]), /already uses/)
    await call(P_ADMIN, 'cp_save_post', [{ ...base, slug: 'future-post', status: 'published', published_at: new Date(Date.now() + 86_400_000).toISOString() }])

    const list = await call('anon', 'platform_blog')
    expect(list.total).toBe(1)                                      // the scheduled one waits
    expect(list.tags).toEqual(['billing', 'gst'])
    expect(list.rows[0]).toMatchObject({ slug: 'gst-for-clinics', title: 'GST for clinics' })
    expect(list.rows[0].body).toBeUndefined()
    expect((await call('anon', 'platform_blog', ['billing'])).total).toBe(1)
    expect((await call('anon', 'platform_blog', ['nope'])).total).toBe(0)
    expect(await call('anon', 'platform_blog_post', ['GST-for-clinics'])).toMatchObject({ body: '## Hello\nText' })

    expect(await call(P_SUPPORT, 'cp_posts')).toHaveLength(2)
    await fails(call(P_SUPPORT, 'cp_delete_post', [d.id]), /admin/)
    await call(P_ADMIN, 'cp_delete_post', [d.id])
    expect((await call('anon', 'platform_blog')).total).toBe(0)
  })
})

describe('media bucket', () => {
  test('public read; only platform admins upload or delete', async () => {
    await db.as(null, `grant select, insert, update, delete on storage.objects to anon, authenticated`)   // as on Supabase
    const bucket = await db.one<any>(null, `select public from storage.buckets where id = 'platform-media'`)
    expect(bucket.public).toBe(true)
    await fails(db.as(B_OWNER, `insert into storage.objects (bucket_id, name) values ('platform-media', 'x.webp')`), /row-level security/)
    await fails(db.as(P_SUPPORT, `insert into storage.objects (bucket_id, name) values ('platform-media', 'x.webp')`), /row-level security/)
    await db.as(P_ADMIN, `insert into storage.objects (bucket_id, name) values ('platform-media', 'logo.webp')`)
    const seen = await db.as('anon', `select name from storage.objects where bucket_id = 'platform-media'`)
    expect(JSON.stringify(seen)).toContain('logo.webp')
  })
})

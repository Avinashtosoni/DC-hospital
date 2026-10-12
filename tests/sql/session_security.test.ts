/**
 * Session authorization against already-issued Supabase JWTs. A JWT can remain cryptographically valid after Auth
 * revokes its refresh session; database access must still fail closed for disabled or removed sessions.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

const OWNER = 'f2c00000-0000-4000-8000-000000000001'
const ADMIN = 'f2c00000-0000-4000-8000-000000000002'
const OWNER_SESSION = 'f2c00000-0000-4000-8000-000000000101'
const ADMIN_SESSION = 'f2c00000-0000-4000-8000-000000000102'
const PRIMARY = 'a0000000-0000-4000-8000-000000000001'

let db: Db

async function withJwt<T = Record<string, unknown>>(userId: string, sessionId: string, sql: string, params: unknown[] = [], tenant?: string) {
  await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`, [
    JSON.stringify({ sub: userId, session_id: sessionId, role: 'authenticated' }),
    JSON.stringify(tenant ? { 'x-tenant-id': tenant } : {}),
  ])
  try { return await db.as<T>(userId, sql, params) }
  finally { await db.query(`select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false)`) }
}

beforeAll(async () => {
  db = await freshDb('production')
  // The shared PGlite harness supplies the small Auth session table used by the fail-closed helper.
  await db.as(null, `insert into auth.users (id,email,encrypted_password,raw_user_meta_data) values
    ($1,'session-owner@example.test','x','{"full_name":"Session Owner"}'::jsonb),
    ($2,'session-admin@example.test','x','{"full_name":"Session Admin"}'::jsonb)`, [OWNER, ADMIN])
  await db.as(null, `update public.profiles set role='owner' where id=$1`, [OWNER])
  await db.as(null, `select set_config('app.tenant_move','on',false)`)
  await db.as(null, `update public.profiles set tenant_id=null where id=$1`, [ADMIN])
  await db.as(null, `select set_config('app.tenant_move','',false)`)
  await db.as(null, `delete from public.patients where profile_id=$1`, [ADMIN])
  await db.as(null, `insert into public.provider_users(user_id,role) values ($1,'admin')`, [ADMIN])
  await db.as(null, `insert into auth.sessions(id,user_id,not_after) values ($1,$3,null),($2,$4,null)`, [OWNER_SESSION, ADMIN_SESSION, OWNER, ADMIN])
}, 180_000)

describe('auth_session_active', () => {
  test('an active session unlocks the hospital; revoking its database row invalidates that same JWT across RLS', async () => {
    await db.as(null, `grant select,insert,update,delete on storage.objects to authenticated`)
    expect(await withJwt<{ active: boolean }>(OWNER, OWNER_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: true }])
    expect(await withJwt<{ tenant: string | null }>(OWNER, OWNER_SESSION, `select public.current_tenant()::text tenant`)).toEqual([{ tenant: PRIMARY }])
    expect(await withJwt(OWNER, OWNER_SESSION, `select id from public.profiles where id=$1`, [OWNER])).toHaveLength(1)
    expect(await withJwt(OWNER, OWNER_SESSION, `select id from public.patients where profile_id=$1`, [OWNER])).toHaveLength(1)
    const avatar = await withJwt<{ id: string }>(OWNER, OWNER_SESSION,
      `insert into storage.objects(bucket_id,name) values ('avatars',$1) returning id`, [`${OWNER}/avatar.png`])
    expect(avatar).toHaveLength(1)

    // Auth sign-out / revocation removes the session row, while this test deliberately reuses the unchanged JWT claims.
    await db.as(null, `delete from auth.sessions where id=$1`, [OWNER_SESSION])
    expect(await withJwt<{ active: boolean }>(OWNER, OWNER_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
    expect(await withJwt<{ tenant: string | null }>(OWNER, OWNER_SESSION, `select public.current_tenant()::text tenant`)).toEqual([{ tenant: null }])
    expect(await withJwt(OWNER, OWNER_SESSION, `select id from public.profiles where id=$1`, [OWNER])).toEqual([])
    expect(await withJwt(OWNER, OWNER_SESSION, `select id from public.patients where profile_id=$1`, [OWNER])).toEqual([])
    expect(await withJwt(OWNER, OWNER_SESSION, `update storage.objects set name='${OWNER}/stolen.png' where id=$1 returning id`, [avatar[0].id])).toEqual([])
    await expect(withJwt(OWNER, OWNER_SESSION, `insert into storage.objects(bucket_id,name) values ('avatars',$1)`, [`${OWNER}/stale.png`]))
      .rejects.toThrow(/row-level security/)
  })

  test('provider self-rows also require the live session; banned users and elapsed not_after sessions fail closed', async () => {
    expect(await withJwt<{ role: string }>(ADMIN, ADMIN_SESSION, `select role from public.provider_users where user_id=$1`, [ADMIN]))
      .toEqual([{ role: 'admin' }])
    expect(await withJwt<{ role: string | null }>(ADMIN, ADMIN_SESSION, `select public.provider_role() role`)).toEqual([{ role: 'admin' }])
    expect(await withJwt<{ active: boolean }>(OWNER, ADMIN_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
    expect(await withJwt<{ active: boolean }>(OWNER, 'not-a-uuid', `select public.auth_session_active() active`)).toEqual([{ active: false }])

    await db.as(null, `update auth.users set banned_until='infinity' where id=$1`, [ADMIN])
    expect(await withJwt<{ active: boolean }>(ADMIN, ADMIN_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
    await db.as(null, `update auth.users set banned_until=null where id=$1`, [ADMIN])

    await db.as(null, `update auth.sessions set not_after=now()-interval '1 second' where id=$1`, [ADMIN_SESSION])
    expect(await withJwt<{ active: boolean }>(ADMIN, ADMIN_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
    expect(await withJwt(ADMIN, ADMIN_SESSION, `select role from public.provider_users where user_id=$1`, [ADMIN])).toEqual([])
    await db.as(null, `update auth.sessions set not_after=null where id=$1`, [ADMIN_SESSION])

    // On account deactivation the real admin RPC bans the account and deletes all of its Auth sessions.
    expect(await withJwt(ADMIN, ADMIN_SESSION, `select public.admin_set_user_active($1,false)`, [OWNER], PRIMARY)).toHaveLength(1)
    expect((await db.one<{ banned: boolean; sessions: number }>(null, `select u.banned_until>now() banned,
      (select count(*)::int from auth.sessions s where s.user_id=u.id) sessions from auth.users u where u.id=$1`, [OWNER])))
      .toEqual({ banned: true, sessions: 0 })
    // The previous access JWT is still supplied unchanged, but cannot read its profile or hospital data.
    expect(await withJwt<{ active: boolean }>(OWNER, OWNER_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
    expect(await withJwt(OWNER, OWNER_SESSION, `select id from public.profiles where id=$1`, [OWNER])).toEqual([])
  })

  test('older Auth schemas without not_after still require a matching live session row', async () => {
    await db.exec(`alter table auth.sessions drop column not_after`)
    expect(await withJwt<{ active: boolean }>(ADMIN, ADMIN_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: true }])
    await db.as(null, `delete from auth.sessions where id=$1`, [ADMIN_SESSION])
    expect(await withJwt<{ active: boolean }>(ADMIN, ADMIN_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
  })

  test('missing Auth session registry fails closed rather than falling back to account status', async () => {
    await db.exec(`drop table auth.sessions`)
    expect(await withJwt<{ active: boolean }>(ADMIN, ADMIN_SESSION, `select public.auth_session_active() active`)).toEqual([{ active: false }])
    expect(await withJwt<{ tenant: string | null }>(ADMIN, ADMIN_SESSION, `select public.current_tenant()::text tenant`)).toEqual([{ tenant: null }])
    expect(await withJwt<{ role: string | null }>(ADMIN, ADMIN_SESSION, `select public.provider_role() role`)).toEqual([{ role: null }])
  })
})

/**
 * Messaging (scripts/sql/messaging.sql): push channel, account / notice messages, custom & scheduled templates,
 * usage report, cron helpers (without pg_cron) and owner-only user administration.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'

let db: Db
const n = structuredClone(DEFAULT_APP_SETTINGS.notifications)
n.sms.enabled = true; n.email.enabled = true; n.whatsapp.enabled = true; n.push.enabled = true

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.app_settings (key, data) values ('app', jsonb_build_object('notifications', $1::jsonb))
    on conflict (key) do update set data = excluded.data`, [JSON.stringify(n)])
}, 180_000)

const outbox = (where: string, params: unknown[] = []) =>
  db.as<{ event: string; channel: string; recipient: string; subject: string | null; body: string; profile_id: string | null }>(null,
    `select event, channel, recipient, subject, body, profile_id from public.notification_outbox where ${where} order by channel`, params)
const clear = () => db.as(null, 'delete from public.notification_outbox')

describe('push channel', () => {
  test('only a person with a registered device gets a push; the token belongs to the last user', async () => {
    await clear()
    await db.as(USER.staff, `select public.register_push_token('tok-staff-aaaaaaaaaaaaaaaaaaaa', 'web', 'test')`)
    expect(await db.as(USER.staff, 'select token from public.push_tokens')).toHaveLength(1)
    expect(await db.as(USER.doctor, 'select token from public.push_tokens')).toHaveLength(0)
    await expect(db.as(USER.staff, `insert into public.push_tokens (profile_id, token) values ('${USER.owner}', 'x-aaaaaaaaaaaaaaaaaaaaaaa')`)).rejects.toThrow(/permission denied/)

    await db.as(null, `select public.notify_enqueue('password_changed', '9810010005', 'staff@dchospital.com', '{"name":"Priya","time":"now"}'::jsonb, 'profiles', $1, null, $1)`, [USER.staff])
    const rows = await outbox(`event = 'password_changed'`)
    expect(rows.map((r) => r.channel)).toEqual(['email', 'push', 'sms'])
    const push = rows.find((r) => r.channel === 'push')!
    expect(push.recipient).toBe(USER.staff)
    expect(push.subject).toBe('Your password was changed')
    expect(push.body).toContain('Your password was changed on now')

    await clear()
    await db.as(null, `select public.notify_enqueue('password_changed', '9810010002', null, '{}'::jsonb, null, null, null, $1)`, [USER.doctor])
    expect((await outbox('true')).map((r) => r.channel)).toEqual(['sms'])   // doctor has no device
  })

  test('the old 7-argument calls still work (booking OTP)', async () => {
    await clear()
    const r = await db.one<{ n: number }>(null, `select public.notify_enqueue('otp', '9876543210', null, '{"code":"123456"}'::jsonb, 'booking_otps', null, array['sms']) n`)
    expect(r.n).toBe(1)
  })
})

describe('account & notice messages', () => {
  test('changing a role / phone sends account_updated; a password change sends password_changed', async () => {
    await clear()
    await db.as(null, `update public.profiles set phone = '+91 98100 19999' where id = $1`, [USER.receptionist])
    const upd = await outbox(`event = 'account_updated'`)
    expect(upd.map((r) => r.channel)).toEqual(['email'])
    expect(upd[0].body).toContain('mobile: +91 98100 19999')
    await db.as(null, `update auth.users set encrypted_password = 'changed' where id = $1`, [USER.receptionist])
    expect((await outbox(`event = 'password_changed'`)).map((r) => r.channel)).toEqual(['email', 'sms'])
  })

  test('a new notice reaches its audience by push (and stamps the author)', async () => {
    await clear()
    await db.as(USER.doctor, `select public.register_push_token('tok-doctor-aaaaaaaaaaaaaaaaaaa')`)
    await db.as(USER.patient, `select public.register_push_token('tok-patient-aaaaaaaaaaaaaaaaaa')`)
    const row = await db.one<{ author_name: string }>(USER.owner, `insert into public.notices (title, body, audience) values ('OPD timings', 'OPD opens at 9 AM from Monday.', 'staff') returning author_name`)
    expect(row.author_name).toBe('Avinash Tosoni')
    const rows = await outbox(`event = 'notice_published'`)
    expect(rows.every((r) => r.channel === 'push')).toBe(true)
    expect(rows.map((r) => r.profile_id).sort()).toEqual([USER.doctor, USER.staff].sort())
    expect(rows[0].subject).toBe('📌 OPD timings')
  })
})

describe('custom templates', () => {
  test('owner only; schedule works out the next run in India time', async () => {
    await expect(db.as(USER.accountant, `insert into public.notification_templates (name, text) values ('x', 'y')`)).rejects.toThrow(/row-level security/)
    const t = await db.one<{ next_run_at: string | null; created_by_name: string }>(USER.owner,
      `insert into public.notification_templates (name, text, schedule, time_of_day, enabled) values ('Daily tip', 'Drink water', 'daily', '09:30', true) returning next_run_at, created_by_name`)
    expect(t.created_by_name).toBe('Avinash Tosoni')
    const next = new Date(t.next_run_at!)
    expect(next.getTime()).toBeGreaterThan(Date.now())
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000)
    expect(next.toISOString().slice(11, 16)).toBe('04:00')   // 09:30 IST
    const manual = await db.one<{ next_run_at: string | null }>(USER.owner, `insert into public.notification_templates (name, text) values ('Manual', 'x') returning next_run_at`)
    expect(manual.next_run_at).toBeNull()
    await expect(db.as(USER.owner, `insert into public.notification_templates (name, text, audience) values ('Roles', 'x', 'roles')`)).rejects.toThrow(/at least one role/)
  })

  test('send now: staff audience by role, tokens filled per person, preview counts match', async () => {
    await clear()
    const { id } = await db.one<{ id: string }>(USER.owner,
      `insert into public.notification_templates (name, text, subject, channels, audience, roles) values ('Staff meeting', 'Hi {name}, meeting at 5 PM — {hospital}', 'Meeting', array['email','push'], 'roles', array['doctor','staff']) returning id`)
    const prev = await db.one<{ a: { total: number; email: number; push: number } }>(USER.owner, 'select public.notify_template_audience($1) a', [id])
    expect(prev.a.total).toBeGreaterThanOrEqual(2)
    await expect(db.as(USER.receptionist, 'select public.notify_send_template($1)', [id])).rejects.toThrow(/owner/)
    const sent = await db.one<{ n: number }>(USER.owner, 'select public.notify_send_template($1) n', [id])
    const rows = await outbox(`event = $1`, ['tpl:' + id])
    expect(rows).toHaveLength(sent.n)
    expect(rows.filter((r) => r.channel === 'push').map((r) => r.profile_id).sort()).toEqual([USER.doctor, USER.staff].sort())
    expect(rows.find((r) => r.recipient === 'doctor@dchospital.com')?.body).toBe('Hi Dr., meeting at 5 PM — DC Hospital')
    const t = await db.one<{ last_run_count: number }>(USER.owner, 'select last_run_count from public.notification_templates where id = $1', [id])
    expect(t.last_run_count).toBe(sent.n)
  })

  test('scheduled: due templates run once, a one-off switches itself off; birthdays pick today\'s patients', async () => {
    await clear()
    await db.as(null, `update public.patients set date_of_birth = (now() at time zone 'Asia/Kolkata')::date - interval '30 years' where id = (select id from public.patients where phone is not null order by id limit 1)`)
    const { id } = await db.one<{ id: string }>(USER.owner,
      `insert into public.notification_templates (name, text, channels, schedule, enabled) values ('Birthday', 'Happy birthday {name}!', array['sms'], 'birthday', true) returning id`)
    const once = await db.one<{ id: string }>(USER.owner,
      `insert into public.notification_templates (name, text, channels, audience, schedule, send_at, enabled) values ('Once', 'Hello staff', array['email'], 'staff', 'once', now() + interval '1 hour', true) returning id`)
    await db.as(null, `update public.notification_templates set next_run_at = now() - interval '1 minute' where id in ($1, $2)`, [id, once.id])
    const total = await db.one<{ n: number }>(null, 'select public.run_scheduled_notifications() n')
    expect(total.n).toBeGreaterThanOrEqual(2)
    const bday = await outbox('event = $1', ['tpl:' + id])
    expect(bday.length).toBeGreaterThanOrEqual(1)
    expect(bday[0].body).toMatch(/^Happy birthday \S+!$/)
    const after = await db.as<{ id: string; enabled: boolean; next_run_at: string | null }>(null, 'select id, enabled, next_run_at from public.notification_templates where id in ($1, $2)', [id, once.id])
    expect(after.find((r) => r.id === once.id)).toMatchObject({ enabled: false, next_run_at: null })
    expect(new Date(after.find((r) => r.id === id)!.next_run_at!).getTime()).toBeGreaterThan(Date.now())
    expect((await db.one<{ n: number }>(null, 'select public.run_scheduled_notifications() n')).n).toBe(0)
  })
})

describe('usage, cron status', () => {
  test('owner and accountant see usage; others cannot', async () => {
    const rows = await db.as<{ channel: string; event: string; n: string }>(USER.accountant, `select * from public.notification_usage(current_date - 7, current_date + 1)`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.event === 'custom')).toBe(true)
    await expect(db.as(USER.receptionist, `select * from public.notification_usage(current_date - 7, current_date)`)).rejects.toThrow(/owner and the accountant/)
    await expect(db.as(USER.owner, `select * from public.notification_usage(current_date - 500, current_date)`)).rejects.toThrow(/400 days/)
  })

  test('cron status / setup degrade gracefully without pg_cron', async () => {
    const s = await db.one<{ s: { pg_cron: boolean; url_set: boolean } }>(USER.owner, 'select public.notify_cron_status() s')
    expect(s.s).toMatchObject({ pg_cron: false, url_set: false })
    await expect(db.as(USER.owner, `select public.notify_cron_setup(true, 'https://x.supabase.co/functions/v1/notify')`)).rejects.toThrow(/CRON_MISSING|pg_cron/)
    await expect(db.as(USER.owner, `select public.notify_cron_setup(false, 'http://bad')`)).rejects.toThrow(/should look like/)
    await expect(db.as(USER.accountant, 'select public.notify_cron_status()')).rejects.toThrow(/Not allowed/)
    const off = await db.one<{ s: { jobs: unknown[] } }>(USER.owner, 'select public.notify_cron_setup(false) s')
    expect(off.s.jobs).toEqual([])
  })
})

describe('user administration', () => {
  test('owner creates a receptionist who can sign in with the right role and no patient record', async () => {
    await clear()
    const { id } = await db.one<{ id: string }>(USER.owner, `select public.admin_create_user('New.Desk@Example.in', 'Kiran Rao', 'receptionist', '9812345678', 'Secret@123') id`)
    const p = await db.one<{ role: string; email: string; phone: string }>(null, 'select role, email, phone from public.profiles where id = $1', [id])
    expect(p).toEqual({ role: 'receptionist', email: 'new.desk@example.in', phone: '9812345678' })
    expect(await db.as(null, 'select 1 from public.patients where profile_id = $1', [id])).toHaveLength(0)
    const ok = await db.one<{ ok: boolean }>(null, `select encrypted_password = extensions.crypt('Secret@123', encrypted_password) ok from auth.users where id = $1`, [id])
    expect(ok.ok).toBe(true)
    const welcome = await outbox(`event = 'account_created'`)
    expect(welcome.map((r) => r.channel)).toEqual(['email', 'whatsapp'])
    expect(welcome[0].body).toContain('Receptionist account')
    await expect(db.as(USER.owner, `select public.admin_create_user('new.desk@example.in', 'Dup', 'staff')`)).rejects.toThrow(/already exists/)
    await expect(db.as(USER.receptionist, `select public.admin_create_user('a@b.in', 'Hacker', 'owner')`)).rejects.toThrow(/Only the hospital owner/)
  })

  test('update, reset password, disable and delete — with last-owner and self guards', async () => {
    const { id } = await db.one<{ id: string }>(USER.owner, `select public.admin_create_user('temp.user@example.in', 'Temp User', 'patient') id`)
    expect(await db.as(null, 'select 1 from public.patients where profile_id = $1', [id])).toHaveLength(1)
    await db.as(USER.owner, `select public.admin_update_user($1, 'Temp Staff', 'staff', '9811111111', 'temp.staff@example.in')`, [id])
    expect(await db.one(null, 'select u.email, p.role, p.full_name from auth.users u join public.profiles p using (id) where id = $1', [id]))
      .toEqual({ email: 'temp.staff@example.in', role: 'staff', full_name: 'Temp Staff' })
    await db.as(USER.owner, `select public.admin_set_user_password($1, 'Another@123')`, [id])
    await expect(db.as(USER.owner, `select public.admin_set_user_password($1, 'short')`, [id])).rejects.toThrow(/8 characters/)
    await db.as(USER.owner, 'select public.admin_set_user_active($1, false)', [id])
    const st = await db.as<{ id: string; disabled: boolean }>(USER.owner, 'select * from public.admin_user_status($1)', [[id, USER.owner]])
    expect(st.find((r) => r.id === id)?.disabled).toBe(true)
    await expect(db.as(USER.owner, 'select public.admin_set_user_active($1, false)', [USER.owner])).rejects.toThrow(/own account/)
    await expect(db.as(USER.owner, `select public.admin_update_user($1, 'Avinash Tosoni', 'doctor')`, [USER.owner])).rejects.toThrow(/last owner/)
    await expect(db.as(USER.owner, 'select public.admin_delete_user($1)', [USER.owner])).rejects.toThrow(/own account/)
    await clear()
    await db.as(USER.owner, 'select public.admin_delete_user($1)', [id])
    expect(await db.as(null, 'select 1 from auth.users where id = $1', [id])).toHaveLength(0)
    expect((await outbox(`event = 'account_deleted'`)).map((r) => r.recipient)).toEqual(['temp.staff@example.in'])
  })
})

describe('upgrade', () => {
  test('upgrade-2026-10.sql ships the messaging section, re-runs cleanly and keeps saved wording', async () => {
    const upgrade = readFileSync(resolve(__dirname, '../../supabase/upgrade-2026-10.sql'), 'utf8')
    expect(upgrade).toContain('-- >>> messaging')
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{notifications,templates,password_changed,text}', '"Custom wording"') where key = 'app'`)
    await db.exec(upgrade)
    await db.exec(upgrade)
    const t = await db.one<{ t: string }>(null, `select data #>> '{notifications,templates,password_changed,text}' t from public.app_settings where key = 'app'`)
    expect(t.t).toBe('Custom wording')
    const fns = await db.as(null, `select 1 from pg_proc where proname = 'notify_enqueue'`)
    expect(fns).toHaveLength(1)
  })

  test('an older settings row gets the new events added', async () => {
    const old = structuredClone(n) as unknown as { events: Record<string, unknown>; templates: Record<string, unknown>; push?: unknown }
    delete old.events.notice_published; delete old.templates.notice_published; delete old.push
    await db.as(null, `update public.app_settings set data = jsonb_build_object('notifications', $1::jsonb) where key = 'app'`, [JSON.stringify(old)])
    await db.exec(readFileSync(resolve(__dirname, '../../supabase/upgrade-2026-10.sql'), 'utf8'))
    const r = await db.one<{ e: unknown; p: { enabled: boolean } }>(null, `select data #> '{notifications,events,notice_published}' e, data #> '{notifications,push}' p from public.app_settings where key = 'app'`)
    expect(r.e).toEqual({ sms: false, whatsapp: false, email: false, push: true })
    expect(r.p.enabled).toBe(false)
  })
})

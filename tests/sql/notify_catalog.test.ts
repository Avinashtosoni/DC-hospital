/**
 * The notification template library (scripts/sql/notify_catalog.sql): catalog in the database, control-panel switches /
 * wording / locks / custom templates, the in-app bell, the new hospital and platform events, daily jobs and the server monitor.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'
import { DEFAULT_APP_SETTINGS } from '../../src/settings/types'
import { CATALOG } from '../../src/notify'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
const P_ADMIN = 'e0e00000-0000-4000-8000-000000000001'
const P_SUPPORT = 'e0e00000-0000-4000-8000-000000000002'
const n = structuredClone(DEFAULT_APP_SETTINGS.notifications)
n.sms.enabled = true; n.email.enabled = true; n.whatsapp.enabled = true; n.push.enabled = true

const outbox = (where = 'true', params: unknown[] = []) =>
  db.as<{ event: string; channel: string; recipient: string; subject: string | null; body: string }>(null,
    `select event, channel, recipient, subject, body from public.notification_outbox where ${where} order by event, channel`, params)
const bell = (profile: string) => db.as<{ event: string; title: string; body: string; read_at: string | null }>(null,
  `select event, title, body, read_at from public.user_notifications where profile_id = $1 order by created_at, event`, [profile])
const clear = async () => { await db.as(null, 'delete from public.notification_outbox'); await db.as(null, 'delete from public.user_notifications') }
async function call<T = any>(who: string | null, fn: string, args: unknown[] = [], types: string[] = []): Promise<T> {
  const list = args.map((_, i) => `$${i + 1}${types[i] ? '::' + types[i] : ''}`).join(', ')
  const r = await db.one<{ r: T }>(who, `select public.${fn}(${list}) as r`, args.map((a) => (a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a)))
  return r.r
}
const ids = async () => {
  const p = await db.one<{ id: string }>(null, `select id from public.patients where profile_id = $1`, [USER.patient])
  const d = await db.one<{ id: string }>(null, `select id from public.doctors where profile_id = $1`, [USER.doctor])
  return { patient: p.id, doctor: d.id }
}

beforeAll(async () => {
  db = await freshDb('master')
  await db.as(null, `insert into public.app_settings (key, data) values ('app', jsonb_build_object('notifications', $1::jsonb))
    on conflict (tenant_id, key) do update set data = excluded.data`, [JSON.stringify(n)])
  await db.as(null, `insert into public.tenants (id, slug, name, code, plan, status) values ($1, 'city', 'City Hospital', 'CTY', 'clinic', 'active')`, [B])
  await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'owner@city.in', 'x', $2::jsonb)`,
    [B_OWNER, JSON.stringify({ full_name: 'City Owner', tenant_id: B })])
  await db.as(null, `update public.profiles set role = 'owner', phone = '9876543210' where id = $1`, [B_OWNER])
  for (const [id, email, role] of [[P_ADMIN, 'admin@hc.in', 'admin'], [P_SUPPORT, 'support@hc.in', 'support']]) {
    await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'x', $3::jsonb)`, [id, email, JSON.stringify({ full_name: `Provider ${role}` })])
    await db.as(null, `select set_config('app.tenant_move', 'on', false)`)
    await db.as(null, `update public.profiles set tenant_id = null where id = $1`, [id])
    await db.as(null, `select set_config('app.tenant_move', '', false)`)
    await db.as(null, `delete from public.patients where profile_id = $1`, [id])
    await db.as(null, `insert into public.provider_users (user_id, role) values ($1, $2)`, [id, role])
  }
}, 240_000)

describe('catalog', () => {
  test('every template has a unique ID and the database holds the same list', async () => {
    const codes = CATALOG.map((e) => e.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length)
    expect(CATALOG.length).toBeGreaterThanOrEqual(70)
    const r = await db.one<{ c: Record<string, { code: string; channels: string[] }> }>(null, 'select public.notify_catalog() c')
    expect(Object.keys(r.c).sort()).toEqual(CATALOG.map((e) => e.id).sort())
    expect(r.c.appointment_booked.code).toBe('APT-001')
    expect(r.c.owner_daily_digest.channels).toContain('inapp')
    // every hospital event's tokens are listed and its copy only uses known tokens (+ the always-there ones)
    for (const e of CATALOG.filter((x) => x.copy && x.scope !== 'platform')) {
      const used = [...`${e.copy!.subject} ${e.copy!.text} ${e.copy!.waText ?? ''} ${e.copy!.pushText ?? ''}`.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1])
      for (const t of used) expect([...e.tokens, 'hospital', 'hospital_phone', 'address', 'site_url', 'platform'], `${e.code} {${t}}`).toContain(t)
    }
  })
})

describe('hospital events', () => {
  test('new events use the catalog defaults: appointment → patient (+ bell), doctor (bell) and reception for online bookings', async () => {
    await clear()
    const { patient, doctor } = await ids()
    const tomorrow = await db.one<{ d: string }>(null, `select (public.today_ist() + 1)::text d`)
    await db.as(null, `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time, source) values ($1, $2, $3, '11:30', 'website')`,
      [patient, doctor, tomorrow.d])
    const rows = await outbox()
    expect(rows.filter((r) => r.event === 'appointment_booked').map((r) => r.channel)).toEqual(['email', 'sms', 'whatsapp'])
    expect((await bell(USER.patient)).map((b) => b.event)).toEqual(['appointment_booked'])
    const doc = await bell(USER.doctor)
    expect(doc.map((b) => b.event)).toEqual(['doctor_new_appointment'])
    expect(doc[0].body).toContain('11:30 AM')
    expect((await bell(USER.receptionist)).map((b) => b.event)).toEqual(['online_booking_alert'])
  })

  test('status changes: confirmed, checked in, no-show; the patient bell API marks read', async () => {
    await clear()
    const a = await db.one<{ id: string }>(null, `select id from public.appointments where source = 'website' and appointment_time = '11:30' limit 1`)
    await db.as(null, `update public.appointments set status = 'confirmed' where id = $1`, [a.id])
    await db.as(null, `update public.appointments set status = 'no_show' where id = $1`, [a.id])
    expect((await outbox()).map((r) => `${r.event}:${r.channel}`)).toEqual(['appointment_confirmed:whatsapp', 'appointment_no_show:sms', 'appointment_no_show:whatsapp'])
    const mine = await call(USER.patient, 'my_notifications', [10, null], ['int', 'timestamptz'])
    expect(mine.unread).toBe(2)
    expect(mine.items[0].event).toBe('appointment_no_show')
    expect(await call(USER.patient, 'read_notifications', [[mine.items[1].id]], ['uuid[]'])).toBe(1)
    expect((await call(USER.patient, 'my_notifications', [10, null], ['int', 'timestamptz'])).unread).toBe(1)
    expect(await call(USER.patient, 'read_notifications', [null], ['uuid[]'])).toBe(1)
    // someone else's rows are invisible
    expect((await call(USER.doctor, 'my_notifications', [10, null], ['int', 'timestamptz'])).items.every((i: any) => i.event !== 'appointment_no_show')).toBe(true)
    await expect(db.as(USER.patient, `update public.user_notifications set read_at = null`)).rejects.toThrow(/permission denied/)
  })

  test('the hospital switches an event off, rewords it; a locked template ignores the hospital wording', async () => {
    await clear()
    const { patient, doctor } = await ids()
    const custom = structuredClone(n) as any
    custom.events.prescription_issued = { whatsapp: false, email: true, inapp: false }
    custom.templates.prescription_issued = { ...custom.templates.prescription_issued, text: 'Rx by {doctor} for {name}', subject: 'Rx ready' }
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{notifications}', $1::jsonb) where key = 'app' and tenant_id = public.primary_tenant()`, [JSON.stringify(custom)])
    await db.as(null, `insert into public.prescriptions (patient_id, doctor_id, diagnosis) values ($1, $2, 'Viral fever')`, [patient, doctor])
    let rows = await outbox(`event = 'prescription_issued'`)
    expect(rows.map((r) => r.channel)).toEqual(['email'])
    expect(rows[0].body).toMatch(/^Rx by Dr\. .+ for /)
    expect(await bell(USER.patient)).toHaveLength(0)

    // control panel: platform wording + lock → the hospital's own wording is ignored
    await db.as(null, `insert into public.platform_templates (key, locked, tpl) values ('prescription_issued', true, '{"text": "Platform Rx text {name}", "subject": "Platform Rx"}')`)
    await clear()
    await db.as(null, `insert into public.prescriptions (patient_id, doctor_id, diagnosis) values ($1, $2, 'Cough')`, [patient, doctor])
    rows = await outbox(`event = 'prescription_issued'`)
    expect(rows[0].subject).toBe('Platform Rx')
    expect(rows[0].body).toMatch(/^Platform Rx text /)

    // control panel switches the event off for every hospital
    await db.as(null, `update public.platform_templates set enabled = false where key = 'prescription_issued'`)
    await clear()
    await db.as(null, `insert into public.prescriptions (patient_id, doctor_id, diagnosis) values ($1, $2, 'Cold')`, [patient, doctor])
    expect(await outbox(`event = 'prescription_issued'`)).toHaveLength(0)
    await db.as(null, `delete from public.platform_templates`)
    await db.as(null, `update public.app_settings set data = jsonb_set(data, '{notifications}', $1::jsonb) where key = 'app' and tenant_id = public.primary_tenant()`, [JSON.stringify(n)])
  })

  test('a channel switched off in the control panel stays off for every hospital', async () => {
    await clear()
    await db.as(null, `insert into public.platform_templates (key, channels) values ('password_changed', '{"sms": false}')`)
    await db.as(null, `select public.notify_enqueue('password_changed', '9810010005', 'staff@dchospital.com', '{"name":"Priya","time":"now"}'::jsonb, 'profiles', $1, null, $1)`, [USER.staff])
    expect((await outbox()).map((r) => r.channel)).toEqual(['email'])
    await db.as(null, `delete from public.platform_templates`)
  })

  test('admission, discharge, lab, part payment, cancelled invoice, leave → patients told', async () => {
    await clear()
    const { patient, doctor } = await ids()
    const bed = await db.one<{ id: string }>(null, `select id from public.beds where status = 'available' limit 1`)
    const adm = await db.one<{ id: string }>(null, `insert into public.admissions (patient_id, doctor_id, bed_id, reason) values ($1, $2, $3, 'Observation') returning id`, [patient, doctor, bed.id])
    await db.as(null, `update public.admissions set status = 'discharged', discharge_date = public.today_ist() where id = $1`, [adm.id])
    const lab = await db.one<{ id: string }>(null, `insert into public.lab_tests (patient_id, doctor_id, test_name, priority) values ($1, $2, 'CBC', 'urgent') returning id`, [patient, doctor])
    await db.as(null, `update public.lab_tests set status = 'completed', result = 'ok' where id = $1`, [lab.id])
    expect((await bell(USER.patient)).map((b) => b.event)).toEqual(['admission_created', 'patient_discharged', 'lab_test_ordered', 'lab_report_ready'])
    expect((await bell(USER.doctor)).map((b) => b.event)).toEqual(['doctor_new_admission', 'lab_result_doctor'])

    await clear()
    const inv = await db.one<{ id: string }>(null, `insert into public.invoices (invoice_number, patient_id, items) values ('INV-T-1', $1, '[{"description":"Consult","quantity":1,"unit_price":1000}]') returning id`, [patient])
    await db.as(null, `insert into public.payments (invoice_id, patient_id, amount) values ($1, $2, 400)`, [inv.id, patient])
    const due = (await bell(USER.patient)).find((b) => b.event === 'invoice_balance_due')!
    expect(due.body).toContain('₹600.00')
    const inv2 = await db.one<{ id: string }>(null, `insert into public.invoices (invoice_number, patient_id, items) values ('INV-T-2', $1, '[{"description":"X-ray","quantity":1,"unit_price":500}]') returning id`, [patient])
    await db.as(null, `update public.invoices set status = 'cancelled' where id = $1`, [inv2.id])
    expect((await outbox(`event = 'invoice_cancelled'`)).map((r) => r.channel)).toEqual(['email'])

    // leave: owner asked; approval tells the doctor and the booked patient
    await clear()
    const day = await db.one<{ d: string }>(null, `select (public.today_ist() + 3)::text d`)
    await db.as(null, `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time) values ($1, $2, $3, '10:00')`, [patient, doctor, day.d])
    const lv = await db.one<{ id: string }>(null, `insert into public.doctor_leaves (doctor_id, start_date, end_date, reason) values ($1, $2, $2, 'Conference') returning id`, [doctor, day.d])
    expect((await bell(USER.owner)).map((b) => b.event)).toContain('leave_requested')
    await db.as(null, `update public.doctor_leaves set status = 'approved' where id = $1`, [lv.id])
    expect((await bell(USER.doctor)).map((b) => b.event)).toContain('leave_approved')
    expect((await outbox(`event = 'doctor_unavailable'`)).map((r) => r.channel)).toEqual(['email', 'sms', 'whatsapp'])
  })

  test('new device sign-in: the first device is quiet, the next one alerts', async () => {
    await clear()
    expect(await call(USER.accountant, 'note_sign_in', ['device-aaaaaaaaaaaaaaaa1', 'Chrome on Windows'])).toBe(false)
    expect(await call(USER.accountant, 'note_sign_in', ['device-aaaaaaaaaaaaaaaa1', 'Chrome on Windows'])).toBe(false)
    expect(await bell(USER.accountant)).toHaveLength(0)
    expect(await call(USER.accountant, 'note_sign_in', ['device-bbbbbbbbbbbbbbbb2', 'Safari on iPhone'])).toBe(true)
    const b = await bell(USER.accountant)
    expect(b.map((x) => x.event)).toEqual(['new_device_signin'])
    expect(b[0].body).toContain('Safari on iPhone')
  })

  test('demo loading (app.notify_off) sends nothing', async () => {
    await clear()
    await db.as(null, `select set_config('app.notify_off', 'on', false)`)
    await db.as(null, `select public.notify_enqueue('password_changed', '9810010005', 'staff@dchospital.com', '{}'::jsonb, null, null, null, $1)`, [USER.staff])
    await db.as(null, `select set_config('app.notify_off', '', false)`)
    expect(await outbox()).toHaveLength(0)
  })
})

describe('daily jobs', () => {
  test('doctor schedule, owner digest, overdue bills (once), platform digest', async () => {
    await clear()
    const { patient, doctor } = await ids()
    await db.as(null, `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time) values ($1, $2, public.today_ist(), '23:30')`, [patient, doctor])
    await db.as(null, 'select public.notify_morning_jobs()')
    const sched = (await bell(USER.doctor)).find((b) => b.event === 'doctor_daily_schedule')!
    expect(sched.body).toMatch(/appointments today, first at/)
    expect((await outbox(`event = 'doctor_daily_schedule'`))[0].body).toMatch(/11:30 PM — /)
    await db.as(null, 'select public.notify_owner_digests()')
    expect((await bell(USER.owner)).map((b) => b.event)).toContain('owner_daily_digest')
    expect((await outbox(`event = 'owner_daily_digest'`)).map((r) => r.channel)).toEqual(['email'])

    await db.as(null, `insert into public.invoices (invoice_number, patient_id, items, due_date) values ('INV-T-OD', $1, '[{"description":"Old","quantity":1,"unit_price":300}]', public.today_ist() - 1)`, [patient])
    await db.as(null, 'select public.notify_midday_jobs()')
    await db.as(null, 'select public.notify_midday_jobs()')
    expect((await outbox(`event = 'invoice_overdue' and body like '%INV-T-OD%'`)).map((r) => r.channel)).toEqual(['email', 'sms', 'whatsapp'])

    const id = await db.one<{ id: string | null }>(null, 'select public.notify_platform_digest() id')
    expect(id.id).toBeTruthy()
    const a = await db.one<{ title: string; body: string }>(null, `select title, body from public.platform_alerts where event = 'platform_digest'`)
    expect(a.title).toMatch(/^Daily summary/)
    expect(a.body).toContain('Sign-ups:')
  })

  test('the tick runs each slot once a day', async () => {
    await db.as(null, `delete from public.platform_heartbeats where key like 'notify_%'`)
    await db.as(null, 'select public.notify_daily_tick()')
    await db.as(null, 'select public.notify_daily_tick()')
    const hb = await db.as<{ key: string; count: number }>(null, `select key, count from public.platform_heartbeats where key like 'notify_%'`)
    for (const h of hb) expect(Number(h.count)).toBe(1)
  })
})

describe('platform → hospital owner', () => {
  test('suspend / restore, plan change and trial extension reach the owner (and the team for status)', async () => {
    await db.as(null, `insert into public.app_settings (tenant_id, key, data) values ($2, 'app', jsonb_build_object('notifications', $1::jsonb))
      on conflict (tenant_id, key) do update set data = excluded.data`, [JSON.stringify(n), B])
    await db.as(null, `update public.tenants set status = 'suspended' where id = $1`, [B])
    await db.as(null, `update public.tenants set status = 'active', plan = 'hospital' where id = $1`, [B])
    const b = await bell(B_OWNER)
    expect(b.map((x) => x.event).sort()).toEqual(['plan_changed', 'tenant_reactivated', 'tenant_suspended'])
    expect(b.find((x) => x.event === 'plan_changed')!.body).toContain('Clinic plan to the Hospital plan')
    const team = await db.as<{ event: string }>(null, `select event from public.platform_alerts where event = 'tenant_status'`)
    expect(team).toHaveLength(2)
    const wa = await db.as<{ event: string }>(null, `select event from public.notification_outbox where tenant_id = $1 and channel = 'whatsapp'`, [B])
    expect(wa.map((r) => r.event).sort()).toEqual(['tenant_reactivated', 'tenant_suspended'])
  })

  test('the control panel can add a channel or switch one off on a platform message', async () => {
    await db.as(null, 'delete from public.notification_outbox')
    await db.as(null, `insert into public.platform_templates (key, channels, tpl) values ('trial_extended', '{"whatsapp": true, "email": false}', '{"subject": "Extended to {date}!"}')`)
    await db.as(null, `update public.tenants set trial_ends_at = now() + interval '5 days' where id = $1`, [B])
    await db.as(null, `update public.tenants set trial_ends_at = now() + interval '20 days' where id = $1`, [B])
    const rows = await db.as<{ channel: string; subject: string }>(null, `select channel, subject from public.notification_outbox where event = 'trial_extended' order by channel`)
    expect(rows.map((r) => r.channel)).toEqual(['whatsapp'])
    const bellRow = (await bell(B_OWNER)).find((x) => x.event === 'trial_extended')!
    expect(bellRow.title).toMatch(/^Extended to /)
    await db.as(null, `delete from public.platform_templates`)
  })
})

describe('control panel template manager', () => {
  test('admins edit, lock, switch off and reset; support reads; custom templates', async () => {
    await expect(call(USER.owner, 'cp_templates')).rejects.toThrow(/Hospital Comrade team/)
    const list = await call(P_SUPPORT, 'cp_templates')
    expect(list.saved).toEqual({})
    await expect(call(P_SUPPORT, 'cp_save_template', ['appointment_booked', { enabled: false }], ['text', 'jsonb'])).rejects.toThrow()
    const saved = await call(P_ADMIN, 'cp_save_template', ['appointment_booked', { enabled: true, locked: true, channels: { sms: false, bogus: true },
      tpl: { subject: 'Booked: {date}', waTemplate: 'appt_booked_v2', waParams: 'name,date', waCategory: 'UTILITY', waStatus: 'approved' } }], ['text', 'jsonb'])
    expect(saved.locked).toBe(true)
    expect(saved.channels).toEqual({ sms: false })
    // approved IDs reach the shared accounts' settings
    const ms = await db.one<{ d: any }>(null, `select data -> 'templates' -> 'appointment_booked' d from public.platform_settings where key = 'messaging'`)
    expect(ms.d).toEqual({ waTemplate: 'appt_booked_v2', waParams: 'name,date' })
    // the hospital sees switches / lock / wording but not the registration IDs
    const ov = await call(USER.owner, 'notify_platform_overrides')
    expect(ov.appointment_booked).toEqual({ enabled: true, locked: true, channels: { sms: false }, tpl: { subject: 'Booked: {date}' } })
    await expect(call(P_ADMIN, 'cp_save_template', ['my_promo', { tpl: { text: 'x' } }], ['text', 'jsonb'])).rejects.toThrow(/custom_/)
    await expect(call(P_ADMIN, 'cp_save_template', ['custom_promo', { tpl: { text: 'x' } }], ['text', 'jsonb'])).rejects.toThrow(/name/)
    const c = await call(P_ADMIN, 'cp_save_template', ['custom_promo', { meta: { label: 'Diwali offer', group: 'Marketing' }, tpl: { subject: 'Offer', text: 'Hello {name}' } }], ['text', 'jsonb'])
    expect(c.custom).toBe(true)
    expect(c.meta.label).toBe('Diwali offer')
    await call(P_ADMIN, 'cp_delete_template', ['appointment_booked'])
    await call(P_ADMIN, 'cp_delete_template', ['custom_promo'])
    expect((await call(P_ADMIN, 'cp_templates')).saved).toEqual({})
    const ms2 = await db.one<{ d: any }>(null, `select data -> 'templates' -> 'appointment_booked' d from public.platform_settings where key = 'messaging'`)
    expect(ms2.d).toBeNull()
  })

  test('platform alerts follow the template switch and wording', async () => {
    await db.as(null, `insert into public.platform_templates (key, tpl) values ('lead_new', '{"subject": "LEAD: {title}", "text": "{title} / {body}"}')`)
    await db.as(null, `select public.raise_platform_alert('lead_new', 'Ramesh wants a call', 'Phone 98xxxx', null, null, 60, 'warning')`)
    const m = await db.one<{ subject: string; body: string }>(null, `select subject, body from public.platform_outbox where kind = 'alert' and channel = 'email' and subject like 'LEAD:%' limit 1`)
    expect(m.subject).toBe('LEAD: Ramesh wants a call')
    expect(m.body).toBe('Ramesh wants a call / Phone 98xxxx')
    await db.as(null, `update public.platform_templates set enabled = false where key = 'lead_new'`)
    const r = await db.one<{ id: string | null }>(null, `select public.raise_platform_alert('lead_new', 'Another', '') id`)
    expect(r.id).toBeNull()
    await db.as(null, `delete from public.platform_templates`)
  })
})

describe('server monitor', () => {
  test('metrics become health rows; crossing a limit raises an alert; silence trips the watchdog', async () => {
    const res = await db.one<{ r: any }>('service', `select public.record_server_metrics($1::jsonb) r`, [JSON.stringify({
      host: 'contabo-1', cpu: 42, load1: '0.8', cores: 4, ram: 93, disk: 61, disks: [{ mount: '/', pct: 61 }],
      containers: { total: 12, running: 11, down: ['coolify-redis'] }, ssl: [{ domain: 'hospital.digitalcomrade.in', days: 60 }] })])
    const by = Object.fromEntries((res.r as any[]).map((x) => [x.service, x.status]))
    expect(by['server:cpu']).toBe('ok')
    expect(by['server:ram']).toBe('warn')
    expect(by['server:containers']).toBe('warn')
    expect(by['server:ssl:hospital.digitalcomrade.in']).toBe('ok')
    const al = await db.as<{ title: string }>(null, `select title from public.platform_alerts where event = 'threshold' order by created_at`)
    expect(al.map((a) => a.title)).toEqual(expect.arrayContaining(['Server memory needs attention', 'Server containers needs attention']))
    await expect(db.as(USER.owner, `select public.record_server_metrics('{}'::jsonb)`)).rejects.toThrow(/permission denied/)

    await db.as(null, `update public.platform_heartbeats set last_at = now() - interval '30 minutes' where key = 'server_monitor'`)
    await db.as(null, 'select public.server_watchdog()')
    const st = await db.one<{ status: string }>(null, `select status from public.platform_health_state where service = 'server:agent'`)
    expect(st.status).toBe('fail')
    expect((await db.as(null, `select 1 from public.platform_alerts where event = 'health_down' and title = 'Server monitor is down'`)).length).toBe(1)
  })
})

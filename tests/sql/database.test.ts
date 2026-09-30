/**
 * Database behaviour tests: RLS, booking API, patient self-service, feedback, staff invites, go-live helpers,
 * notification queue. Runs the generated supabase/master.sql in PGlite (see harness.ts).
 *   npm run sql:build && npm test
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

let db: Db
beforeAll(async () => { db = await freshDb('master') }, 180_000)

const freeSlots = (doctor: string, n = 3) => db.as<{ day: string; tm: string }>(null, `
  select g.day::date::text as day, t.tm
  from generate_series(current_date + 2, current_date + 25, interval '1 day') g(day),
       (select to_char(time '08:00' + k * interval '30 min', 'HH24:MI') tm from generate_series(0, 21) k) t
  where public.slot_problem($1, g.day::date, t.tm, true) is null
    and not exists (select 1 from public.appointments a where a.doctor_id = $1 and a.appointment_date = g.day::date
                    and a.appointment_time = t.tm and a.status not in ('cancelled', 'no_show'))
  order by 1, 2 limit ${n}`, [doctor])

const activeDoctor = async () => (await db.one<{ id: string }>(null, `select id from public.doctors where status = 'active' order by full_name limit 1`)).id
const myPatientId = async () => (await db.one<{ id: string }>(null, `select id from public.patients where profile_id = $1`, [USER.patient])).id

describe('row level security', () => {
  test('anonymous visitors cannot read patients or OTPs', async () => {
    await expect(db.as('anon', 'select * from public.patients limit 1')).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', 'select * from public.booking_otps limit 1')).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', 'select * from public.wa_sessions limit 1')).rejects.toThrow(/permission denied/)
  })
  test('a patient only sees their own appointments', async () => {
    const mine = await myPatientId()
    const rows = await db.as<{ patient_id: string }>(USER.patient, 'select patient_id from public.appointments')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.patient_id === mine)).toBe(true)
  })
  test('the audit log cannot be edited', async () => {
    await db.as(USER.owner, `delete from public.audit_log`).catch(() => null)
    expect((await db.one<{ n: number }>(null, 'select count(*)::int n from public.audit_log')).n).toBeGreaterThan(0)
  })
  test('only the owner manages staff invites', async () => {
    expect(await db.as(USER.receptionist, 'select * from public.staff_invites')).toEqual([])
    await expect(db.as(USER.receptionist, `insert into public.staff_invites (full_name, email, role) values ('X Y', 'x@y.in', 'doctor')`)).rejects.toThrow(/row-level security/)
  })
})

describe('online booking API', () => {
  test('OTP → verify → book creates patient, appointment and unpaid invoice; token is single use', async () => {
    const phone = '9876501234'
    const otp = await db.one<{ r: { ref: string; demo_code: string } }>('anon', 'select public.request_booking_otp($1) r', [phone])
    expect(otp.r.ref).toMatch(/[0-9a-f-]{36}/)
    expect(otp.r.demo_code).toMatch(/^\d{6}$/)
    const v = await db.one<{ r: { ok: boolean; token: string } }>('anon', 'select public.verify_booking_otp($1, $2) r', [phone, otp.r.demo_code])
    expect(v.r.ok).toBe(true)
    const doc = await activeDoctor()
    const [slot] = await freeSlots(doc)
    const res = await db.one<{ r: { ref: string; appointment: { source: string }; invoice: { status: string } } }>('anon',
      `select public.public_book_appointment($1, $2, $3::date, $4, 'Test Patient', 'female', null, null, 'fever') r`, [v.r.token, doc, slot.day, slot.tm])
    expect(res.r.ref).toMatch(/^DCB-[0-9A-F]{6}$/)
    expect(res.r.appointment.source).toBe('website')
    expect(res.r.invoice.status).toBe('unpaid')
    await expect(db.as('anon', `select public.public_book_appointment($1, $2, $3::date, $4, 'Test Patient', 'female', null, null, null)`,
      [v.r.token, doc, slot.day, slot.tm])).rejects.toThrow(/OTP_REQUIRED/)
  })
  test('slot rules: past dates and holidays are refused', async () => {
    const doc = await activeDoctor()
    const past = await db.one<{ p: string }>(null, `select public.slot_problem($1, current_date - 1, '10:00') p`, [doc])
    expect(past.p).toMatch(/past/)
    const hol = await db.one<{ p: string }>(null, `select public.slot_problem($1, (select holiday_date from public.holidays where holiday_date > current_date + 1 order by 1 limit 1), '10:00') p`, [doc])
    expect(hol.p).toMatch(/closed|consult|unavailable/)
  })
  test('WhatsApp bookings are service-role only and tagged whatsapp', async () => {
    const doc = await activeDoctor()
    const [slot] = await freeSlots(doc)
    await expect(db.as('anon', `select public.whatsapp_book_appointment('9876512345', $1, $2::date, $3, 'WA Person')`, [doc, slot.day, slot.tm])).rejects.toThrow(/permission denied/)
    await expect(db.as(USER.patient, `select public.whatsapp_book_appointment('9876512345', $1, $2::date, $3, 'WA Person')`, [doc, slot.day, slot.tm])).rejects.toThrow(/permission denied/)
    const r = await db.one<{ r: { appointment: { source: string } } }>('service', `select public.whatsapp_book_appointment('9876512345', $1, $2::date, $3, 'WA Person') r`, [doc, slot.day, slot.tm])
    expect(r.r.appointment.source).toBe('whatsapp')
    await expect(db.as('service', `select public.whatsapp_book_appointment('9876512399', $1, $2::date, $3, 'Other Person')`, [doc, slot.day, slot.tm])).rejects.toThrow(/SLOT_TAKEN|SLOT_UNAVAILABLE/)
  })
})

describe('patient self-service', () => {
  let apptId: string
  let doctorId: string
  beforeAll(async () => {
    const pid = await myPatientId()
    doctorId = await activeDoctor()
    const [slot] = await freeSlots(doctorId)
    const row = await db.one<{ id: string }>(USER.patient,
      `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time, type, status, notes, source)
       values ($1, $2, $3::date, $4, 'consultation', 'completed', 'sneaky', 'desk') returning id`, [pid, doctorId, slot.day, slot.tm])
    apptId = row.id
  })
  test('patient bookings are forced to scheduled/portal with no staff notes', async () => {
    const a = await db.one<Record<string, unknown>>(null, 'select status, source, notes from public.appointments where id = $1', [apptId])
    expect(a).toEqual({ status: 'scheduled', source: 'portal', notes: null })
  })
  test('patients cannot book invalid slots', async () => {
    const pid = await myPatientId()
    await expect(db.as(USER.patient, `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time, type, status)
      values ($1, $2, current_date - 3, '10:00', 'consultation', 'scheduled')`, [pid, doctorId])).rejects.toThrow(/SLOT_UNAVAILABLE/)
  })
  test('reschedule to a free slot; doctor/status changes are ignored or refused', async () => {
    await db.as(null, `update public.appointments set status = 'confirmed' where id = $1`, [apptId])
    const slots = await freeSlots(doctorId, 5)
    const target = slots[slots.length - 1]
    const other = (await db.one<{ id: string }>(null, `select id from public.doctors where id <> $1 limit 1`, [doctorId])).id
    await db.as(USER.patient, `update public.appointments set appointment_date = $2::date, appointment_time = $3, doctor_id = $4 where id = $1`, [apptId, target.day, target.tm, other])
    const a = await db.one<Record<string, unknown>>(null, `select appointment_date::text d, appointment_time t, doctor_id, status from public.appointments where id = $1`, [apptId])
    expect(a).toEqual({ d: target.day, t: target.tm, doctor_id: doctorId, status: 'scheduled' })
    await expect(db.as(USER.patient, `update public.appointments set status = 'completed' where id = $1`, [apptId])).rejects.toThrow(/only cancel/)
    await expect(db.as(USER.patient, `update public.appointments set appointment_time = '07:00' where id = $1`, [apptId])).rejects.toThrow(/SLOT_UNAVAILABLE/)
  })
  test('the portal reschedule dialog can send status=scheduled together with the new slot', async () => {
    await db.as(null, `update public.appointments set status = 'confirmed' where id = $1`, [apptId])
    const cur = await db.one<{ d: string; t: string }>(null, `select appointment_date::text d, appointment_time t from public.appointments where id = $1`, [apptId])
    const next = (await freeSlots(doctorId, 8)).find((x) => x.day !== cur.d || x.tm !== cur.t)!
    await db.as(USER.patient, `update public.appointments set appointment_date = $2::date, appointment_time = $3, status = 'scheduled' where id = $1`, [apptId, next.day, next.tm])
    const a = await db.one<Record<string, unknown>>(null, `select appointment_date::text d, appointment_time t, status from public.appointments where id = $1`, [apptId])
    expect(a).toEqual({ d: next.day, t: next.tm, status: 'scheduled' })
    await db.as(null, `update public.appointments set status = 'confirmed' where id = $1`, [apptId])
    await expect(db.as(USER.patient, `update public.appointments set status = 'scheduled' where id = $1`, [apptId])).rejects.toThrow(/only cancel/)
  })
  test('patients cannot touch other patients’ visits', async () => {
    const other = await db.one<{ id: string }>(null, `select id from public.appointments where patient_id <> $1 and status = 'scheduled' limit 1`, [await myPatientId()])
    await db.as(USER.patient, `update public.appointments set status = 'cancelled' where id = $1`, [other.id])
    expect((await db.one<{ status: string }>(null, 'select status from public.appointments where id = $1', [other.id])).status).toBe('scheduled')
  })
  test('cancel works, then the visit is locked', async () => {
    await db.as(USER.patient, `update public.appointments set status = 'cancelled' where id = $1`, [apptId])
    expect((await db.one<{ status: string }>(null, 'select status from public.appointments where id = $1', [apptId])).status).toBe('cancelled')
    await expect(db.as(USER.patient, `update public.appointments set status = 'scheduled' where id = $1`, [apptId])).rejects.toThrow(/no longer be changed/)
  })
})

describe('visit feedback', () => {
  test('patient rates their own completed visit once', async () => {
    const pid = await myPatientId()
    const a = await db.one<{ id: string; doctor_id: string }>(null, `select id, doctor_id from public.appointments a where patient_id = $1 and status = 'completed'
      and not exists (select 1 from public.visit_feedback f where f.appointment_id = a.id) order by appointment_date desc limit 1`, [pid])
    const f = await db.one<{ doctor_id: string; source: string }>(USER.patient,
      `insert into public.visit_feedback (appointment_id, patient_id, rating, comment, source) values ($1, $2, 5, ' great ', 'link') returning doctor_id, source`, [a.id, pid])
    expect(f).toEqual({ doctor_id: a.doctor_id, source: 'portal' })
    await expect(db.as(USER.patient, `insert into public.visit_feedback (appointment_id, patient_id, rating) values ($1, $2, 4)`, [a.id, pid])).rejects.toThrow(/duplicate|unique/)
  })
  test('patients cannot rate other people’s visits', async () => {
    const pid = await myPatientId()
    const other = await db.one<{ id: string }>(null, `select id from public.appointments a where patient_id <> $1 and status = 'completed'
      and not exists (select 1 from public.visit_feedback f where f.appointment_id = a.id) limit 1`, [pid])
    await expect(db.as(USER.patient, `insert into public.visit_feedback (appointment_id, patient_id, rating) values ($1, $2, 1)`, [other.id, pid])).rejects.toThrow(/own visits|row-level/)
  })
  test('public link: context + one submission', async () => {
    const a = await db.one<{ id: string }>(null, `select id from public.appointments a where status = 'completed' and appointment_date > current_date - 30
      and not exists (select 1 from public.visit_feedback f where f.appointment_id = a.id) limit 1`)
    const ctx = await db.one<{ r: { ok: boolean; submitted: boolean; doctor: string } }>('anon', 'select public.feedback_context($1) r', [a.id])
    expect(ctx.r.ok).toBe(true)
    expect(ctx.r.submitted).toBe(false)
    await db.as('anon', `select public.submit_feedback($1, 4, 'Nice', array['doctor', 'Bad Tag!'], true)`, [a.id])
    const saved = await db.one<{ tags: string[]; source: string }>(null, 'select tags, source from public.visit_feedback where appointment_id = $1', [a.id])
    expect(saved).toEqual({ tags: ['doctor'], source: 'link' })
    await expect(db.as('anon', `select public.submit_feedback($1, 5, null)`, [a.id])).rejects.toThrow(/already/)
    const scheduled = await db.one<{ id: string }>(null, `select id from public.appointments where status = 'scheduled' limit 1`)
    expect((await db.one<{ r: { ok: boolean } }>('anon', 'select public.feedback_context($1) r', [scheduled.id])).r.ok).toBe(false)
  })
  test('doctors only see their own ratings', async () => {
    const mine = (await db.one<{ id: string }>(null, 'select id from public.doctors where profile_id = $1', [USER.doctor])).id
    const rows = await db.as<{ doctor_id: string }>(USER.doctor, 'select doctor_id from public.visit_feedback')
    expect(rows.every((r) => r.doctor_id === mine)).toBe(true)
  })
})

describe('staff invites', () => {
  test('invited person signs up with the invited role', async () => {
    const inv = await db.one<{ token: string }>(USER.owner,
      `insert into public.staff_invites (full_name, email, role) values ('Kavya Rao', 'Kavya@Example.in', 'accountant') returning token`)
    const look = await db.one<{ r: { ok: boolean; email: string; role: string } }>('anon', 'select public.invite_lookup($1) r', [inv.token])
    expect(look.r).toMatchObject({ ok: true, email: 'kavya@example.in', role: 'accountant' })
    const u = await db.one<{ id: string }>(null, `insert into auth.users (email, raw_user_meta_data) values ('kavya@example.in', $1) returning id`,
      [JSON.stringify({ full_name: 'Kavya Rao', invite_token: inv.token })])
    expect((await db.one<{ role: string }>(null, 'select role from public.profiles where id = $1', [u.id])).role).toBe('accountant')
    expect((await db.as(null, 'select 1 from public.patients where profile_id = $1', [u.id])).length).toBe(0)
    expect((await db.one<{ r: { ok: boolean } }>('anon', 'select public.invite_lookup($1) r', [inv.token])).r.ok).toBe(false)
  })
  test('a wrong e-mail or token signs up as a patient', async () => {
    const inv = await db.one<{ token: string }>(USER.owner, `insert into public.staff_invites (full_name, email, role) values ('Dev Nair', 'dev@example.in', 'doctor') returning token`)
    const u = await db.one<{ id: string }>(null, `insert into auth.users (email, raw_user_meta_data) values ('someone@else.in', $1) returning id`, [JSON.stringify({ invite_token: inv.token })])
    expect((await db.one<{ role: string }>(null, 'select role from public.profiles where id = $1', [u.id])).role).toBe('patient')
  })
})

describe('notification queue', () => {
  test('retries wait for next_attempt_at; targeted claims only take the requested rows', async () => {
    await db.as(null, `delete from public.notification_outbox`)
    const ids = await db.as<{ id: string }>(null, `insert into public.notification_outbox (event, channel, recipient, body, related_id, next_attempt_at) values
      ('otp', 'sms', '9876500001', 'a', '00000000-0000-4000-8000-00000000aaaa', now()),
      ('otp', 'sms', '9876500002', 'b', null, now()),
      ('otp', 'sms', '9876500003', 'c', null, now() + interval '5 minutes') returning id`)
    const targeted = await db.as<{ recipient: string }>('service', `select recipient from public.claim_notifications_for(array['00000000-0000-4000-8000-00000000aaaa']::uuid[])`)
    expect(targeted.map((r) => r.recipient)).toEqual(['9876500001'])
    await expect(db.as('anon', `select * from public.claim_notifications_for(array[$1]::uuid[])`, [ids[1].id])).rejects.toThrow(/permission denied/)
    const all = await db.as<{ recipient: string; last_attempt_at: string }>('service', 'select recipient, last_attempt_at from public.claim_notifications(25)')
    expect(all.map((r) => r.recipient)).toEqual(['9876500002'])
    expect(all[0].last_attempt_at).toBeTruthy()
  })
})

describe('go-live helpers', () => {
  test('owner-only; lock bans demo logins except the caller; clear removes demo rows', async () => {
    await expect(db.as(USER.receptionist, 'select public.demo_status()')).rejects.toThrow(/Only the hospital owner/)
    const st = await db.one<{ s: Record<string, unknown> }>(USER.owner, 'select public.demo_status() s')
    expect(st.s).toMatchObject({ demo_accounts_active: 5, owner_is_demo_email: true, owner_has_demo_password: true })
    expect(await db.one(USER.owner, 'select public.lock_demo_accounts() n')).toEqual({ n: 5 })
    const banned = await db.one<{ n: number }>(null, `select count(*)::int n from auth.users where banned_until = 'infinity'`)
    expect(banned.n).toBe(5)
    const cleared = await db.one<{ n: number }>(USER.owner, 'select public.clear_demo_data() n')
    expect(cleared.n).toBeGreaterThan(500)
    expect((await db.one<{ n: number }>(null, `select count(*)::int n from public.patients where public.is_demo_id(id)`)).n).toBe(0)
  })
})

describe('production.sql', () => {
  test('no demo data; bootstrap e-mail becomes owner once; demo helpers off', async () => {
    const p = await freshDb('production')
    expect((await p.one<{ n: number }>(null, 'select count(*)::int n from auth.users')).n).toBe(0)
    expect((await p.one<{ n: number }>(null, 'select count(*)::int n from public.appointments')).n).toBe(0)
    const s = await p.one<{ d: { portal: { showDemoLogins: boolean }; booking: { showDemoOtp: boolean } } }>(null, `select data d from public.site_content where key = 'settings'`)
    expect(s.d.portal.showDemoLogins).toBe(false)
    expect(s.d.booking.showDemoOtp).toBe(false)
    const a = await p.one<{ id: string }>(null, `insert into auth.users (email) values ('OWNER@your-hospital.in') returning id`)
    const b = await p.one<{ id: string }>(null, `insert into auth.users (email) values ('someone@gmail.com') returning id`)
    expect((await p.one<{ role: string }>(null, 'select role from public.profiles where id = $1', [a.id])).role).toBe('owner')
    expect((await p.one<{ role: string }>(null, 'select role from public.profiles where id = $1', [b.id])).role).toBe('patient')
  }, 120_000)
})

describe('WhatsApp chatbot helpers', () => {
  test('are service-role only', async () => {
    const doc = await activeDoctor()
    await expect(db.as('anon', 'select * from public.bot_free_slots($1)', [doc])).rejects.toThrow(/permission denied/)
    await expect(db.as(USER.patient, `select public.bot_upcoming('9876500000')`)).rejects.toThrow(/permission denied/)
    await expect(db.as(USER.receptionist, `select public.whatsapp_cancel_appointment('9876500000', gen_random_uuid())`)).rejects.toThrow(/permission denied/)
  })
  test('free slots are bookable; upcoming lists the booking; cancel only works for the same number', async () => {
    const doc = await activeDoctor()
    const slots = await db.as<{ slot_date: string; slot_time: string }>('service', 'select slot_date::text, slot_time from public.bot_free_slots($1, 4)', [doc])
    expect(slots.length).toBe(4)
    const s0 = slots[0]
    expect(await db.one<{ p: string | null }>(null, 'select public.slot_problem($1, $2::date, $3, true) p', [doc, s0.slot_date, s0.slot_time])).toEqual({ p: null })
    const phone = '9123400011'
    const r = await db.one<{ r: { appointment: { id: string } } }>('service', `select public.whatsapp_book_appointment($1, $2, $3::date, $4, 'Bot Patient', 'cough') r`, [phone, doc, s0.slot_date, s0.slot_time])
    const after = await db.as<{ slot_date: string; slot_time: string }>('service', 'select slot_date::text, slot_time from public.bot_free_slots($1, 4)', [doc])
    expect(after.some((x) => x.slot_date === s0.slot_date && x.slot_time === s0.slot_time)).toBe(false)
    const up = await db.one<{ r: { id: string; ref: string }[] }>('service', 'select public.bot_upcoming($1) r', [`+91 ${phone}`])
    expect(up.r.map((x) => x.id)).toContain(r.r.appointment.id)
    expect((await db.one<{ r: { full_name: string } }>('service', 'select public.bot_patient($1) r', [phone])).r.full_name).toBe('Bot Patient')
    await expect(db.as('service', 'select public.whatsapp_cancel_appointment($1, $2)', ['9999900000', r.r.appointment.id])).rejects.toThrow(/cannot be cancelled/)
    await db.as('service', 'select public.whatsapp_cancel_appointment($1, $2)', [phone, r.r.appointment.id])
    expect((await db.one<{ status: string }>(null, 'select status from public.appointments where id = $1', [r.r.appointment.id])).status).toBe('cancelled')
  })
})

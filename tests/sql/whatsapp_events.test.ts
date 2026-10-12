/** Persistent webhook dedupe, per-phone conversation serialization and retry-safe booking idempotency. */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, type Db } from './harness'

let db: Db
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'

beforeAll(async () => { db = await freshDb('master') }, 180_000)

const begin = async (provider: string, externalId: string, phone: string, tenant = A) =>
  (await db.one<{ r: any }>('service', `select public.wa_begin_event($1, $2, $3, $4) r`, [tenant, provider, externalId, phone])).r
const stage = (event: string, token: number, state = { step: 'menu', lang: 'en', at: Date.now() }, replies = ['menu']) =>
  db.one<{ r: boolean }>('service', `select public.wa_stage_event($1::uuid, $2::bigint, $3::jsonb, $4::jsonb) r`, [event, token, JSON.stringify(state), JSON.stringify(replies)])
const complete = (event: string, token: number) =>
  db.one<{ r: boolean }>('service', `select public.wa_complete_event($1::uuid, $2::bigint) r`, [event, token])

describe('WhatsApp webhook event claims', () => {
  test('duplicate deliveries are stored, and one phone cannot process two messages at once', async () => {
    const first = await begin('meta', 'wamid.first', '9876503333')
    expect(first).toMatchObject({ ok: true, duplicate: false, state: null, staged_state: null, staged_replies: null })

    const other = await begin('meta', 'wamid.second', '9876503333')
    expect(other).toMatchObject({ ok: false, busy: true })
    const duplicateWhileWorking = await begin('meta', 'wamid.first', '9876503333')
    expect(duplicateWhileWorking).toMatchObject({ ok: false, busy: true })

    expect((await stage(first.event_id, first.lease_token)).r).toBe(true)
    expect((await complete(first.event_id, first.lease_token)).r).toBe(true)
    const replay = await begin('meta', 'wamid.first', '9876503333')
    expect(replay).toMatchObject({ ok: true, duplicate: true, completed: true })
    const saved = await db.one<{ state: unknown }>(null, `select state from public.wa_sessions where tenant_id = $1 and phone = '9876503333'`, [A])
    expect(saved.state).toMatchObject({ step: 'menu', lang: 'en' })

    const next = await begin('meta', 'wamid.second', '9876503333')
    expect(next).toMatchObject({ ok: true, duplicate: false, state: { step: 'menu', lang: 'en' } })
  })

  test('failed work releases its lease and can be reclaimed with a fencing token', async () => {
    const first = await begin('openwa', 'openwa-1', '9876503334')
    const failed = await db.one<{ r: boolean }>('service', `select public.wa_fail_event($1::uuid, $2::bigint) r`, [first.event_id, first.lease_token])
    expect(failed.r).toBe(true)

    const retry = await begin('openwa', 'openwa-1', '9876503334')
    expect(retry.event_id).toBe(first.event_id)
    expect(retry.lease_token).toBeGreaterThan(first.lease_token)
    expect((await stage(first.event_id, first.lease_token)).r).toBe(false)
    expect((await stage(retry.event_id, retry.lease_token, { step: 'slot', lang: 'en' }, ['pick a time'])).r).toBe(true)
    expect((await complete(retry.event_id, retry.lease_token)).r).toBe(true)
  })

  test('event IDs are scoped by tenant and provider', async () => {
    await db.as(null, `insert into public.tenants (id, slug, name, code) values ($1, 'events-clinic', 'Events Clinic', 'EVT')`, [B])
    const a = await begin('meta', 'same-provider-id', '9876503335', A)
    const b = await begin('meta', 'same-provider-id', '9876503335', B)
    const w = await begin('wacrm', 'same-provider-id', '9876503335', A)
    expect(new Set([a.event_id, b.event_id, w.event_id]).size).toBe(3)
  })

  test('a retried booking event returns the original booking instead of creating another appointment', async () => {
    const slot = await db.one<{ doctor_id: string; slot_date: string; slot_time: string }>(null, `
      select d.id as doctor_id, g.slot_date::date::text as slot_date, t.tm as slot_time
        from public.doctors d,
             generate_series(public.today_ist() + 2, public.today_ist() + 25, interval '1 day') as g(slot_date),
             (select to_char(time '08:00' + k * interval '30 min', 'HH24:MI') as tm from generate_series(0, 21) as slots(k)) as t
       where d.status = 'active' and public.slot_problem(d.id, g.slot_date::date, t.tm, true) is null
         and not exists (select 1 from public.appointments a where a.doctor_id = d.id and a.appointment_date = g.slot_date::date
                           and a.appointment_time = t.tm and a.status not in ('cancelled', 'no_show'))
       order by d.full_name, g.slot_date, t.tm limit 1`)
    const claim = await begin('meta', 'wamid.book-once', '9876503336')
    const book = () => db.one<{ r: any }>('service', `select public.whatsapp_book_appointment(
      '9876503336', $1, $2::date, $3, 'Event Patient', 'consultation', $4::uuid, $5::bigint) r`,
    [slot.doctor_id, slot.slot_date, slot.slot_time, claim.event_id, claim.lease_token])

    const first = await book()
    const retry = await book()
    expect(retry.r.ref).toBe(first.r.ref)
    const count = await db.one<{ n: number }>(null, `select count(*)::int n from public.appointments where booking_ref = $1`, [first.r.ref])
    expect(count.n).toBe(1)
    const invoices = await db.one<{ n: number }>(null, `select count(*)::int n from public.invoices where notes like '%' || $1 || '%'`, [first.r.ref])
    expect(invoices.n).toBe(1)
  })
})

/**
 * Server-side pagination support (scripts/sql/scale.sql): payment → invoice sync trigger, indexes, upgrade path.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

let db: Db
beforeAll(async () => { db = await freshDb('master') }, 180_000)

type Inv = { id: string; patient_id: string; total: string; amount_paid: string; status: string }
const invoice = (id: string) => db.one<Inv>(null, 'select id, patient_id, total::text, amount_paid::text, status from public.invoices where id = $1', [id])

describe('payments keep invoice totals in the database', () => {
  let inv: Inv
  beforeAll(async () => {
    const p = await db.one<{ id: string }>(null, `select id from public.patients order by mrn limit 1`)
    inv = await db.one<Inv>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items, subtotal, total, status, due_date)
      values ('', $1, '[{"description":"Consultation","quantity":1,"unit_price":1000}]', 1000, 1000, 'unpaid', current_date + 10)
      returning id, patient_id, total::text, amount_paid::text, status`, [p.id])
  })

  test('a payment stamps the patient and makes the invoice partial, then paid', async () => {
    // no patient_id sent — the trigger takes it from the invoice
    const pay = await db.one<{ id: string; patient_id: string }>(USER.accountant,
      `insert into public.payments (invoice_id, amount, method) values ($1, 400, 'upi') returning id, patient_id`, [inv.id])
    expect(pay.patient_id).toBe(inv.patient_id)
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '400.00', status: 'partial' })
    await db.as(USER.accountant, `insert into public.payments (invoice_id, amount, method) values ($1, 600, 'cash')`, [inv.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '1000.00', status: 'paid' })
    // editing an amount and deleting a payment recompute from the remaining payments
    await db.as(USER.owner, `update public.payments set amount = 100 where id = $1`, [pay.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '700.00', status: 'partial' })
    await db.as(USER.owner, `delete from public.payments where invoice_id = $1`, [inv.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '0.00', status: 'unpaid' })
  })

  test('moving a payment to another invoice updates both; cancelled invoices keep their status', async () => {
    const other = await db.one<Inv>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items, subtotal, total, status)
      values ('', $1, '[]', 500, 500, 'unpaid') returning id, patient_id, total::text, amount_paid::text, status`, [inv.patient_id])
    const pay = await db.one<{ id: string }>(USER.accountant, `insert into public.payments (invoice_id, amount) values ($1, 500) returning id`, [inv.id])
    await db.as(USER.owner, `update public.payments set invoice_id = $2 where id = $1`, [pay.id, other.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '0.00', status: 'unpaid' })
    expect(await invoice(other.id)).toMatchObject({ amount_paid: '500.00', status: 'paid' })
    await db.as(USER.owner, `update public.invoices set status = 'cancelled' where id = $1`, [inv.id])
    await db.as(USER.accountant, `insert into public.payments (invoice_id, amount) values ($1, 50)`, [inv.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '50.00', status: 'cancelled' })
  })

  test('the recalculation helpers are not callable by users', async () => {
    await expect(db.as(USER.owner, `select public.invoice_recalc($1)`, [inv.id])).rejects.toThrow(/permission denied/)
  })

  test('seeded invoices already match their payments', async () => {
    const bad = await db.one<{ n: number }>(null, `select count(*)::int n from public.invoices i
      where i.amount_paid <> coalesce((select sum(amount) from public.payments p where p.invoice_id = i.id), 0)`)
    expect(bad.n).toBe(0)
  })
})

describe('indexes and upgrade path', () => {
  test('sort / window indexes exist', async () => {
    const rows = await db.as<{ indexname: string }>(null, `select indexname from pg_indexes where schemaname = 'public'`)
    const names = new Set(rows.map((r) => r.indexname))
    for (const n of ['invoices_issue_idx', 'payments_paid_on_idx', 'patients_created_idx', 'admissions_status_idx', 'lab_tests_requested_idx']) expect(names).toContain(n)
  })
  test('upgrade-2026-10.sql ships the scale section and can be re-run on a current database', async () => {
    const upgrade = readFileSync(resolve(__dirname, '../../supabase/upgrade-2026-10.sql'), 'utf8')
    const scale = readFileSync(resolve(__dirname, '../../scripts/sql/scale.sql'), 'utf8')
    expect(upgrade).toContain(scale.trim())
    const before = await db.one<{ n: number }>(null, 'select count(*)::int n from public.payments')
    await db.exec(upgrade)
    await db.exec(upgrade)
    expect((await db.one<{ n: number }>(null, 'select count(*)::int n from public.payments')).n).toBe(before.n)
  }, 60_000)
})

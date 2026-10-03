/**
 * Server-side pagination support (scripts/sql/scale.sql): payment → invoice sync trigger, indexes, upgrade path.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'
import { rawReport, type RawReport } from '../../src/lib/reports'
import { summariseFinance, type FinanceSummary } from '../../src/lib/dashboardFinance'

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

  test('moving a payment to another invoice updates both; cancelled invoices take no payments', async () => {
    const other = await db.one<Inv>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items, subtotal, total, status)
      values ('', $1, '[{"description":"X-ray","quantity":1,"unit_price":500}]', 500, 500, 'unpaid') returning id, patient_id, total::text, amount_paid::text, status`, [inv.patient_id])
    const pay = await db.one<{ id: string }>(USER.accountant, `insert into public.payments (invoice_id, amount) values ($1, 500) returning id`, [inv.id])
    await db.as(USER.owner, `update public.payments set invoice_id = $2 where id = $1`, [pay.id, other.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '0.00', status: 'unpaid' })
    expect(await invoice(other.id)).toMatchObject({ amount_paid: '500.00', status: 'paid' })
    await db.as(USER.owner, `update public.invoices set status = 'cancelled' where id = $1`, [inv.id])
    // a cancelled bill takes no payments (scripts/sql/integrity.sql) and keeps its status
    await expect(db.as(USER.accountant, `insert into public.payments (invoice_id, amount) values ($1, 50)`, [inv.id])).rejects.toThrow(/is cancelled/)
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '0.00', status: 'cancelled' })
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

describe('financial_report', () => {
  test('database totals match the demo-mode calculation', async () => {
    const from = (await db.one<{ d: string }>(null, `select (date_trunc('month', current_date) - interval '5 months')::date::text d`)).d
    const sql = (await db.one<{ r: RawReport }>(USER.accountant, 'select public.financial_report($1::date) r', [from])).r
    const num = (rows: Record<string, unknown>[], ...cols: string[]) => rows.map((r) => { for (const c of cols) r[c] = Number(r[c]); return r })
    const inv = num(await db.as(null, `select issue_date::text, status, total, items from public.invoices`), 'total')
    const pay = num(await db.as(null, `select paid_on::text, amount from public.payments`), 'amount')
    const exp = num(await db.as(null, `select expense_date::text, amount, category from public.expenses`), 'amount')
    const js = rawReport(inv as never, pay as never, exp as never, from)
    for (const k of ['billed', 'collected', 'expenses', 'sources', 'cats', 'doctors'] as const) {
      expect(Object.keys(sql[k]).sort(), k).toEqual(Object.keys(js[k]).sort())
      for (const [key, v] of Object.entries(js[k])) expect(Number(sql[k][key]), `${k}.${key}`).toBeCloseTo(v, 2)
    }
    expect(Object.keys(js.billed).length).toBeGreaterThan(3)
  })
  test('row level security applies: a patient only gets their own billing and no expenses', async () => {
    const r = (await db.one<{ r: RawReport }>(USER.patient, `select public.financial_report(current_date - 400) r`)).r
    expect(r.expenses).toEqual({})
    await expect(db.as('anon', `select public.financial_report(current_date)`)).rejects.toThrow(/permission denied/)
  })
})

describe('dashboard_finance', () => {
  test('database totals and lists match the demo-mode calculation', async () => {
    const from = (await db.one<{ d: string }>(null, `select (date_trunc('month', current_date) - interval '5 months')::date::text d`)).d
    const sql = (await db.one<{ r: FinanceSummary }>(USER.owner, 'select public.dashboard_finance($1::date) r', [from])).r
    const num = (rows: Record<string, unknown>[], ...cols: string[]) => rows.map((r) => { for (const c of cols) r[c] = Number(r[c]); return r })
    const inv = num(await db.as(null, `select id, issue_date::text, due_date::text, status, total, amount_paid from public.invoices`), 'total', 'amount_paid')
    const pay = num(await db.as(null, `select id, paid_on::text, amount, method, created_at::text from public.payments`), 'amount')
    const exp = num(await db.as(null, `select expense_date::text, amount from public.expenses`), 'amount')
    const js = summariseFinance(inv as never, pay as never, exp as never, from)
    for (const k of ['revenue', 'expenses', 'methods'] as const) {
      expect(Object.keys(sql[k]).sort(), k).toEqual(Object.keys(js[k]).sort())
      for (const [key, v] of Object.entries(js[k])) expect(Number(sql[k][key]), `${k}.${key}`).toBeCloseTo(v, 2)
    }
    expect(Number(sql.outstanding)).toBeCloseTo(js.outstanding, 2)
    expect(Number(sql.open_count)).toBe(js.open_count)
    expect(js.open_count).toBeGreaterThan(0)
    // same balances in the same order (ties may pick a different invoice)
    const bal = (l: { total: unknown; amount_paid: unknown }[]) => l.map((i) => Number(i.total) - Number(i.amount_paid))
    expect(bal(sql.top_open)).toEqual(bal(js.top_open))
    expect(bal(sql.overdue)).toEqual(bal(js.overdue))
    expect(sql.top_open.length).toBeLessThanOrEqual(5)
    expect(sql.recent.map((p) => p.paid_on)).toEqual(js.recent.map((p) => p.paid_on))
    // whole rows come back (the lists link to the invoice and show the patient)
    expect(sql.top_open[0]).toHaveProperty('invoice_number')
    expect(sql.top_open[0]).toHaveProperty('patient_id')
    expect(sql.top_open[0]).not.toHaveProperty('balance')
  })
  test('row level security applies: a patient only sees their own bills, visitors nothing', async () => {
    const mine = await db.as<{ id: string }>(null, `select pa.id from public.patients pa where pa.profile_id = $1`, [USER.patient])
    const r = (await db.one<{ r: FinanceSummary }>(USER.patient, `select public.dashboard_finance(current_date - 400) r`)).r
    expect(r.expenses).toEqual({})
    expect(r.recent.every((p) => p.patient_id === mine[0].id)).toBe(true)
    await expect(db.as('anon', `select public.dashboard_finance(current_date)`)).rejects.toThrow(/permission denied/)
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

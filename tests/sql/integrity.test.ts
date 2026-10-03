/**
 * scripts/sql/integrity.sql — the money / bed / same-hospital rules live in the database, so a stale browser tab, two
 * receptionists at once or a hand-made API call cannot leave the books or the ward wrong.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'

let db: Db
const B = 'b0000000-0000-4000-8000-000000000002'
const B_OWNER = 'b0b00000-0000-4000-8000-000000000001'
type Inv = { id: string; subtotal: string; total: string; amount_paid: string; status: string }
const ITEMS = (...rows: [number, number][]) => JSON.stringify(rows.map(([quantity, unit_price], i) => ({ description: `Item ${i + 1}`, quantity, unit_price })))

let patientId: string
const newPatient = async (name: string) =>
  (await db.one<{ id: string }>(USER.receptionist, `insert into public.patients (full_name, phone, gender) values ($1, '9811100000', 'male') returning id`, [name])).id
const invoice = (id: string) => db.one<Inv>(null, `select id, subtotal::text, total::text, amount_paid::text, status from public.invoices where id = $1`, [id])
const freeBed = async () => (await db.one<{ id: string; bed_number: string }>(null,
  `select b.id, b.bed_number from public.beds b where b.status = 'available' and not exists (select 1 from public.admissions a where a.bed_id = b.id and a.status = 'admitted') order by b.bed_number limit 1`))

beforeAll(async () => {
  db = await freshDb('master')
  patientId = await newPatient('Integrity Test')
  // a second hospital with its own owner, bed and invoice
  await db.as(null, `insert into public.tenants (id, slug, name, code) values ($1, 'city', 'City Hospital', 'CTY')`, [B])
  await db.as(null, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'owner@city.in', 'x', $2::jsonb)`, [B_OWNER, JSON.stringify({ full_name: 'City Owner', tenant_id: B })])
  await db.as(null, `update public.profiles set role = 'owner' where id = $1`, [B_OWNER])
  await db.as(null, `delete from public.patients where profile_id = $1`, [B_OWNER])
}, 120_000)

describe('invoices: totals come from the line items', () => {
  test('subtotal / total are recomputed, whatever the browser sent; amount paid cannot be typed in', async () => {
    const inv = await db.one<Inv>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items, subtotal, discount, tax, total, amount_paid, status)
      values ('', $1, $2, 1, 100, 18, 999999, 5000, 'paid') returning id, subtotal::text, total::text, amount_paid::text, status`, [patientId, ITEMS([2, 500], [1, 250.5])])
    expect(inv).toMatchObject({ subtotal: '1250.50', total: '1168.50', amount_paid: '0.00', status: 'unpaid' })
    await db.as(USER.owner, `update public.invoices set amount_paid = 1168.50, total = 1 where id = $1`, [inv.id])
    expect(await invoice(inv.id)).toMatchObject({ total: '1168.50', amount_paid: '0.00', status: 'unpaid' })
  })

  test('bad line items, negative tax, a discount bigger than the bill are refused with a clear message', async () => {
    const ins = (items: string, discount = 0, tax = 0) => db.as(USER.accountant,
      `insert into public.invoices (invoice_number, patient_id, items, discount, tax) values ('', $1, $2, $3, $4)`, [patientId, items, discount, tax])
    await expect(ins(ITEMS([0, 100]))).rejects.toThrow(/quantity above 0/)
    await expect(ins(ITEMS([1, -5]))).rejects.toThrow(/cannot be negative/)
    await expect(ins(JSON.stringify([{ description: 'x', quantity: 'two', unit_price: 1 }]))).rejects.toThrow(/needs a number/)
    await expect(ins(ITEMS([1, 100]), 0, -1)).rejects.toThrow(/cannot be negative/)
    await expect(ins(ITEMS([1, 100]), 150, 0)).rejects.toThrow(/discount is larger/)
  })

  test('payments: never above the balance, never on draft / cancelled bills; a paid bill cannot be cancelled or shrunk', async () => {
    const inv = await db.one<Inv>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items) values ('', $1, $2) returning id`, [patientId, ITEMS([1, 1000])])
    const pay = (amount: number, id = inv.id) => db.as(USER.receptionist, `insert into public.payments (invoice_id, amount) values ($1, $2)`, [id, amount])
    await pay(600)
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '600.00', status: 'partial' })
    await expect(pay(400.01)).rejects.toThrow(/more than the balance due .*₹400\.00/)
    await expect(db.as(USER.owner, `update public.invoices set status = 'cancelled' where id = $1`, [inv.id])).rejects.toThrow(/already has payments/)
    await expect(db.as(USER.owner, `update public.invoices set items = $2 where id = $1`, [inv.id, ITEMS([1, 500])])).rejects.toThrow(/cannot be less than what has already been paid/)
    // editing a payment counts the others, not itself
    const p = await db.one<{ id: string }>(null, `select id from public.payments where invoice_id = $1`, [inv.id])
    await db.as(USER.owner, `update public.payments set amount = 1000 where id = $1`, [p.id])
    expect(await invoice(inv.id)).toMatchObject({ amount_paid: '1000.00', status: 'paid' })

    const draft = await db.one<Inv>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items, status) values ('', $1, $2, 'draft') returning id`, [patientId, ITEMS([1, 100])])
    await expect(pay(50, draft.id)).rejects.toThrow(/is draft/)
  })
})

describe('admissions and beds stay consistent', () => {
  test('admit → bed occupied, patient inpatient; the same bed / the same patient cannot be admitted twice', async () => {
    const bed = await freeBed()
    const adm = await db.one<{ id: string }>(USER.receptionist, `insert into public.admissions (patient_id, bed_id, reason) values ($1, $2, 'Fever') returning id`, [patientId, bed.id])
    expect(await db.one(null, `select status from public.beds where id = $1`, [bed.id])).toMatchObject({ status: 'occupied' })
    expect(await db.one(null, `select status from public.patients where id = $1`, [patientId])).toMatchObject({ status: 'inpatient' })

    const other = await newPatient('Second Patient')
    await expect(db.as(USER.receptionist, `insert into public.admissions (patient_id, bed_id, reason) values ($1, $2, 'x')`, [other, bed.id])).rejects.toThrow(/already occupied/)
    const bed2 = await freeBed()
    await expect(db.as(USER.receptionist, `insert into public.admissions (patient_id, bed_id, reason) values ($1, $2, 'x')`, [patientId, bed2.id])).rejects.toThrow(/already admitted/)

    // the bed cannot be freed, deleted or put in maintenance while the patient is in it
    await expect(db.as(USER.staff, `update public.beds set status = 'available' where id = $1`, [bed.id])).rejects.toThrow(/has an admitted patient/)
    await expect(db.as(USER.owner, `delete from public.beds where id = $1`, [bed.id])).rejects.toThrow(/has an admitted patient/)
    // …and a free bed cannot be marked occupied by hand
    await expect(db.as(USER.staff, `update public.beds set status = 'occupied' where id = $1`, [bed2.id])).rejects.toThrow(/when a patient is admitted/)

    // transfer: old bed frees, new one fills
    await db.as(USER.doctor, `update public.admissions set bed_id = $2 where id = $1`, [adm.id, bed2.id])
    expect((await db.as(null, `select id, status from public.beds where id in ($1, $2) order by status`, [bed.id, bed2.id])).map((r) => r.status)).toEqual(['available', 'occupied'])

    // discharge: date stamped, bed free, patient discharged
    await db.as(USER.doctor, `update public.admissions set status = 'discharged' where id = $1`, [adm.id])
    expect(await db.one(null, `select discharge_date is not null as stamped from public.admissions where id = $1`, [adm.id])).toMatchObject({ stamped: true })
    expect(await db.one(null, `select status from public.beds where id = $1`, [bed2.id])).toMatchObject({ status: 'available' })
    expect(await db.one(null, `select status from public.patients where id = $1`, [patientId])).toMatchObject({ status: 'discharged' })
  })

  test('a bed under maintenance cannot take a patient', async () => {
    const bed = await freeBed()
    await db.as(USER.staff, `update public.beds set status = 'maintenance' where id = $1`, [bed.id])
    const p = await newPatient('Maint Patient')
    await expect(db.as(USER.receptionist, `insert into public.admissions (patient_id, bed_id, reason) values ($1, $2, 'x')`, [p, bed.id])).rejects.toThrow(/under maintenance/)
    await db.as(USER.staff, `update public.beds set status = 'available' where id = $1`, [bed.id])
  })

  test('the database refuses a second admitted row on a bed even without the trigger (unique index)', async () => {
    const idx = await db.as(null, `select indexname from pg_indexes where indexname in ('admissions_one_per_bed', 'admissions_one_per_patient') order by 1`)
    expect(idx.map((r) => r.indexname)).toEqual(['admissions_one_per_bed', 'admissions_one_per_patient'])
  })
})

describe("references never cross into another hospital", () => {
  test("hospital B cannot attach hospital A's bed, invoice, doctor or patient to its rows", async () => {
    const aBed = await freeBed()
    const aDoctor = await db.one<{ id: string }>(null, `select id from public.doctors order by full_name limit 1`)
    const aInv = await db.one<{ id: string }>(USER.accountant, `insert into public.invoices (invoice_number, patient_id, items) values ('', $1, $2) returning id`, [patientId, ITEMS([1, 300])])
    const bPatient = await db.one<{ id: string }>(B_OWNER, `insert into public.patients (full_name, phone, gender) values ('B Patient', '9822200000', 'female') returning id`)

    await expect(db.as(B_OWNER, `insert into public.admissions (patient_id, bed_id, reason) values ($1, $2, 'x')`, [bPatient.id, aBed.id])).rejects.toThrow(/bed belongs to another hospital/)
    await expect(db.as(B_OWNER, `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time) values ($1, $2, current_date + 1, '10:00')`, [bPatient.id, aDoctor.id])).rejects.toThrow(/doctor belongs to another hospital/)
    await expect(db.as(B_OWNER, `insert into public.payments (invoice_id, amount) values ($1, 100)`, [aInv.id])).rejects.toThrow(/belongs to another hospital|Invoice not found/)
    await expect(db.as(USER.receptionist, `insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time) values ($1, $2, current_date + 1, '11:00')`, [bPatient.id, aDoctor.id])).rejects.toThrow(/patient belongs to another hospital/)
    // A's rows are untouched
    expect(await db.one(null, `select status from public.beds where id = $1`, [aBed.id])).toMatchObject({ status: 'available' })
    expect(await invoice(aInv.id)).toMatchObject({ amount_paid: '0.00' })
  })
})

describe('lab tests', () => {
  test('completion date is stamped and cleared with the status', async () => {
    const t = await db.one<{ id: string }>(USER.doctor, `insert into public.lab_tests (patient_id, test_name) values ($1, 'CBC') returning id`, [patientId])
    await db.as(USER.staff, `update public.lab_tests set status = 'completed', result = 'Normal' where id = $1`, [t.id])
    expect(await db.one(null, `select completed_on is not null as done from public.lab_tests where id = $1`, [t.id])).toMatchObject({ done: true })
    await db.as(USER.staff, `update public.lab_tests set status = 'in_progress' where id = $1`, [t.id])
    expect(await db.one(null, `select completed_on from public.lab_tests where id = $1`, [t.id])).toMatchObject({ completed_on: null })
  })
})

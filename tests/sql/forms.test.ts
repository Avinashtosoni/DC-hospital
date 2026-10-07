/**
 * Website forms (scripts/sql/forms.sql): site_forms access rules, submit_site_form() validation,
 * parity with toEnquiry() in src/forms/schema.ts, legacy Contact-form inserts and the upgrade path.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { freshDb, USER, type Db } from './harness'
import { CONTACT_FORM_ID, DEFAULT_FORMS, REVIEW_FORM_ID, toEnquiry, type Answers } from '../../src/forms/schema'

let db: Db
beforeAll(async () => { db = await freshDb('master') }, 180_000)

const submit = (form: string, answers: Answers, who: string | null = 'anon') =>
  db.one<{ r: { ref: string } }>(who, 'select public.submit_site_form($1, $2) r', [form, JSON.stringify(answers)]).then((x) => x.r)
const byRef = (ref: string) => db.one<Record<string, unknown>>(null, 'select * from public.site_enquiries where ref = $1', [ref])
/** each test uses its own numbers; the flood limit is 3 per number per hour */
let n = 0
const phone = () => `98765${String(43000 + ++n)}`

describe('site_forms access', () => {
  test('built-in forms are installed once with the ids the app expects', async () => {
    const rows = await db.as<{ id: string; slug: string }>(null, 'select id, slug from public.site_forms order by sort')
    expect(rows.slice(0, 2)).toEqual([{ id: CONTACT_FORM_ID, slug: 'contact' }, { id: REVIEW_FORM_ID, slug: 'review' }])
  })

  test('visitors see only enabled forms and cannot change them', async () => {
    await db.as(null, `update public.site_forms set enabled = false where slug = 'callback'`)
    const slugs = (await db.as<{ slug: string }>('anon', 'select slug from public.site_forms')).map((r) => r.slug)
    expect(slugs).toContain('review'); expect(slugs).not.toContain('callback')
    await expect(db.as('anon', `update public.site_forms set name = 'x'`)).rejects.toThrow(/permission denied/)
    const patientUpd = await db.as(USER.patient, `update public.site_forms set name = 'Hacked' returning id`)
    expect(patientUpd).toHaveLength(0)
    await db.as(null, `update public.site_forms set enabled = true where slug = 'callback'`)
  })

  test('receptionist reads every form (also disabled ones) but only the owner edits', async () => {
    await db.as(null, `update public.site_forms set enabled = false where slug = 'callback'`)
    expect((await db.as(USER.receptionist, `select 1 from public.site_forms where slug = 'callback'`))).toHaveLength(1)
    expect(await db.as(USER.receptionist, `update public.site_forms set name = 'R' where slug = 'callback' returning id`)).toHaveLength(0)
    expect(await db.as(USER.owner, `update public.site_forms set enabled = true where slug = 'callback' returning id`)).toHaveLength(1)
    await expect(db.as(USER.owner, `insert into public.site_forms (slug, name) values ('Bad Slug', 'Bad')`)).rejects.toThrow(/check constraint/)
  })
})

describe('submit_site_form()', () => {
  test('a review lands in the inbox exactly like toEnquiry() builds it', async () => {
    const answers: Answers = { rating: 4, name: '  Meera Iyer ', phone: phone(), liked: ['Cleanliness', 'Nursing care'], message: 'Clean rooms and kind nurses, thank you.', publish: true, ignored_key: 'x' }
    const { ref } = await submit(REVIEW_FORM_ID, answers)
    expect(ref).toMatch(/^DCH-\d{6}$/)
    const row = await byRef(ref)
    const review = DEFAULT_FORMS.find((f) => f.id === REVIEW_FORM_ID)!
    const want = toEnquiry(review, answers)
    expect(row).toMatchObject({ name: want.name, phone: want.phone, email: null, topic: want.topic, message: want.message,
      form_id: REVIEW_FORM_ID, form_name: 'Patient review', status: 'new', read_at: null, starred: false })
    expect(row.data).toEqual(want.data)
  })

  test('a form without a message field gets every answer as the message', async () => {
    const id = (await db.one<{ id: string }>(USER.owner, `insert into public.site_forms (slug, name, fields, settings) values ('camp-test', 'Camp test', $1, '{"topic":"Health camp"}') returning id`,
      [JSON.stringify([{ id: 'name', type: 'text', label: 'Name', role: 'name' }, { id: 'phone', type: 'phone', label: 'Mobile', role: 'phone' },
        { id: 'age', type: 'number', label: 'Age', required: true }, { id: 'tests', type: 'checkboxes', label: 'Tests', options: ['BP', 'Sugar'] }])])).id
    const answers: Answers = { name: 'Ravi Kumar', phone: phone(), age: '42', tests: ['BP', 'Sugar'] }
    const row = await byRef((await submit(id, answers)).ref)
    expect(row).toMatchObject({ topic: 'Health camp', message: 'Age: 42\nTests: BP, Sugar', form_name: 'Camp test' })
    expect(row.message).toBe(toEnquiry({ id, name: 'Camp test', fields: [{ id: 'name', type: 'text', label: 'Name', role: 'name' }, { id: 'phone', type: 'phone', label: 'Mobile', role: 'phone' },
      { id: 'age', type: 'number', label: 'Age', required: true }, { id: 'tests', type: 'checkboxes', label: 'Tests', options: ['BP', 'Sugar'] }], settings: { topic: 'Health camp' } }, answers).message)
  })

  test.each([
    [{ name: 'Asha', phone: '12345', message: 'Long enough message here', rating: 5 }, /valid 10-digit mobile/],
    [{ name: 'Asha', phone: '9876500001', message: 'Long enough message here' }, /choose a rating/],
    [{ name: 'Asha', phone: '9876500001', message: 'Long enough message here', rating: 9 }, /choose a rating/],
    [{ name: 'Asha', phone: '9876500001', message: 'short', rating: 5 }, /at least 10 characters/],
    [{ name: 'Asha', phone: '9876500001', message: 'Long enough message here', rating: 5, liked: ['Free food'] }, /choose from the options/],
    [{ name: 'Asha', phone: '9876500001', message: 'Long enough message here', rating: 5, liked: 'Cleanliness' }, /invalid answer/],
    [{ phone: '9876500001', message: 'Long enough message here', rating: 5 }, /Full name is required/],
  ])('rejects bad answers %#', async (answers, err) => {
    await expect(submit(REVIEW_FORM_ID, answers as Answers)).rejects.toThrow(err)
  })

  test('disabled or unknown forms refuse submissions', async () => {
    await db.as(null, `update public.site_forms set enabled = false where slug = 'review'`)
    await expect(submit(REVIEW_FORM_ID, { rating: 5, name: 'Asha', phone: phone(), message: 'Long enough message here' })).rejects.toThrow(/not available/)
    await db.as(null, `update public.site_forms set enabled = true where slug = 'review'`)
    await expect(submit('00000000-0000-4000-8000-000000000000', {})).rejects.toThrow(/not available/)
  })

  test('the flood limit still applies (3 per mobile per hour)', async () => {
    const p = phone()
    for (let i = 0; i < 3; i++) await submit(REVIEW_FORM_ID, { rating: 5, name: 'Asha', phone: p, message: 'Long enough message here' })
    await expect(submit(REVIEW_FORM_ID, { rating: 5, name: 'Asha', phone: p, message: 'Long enough message here' })).rejects.toThrow(/last hour/)
  })

  test('visitors still cannot read the inbox', async () => {
    await expect(db.as('anon', 'select * from public.site_enquiries')).rejects.toThrow(/permission denied/)
  })
})

describe('older clients and history', () => {
  test('a plain Contact-form insert is filed under the Contact form; faked answers are refused', async () => {
    await db.as('anon', `insert into public.site_enquiries (name, phone, message) values ('Old App', $1, 'Sent from an older version')`, [phone()])
    const row = await db.one<{ form_id: string; form_name: string }>(null, `select form_id, form_name from public.site_enquiries where name = 'Old App'`)
    expect(row).toEqual({ form_id: CONTACT_FORM_ID, form_name: 'Contact form' })
    await expect(db.as('anon', `insert into public.site_enquiries (name, phone, message, data) values ('Faker', $1, 'x', '[]')`, [phone()])).rejects.toThrow(/row-level security/)
  })

  test('every demo enquiry belongs to a form', async () => {
    expect((await db.one<{ c: number }>(null, 'select count(*)::int c from public.site_enquiries where form_id is null')).c).toBe(0)
  })

  test('upgrade-2026-10.sql ships the forms section, re-runs cleanly and backfills old messages', async () => {
    const upgrade = readFileSync(resolve(__dirname, '../../supabase/upgrade-2026-10.sql'), 'utf8')
    expect(upgrade).toContain('-- >>> forms'); expect(upgrade).toContain('submit_site_form')
    await db.exec(`alter table public.site_enquiries disable trigger trg_site_enquiries_form;
      insert into public.site_enquiries (name, phone, message) values ('Legacy Row', '9811100000', 'from before forms');
      alter table public.site_enquiries enable trigger trg_site_enquiries_form;
      update public.site_forms set name = 'Contact us (edited)' where id = '${CONTACT_FORM_ID}';`)
    await db.exec(upgrade)
    await db.exec(upgrade)
    const legacy = await db.one<{ form_id: string }>(null, `select form_id from public.site_enquiries where name = 'Legacy Row'`)
    expect(legacy.form_id).toBe(CONTACT_FORM_ID)
    // the owner's edits to built-in forms survive the upgrade
    expect((await db.one<{ name: string }>(null, `select name from public.site_forms where id = '${CONTACT_FORM_ID}'`)).name).toBe('Contact us (edited)')
  })
})

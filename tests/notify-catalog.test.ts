import { describe, expect, test } from 'vitest'
import { CATALOG, catalogEntry, effectiveCopy, toCsv, waSubmission, waTemplateName } from '../src/notify'

describe('template library helpers', () => {
  test('every template has a code, and codes are unique', () => {
    expect(CATALOG.length).toBeGreaterThan(60)
    expect(new Set(CATALOG.map((e) => e.code)).size).toBe(CATALOG.length)
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length)
  })
  test('the control panel edit wins over the default; empty fields fall back', () => {
    const e = catalogEntry('appointment_confirmed')!
    const c = effectiveCopy(e, { key: e.id, enabled: true, locked: false, channels: {}, tpl: { text: 'Booked, {name}', subject: '  ' } })
    expect(c.text).toBe('Booked, {name}')
    expect(c.subject).toBe(e.copy!.subject)
  })
  test('WhatsApp sheet: tokens become {{n}} in the saved order, with samples', () => {
    const e = catalogEntry('appointment_confirmed')!
    const r = waSubmission(e, { key: e.id, enabled: true, locked: false, channels: {}, tpl: { waText: 'Hi {name}, {doctor} on {date} at {time}. {name}!', waParams: 'name,date', waTemplate: 'Appt Confirmed!' } })
    expect(r.body).toBe('Hi {{1}}, {{3}} on {{2}} at {{4}}. {{1}}!')
    expect(r.params).toBe('name,date,doctor,time')
    expect(r.samples.split(' | ')).toHaveLength(4)
    expect(r.name).toBe('appt_confirmed')
    expect(r.code).toBe(e.code)
    expect(waTemplateName('--')).toBe('template')
  })
  test('CSV quoting', () => {
    expect(toCsv([{ a: 'x "y"', b: 'line1\nline2' }], ['a', 'b'])).toBe('"a","b"\r\n"x ""y""","line1\nline2"\r\n')
  })
})

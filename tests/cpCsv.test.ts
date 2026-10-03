import { describe, expect, test } from 'vitest'
import { isoDate, mapRows, parseCsv, TEMPLATE } from '../control-panel/src/csv'

describe('control panel CSV import', () => {
  test('parses quotes, commas and newlines inside quotes, BOM, CRLF and blank lines', () => {
    expect(parseCsv('\uFEFFname,address\r\n"Kumar, Ravi","Line 1\nLine 2"\r\n\r\n"He said ""hi""",x\r\n')).toEqual([
      ['name', 'address'], ['Kumar, Ravi', 'Line 1\nLine 2'], ['He said "hi"', 'x'],
    ])
  })
  test('semicolon files (Excel in some locales)', () => {
    expect(parseCsv('name;phone\nSita;98765')).toEqual([['name', 'phone'], ['Sita', '98765']])
  })
  test('header names people use are matched; Indian dates become ISO; empty cells dropped', () => {
    const r = mapRows('patients', parseCsv('Patient Name,Mobile Number,DOB,Blood Group,Ward\nSita Devi,98765 00001,05/01/1990,o+,\nAmit,,1990-02-03,,3'))
    expect(r.rows).toEqual([
      { full_name: 'Sita Devi', phone: '98765 00001', date_of_birth: '1990-01-05', blood_group: 'o+' },
      { full_name: 'Amit', date_of_birth: '1990-02-03' },
    ])
    expect(r.unknown).toEqual(['Ward'])
    expect(r.missing).toEqual([])
  })
  test('doctors need a name and a specialization column', () => {
    expect(mapRows('doctors', parseCsv('name,fee\nDr X,500')).missing).toEqual(['specialization'])
    expect(mapRows('doctors', parseCsv(TEMPLATE.doctors)).rows[0]).toMatchObject({ full_name: 'Dr Anjali Rao', department: 'Cardiology', consultation_fee: '800' })
  })
  test('isoDate leaves other formats for the database to check', () => {
    expect(isoDate('1-2-2001')).toBe('2001-02-01')
    expect(isoDate('2001-02-01')).toBe('2001-02-01')
    expect(isoDate('Feb 1')).toBe('Feb 1')
  })
})

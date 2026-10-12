import { describe, expect, test } from 'vitest'
import { cleanTerm, runQuery } from '../src/data/query'

const rows = [
  { id: 'a', name: 'Anita Sharma', mrn: 'DCH-100001', total: 500, date: '2026-09-01', status: 'paid', pid: 'p1' },
  { id: 'b', name: 'Rohan Das', mrn: 'DCH-100002', total: 1200, date: '2026-09-15', status: 'unpaid', pid: 'p2' },
  { id: 'c', name: 'Meera Iyer', mrn: 'DCH-100003', total: 80, date: '2026-10-01', status: 'partial', pid: 'p3' },
  { id: 'd', name: 'Arjun Rao', mrn: 'DCH-100010', total: 1200, date: null, status: 'unpaid', pid: 'p1' },
]

describe('runQuery (demo-mode twin of the PostgREST translation)', () => {
  test('filters', () => {
    expect(runQuery(rows, { where: [['status', 'eq', 'unpaid']] }).rows.map((r) => r.id)).toEqual(['b', 'd'])
    expect(runQuery(rows, { where: [['status', 'in', ['paid', 'partial']]] }).rows.map((r) => r.id)).toEqual(['a', 'c'])
    expect(runQuery(rows, { where: [['status', 'nin', ['paid', 'partial']]] }).rows.map((r) => r.id)).toEqual(['b', 'd'])
    expect(runQuery(rows, { where: [['date', 'gte', '2026-09-15'], ['date', 'lte', '2026-10-01']] }).rows.map((r) => r.id)).toEqual(['b', 'c'])
    expect(runQuery(rows, { where: [['date', 'is_null']] }).rows.map((r) => r.id)).toEqual(['d'])
    expect(runQuery(rows, { where: [['total', 'gt', 500]] }).rows.map((r) => r.id)).toEqual(['b', 'd'])
  })
  test('search matches any column or a related id, case-insensitively', () => {
    expect(runQuery(rows, { search: { term: 'ROHAN', columns: ['name', 'mrn'] } }).rows.map((r) => r.id)).toEqual(['b'])
    expect(runQuery(rows, { search: { term: '0001', columns: ['name', 'mrn'] } }).rows.map((r) => r.id)).toEqual(['a', 'd'])
    expect(runQuery(rows, { search: { term: 'zzz', columns: ['name'], ids: [{ column: 'pid', ids: ['p3'] }] } }).rows.map((r) => r.id)).toEqual(['c'])
  })
  test('sorting is stable (id tie-break) with nulls last, then paged with a total count', () => {
    const q = runQuery(rows, { order: [{ column: 'total', asc: false }], range: [0, 1], count: true })
    expect(q.rows.map((r) => r.id)).toEqual(['b', 'd'])
    expect(q.count).toBe(4)
    expect(runQuery(rows, { order: [{ column: 'date', asc: true }] }).rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(runQuery(rows, { order: [{ column: 'date', asc: true }], range: [2, 5] }).rows.map((r) => r.id)).toEqual(['c', 'd'])
    expect(runQuery(rows, { where: [['status', 'eq', 'unpaid']], head: true })).toEqual({ rows: [], count: 2 })
  })
  test('search terms are cleaned of PostgREST syntax', () => {
    expect(cleanTerm(' a,b (c)*% "d" ')).toBe('a b c d')
  })
})

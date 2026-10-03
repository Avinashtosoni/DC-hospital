/**
 * Phase 7 in the browser: the closing state of the licence (computeLicense / licenseBanner) and CSV export.
 * The privacy RPCs themselves are tested against the real SQL in tests/sql.
 */
import { describe, expect, test } from 'vitest'
import { computeLicense, licenseBanner } from '../src/billing/license'
import { toCsv } from '../src/lib/utils'

describe('licence: a closing account', () => {
  const NOW = Date.parse('2026-10-02T06:00:00Z')
  const d = (days: number) => new Date(NOW + days * 864e5).toISOString()
  test('is read-only from the closing date even with a paid plan; suspension still wins', () => {
    const l = computeLicense({ status: 'active', trial_ends_at: null, paid_until: d(200), closing_at: d(-1), purge_after: d(29) }, 7, NOW)
    expect(l).toMatchObject({ status: 'read_only', read_only_from: d(-1), purge_after: d(29) })
    expect(computeLicense({ status: 'suspended', trial_ends_at: null, paid_until: d(200), closing_at: d(-1), purge_after: d(29) }, 7, NOW).status).toBe('suspended')
    expect(computeLicense({ status: 'active', trial_ends_at: null, paid_until: d(200) }, 7, NOW).status).toBe('active')
  })
  test('the banner counts the days to deletion and points the owner at the export', () => {
    const l = computeLicense({ status: 'active', trial_ends_at: null, paid_until: d(200), closing_at: d(-1), purge_after: d(29) }, 7, NOW)
    const owner = licenseBanner(l, true, NOW)!
    expect(owner).toMatchObject({ tone: 'danger', title: 'This account is closing', cta: false })
    expect(owner.text).toMatch(/Settings → Data & backup.*\(29 days left\).*deleted permanently/)
    expect(licenseBanner(l, false, NOW)!.text).toMatch(/Ask the owner/)
  })
})

describe('toCsv', () => {
  test('header from every row; JSON cells; formulas defused', () => {
    expect(toCsv([{ a: 1 }, { b: '=SUM(A1)', c: { x: 1 } }])).toBe('a,b,c\r\n1,,\r\n,\'=SUM(A1),"{""x"":1}"')
  })
})

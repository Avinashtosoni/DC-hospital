/** Phase 4 — the browser side of the licence (same rules as scripts/sql/billing.sql). */
import { describe, expect, test } from 'vitest'
import { computeLicense, isLicenseError, licenseBanner, licenseStaffMessage } from '../src/billing/license'
import { BILLING_DEFAULTS, rupees } from '../src/platform/billing'
import { PLANS } from '../src/platform/plans'

const NOW = Date.parse('2026-10-02T06:00:00Z')
const d = (days: number) => new Date(NOW + days * 864e5).toISOString()

describe('computeLicense (mirrors tenant_license)', () => {
  const row = (trial: number | null, paid: number | null, status: any = 'trial', is_primary = false) =>
    computeLicense({ is_primary, status, trial_ends_at: trial == null ? null : d(trial), paid_until: paid == null ? null : d(paid) }, 7, NOW)
  test('trial → active → grace → read-only; suspend wins; primary always active; no dates = manual status', () => {
    expect(row(5, null).status).toBe('trial')
    expect(row(-30, 3).status).toBe('active')
    expect(row(-3, null).status).toBe('grace')
    expect(row(-8, null).status).toBe('read_only')
    expect(row(5, null, 'suspended').status).toBe('suspended')
    expect(row(-100, null, 'trial', true).status).toBe('active')
    expect(row(null, null, 'grace').status).toBe('grace')
    expect(row(-3, null).read_only_from).toBe(d(4))
  })
})

describe('licence banner', () => {
  const l = (status: any, extra: Record<string, string | null> = {}) => ({ status, trial_ends_at: null, paid_until: null, read_only_from: null, ...extra })
  test('trial days left, renewal due, grace, read-only; nothing when well paid', () => {
    expect(licenseBanner(l('trial', { trial_ends_at: d(9) }), true, NOW)).toMatchObject({ tone: 'info', title: 'Free trial · 9 days left', cta: true })
    expect(licenseBanner(l('trial', { trial_ends_at: d(2) }), true, NOW)?.tone).toBe('warning')
    expect(licenseBanner(l('active', { paid_until: d(60) }), true, NOW)).toBeNull()
    expect(licenseBanner(l('active', { paid_until: d(10) }), true, NOW)?.title).toBe('Plan renews in 10 days')
    expect(licenseBanner(l('active', { paid_until: d(10) }), false, NOW)).toBeNull()                 // staff don't need renewal nags
    expect(licenseBanner(l('grace', { read_only_from: d(4) }), true, NOW)).toMatchObject({ tone: 'warning', title: 'Plan ended · read-only in 4 days' })
    const ro = licenseBanner(l('read_only'), false, NOW)!
    expect(ro).toMatchObject({ tone: 'danger', cta: false }); expect(ro.text).toMatch(/ask the hospital owner/)
  })
  test('database guard errors become plain sentences', () => {
    const m = 'LICENSE_READ_ONLY: This hospital\'s Hospital Comrade plan has ended, so the account is read-only.'
    expect(isLicenseError(m)).toBe(true)
    expect(licenseStaffMessage(m)).toBe('This hospital\'s Hospital Comrade plan has ended, so the account is read-only.')
    expect(isLicenseError('duplicate key')).toBe(false)
  })
})

describe('billing defaults', () => {
  test('prices and included messages come from the plans; ₹ formatting', () => {
    expect(BILLING_DEFAULTS.plans.clinic).toMatchObject({ name: 'Clinic', price: 999, included: PLANS.find((p) => p.id === 'clinic')!.included, public: true, archived: false })
    expect(BILLING_DEFAULTS.plans.custom.price).toBeNull()
    expect(rupees(117882)).toBe('₹1,178.82')
    expect(rupees(99900)).toBe('₹999')
  })
})

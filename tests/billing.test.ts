/** Phase 4 — the browser side of the licence + the demo billing store (same rules as scripts/sql/billing.sql). */
import { beforeEach, describe, expect, test } from 'vitest'
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
    expect(BILLING_DEFAULTS.plans.clinic).toEqual({ price: 999, included: PLANS.find((p) => p.id === 'clinic')!.included })
    expect(BILLING_DEFAULTS.plans.custom.price).toBeNull()
    expect(rupees(117882)).toBe('₹1,178.82')
    expect(rupees(99900)).toBe('₹999')
  })
})

describe('demo billing store', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    ;(globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() }
  })
  test('City Care: quote like the database, pay → invoice, plan extends after the trial, wallet credits before GST', async () => {
    const { demoQuote, demoApplyPayment, demoBilling, demoLicense, demoProviderBilling } = await import('../src/billing/demo')
    const CITY = 'b0000000-0000-4000-8000-000000000002'
    expect(demoLicense(CITY, false)?.status).toBe('trial')
    const q = demoQuote(CITY, 'plan', 12)
    expect([q.base_paise, q.gst_paise, q.total_paise]).toEqual([999000, 179820, 1178820])
    expect(() => demoQuote(CITY, 'plan', 3)).toThrow(/1 month or 12/)
    expect(() => demoQuote(CITY, 'wallet', 1, 100)).toThrow(/Top up between/)
    const trialEnd = Date.parse(demoBilling(CITY)!.trial_ends_at!)
    expect(demoApplyPayment(CITY, demoQuote(CITY, 'plan', 1), 'razorpay', 'upi')).toMatch(/^HC\/\d{4}-\d{2}\/000042$/)
    expect(Date.parse(demoBilling(CITY)!.paid_until!)).toBeGreaterThan(trialEnd + 27 * 864e5)
    expect(demoLicense(CITY, false)?.status).toBe('active')
    const before = demoBilling(CITY)!.wallet_paise
    demoApplyPayment(CITY, demoQuote(CITY, 'wallet', 1, 1000), 'razorpay', 'upi')
    expect(demoBilling(CITY)!.wallet_paise).toBe(before + 100000)
    demoProviderBilling(CITY, 'demo_end_trial', { daysAgo: 10 })
    expect(demoLicense(CITY, true)).toMatchObject({ status: 'read_only' })
    demoProviderBilling(CITY, 'suspend', {})
    expect(demoLicense(CITY, false)?.status).toBe('suspended')
    expect(() => demoProviderBilling(CITY, 'wallet_adjust', { amount: 10 })).toThrow(/note/)
  })
})

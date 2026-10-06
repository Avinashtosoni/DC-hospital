import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => ({ supabase: {}, platformName: 'Hospital Comrade', platformDomain: 'example.in' }))
import { changeLines, historyLine, planProblems, planStats, slugFor, totals, fieldsOf } from '../control-panel/src/pages/plans/model'
import { planList } from '../src/platform/plans'
import type { CpHospital, PlanHistoryRow } from '../control-panel/src/types'

const h = (plan: string, status: string, price: number | null, extra: Partial<CpHospital> = {}) =>
  ({ plan, is_primary: false, is_demo: false, license: { status } as CpHospital['license'], price, billing: null, ...extra }) as CpHospital

describe('plans page model', () => {
  it('counts hospitals and MRR per plan, skipping the platform / demo hospital', () => {
    const s = planStats([
      h('clinic', 'active', 999), h('clinic', 'trial', 999), h('hospital', 'active', 2500, { billing: { price: 2500 } }),
      h('hospital', 'active', 2999, { is_primary: true }), h('clinic', 'active', 999, { is_demo: true }),
    ])
    expect(s.clinic).toEqual({ hospitals: 2, paying: 1, trial: 1, ownPrice: 0, mrr: 999 })
    expect(s.hospital).toEqual({ hospitals: 1, paying: 1, trial: 0, ownPrice: 1, mrr: 2500 })
    expect(totals(s)).toMatchObject({ hospitals: 3, paying: 2, mrr: 3499 })
  })

  it('makes a free plan ID from the name', () => {
    expect(slugFor('Multi-branch Plus!', [])).toBe('multi-branch-plus')
    expect(slugFor('Clinic', ['clinic'])).toBe('clinic-2')
    expect(slugFor('  9 ', [])).toBe('plan')
    expect(slugFor('Unsure', [])).toBe('plan-unsure')
  })

  it('validates an edited plan', () => {
    const base = fieldsOf(planList(undefined)[0])
    expect(planProblems(base, 'x', false, [])).toEqual([])
    expect(planProblems({ ...base, name: ' ' }, 'new-plan', true, [])).toHaveLength(1)
    expect(planProblems(base, 'Bad id', true, [])[0]).toMatch(/Plan ID/)
    expect(planProblems(base, 'clinic', true, ['clinic'])[0]).toMatch(/already/)
    expect(planProblems({ ...base, price: -1 }, 'x', false, [])[0]).toMatch(/Price/)
  })

  it('describes what owners are told', () => {
    const before = fieldsOf(planList(undefined)[0])
    const after = { ...before, price: 1199, included: { ...before.included, sms: before.included.sms + 50 } }
    const l = changeLines(before, after)
    expect(l.price).toContain('₹1,199')
    expect(l.other[0]).toMatch(/SMS messages included/)
    expect(changeLines(before, { ...before }).price).toBeNull()
  })

  it('writes history lines', () => {
    const row = (action: string, detail: unknown): PlanHistoryRow => ({ id: '1', at: '', user_name: 'A', action, target: 'clinic', detail: detail as Record<string, unknown> })
    expect(historyLine(row('plan:create', { after: { name: 'Pro', price: 5000 } }))).toBe('Added the Pro plan at ₹5,000/month.')
    expect(historyLine(row('plan:update', { before: { name: 'Clinic', price: 999 }, after: { name: 'Clinic', price: 1199 }, existing: 'keep', kept: 3, notified: 0 })))
      .toContain('3 existing hospital(s) kept the old price')
    expect(historyLine(row('plan:update', { before: { name: 'Clinic', public: true }, after: { name: 'Clinic', public: false }, notified: 2 }))).toBe('Clinic: hidden from the website · 2 owner(s) told')
    expect(historyLine(row('settings:billing', { gstPercent: 18, seller: {} }))).toBe('Billing rules changed: gstPercent, seller.')
  })
})

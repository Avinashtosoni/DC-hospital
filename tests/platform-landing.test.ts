import { describe, expect, it } from 'vitest'
import { isPlatformLanding } from '../src/tenancy/boot'
import { leadProblem } from '../src/platform/api'
import { PLANS } from '../src/platform/plans'

describe('platform product page', () => {
  it('shows on the platform domain (with or without www) when no hospital is picked', () => {
    expect(isPlatformLanding('hospital.digitalcomrade.in', '')).toBe(true)
    expect(isPlatformLanding('www.hospital.digitalcomrade.in', '')).toBe(true)
    expect(isPlatformLanding('Hospital.DigitalComrade.in', '')).toBe(true)
  })
  it('never on hospital domains or sub-domains; ?hospital= opens a hospital; ?platform forces it', () => {
    expect(isPlatformLanding('demo.hospital.digitalcomrade.in', '')).toBe(false)
    expect(isPlatformLanding('www.cityhospital.in', '')).toBe(false)
    expect(isPlatformLanding('localhost', '')).toBe(false)
    expect(isPlatformLanding('hospital.digitalcomrade.in', '?hospital=main')).toBe(false)
    expect(isPlatformLanding('localhost', '?platform')).toBe(true)
  })
  it('lead form checks match the database rules', () => {
    const ok = { name: 'Asha', organisation: 'Verma Clinic', phone: '+91 98765 43210', email: '', city: '', plan: 'clinic', message: '' }
    expect(leadProblem(ok)).toBeNull()
    expect(leadProblem({ ...ok, phone: '12345' })).toMatch(/mobile/)
    expect(leadProblem({ ...ok, email: 'x@' })).toMatch(/email/)
    expect(leadProblem({ ...ok, organisation: '' })).toMatch(/hospital/)
  })
  it('keeps the agreed prices and a custom plan', () => {
    expect(PLANS.map((p) => [p.id, p.price])).toEqual([['clinic', 999], ['hospital', 2999], ['enterprise', 7999], ['custom', null]])
  })
})

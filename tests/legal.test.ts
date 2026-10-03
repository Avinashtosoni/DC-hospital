import { describe, expect, it } from 'vitest'
import { LEGAL_VERSION, legalDoc, legalDocs, legalUrl } from '../src/platform/legal'
import { platformCompany, platformDomain, platformName } from '../src/lib/supabase'

describe('platform legal pages', () => {
  it('has every page Razorpay / DPDP needs', () => {
    expect(legalDocs().map((d) => d.slug)).toEqual(['terms', 'privacy', 'refunds', 'delivery', 'dpa', 'contact'])
    for (const d of legalDocs()) {
      expect(d.title).toBeTruthy()
      expect(d.sections.length).toBeGreaterThan(0)
      for (const s of d.sections) expect(s.p.length).toBeGreaterThan(0)
    }
  })
  it('uses the configurable names, never a hard-coded brand', () => {
    const all = JSON.stringify(legalDocs())
    expect(all).toContain(platformName)
    expect(all).toContain(platformCompany.legalName)
    expect(all).toContain(platformCompany.email)
    expect(all).not.toMatch(/undefined|\[object Object\]/)
  })
  it('links to the platform domain and finds pages by slug', () => {
    expect(legalUrl('refunds')).toBe(`https://${platformDomain}/legal/refunds`)
    expect(legalDoc('dpa')?.short).toBe('DPA')
    expect(legalDoc('nope')).toBeNull()
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('mentions the refund window and the breach notice', () => {
    expect(JSON.stringify(legalDoc('refunds'))).toMatch(/7 days/)
    expect(JSON.stringify(legalDoc('dpa'))).toMatch(/24 hours/)
  })
})

describe('free-trial sign-up form', async () => {
  const { signupProblem, signupInfo, trialSignup } = await import('../src/platform/api')
  const ok = { organisation: 'Sunrise Clinic', name: 'Meera', email: 'meera@sunrise.in', phone: '+91 98765 43210', city: '', plan: 'clinic', website: '' }
  it('checks like the database does', () => {
    expect(signupProblem(ok, true)).toBeNull()
    expect(signupProblem(ok, false)).toMatch(/Terms of Service/)
    expect(signupProblem({ ...ok, phone: '12345' }, true)).toMatch(/10-digit/)
    expect(signupProblem({ ...ok, email: 'x@y' }, true)).toMatch(/e-mail/)
    expect(signupProblem({ ...ok, organisation: ' ' }, true)).toMatch(/hospital/)
  })
  it('without a database the form is closed and never pretends to succeed', async () => {
    expect(await signupInfo()).toMatchObject({ enabled: false })
    await expect(trialSignup(ok, '2026-10-02')).rejects.toThrow(/not available/)
  })
})

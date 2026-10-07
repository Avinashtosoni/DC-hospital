import { describe, expect, it } from 'vitest'
import { domainProblem, isPlatformSubdomain, looksLikeApex, normaliseDomain, summarise } from '../../supabase/functions/_shared/cloudflare'

const P = 'hospital.digitalcomrade.in'
describe('custom domain helpers', () => {
  it('normalises what people paste', () => {
    expect(normaliseDomain(' https://WWW.CityCare.in/book?x=1 ')).toBe('www.citycare.in')
    expect(normaliseDomain('citycare.in:443')).toBe('citycare.in')
    expect(normaliseDomain('citycare.in.')).toBe('citycare.in')
  })
  it('rejects junk and the platform itself', () => {
    expect(domainProblem('www.citycare.in', P)).toBeNull()
    expect(domainProblem('citycare', P)).toMatch(/like www/)
    expect(domainProblem('a b.in', P)).toMatch(/like www/)
    expect(domainProblem(P, P)).toMatch(/platform/)
    expect(domainProblem(`www.${P}`, P)).toMatch(/platform/)
  })
  it('knows platform sub-domains and apex domains', () => {
    expect(isPlatformSubdomain(`citycare.${P}`, P)).toBe(true)
    expect(isPlatformSubdomain('www.citycare.in', P)).toBe(false)
    expect(looksLikeApex('citycare.in')).toBe(true)
    expect(looksLikeApex('citycare.co.in')).toBe(true)
    expect(looksLikeApex('www.citycare.co.in')).toBe(false)
  })
  it('summarises a Cloudflare hostname', () => {
    expect(summarise({ id: 'x', status: 'active', ssl: { status: 'active' } })).toEqual({ status: 'active', ssl_status: 'active', verification: null, last_error: null, active: true })
    const s = summarise({ status: 'pending', verification_errors: ['custom hostname does not CNAME to this zone.'], ownership_verification: { type: 'txt', name: 'n', value: 'v' },
      ssl: { status: 'pending_validation', validation_errors: [{ message: 'caa error' }], validation_records: [{ txt_name: 'a', txt_value: 'b' }] } })
    expect(s.active).toBe(false)
    expect(s.last_error).toBe('custom hostname does not CNAME to this zone. · caa error')
    expect(Object.keys(s.verification!)).toEqual(['txt', 'ssl'])
  })
})

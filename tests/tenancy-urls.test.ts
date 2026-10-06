/** hospital addresses: custom domain › <slug>.<platform domain> (TENANT_SUBDOMAINS=on) › ?hospital= (src/tenancy/urls.ts) */
import { afterEach, describe, expect, it } from 'vitest'
import { hospitalHost, hospitalUrl, hostSlug, isRootPlatformHost, subdomainRedirect } from '../src/tenancy/urls'
import { isPlatformLanding } from '../src/tenancy/boot'

const g = globalThis as unknown as { window?: { __ENV__?: Record<string, string> }; location?: { origin: string } }
const setEnv = (e: Record<string, string>) => { g.window = { __ENV__: { PLATFORM_DOMAIN: 'hospital.digitalcomrade.in', ...e } } }
afterEach(() => { delete g.window; delete g.location })
const loc = (hostname: string, pathname = '/', search = '', hash = '') => ({ hostname, pathname, search, hash })

describe('hospital addresses', () => {
  it('subdomains on: <slug>.<platform domain>, keeping path, query and hash; a custom domain always wins', () => {
    setEnv({ TENANT_SUBDOMAINS: 'on' })
    expect(hospitalUrl({ slug: 'city' })).toBe('https://city.hospital.digitalcomrade.in/')
    expect(hospitalUrl({ slug: 'city' }, '/register?email=a%40b.in')).toBe('https://city.hospital.digitalcomrade.in/register?email=a%40b.in')
    expect(hospitalUrl({ slug: 'city' }, '/#imp=abc')).toBe('https://city.hospital.digitalcomrade.in/#imp=abc')
    expect(hospitalUrl({ slug: 'city', domain: 'cityhospital.in' }, '/login')).toBe('https://cityhospital.in/login')
    expect(hospitalHost({ slug: 'main' })).toBe('main.hospital.digitalcomrade.in')
  })
  it('subdomains off: ?hospital= on this address (before the #hash)', () => {
    setEnv({})
    g.location = { origin: 'https://hospital.digitalcomrade.in' }
    expect(hospitalUrl({ slug: 'city' })).toBe('https://hospital.digitalcomrade.in/?hospital=city')
    expect(hospitalUrl({ slug: 'city' }, '/register?invite=x')).toBe('https://hospital.digitalcomrade.in/register?invite=x&hospital=city')
    expect(hospitalUrl({ slug: 'city' }, '/#imp=abc')).toBe('https://hospital.digitalcomrade.in/?hospital=city#imp=abc')
    expect(hospitalHost({ slug: 'city' })).toBe('hospital.digitalcomrade.in/?hospital=city')
  })
  it('reads the hospital from its subdomain — one label, never www', () => {
    setEnv({})
    expect(hostSlug('city.hospital.digitalcomrade.in')).toBe('city')
    expect(hostSlug('City.Hospital.DigitalComrade.in:443')).toBe('city')
    expect(hostSlug('www.hospital.digitalcomrade.in')).toBeNull()
    expect(hostSlug('a.b.hospital.digitalcomrade.in')).toBeNull()
    expect(hostSlug('hospital.digitalcomrade.in')).toBeNull()
    expect(hostSlug('cityhospital.in')).toBeNull()
    expect(isRootPlatformHost('www.hospital.digitalcomrade.in')).toBe(true)
    expect(isRootPlatformHost('city.hospital.digitalcomrade.in')).toBe(false)
  })
  it('subdomains on: old ?hospital= links on the platform domain move to the subdomain', () => {
    setEnv({ TENANT_SUBDOMAINS: 'on' })
    expect(subdomainRedirect(loc('hospital.digitalcomrade.in', '/register', '?hospital=City&invite=x', '#top'))).toBe('https://city.hospital.digitalcomrade.in/register?invite=x#top')
    expect(subdomainRedirect(loc('hospital.digitalcomrade.in', '/', ''))).toBeNull()
    expect(subdomainRedirect(loc('hospital.digitalcomrade.in', '/', '?hospital=../evil'))).toBeNull()
    expect(subdomainRedirect(loc('city.hospital.digitalcomrade.in', '/', '?hospital=main'))).toBeNull()
    setEnv({})
    expect(subdomainRedirect(loc('hospital.digitalcomrade.in', '/', '?hospital=city'))).toBeNull()
  })
})

describe('the bare platform domain', () => {
  it('"/" is always the product page; ?hospital= opens a hospital; hospital sub-domains never show it', () => {
    expect(isPlatformLanding('hospital.digitalcomrade.in', '', '/')).toBe(true)
    expect(isPlatformLanding('hospital.digitalcomrade.in', '?hospital=', '/')).toBe(true)
    expect(isPlatformLanding('hospital.digitalcomrade.in', '?hospital=main', '/')).toBe(false)
    expect(isPlatformLanding('hospital.digitalcomrade.in', '', '/login')).toBe(true)   // nothing remembered (no sessionStorage here)
    expect(isPlatformLanding('main.hospital.digitalcomrade.in', '', '/')).toBe(false)
  })
})

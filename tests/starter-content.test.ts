import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONTENT } from '../src/site/cms/defaults'
import { STARTER_CONTENT } from '../src/site/cms/starter'
import { mergeRows, toPublic } from '../src/site/cms/content'
import { CONTENT_KEYS } from '../src/site/cms/types'
import { chooseProviderTenant, clearProviderChoice, enableTenancy, setSiteTenant, PRIMARY_TENANT_ID, type TenantInfo } from '../src/tenancy/state'
import type { ContentRows } from '../src/site/cms/store'

// facts that belong to DC Hospital only — a newly onboarded hospital must never show them as its own
const DC_ONLY = /DC Hospital|Dwarka|Delhi|New Delhi|2009|lakh|Avinash|Vikram|Nikhil|Lakshmi|NABH|ISO 9001|30\+ insurers|Google reviews|900-strong|dchospital|11 4000|cath-lab|30-bed|NICU|Blood Bank/i

afterEach(() => { clearProviderChoice(); setSiteTenant(null); enableTenancy(false) })

describe('website starter content (non-primary hospitals)', () => {
  it('has every content key and no DC Hospital-specific claims', () => {
    for (const k of CONTENT_KEYS) expect(STARTER_CONTENT[k], k).toBeTruthy()
    const text = JSON.stringify(STARTER_CONTENT)
    const hit = text.match(DC_ONLY)
    expect(hit?.[0] ?? null).toBeNull()
  })

  it('keeps the booking-relevant services but drops numbers, equipment and doctor profiles', () => {
    expect(STARTER_CONTENT.services.map((s) => s.slug)).toEqual(DEFAULT_CONTENT.services.map((s) => s.slug))
    expect(STARTER_CONTENT.services.every((s) => s.stats.length === 0 && s.technology.length === 0)).toBe(true)
    expect(STARTER_CONTENT.doctors).toEqual([])
    expect(STARTER_CONTENT.testimonials).toEqual([])
    expect(STARTER_CONTENT.about.leadership.people).toEqual([])
    expect(STARTER_CONTENT.about.journey.milestones).toEqual([])
    expect(STARTER_CONTENT.home.sections).toMatchObject({ stats: false, testimonials: false, doctors: false, why: false })
    expect(STARTER_CONTENT.settings.pages).toMatchObject({ doctors: false, packages: false })
  })

  it('uses tokens so the hospital name and phone fill in automatically', () => {
    const rows = { settings: { data: { name: 'Sunrise Clinic', phone: '+91 99999 00000' } } } as unknown as ContentRows
    const pub = toPublic(mergeRows(rows, {}, STARTER_CONTENT))
    expect(pub.about.hero.lead).toContain('Sunrise Clinic')
    expect(pub.home.seo.description).toContain('Sunrise Clinic')
    expect(JSON.stringify(pub)).not.toMatch(/\{name\}|\{phone\}/)
  })
})

describe('which built-in content a hospital falls back to', () => {
  const CITY_TENANT_ID = 'b0000000-0000-4000-8000-000000000002'
  const tenant = (id: string, slug: string, is_primary: boolean) => ({ id, slug, name: slug, is_primary, status: 'active' }) satisfies TenantInfo
  const city = tenant(CITY_TENANT_ID, 'citycare', false)
  const main = tenant(PRIMARY_TENANT_ID, 'dc', true)

  it('single-hospital install → DC Hospital content', () => {
    expect(mergeRows(undefined).about.journey.milestones.length).toBeGreaterThan(0)
  })

  it('primary hospital in multi mode → DC Hospital content', () => {
    enableTenancy(true); setSiteTenant(main)
    expect(mergeRows(undefined).testimonials.length).toBeGreaterThan(0)
  })

  it('any other hospital → neutral starter, and saved values still win', () => {
    enableTenancy(true); setSiteTenant(city)
    const c = mergeRows({ testimonials: { data: [{ name: 'A', text: 'B' }] } } as unknown as ContentRows)
    expect(c.about.leadership.people).toEqual([])
    expect(c.settings.map.embedUrl).toBe('')
    expect(c.testimonials).toHaveLength(1)
  })

  it('a provider looking at another hospital from the primary domain gets that hospital’s starter', () => {
    enableTenancy(true); setSiteTenant(main); chooseProviderTenant(CITY_TENANT_ID)
    expect(mergeRows(undefined).doctors).toEqual([])
  })
})

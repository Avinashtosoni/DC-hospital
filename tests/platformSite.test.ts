/** Product-site content: CMS rows merged over defaults, legal overrides, {tokens}, and the blog slug helper. */
import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({
  supabase: null,
  platformName: 'Hospital Comrade',
  platformDomain: 'hospital.example.in',
  platformCompany: { legalName: 'Digital Comrade', address: 'Purnia, Bihar', email: 'support@example.in', phone: '+91 90000 00000', grievanceOfficer: 'A. Kumar', jurisdiction: 'Purnia' },
}))

const { mergeSite, mergeLegal, fill } = await import('../src/platform/site/store')
const { defaultSite } = await import('../src/platform/site/defaults')

describe('platform site content', () => {
  test('defaults cover every page and every legal page, tokens filled', () => {
    const s = mergeSite({})
    expect(Object.keys(s).sort()).toEqual(['about', 'blog', 'brand', 'contact', 'faq', 'features', 'home', 'legal', 'pricing', 'security', 'solutions'])
    expect(s.legal.docs.map((d) => d.slug)).toEqual(['terms', 'privacy', 'refunds', 'delivery', 'dpa', 'cookies', 'acceptable-use', 'grievance', 'disclaimer', 'sla', 'contact'])
    expect(s.brand.email).toBe('support@example.in')
    expect(s.home.seo.description).toContain('Hospital Comrade')
    expect(JSON.stringify(s)).not.toMatch(/\{(platform|company|email|phone|address|domain|grievance)\}/)
    expect(s.legal.docs.find((d) => d.slug === 'grievance')!.sections[0].p[0]).toContain('A. Kumar')
  })

  test('saved page fields replace defaults; missing fields keep them; junk ignored', () => {
    const s = mergeSite({ home: { hero: { title: 'Hi *there*' } }, about: 'nope' as never, unknown: { a: 1 } as never } as never)
    expect(s.home.hero.title).toBe('Hi *there*')
    expect(s.home.hero.lead).toBe(defaultSite().home.hero.lead)            // nested fields not saved keep the default
    expect(s.home.stats).toEqual(defaultSite().home.stats)
    expect(s.about).toEqual(mergeSite({}).about)
  })

  test('lists are replaced whole; wrong types fall back', () => {
    const s = mergeSite({ home: { stats: [{ value: '1', label: 'x' }], roles: { items: 'bad' } } } as never)
    expect(s.home.stats).toEqual([{ value: '1', label: 'x' }])
    expect(s.home.roles.items).toEqual(defaultSite().home.roles.items)
  })

  test('editor view keeps tokens as typed', () => {
    expect(mergeSite({}, false).brand.email).toBe('{email}')
  })

  test('legal: override by slug, add new, hide', () => {
    const d = defaultSite().legal.docs
    const out = mergeLegal(d, [
      { slug: 'terms', title: 'Terms (new)', short: 'Terms', updated: '2026-11-01', intro: 'x', sections: [] },
      { slug: 'cookies', title: 'Cookies', short: 'Cookies', updated: '', intro: '', sections: [], hidden: true },
      { slug: 'shipping', title: 'Shipping', short: 'Shipping', updated: '', intro: '', sections: [] },
    ])
    expect(out[0]).toMatchObject({ slug: 'terms', title: 'Terms (new)', updated: '2026-11-01' })
    expect(out.find((x) => x.slug === 'cookies')!.hidden).toBe(true)
    expect(out.at(-1)!.slug).toBe('shipping')
    expect(out).toHaveLength(d.length + 1)
    expect(mergeLegal(d, 'bad' as never)).toBe(d)
  })

  test('fill leaves unknown braces alone', () => {
    expect(fill('{platform} by {company} — {unknown}')).toBe('Hospital Comrade by Digital Comrade — {unknown}')
  })
})

import { describe, expect, it } from 'vitest'
import { safeUrl } from '../src/lib/safeUrl'
import { toPublic, mergeRows } from '../src/site/cms/content'

describe('safeUrl (CMS links)', () => {
  it('keeps normal links', () => {
    expect(safeUrl('https://instagram.com/dch')).toBe('https://instagram.com/dch')
    expect(safeUrl('tel:+919810010001')).toBe('tel:+919810010001')
    expect(safeUrl('mailto:help@x.in')).toBe('mailto:help@x.in')
    expect(safeUrl('/contact')).toBe('/contact')
    expect(safeUrl('data:image/png;base64,AAAA', 'image')).toBe('data:image/png;base64,AAAA')
  })
  it('drops script and odd schemes', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '//evil.example/x', 'not a url'])
      expect(safeUrl(bad), bad).toBe('')
    expect(safeUrl('tel:123', 'web')).toBe('')
    expect(safeUrl('data:image/png;base64,AAAA', 'web')).toBe('')
  })
  it('the public site never receives a javascript: link from the CMS', () => {
    const c = mergeRows({ settings: { key: 'settings', updated_at: '', data: {
      socials: [{ platform: 'Facebook', url: 'javascript:alert(1)' }, { platform: 'X', url: 'https://x.com/dch' }],
      map: { embedUrl: 'javascript:alert(2)', directionsUrl: 'https://maps.app.goo.gl/abc' },
    } } } as never)
    const s = toPublic(c).settings
    expect(s.socials.map((x) => x.url)).toEqual(['', 'https://x.com/dch'])
    expect(s.map).toEqual({ embedUrl: '', directionsUrl: 'https://maps.app.goo.gl/abc' })
  })
})

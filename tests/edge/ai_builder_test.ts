import { deepStrictEqual as assertEquals, throws as assertThrows } from 'node:assert/strict'
import { buildPrompt, errorCode, sanitizeGeneratedPage } from '../../supabase/functions/_shared/ai_builder.ts'

Deno.test('AI prompt uses a short schema instruction and caps the user brief', () => {
  const prompt = buildPrompt('x'.repeat(900))
  assertEquals(prompt.user.length < 600, true)
  assertEquals(prompt.user.endsWith('x'.repeat(500)), true)
  assertEquals(prompt.system.includes('Return only compact JSON'), true)
  assertEquals(prompt.system.includes('Do not create image URLs'), true)
})

Deno.test('AI page output is draft-only, bounded and strips HTML and unsafe CTA URLs', () => {
  const page = sanitizeGeneratedPage({
    title: '<script>alert(1)</script> Maternity Care', seoTitle: 'Maternity <b>care</b>',
    seoDescription: 'Helpful <img src=x> guidance', blocks: [
      { type: 'hero', title: '<b>Maternity care</b>', body: 'Plan *your* visits.' },
      { type: 'features', title: 'Care', items: [{ title: '<i>Prenatal visits</i>', body: 'Discuss your routine with our care team.' }] },
      { type: 'cta', title: 'Contact us', body: 'Our team can help.', buttonText: 'Book', buttonUrl: 'javascript:alert(1)' },
      { type: 'image', imageUrl: 'https://tracker.example/pixel.png', alt: 'tracking pixel' },
    ],
  })
  assertEquals(page.status, 'draft')
  assertEquals(page.showInNavigation, false)
  assertEquals(page.slug, 'maternity-care')
  assertEquals(page.title, 'Maternity Care')
  assertEquals(page.blocks.length, 3)
  assertEquals(page.blocks[2].type === 'cta' && page.blocks[2].buttonUrl, '/contact')
  assertEquals(page.blocks.some((b) => JSON.stringify(b).includes('<script>')), false)
})

Deno.test('AI page output inserts safe default blocks and rejects malformed JSON', () => {
  const page = sanitizeGeneratedPage({ title: 'About care', blocks: [] })
  assertEquals(page.blocks.length, 2)
  assertEquals(page.blocks[0].type, 'hero')
  assertEquals(page.blocks[1].type, 'text')
  assertThrows(() => sanitizeGeneratedPage('{not json'))
})

Deno.test('provider errors normalize to safe audit codes for failover logs', () => {
  assertEquals(errorCode(429), 'rate_limit')
  assertEquals(errorCode(503), 'provider_5xx')
  assertEquals(errorCode(401), 'provider_auth')
  assertEquals(errorCode(undefined, 'timeout'), 'timeout')
})

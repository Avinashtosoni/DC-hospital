/** Phase 6 — owner billing page: invoice GST split / place of supply, demo plan changes and usage history. */
import { beforeEach, describe, expect, test } from 'vitest'
import { gstRate, invoiceTax, stateCode, stateFromGstin } from '../src/billing/invoice'
import { invoiceDescription } from '../src/billing/invoicePdf'
import { amountInWords } from '../src/components/InvoiceDocument'

const CITY = 'b0000000-0000-4000-8000-000000000002'

describe('tax invoice', () => {
  test('place of supply from the buyer GSTIN; same state → CGST + SGST, other state → IGST', () => {
    expect(stateFromGstin('10AAKFC4321M1Z2')).toBe('Bihar')
    expect(stateFromGstin('27ABCDE1234F1Z5')).toBe('Maharashtra')
    expect(stateFromGstin('')).toBeNull()
    expect(stateCode('bihar')).toBe('10')
    const intra = invoiceTax({ state: 'Bihar', gstin: '' }, '10AAKFC4321M1Z2', 17982)
    expect(intra).toMatchObject({ placeOfSupply: 'Bihar', posCode: '10', interState: false, cgst: 8991, sgst: 8991, igst: 0 })
    const inter = invoiceTax({ state: 'Bihar', gstin: '' }, '27ABCDE1234F1Z5', 17982)
    expect(inter).toMatchObject({ placeOfSupply: 'Maharashtra', interState: true, cgst: 0, sgst: 0, igst: 17982 })
    // odd paise: halves still add up
    const odd = invoiceTax({ state: 'Bihar', gstin: '' }, null, 4501)
    expect(odd.cgst + odd.sgst).toBe(4501)
    expect(odd.placeOfSupply).toBe('Bihar')                       // unregistered buyer → seller's state
    // the seller's own GSTIN decides the seller state when present
    expect(invoiceTax({ state: 'Bihar', gstin: '07AAAAA0000A1Z5' }, '10AAKFC4321M1Z2', 100).interState).toBe(true)
  })

  test('rate from the amounts, description and amount in words (Indian numbering)', () => {
    expect(gstRate({ base_paise: 99900, gst_paise: 17982 })).toBe(18)
    expect(invoiceDescription({ kind: 'plan', plan: 'hospital', months: 12 } as any, 'Hospital Comrade')).toBe('Hospital Comrade Hospital plan — 12 months subscription')
    expect(invoiceDescription({ kind: 'wallet' } as any, 'HC')).toMatch(/wallet/)
    expect(amountInWords(1178.82)).toBe('Rupees One Thousand One Hundred Seventy Eight and Eighty Two Paise Only')
    expect(amountInWords(353882)).toBe('Rupees Three Lakh Fifty Three Thousand Eight Hundred Eighty Two Only')
  })
})

describe('demo: plans, usage history', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    ;(globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() }
  })

  test('renew on another plan: quote at its price, the plan switches when paid, invoice keeps buyer + seller', async () => {
    const { demoQuote, demoApplyPayment, demoBilling, demoSummary } = await import('../src/billing/demo')
    const s = demoSummary(CITY)!
    expect(s.plans?.hospital.price).toBe(2999)
    expect(s.custom_price).toBe(false)
    expect(s.seller?.sac).toBe('998315')
    const q = demoQuote(CITY, 'plan', 1, undefined, 'hospital')
    expect(q).toMatchObject({ plan: 'hospital', base_paise: 299900, gst_paise: 53982 })
    expect(() => demoQuote(CITY, 'plan', 1, undefined, 'gold')).toThrow(/Unknown plan/)
    expect(() => demoQuote(CITY, 'plan', 1, undefined, 'custom')).toThrow(/priced individually/)
    demoApplyPayment(CITY, q, 'razorpay', 'upi')
    const b = demoBilling(CITY)!
    expect(b.plan).toBe('hospital')
    expect(b.payments[0]).toMatchObject({ plan: 'hospital', buyer: { gstin: '10AAKFC4321M1Z2' }, seller: { name: 'Digital Comrade' } })
  })

  test('trial switch is instant; refused once paid or with a custom price', async () => {
    const { demoChangeTrialPlan, demoBilling, demoQuote, demoApplyPayment, demoProviderBilling } = await import('../src/billing/demo')
    demoChangeTrialPlan(CITY, 'enterprise')
    expect(demoBilling(CITY)!.plan).toBe('enterprise')
    expect(() => demoChangeTrialPlan(CITY, 'custom')).toThrow(/priced individually/)
    demoProviderBilling(CITY, 'set_plan', { price: 1500 })
    expect(() => demoChangeTrialPlan(CITY, 'clinic')).toThrow(/agreed/)
    expect(() => demoQuote(CITY, 'plan', 1, undefined, 'clinic')).toThrow(/agreed/)
    demoProviderBilling(CITY, 'set_plan', { price: null })
    demoApplyPayment(CITY, demoQuote(CITY, 'plan', 1), 'razorpay', 'upi')
    expect(() => demoChangeTrialPlan(CITY, 'clinic')).toThrow(/Your plan is paid/)
  })

  test('usage history: six months oldest first, this month is the live count, charges beyond the allowance', async () => {
    const { demoUsageHistory, demoBilling } = await import('../src/billing/demo')
    const h = demoUsageHistory(CITY)
    expect(h).toHaveLength(6)
    expect(h[5].sent).toEqual(demoBilling(CITY)!.usage)
    expect(h[0].month < h[5].month).toBe(true)
    // City Care (clinic: 100 SMS / 300 WhatsApp / 1,000 e-mails included) sent 108 SMS this month → 8 × 30 paise
    expect(h[5].charged_paise).toBe(240)
    expect(demoUsageHistory(CITY, 12)).toHaveLength(12)
  })
})

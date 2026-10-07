/** Phase 6 — owner billing page: invoice GST split / place of supply. */
import { describe, expect, test } from 'vitest'
import { gstRate, invoiceTax, stateCode, stateFromGstin } from '../src/billing/invoice'
import { invoiceDescription } from '../src/billing/invoicePdf'
import { amountInWords } from '../src/components/InvoiceDocument'

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

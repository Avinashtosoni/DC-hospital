/**
 * Tax-invoice maths for Hospital Comrade's invoices to hospitals (phase 6) — kept free of jsPDF so it is cheap to
 * test and to use on screen. GST: intra-state supply → CGST + SGST (half each); inter-state → IGST.
 * Place of supply = the buyer's state (from the first two digits of their GSTIN); without a GSTIN we assume the
 * seller's state (a B2C supply in India is taxed at the supplier's location unless the buyer's address says otherwise).
 */
import type { PaymentRow, Seller } from './types'

/** GST state codes (first two digits of a GSTIN) */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
export const stateCode = (state: string | null | undefined) => Object.entries(GST_STATES).find(([, n]) => norm(n) === norm(state ?? ''))?.[0] ?? null
export const stateFromGstin = (gstin: string | null | undefined) => (gstin && /^\d{2}/.test(gstin) ? GST_STATES[gstin.slice(0, 2)] ?? null : null)

/** default SAC: 998315 "other IT services n.e.c." / hosting — the platform can set its own in the control panel */
export const DEFAULT_SAC = '998315'

export interface InvoiceTax {
  placeOfSupply: string
  posCode: string | null
  interState: boolean
  cgst: number
  sgst: number
  igst: number
}

/** split the GST of a payment (paise) by place of supply */
export function invoiceTax(seller: Pick<Seller, 'state' | 'gstin'>, buyerGstin: string | null | undefined, gstPaise: number): InvoiceTax {
  const sellerState = stateFromGstin(seller.gstin) ?? seller.state ?? ''
  const pos = stateFromGstin(buyerGstin) ?? sellerState
  const interState = !!pos && !!sellerState && norm(pos) !== norm(sellerState)
  const cgst = interState ? 0 : Math.floor(gstPaise / 2)
  return { placeOfSupply: pos || '—', posCode: stateCode(pos), interState, cgst, sgst: interState ? 0 : gstPaise - cgst, igst: interState ? gstPaise : 0 }
}

/** the GST rate actually charged (from the amounts, so old invoices print the rate they were charged at) */
export const gstRate = (p: Pick<PaymentRow, 'base_paise' | 'gst_paise'>) => (p.base_paise ? Math.round((p.gst_paise / p.base_paise) * 1000) / 10 : 0)

/**
 * GST credit note (Hospital Comrade → hospital) as a PDF, against a paid tax invoice. Loaded only on click (jsPDF chunk).
 * Built-in PDF fonts have no ₹ glyph, so amounts read "Rs.". Tax split follows the original invoice (CGST+SGST or IGST).
 */
import { amountInWords } from '../../src/components/InvoiceDocument'
import { invoiceTax } from '../../src/billing/invoice'
import type { Seller } from '../../src/billing/types'
import type { CreditNote } from './types'

const INK: [number, number, number] = [41, 41, 102]
const MUTED: [number, number, number] = [100, 116, 139]
const rs = (paise: number) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`
const d = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export async function downloadCreditNote(c: CreditNote, platformName: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const seller = { name: platformName, gstin: '', address: '', state: '', email: '', ...(c.seller ?? {}) } as Seller
  const buyer = { legalName: '', gstin: '', address: '', ...(c.buyer ?? {}) }
  const tax = invoiceTax(seller, buyer.gstin, c.gst_paise)

  doc.setFillColor(...INK); doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(seller.name || platformName, 14, 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(204, 204, 255)
  doc.text(doc.splitTextToSize(seller.address || '', 110), 14, 18)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255); doc.text('CREDIT NOTE', W - 14, 13, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(204, 204, 255)
  doc.text(seller.gstin ? `GSTIN ${seller.gstin}` : 'GSTIN: not registered', W - 14, 19, { align: 'right' })

  let y = 42
  doc.setTextColor(92, 92, 153); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text('ISSUED TO', 14, y)
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.text(buyer.legalName || c.hospital || '—', 14, y + 5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  const bl = [...doc.splitTextToSize(buyer.address || '', 95), buyer.gstin ? `GSTIN ${buyer.gstin}` : 'GSTIN: unregistered'] as string[]
  doc.text(bl, 14, y + 10)
  const facts: [string, string][] = [['Credit note no.', c.credit_no], ['Date', d(c.created_at)], ['Against invoice', c.invoice_no], ['Invoice date', d(c.invoice_date)],
    ['Settled by', c.mode === 'wallet' ? 'Credit to wallet' : 'Refund'], ['Place of supply', tax.placeOfSupply]]
  facts.forEach(([k, v], i) => {
    doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(k, W / 2 + 18, y + i * 5)
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.text(v, W - 14, y + i * 5, { align: 'right' }); doc.setFont('helvetica', 'normal')
  })
  y = Math.max(y + 10 + bl.length * 4, y + facts.length * 5) + 8

  doc.setFillColor(245, 245, 255); doc.rect(14, y - 5, W - 28, 8, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK)
  doc.text('Reason', 16, y); doc.text('Amount', W - 16, y, { align: 'right' })
  y += 8
  doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59)
  const reason = doc.splitTextToSize(c.reason, 140) as string[]
  doc.text(reason, 16, y); doc.text(rs(c.base_paise), W - 16, y, { align: 'right' })
  y += reason.length * 4.5 + 6
  const line = (k: string, v: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 8.5); doc.setTextColor(...(bold ? INK : MUTED))
    doc.text(k, W / 2 + 18, y); doc.setTextColor(30, 41, 59); doc.text(v, W - 16, y, { align: 'right' }); y += bold ? 7 : 5
  }
  line('Taxable value', rs(c.base_paise))
  if (tax.interState) line('IGST', rs(tax.igst))
  else { line('CGST', rs(tax.cgst)); line('SGST', rs(tax.sgst)) }
  line('Total credit', rs(c.total_paise), true)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(`In words: ${amountInWords(c.total_paise / 100)}`, W - 28), 14, y + 4)
  doc.text('This is a computer-generated credit note and does not need a signature.', 14, y + 16)
  doc.save(`${c.credit_no.replace(/[^\w-]+/g, '_')}.pdf`)
}

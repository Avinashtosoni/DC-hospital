/**
 * Hospital Comrade → hospital tax invoice as a real PDF (phase 6). Loaded only when "Download" is clicked
 * (jsPDF is a separate chunk). Built-in PDF fonts have no ₹ glyph, so amounts read "Rs.".
 * Seller / buyer come from the payment row (snapshotted when it was paid); older rows fall back to today's values.
 */
import { amountInWords } from '../components/InvoiceDocument'
import { planLabel } from '../platform/planStore'
import { DEFAULT_SAC, gstRate, invoiceTax } from './invoice'
import type { PaymentRow, Seller } from './types'

const INK: [number, number, number] = [41, 41, 102]          // #292966
const MUTED: [number, number, number] = [100, 116, 139]
const LINE: [number, number, number] = [226, 226, 245]
const rs = (paise: number) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`
const d = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export interface InvoiceInput {
  payment: PaymentRow
  /** fallbacks for rows paid before phase 6 */
  seller: Seller
  buyer: { legalName: string; gstin: string; address: string }
  platformName: string
}

export function invoiceDescription(p: PaymentRow, platformName: string) {
  if (p.kind === 'wallet') return `${platformName} messaging wallet — prepaid credit`
  const plan = p.plan ? planLabel(p.plan) : ''
  return `${platformName} ${plan} plan — ${p.months === 12 ? '12 months' : `${p.months ?? 1} month`} subscription`
}

export async function downloadBillingInvoice({ payment: p, seller: sellerNow, buyer: buyerNow, platformName }: InvoiceInput) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const seller: Seller = { ...sellerNow, ...(p.seller ?? {}) }
  const buyer = { ...buyerNow, ...Object.fromEntries(Object.entries(p.buyer ?? {}).filter(([, v]) => v)) } as InvoiceInput['buyer']
  const tax = invoiceTax(seller, buyer.gstin, p.gst_paise)
  const rate = gstRate(p)

  // header band
  doc.setFillColor(...INK); doc.rect(0, 0, W, 32, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text(seller.name || platformName, 14, 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(204, 204, 255)
  const sLines = [...doc.splitTextToSize(seller.address || '', 105), [seller.state && `State: ${seller.state}`, seller.email].filter(Boolean).join('  ·  ')].filter(Boolean)
  doc.text(sLines, 14, 18)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255)
  doc.text('TAX INVOICE', W - 14, 13, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(204, 204, 255)
  doc.text(seller.gstin ? `GSTIN ${seller.gstin}` : 'GSTIN: not registered', W - 14, 19, { align: 'right' })
  doc.text('Original for recipient', W - 14, 24, { align: 'right' })

  // invoice facts + buyer
  let y = 44
  const label = (t: string, x: number, yy: number) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(92, 92, 153); doc.text(t.toUpperCase(), x, yy); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59) }
  label('Billed to', 14, y)
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(buyer.legalName || '—', 14, y + 5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  const bLines = [...doc.splitTextToSize(buyer.address || '', 95), buyer.gstin ? `GSTIN ${buyer.gstin}` : 'GSTIN: unregistered'] as string[]
  doc.text(bLines, 14, y + 10)
  const facts: [string, string][] = [
    ['Invoice no.', p.invoice_no ?? '—'], ['Invoice date', d(p.paid_at ?? p.created_at)],
    ['Place of supply', `${tax.placeOfSupply}${tax.posCode ? ` (${tax.posCode})` : ''}`],
    ['Payment', `${p.provider === 'manual' ? 'Received' : 'Razorpay'}${p.method ? ` · ${p.method.toUpperCase()}` : ''}`],
    ...(p.payment_id ? [['Reference', p.payment_id] as [string, string]] : []),
  ]
  facts.forEach(([k, v], i) => {
    doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(k, W / 2 + 18, y + i * 5)
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.text(v, W - 14, y + i * 5, { align: 'right' }); doc.setFont('helvetica', 'normal')
  })
  y = Math.max(y + 10 + bLines.length * 4, y + facts.length * 5) + 8

  // line table
  const cols = [14, 112, 132, W - 14]
  doc.setFillColor(245, 245, 255); doc.rect(14, y - 5, W - 28, 8, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK)
  doc.text('Description', cols[0] + 2, y); doc.text('SAC', cols[1], y); doc.text('Period', cols[2], y); doc.text('Amount', cols[3] - 2, y, { align: 'right' })
  y += 8
  doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59)
  const desc = doc.splitTextToSize(invoiceDescription(p, platformName), 92) as string[]
  doc.text(desc, cols[0] + 2, y)
  doc.text(seller.sac || DEFAULT_SAC, cols[1], y)
  doc.text(p.period_from ? [`${d(p.period_from)} –`, d(p.period_to)] : ['—'], cols[2], y)
  doc.text(rs(p.base_paise), cols[3] - 2, y, { align: 'right' })
  y += Math.max(desc.length, p.period_from ? 2 : 1) * 4 + 4
  doc.setDrawColor(...LINE); doc.line(14, y, W - 14, y)
  y += 6

  // totals
  const total = (k: string, v: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 8.5); doc.setTextColor(...(bold ? INK : [51, 65, 85] as [number, number, number]))
    doc.text(k, 132, y); doc.text(v, W - 16, y, { align: 'right' }); y += bold ? 7 : 5
  }
  total('Taxable value', rs(p.base_paise))
  if (tax.interState) total(`IGST @ ${rate}%`, rs(tax.igst))
  else { total(`CGST @ ${rate / 2}%`, rs(tax.cgst)); total(`SGST @ ${rate / 2}%`, rs(tax.sgst)) }
  doc.setDrawColor(...LINE); doc.line(132, y - 2, W - 14, y - 2); y += 2
  total('Total', rs(p.total_paise), true)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(`Amount in words: ${amountInWords(p.total_paise / 100)}`, 14, y + 2)
  doc.text('Tax payable on reverse charge: No', 14, y + 7)
  if (p.status === 'refunded') { doc.setTextColor(190, 18, 60); doc.setFont('helvetica', 'bold'); doc.text('REFUNDED', 14, y + 13) }

  // footer
  doc.setDrawColor(...LINE); doc.line(14, H - 22, W - 14, H - 22)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(`This is a computer-generated invoice and needs no signature. Questions about this invoice: ${seller.email || platformName}.`, W - 28), 14, H - 16)
  doc.text(`For ${seller.name || platformName}`, W - 14, H - 8, { align: 'right' })
  doc.save(`${(p.invoice_no ?? 'invoice').replace(/[^a-z0-9-]+/gi, '-')}.pdf`)
}

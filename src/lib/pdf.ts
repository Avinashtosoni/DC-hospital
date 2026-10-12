/**
 * Real PDF files for patients (lab reports, bills) — works the same on phones and in the installed app,
 * where "Print → Save as PDF" is clumsy. jsPDF is loaded only when a download is requested.
 * Built-in PDF fonts have no ₹ glyph, so amounts are written as "Rs.".
 */
import type { jsPDF as JsPDF } from 'jspdf'
import type { SiteSettings } from '../site/cms/types'
import type { Invoice, LabTest, Patient, Payment } from '../types'
import { amountInWords } from '../components/InvoiceDocument'
import { fmtDate } from './utils'

const INK = [41, 41, 102] as const        // #292966
const MUTED = [100, 116, 139] as const
const LINE = [226, 226, 245] as const
type RGB = readonly [number, number, number]
const ink = (doc: JsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2])
const rs = (n: number) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`

type PatientInfo = Pick<Patient, 'full_name' | 'mrn'> & Partial<Pick<Patient, 'phone' | 'email' | 'address' | 'gender' | 'date_of_birth'>>

async function newDoc() {
  const { jsPDF } = await import('jspdf')
  return new jsPDF({ unit: 'mm', format: 'a4' })
}

/** Coloured letterhead band; returns the y position below it. */
function letterhead(doc: JsPDF, s: SiteSettings, right: string[]) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...INK); doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(s.name, 14, 12)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.setTextColor(204, 204, 255)
  doc.text(doc.splitTextToSize(s.address || '', 110), 14, 17)
  doc.text([s.phone, s.email].filter(Boolean).join('  ·  '), 14, 26)
  right.filter(Boolean).forEach((line, i) => doc.text(line, W - 14, 12 + i * 4.5, { align: 'right' }))
  doc.setTextColor(0, 0, 0)
  return 40
}

function footer(doc: JsPDF, s: SiteSettings, note: string) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...LINE); doc.line(14, H - 18, W - 14, H - 18)
  doc.setFontSize(7.5); doc.setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(note, W - 28), 14, H - 13)
  doc.text(`Generated ${fmtDate(new Date().toISOString(), 'dd MMM yyyy, hh:mm a')} · ${s.name}`, W - 14, H - 6, { align: 'right' })
}

function label(doc: JsPDF, text: string, x: number, y: number) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(92, 92, 153)
  doc.text(text.toUpperCase(), x, y)
  doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59)
}

function patientBlock(doc: JsPDF, p: PatientInfo | null | undefined, y: number) {
  label(doc, 'Patient', 14, y)
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(p?.full_name ?? '—', 14, y + 5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  const lines = [p?.mrn && `MRN ${p.mrn}`, [p?.gender && p.gender[0].toUpperCase() + p.gender.slice(1), p?.date_of_birth && `DOB ${fmtDate(p.date_of_birth)}`].filter(Boolean).join(' · '),
    [p?.phone, p?.email].filter(Boolean).join(' · '), p?.address].filter(Boolean) as string[]
  doc.text(lines, 14, y + 10)
  doc.setTextColor(0, 0, 0)
  return y + 10 + lines.length * 4
}

const fileSafe = (s: string) => s.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '')

// ------------------------------------------------------------------ lab report
export async function downloadLabReport(test: LabTest, opts: { site: SiteSettings; patient?: PatientInfo | null; doctor?: string | null }) {
  const doc = await newDoc()
  const W = doc.internal.pageSize.getWidth()
  const s = opts.site
  let y = letterhead(doc, s, [s.billing.regNo && `Clinical Est. Reg. ${s.billing.regNo}`, 'Department of Laboratory Medicine'])
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK)
  doc.text('Laboratory Report', 14, y + 4)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)
  doc.text(`Report ID ${test.id.slice(0, 8).toUpperCase()}`, W - 14, y + 4, { align: 'right' })
  y += 12
  const yLeft = patientBlock(doc, opts.patient, y)
  label(doc, 'Test details', W / 2 + 4, y)
  doc.setFontSize(8.5)
  const meta: [string, string][] = [
    ['Referred by', opts.doctor ?? '—'], ['Category', test.category], ['Priority', test.priority.toUpperCase()],
    ['Requested', fmtDate(test.requested_on)], ['Reported', test.completed_on ? fmtDate(test.completed_on) : '—'],
  ]
  meta.forEach(([k, v], i) => { doc.setTextColor(...MUTED); doc.text(k, W / 2 + 4, y + 5 + i * 4.6); doc.setTextColor(30, 41, 59); doc.text(v, W / 2 + 32, y + 5 + i * 4.6) })
  y = Math.max(yLeft, y + 5 + meta.length * 4.6) + 6

  doc.setFillColor(246, 246, 253); doc.roundedRect(14, y, W - 28, 10, 2, 2, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
  doc.text(test.test_name, 18, y + 6.6)
  doc.setFontSize(8); ink(doc, test.status === 'completed' ? [5, 150, 105] : [217, 119, 6])
  doc.text(test.status === 'completed' ? 'FINAL' : test.status.replace('_', ' ').toUpperCase(), W - 18, y + 6.6, { align: 'right' })
  y += 17
  label(doc, 'Result / findings', 14, y)
  doc.setFontSize(10.5); doc.setTextColor(30, 41, 59)
  const text = doc.splitTextToSize(test.result?.trim() || 'Result awaited. This report will be updated when the test is completed.', W - 28)
  doc.text(text, 14, y + 6, { lineHeightFactor: 1.5 })
  y += 6 + text.length * 5.5 + 16

  doc.setDrawColor(...LINE); doc.line(W - 74, y, W - 14, y)
  doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  doc.text(s.billing.signatory || 'Authorised signatory', W - 44, y + 5, { align: 'center' })
  footer(doc, s, 'This report relates only to the sample tested. Interpret results with clinical correlation — please discuss them with your doctor. Electronically generated; no signature required.')
  doc.save(`Lab-report-${fileSafe(test.test_name)}-${test.completed_on ?? test.requested_on}.pdf`)
}

// ------------------------------------------------------------------ invoice / bill of supply
export async function downloadInvoice(inv: Invoice, opts: { site: SiteSettings; patient?: PatientInfo | null; payments?: Payment[] }) {
  const doc = await newDoc()
  const W = doc.internal.pageSize.getWidth()
  const s = opts.site, b = s.billing
  const taxable = Math.max(0, Number(inv.subtotal) - Number(inv.discount))
  const tax = Number(inv.tax) || 0
  const isTax = tax > 0
  const rate = isTax && taxable ? Math.round((tax / taxable) * 1000) / 10 : 0
  const half = Math.round((tax / 2) * 100) / 100
  const balance = inv.status === 'cancelled' ? 0 : Math.max(0, Number(inv.total) - Number(inv.amount_paid))

  let y = letterhead(doc, s, [b.gstin && `GSTIN ${b.gstin}`, b.pan && `PAN ${b.pan}`, b.regNo && `Clinical Est. Reg. ${b.regNo}`])
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK)
  doc.text(isTax ? 'Tax Invoice' : 'Bill of Supply', 14, y + 4)
  doc.setFontSize(10)
  const stamp = inv.status === 'paid' ? 'PAID' : inv.status === 'partial' ? 'PART PAID' : inv.status === 'cancelled' ? 'CANCELLED' : inv.status === 'overdue' ? 'OVERDUE' : 'UNPAID'
  ink(doc, inv.status === 'paid' ? [5, 150, 105] : inv.status === 'cancelled' ? MUTED : [225, 29, 72])
  doc.text(stamp, W - 14, y + 4, { align: 'right' })
  y += 10
  doc.setFillColor(246, 246, 253); doc.roundedRect(14, y, W - 28, 12, 2, 2, 'F')
  const meta: [string, string][] = [[isTax ? 'Invoice no.' : 'Bill no.', inv.invoice_number], ['Date', fmtDate(inv.issue_date)], ['Due', fmtDate(inv.due_date || inv.issue_date)], ['Status', inv.status.toUpperCase()]]
  meta.forEach(([k, v], i) => { const x = 18 + i * ((W - 36) / 4); label(doc, k, x, y + 4.5); doc.setFontSize(9.5); doc.text(v, x, y + 9.5) })
  y += 20
  y = patientBlock(doc, opts.patient, y) + 4

  // items
  const cols = [14, 24, W - 88, W - 64, W - 44, W - 14]
  doc.setFillColor(250, 250, 255); doc.rect(14, y, W - 28, 8, 'F')
  label(doc, '#', cols[0] + 2, y + 5.3); label(doc, 'Description', cols[1], y + 5.3); label(doc, 'SAC', cols[2], y + 5.3)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(92, 92, 153)
  doc.text('QTY', cols[3] + 8, y + 5.3, { align: 'right' }); doc.text('RATE', cols[4] + 12, y + 5.3, { align: 'right' }); doc.text('AMOUNT', cols[5], y + 5.3, { align: 'right' })
  y += 12
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(30, 41, 59)
  inv.items.forEach((it, i) => {
    const desc = doc.splitTextToSize(it.description, cols[2] - cols[1] - 4)
    if (y + desc.length * 4.5 > 250) { doc.addPage(); y = 20 }
    doc.setTextColor(...MUTED); doc.text(String(i + 1), cols[0] + 2, y); doc.text(b.sac || '', cols[2], y)
    doc.setTextColor(30, 41, 59); doc.text(desc, cols[1], y)
    doc.text(String(it.quantity), cols[3] + 8, y, { align: 'right' })
    doc.text(rs(it.unit_price), cols[4] + 12, y, { align: 'right' })
    doc.text(rs(it.quantity * it.unit_price), cols[5], y, { align: 'right' })
    y += Math.max(1, desc.length) * 4.5 + 2.5
    doc.setDrawColor(240, 240, 248); doc.line(14, y - 2.5, W - 14, y - 2.5)
  })

  // totals
  y += 3
  const tot: [string, string, boolean?][] = [['Subtotal', rs(inv.subtotal)]]
  if (Number(inv.discount) > 0) tot.push(['Discount', `- ${rs(inv.discount)}`])
  if (isTax) tot.push(['Taxable value', rs(taxable)], [`CGST @ ${rate / 2}%`, rs(half)], [`SGST @ ${rate / 2}%`, rs(tax - half)])
  else tot.push(['GST', 'Exempt'])
  tot.push(['Total', rs(inv.total), true], ['Paid', rs(inv.amount_paid)], ['Balance due', rs(balance), true])
  const tx = W - 80
  tot.forEach(([k, v, bold], i) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 10 : 9); ink(doc, bold ? INK : [51, 65, 85])
    doc.text(k, tx, y + i * 5.5); doc.text(v, W - 14, y + i * 5.5, { align: 'right' })
  })
  doc.setFont('helvetica', 'normal')
  label(doc, 'Amount in words', 14, y)
  doc.setFontSize(8.5); doc.text(doc.splitTextToSize(amountInWords(Number(inv.total)), tx - 22), 14, y + 4.5)
  let ny = y + 14
  doc.setFontSize(7.5); doc.setTextColor(...MUTED)
  if (!isTax && b.exemptNote) { const t = doc.splitTextToSize(b.exemptNote, tx - 22); doc.text(t, 14, ny); ny += t.length * 3.6 + 2 }
  if (b.upiId && balance > 0) { doc.text(`Pay by UPI: ${b.upiId} · reference ${inv.invoice_number}`, 14, ny); ny += 5 }
  y = Math.max(ny, y + tot.length * 5.5) + 6

  if (opts.payments?.length) {
    label(doc, 'Payments received', 14, y); y += 5
    doc.setFontSize(8.5); doc.setTextColor(51, 65, 85)
    opts.payments.forEach((p) => { doc.text(`${fmtDate(p.paid_on)} · ${p.method.toUpperCase()}${p.reference ? ` · ${p.reference}` : ''}`, 14, y); doc.text(rs(p.amount), W - 14, y, { align: 'right' }); y += 4.8 })
  }
  footer(doc, s, b.footer || 'Thank you for choosing us. This is a computer-generated document and does not need a signature.')
  doc.save(`${isTax ? 'Invoice' : 'Bill'}-${inv.invoice_number}.pdf`)
}

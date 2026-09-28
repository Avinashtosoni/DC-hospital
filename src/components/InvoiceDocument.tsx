import type { ReactNode } from 'react'
import { useSiteSettings } from '../site/cms/content'
import { cn, fmtDate, fmtTime, titleCase } from '../lib/utils'
import type { Invoice, Patient, Payment } from '../types'

/**
 * Printable invoice with the hospital letterhead (CMS → Settings → Billing, GST & letterhead).
 *  • GST > 0  → "Tax Invoice" with CGST + SGST (intra-state, half each)
 *  • GST = 0  → "Bill of Supply" with the healthcare exemption note (Notification 12/2017-CT(Rate))
 * Print with printInvoice() → only this document is printed, on A4 (browser "Save as PDF" makes the PDF).
 */

const STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '36': 'Telangana', '37': 'Andhra Pradesh',
}
const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(n) || 0)

// ------------------------------------------------------------------ amount in words (Indian numbering)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const three = (n: number) => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && two(n % 100)].filter(Boolean).join(' ')
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount)), paise = Math.round((Math.abs(amount) - rupees) * 100)
  const parts: string[] = []
  let n = rupees
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  if (crore) parts.push(`${crore > 99 ? amountInWords(crore).replace(/^Rupees | Only$/g, '') : two(crore)} Crore`)
  if (lakh) parts.push(`${two(lakh)} Lakh`)
  if (thousand) parts.push(`${two(thousand)} Thousand`)
  if (n) parts.push(three(n))
  const r = parts.join(' ') || 'Zero'
  return `Rupees ${r}${paise ? ` and ${two(paise)} Paise` : ''} Only`
}

export function printInvoice() {
  const html = document.documentElement
  html.classList.add('print-doc')
  const done = () => { html.classList.remove('print-doc'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.print()
  setTimeout(done, 1500) // Safari fires afterprint unreliably
}

export interface InvoiceDocProps {
  invoice: Invoice
  patient?: Pick<Patient, 'full_name' | 'mrn' | 'phone' | 'email' | 'address'> & { insurance_provider?: string | null } | null
  payments?: Payment[]
  appointment?: { ref?: string | null; doctor: string; specialization?: string | null; department?: string | null; date: string; time: string } | null
  className?: string
}

export function InvoiceDocument({ invoice: inv, patient, payments = [], appointment, className }: InvoiceDocProps) {
  const s = useSiteSettings()
  const b = s.billing
  const taxable = Math.max(0, Number(inv.subtotal) - Number(inv.discount))
  const tax = Number(inv.tax) || 0
  const isTax = tax > 0
  const rate = isTax && taxable ? Math.round((tax / taxable) * 1000) / 10 : 0
  const half = Math.round((tax / 2) * 100) / 100
  const balance = Math.max(0, Number(inv.total) - Number(inv.amount_paid))
  const state = STATES[b.gstin.slice(0, 2)] ? `${STATES[b.gstin.slice(0, 2)]} (${b.gstin.slice(0, 2)})` : null
  const ref = appointment?.ref ?? /DCB-[A-F0-9]+/i.exec(inv.notes ?? '')?.[0]
  const stamp = inv.status === 'paid' ? ['PAID', 'text-emerald-600 border-emerald-500'] : inv.status === 'cancelled' ? ['CANCELLED', 'text-slate-400 border-slate-300']
    : inv.status === 'partial' ? ['PART PAID', 'text-amber-600 border-amber-500'] : inv.status === 'overdue' ? ['OVERDUE', 'text-rose-600 border-rose-500'] : inv.status === 'draft' ? ['DRAFT', 'text-slate-400 border-slate-300'] : ['UNPAID', 'text-rose-500 border-rose-400']
  const upi = b.upiId && balance > 0 && inv.status !== 'cancelled'
    ? `upi://pay?pa=${encodeURIComponent(b.upiId)}&pn=${encodeURIComponent(b.legalName || s.name)}&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoice_number)}` : null

  return (
    <article className={cn('invoice-doc relative overflow-hidden rounded-2xl border border-[#e6e6f5] bg-white text-slate-800 shadow-sm', className)} aria-label={`${isTax ? 'Tax invoice' : 'Bill of supply'} ${inv.invoice_number}`}>
      {/* letterhead */}
      <header className="relative bg-[#292966] px-6 py-5 text-white sm:px-8">
        <div aria-hidden="true" className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_85%_20%,rgba(204,204,255,.35),transparent_60%)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-[#292966] shadow-sm">
              <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true"><path fill="currentColor" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>
            </span>
            <div className="min-w-0">
              <p className="font-display text-xl font-bold leading-tight">{s.name}</p>
              {b.legalName && b.legalName !== s.name && <p className="text-[11px] text-[#ccccff]">{b.legalName}</p>}
              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-[#dcdcfa]">{s.address}</p>
              <p className="text-[11px] text-[#dcdcfa]">{s.phone} · {s.email}</p>
            </div>
          </div>
          <div className="shrink-0 text-[11px] leading-relaxed text-[#dcdcfa] sm:text-right">
            {b.gstin && <p><span className="text-[#a3a3cc]">GSTIN</span> <b className="font-mono text-white">{b.gstin}</b></p>}
            {b.pan && <p><span className="text-[#a3a3cc]">PAN</span> <span className="font-mono">{b.pan}</span></p>}
            {b.regNo && <p><span className="text-[#a3a3cc]">Clinical Est. Reg.</span> {b.regNo}</p>}
          </div>
        </div>
      </header>

      <div className="px-6 py-6 sm:px-8">
        {/* title + meta */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#292966]">{isTax ? 'Tax Invoice' : 'Bill of Supply'}</h2>
            <p className="text-xs text-slate-500">{isTax ? 'Original for recipient' : 'Exempt supply — no GST charged'}</p>
          </div>
          <span className={cn('rotate-[-6deg] rounded-lg border-2 px-3 py-1 font-display text-sm font-extrabold tracking-[.2em]', stamp[1])}>{stamp[0]}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-[#f6f6fd] p-4 text-xs sm:grid-cols-4">
          <Meta k={isTax ? 'Invoice no.' : 'Bill no.'} v={<b className="font-mono text-sm text-[#292966]">{inv.invoice_number}</b>} />
          <Meta k="Date" v={fmtDate(inv.issue_date)} />
          <Meta k="Due" v={fmtDate(inv.due_date || inv.issue_date)} />
          {ref ? <Meta k="Booking ref" v={<span className="font-mono">{ref}</span>} /> : <Meta k="Place of supply" v={state ?? '—'} />}
        </dl>

        {/* parties */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="avoid-break">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5c5c99]">Billed to</p>
            <p className="mt-1 font-semibold text-slate-900">{patient?.full_name ?? '—'}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              {patient?.mrn && <>MRN {patient.mrn}<br /></>}
              {patient?.phone}{patient?.email && <> · {patient.email}</>}
              {patient?.address && <><br />{patient.address}</>}
            </p>
            {patient?.insurance_provider && <p className="mt-1 text-xs text-slate-500">Insurance: {patient.insurance_provider}</p>}
          </div>
          {appointment ? (
            <div className="avoid-break rounded-xl border border-[#e6e6f5] p-3 sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5c5c99]">Appointment</p>
              <p className="mt-1 font-semibold text-slate-900">{appointment.doctor}</p>
              <p className="text-xs text-slate-500">{[appointment.specialization, appointment.department].filter(Boolean).join(' · ')}</p>
              <p className="mt-1 text-sm font-medium text-[#292966]">{fmtDate(appointment.date, 'EEE, d MMM yyyy')} · {fmtTime(appointment.time)}</p>
            </div>
          ) : state && ref && (
            <div className="avoid-break sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5c5c99]">Place of supply</p>
              <p className="mt-1 text-sm text-slate-700">{state}</p>
            </div>
          )}
        </div>

        {/* items */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-y border-[#e6e6f5] bg-[#fafaff] text-left text-[10px] font-semibold uppercase tracking-wider text-[#5c5c99]">
                <th className="w-8 py-2 pl-2">#</th><th className="py-2">Description</th><th className="py-2">SAC</th>
                <th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 pr-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f8]">
              {inv.items.map((it, i) => (
                <tr key={i} className="avoid-break align-top">
                  <td className="py-2.5 pl-2 text-xs text-slate-400">{i + 1}</td>
                  <td className="py-2.5 pr-3 text-slate-800">{it.description}</td>
                  <td className="py-2.5 font-mono text-xs text-slate-500">{b.sac}</td>
                  <td className="py-2.5 text-right tabular-nums">{it.quantity}</td>
                  <td className="py-2.5 text-right tabular-nums">{inr(it.unit_price)}</td>
                  <td className="py-2.5 pr-2 text-right font-medium tabular-nums">{inr(it.quantity * it.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* totals */}
        <div className="avoid-break mt-4 grid gap-5 sm:grid-cols-[1fr_minmax(0,18rem)]">
          <div className="order-2 space-y-3 text-xs sm:order-1">
            <div className="rounded-xl bg-[#f6f6fd] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5c5c99]">Amount in words</p>
              <p className="mt-0.5 font-medium text-slate-800">{amountInWords(Number(inv.total))}</p>
            </div>
            {!isTax && b.exemptNote && <p className="leading-relaxed text-slate-500">{b.exemptNote}</p>}
            {upi && (
              <p className="leading-relaxed text-slate-600">Pay by UPI: <b className="font-mono text-[#292966]">{b.upiId}</b> · reference <span className="font-mono">{inv.invoice_number}</span>
                <a href={upi} className="ml-1 text-[#5c5c99] underline print:hidden">Open UPI app</a></p>
            )}
            {inv.notes && <p className="text-slate-500">Note: {inv.notes}</p>}
          </div>
          <dl className="order-1 space-y-1.5 text-sm sm:order-2">
            <Tot k="Subtotal" v={inr(inv.subtotal)} />
            {Number(inv.discount) > 0 && <Tot k="Discount" v={`− ${inr(inv.discount)}`} />}
            {isTax ? <>
              <Tot k="Taxable value" v={inr(taxable)} />
              <Tot k={`CGST @ ${rate / 2}%`} v={inr(half)} />
              <Tot k={`SGST @ ${rate / 2}%`} v={inr(tax - half)} />
            </> : <Tot k="GST" v="Exempt" />}
            <div className="border-t border-[#e6e6f5] pt-1.5"><Tot k={<b className="text-slate-900">Total</b>} v={<b className="text-base text-[#292966]">{inr(inv.total)}</b>} /></div>
            <Tot k="Paid" v={<span className="text-emerald-700">{inr(inv.amount_paid)}</span>} />
            <div className={cn('rounded-lg px-2.5 py-1.5', balance > 0 && inv.status !== 'cancelled' ? 'bg-rose-50' : 'bg-emerald-50')}>
              <Tot k={<b>Balance due</b>} v={<b className={balance > 0 && inv.status !== 'cancelled' ? 'text-rose-600' : 'text-emerald-700'}>{inr(inv.status === 'cancelled' ? 0 : balance)}</b>} />
            </div>
          </dl>
        </div>

        {payments.length > 0 && (
          <div className="avoid-break mt-5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5c5c99]">Payments received</p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-[#f0f0f8]">
                {payments.map((p) => (
                  <tr key={p.id}><td className="py-1.5">{fmtDate(p.paid_on)}</td><td className="py-1.5">{p.method === 'upi' ? 'UPI' : titleCase(p.method)}</td>
                    <td className="py-1.5 font-mono text-slate-400">{p.reference}</td><td className="py-1.5 text-right font-medium tabular-nums text-emerald-700">{inr(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* signature */}
        <div className="avoid-break mt-8 flex flex-wrap items-end justify-between gap-6 border-t border-dashed border-[#e0e0f2] pt-4">
          <p className="max-w-sm text-[11px] leading-relaxed text-slate-400">{b.footer}<br />Thank you for choosing {s.name}. Get well soon.</p>
          <div className="text-right text-xs">
            <p className="text-slate-500">For {b.legalName || s.name}</p>
            <div className="my-2 h-8" />
            <p className="border-t border-slate-300 pt-1 font-medium text-slate-700">{b.signatory}</p>
          </div>
        </div>
      </div>
    </article>
  )
}

const Meta = ({ k, v }: { k: string; v: ReactNode }) => <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt><dd className="mt-0.5 text-slate-800">{v}</dd></div>
const Tot = ({ k, v }: { k: ReactNode; v: ReactNode }) => <div className="flex items-center justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums text-slate-800">{v}</dd></div>

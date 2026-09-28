import { CalendarPlus, ExternalLink, Receipt } from 'lucide-react'
import { Field, Input, Select, Textarea } from '../../components/ui'
import { Section, Toggle, type TabCtx } from './shared'

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/

export function BillingTab({ ctx }: { ctx: TabCtx }) {
  const { site, editSite } = ctx
  const b = site.billing, bk = site.booking
  const gstinErr = b.gstin && !GSTIN_RE.test(b.gstin) ? 'Should be 15 characters, e.g. 07AABCD1234E1Z5' : undefined
  const panErr = b.pan && !PAN_RE.test(b.pan) ? 'Should look like AABCD1234E' : undefined
  return (
    <div className="space-y-6">
      <Section title="Invoice letterhead & tax" description="Printed on every invoice, bill of supply and receipt." icon={<Receipt className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal / registered name" hint="Falls back to the hospital name"><Input value={b.legalName} onChange={(e) => editSite((d) => { d.billing.legalName = e.target.value })} /></Field>
          <Field label="GSTIN" error={gstinErr}><Input value={b.gstin} maxLength={15} onChange={(e) => editSite((d) => { d.billing.gstin = e.target.value.toUpperCase().trim() })} className="font-mono" placeholder="07AABCD1234E1Z5" /></Field>
          <Field label="PAN" error={panErr}><Input value={b.pan} maxLength={10} onChange={(e) => editSite((d) => { d.billing.pan = e.target.value.toUpperCase().trim() })} className="font-mono" /></Field>
          <Field label="Hospital registration no." hint="Clinical Establishments Act / state registration"><Input value={b.regNo} onChange={(e) => editSite((d) => { d.billing.regNo = e.target.value })} /></Field>
          <Field label="SAC code" hint="999312 — medical & dental services"><Input value={b.sac} onChange={(e) => editSite((d) => { d.billing.sac = e.target.value.trim() })} className="font-mono" /></Field>
          <Field label="GST on online consultations" hint="Healthcare services are usually exempt → prints a “Bill of Supply”">
            <Select value={String(b.gstRate)} onChange={(e) => editSite((d) => { d.billing.gstRate = Number(e.target.value) })}>
              {[0, 5, 12, 18].map((r) => <option key={r} value={r}>{r === 0 ? 'Exempt (0%)' : `${r}% (CGST ${r / 2}% + SGST ${r / 2}%)`}</option>)}
            </Select>
          </Field>
          <Field label="Exemption note" className="sm:col-span-2"><Input value={b.exemptNote} onChange={(e) => editSite((d) => { d.billing.exemptNote = e.target.value })} /></Field>
          <Field label="UPI ID" hint="Adds a “Pay by UPI” line and link on unpaid invoices"><Input value={b.upiId} onChange={(e) => editSite((d) => { d.billing.upiId = e.target.value.trim() })} placeholder="dchospital@okaxis" /></Field>
          <Field label="Authorised signatory"><Input value={b.signatory} onChange={(e) => editSite((d) => { d.billing.signatory = e.target.value })} placeholder="Accounts Manager" /></Field>
          <Field label="Invoice footer" className="sm:col-span-2"><Textarea rows={2} value={b.footer} onChange={(e) => editSite((d) => { d.billing.footer = e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Online booking" description="Appointment booking from the public website with mobile OTP verification." icon={<CalendarPlus className="h-4 w-4" />}
        action={<a href="/book" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Open booking page<ExternalLink className="h-3.5 w-3.5" /></a>}>
        <div className="space-y-4">
          <Toggle label="Accept online bookings" hint="When off, the Book button shows your phone number instead" checked={bk.enabled} onChange={(v) => editSite((d) => { d.booking.enabled = v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Book up to (days ahead)"><Input type="number" min={1} max={120} value={bk.advanceDays} onChange={(e) => editSite((d) => { d.booking.advanceDays = Math.min(120, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            <Field label="Minimum notice (minutes)" hint="Earliest slot today = now + this"><Input type="number" min={0} max={1440} step={15} value={bk.minNoticeMinutes} onChange={(e) => editSite((d) => { d.booking.minNoticeMinutes = Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <Field label="Payment note" className="sm:col-span-2" hint="Shown on the confirmation and the invoice"><Input value={bk.payNote} onChange={(e) => editSite((d) => { d.booking.payNote = e.target.value })} /></Field>
          </div>
          <Toggle label="Show the OTP on screen when no SMS gateway is connected" hint="For demos and testing only. Hidden automatically once SMS or WhatsApp delivers the code. Turn OFF in production." checked={bk.showDemoOtp} onChange={(v) => editSite((d) => { d.booking.showDemoOtp = v })} />
        </div>
      </Section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Ban, CreditCard, Printer, Receipt, Wallet } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { useCreate, useLookup, useTable, useUpdate } from '../hooks/useData'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui'
import { Forbidden } from '../components/layout/Guards'
import { Logo } from '../components/layout/AppLayout'
import { HOSPITAL, fmtDate, money, titleCase, today } from '../lib/utils'
import { deriveInvoiceStatus, invoiceBalance } from '../lib/billing'
import type { Payment } from '../types'

export default function InvoiceDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const pLk = useLookup('patients')
  const updInv = useUpdate('invoices', { label: 'Invoice', silent: true })
  const createPay = useCreate('payments', { label: 'Payment', silent: true })
  const [payOpen, setPayOpen] = useState(false)
  const [form, setForm] = useState({ amount: '', method: 'upi' as Payment['method'], paid_on: today(), reference: '' })
  const [err, setErr] = useState('')

  const inv = invoices.data?.find((i) => i.id === id)
  const role = user!.role
  const canPay = can(role, 'payments', 'create') && role !== 'patient'
  const balance = inv ? invoiceBalance(inv) : 0

  useEffect(() => {
    if (params.get('pay') && inv && canPay) {
      setForm((f) => ({ ...f, amount: String(balance) })); setPayOpen(true)
      setParams({}, { replace: true })
    }
  }, [params, inv, canPay, balance, setParams])

  if (invoices.isLoading) return <div className="mx-auto max-w-4xl space-y-4"><Skeleton className="h-10 w-60" /><Skeleton className="h-[560px]" /></div>
  if (!inv) return <EmptyState className="py-24" icon={<Receipt className="h-6 w-6" />} title="Invoice not found" action={<Link to="/invoices"><Button variant="outline">Back to invoices</Button></Link>} />
  const patient = pLk.get(inv.patient_id)
  if (role === 'patient' && patient?.profile_id !== user!.id) return <Forbidden />
  const history = (payments.data ?? []).filter((p) => p.invoice_id === inv.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on))

  const submitPayment = () => {
    const amount = Number(form.amount)
    if (!amount || amount <= 0) return setErr('Enter a valid amount')
    if (amount > balance + 0.01) return setErr(`Amount cannot exceed the balance of ${money(balance)}`)
    setErr('')
    setPayOpen(false)
    const amount_paid = inv.amount_paid + amount
    // optimistic: both the payment row and the invoice totals update instantly
    createPay.mutate({ invoice_id: inv.id, patient_id: inv.patient_id, amount, method: form.method, paid_on: form.paid_on, reference: form.reference || null } as never)
    updInv.mutate({ id: inv.id, patch: { amount_paid, status: deriveInvoiceStatus({ ...inv, amount_paid }) } }, {
      onSuccess: () => import('sonner').then(({ toast }) => toast.success(`Payment of ${money(amount)} recorded`)),
    })
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => nav(-1)} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Back</button>
        <div className="flex flex-wrap gap-2">
          {can(role, 'invoices', 'update') && role !== 'receptionist' && !['cancelled', 'paid'].includes(inv.status) && inv.amount_paid === 0 && (
            <Button variant="outline" icon={<Ban className="h-4 w-4" />} onClick={() => updInv.mutate({ id: inv.id, patch: { status: 'cancelled' } })}>Cancel invoice</Button>
          )}
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
          {canPay && balance > 0 && !['cancelled', 'draft'].includes(inv.status) && <Button icon={<Wallet className="h-4 w-4" />} onClick={() => { setForm((f) => ({ ...f, amount: String(balance) })); setPayOpen(true) }}>Record payment</Button>}
        </div>
      </div>

      <Card className="print-area overflow-hidden">
        <div className="flex flex-col gap-6 border-b border-slate-100 p-8 sm:flex-row sm:justify-between">
          <div><Logo /><p className="mt-3 max-w-xs text-xs leading-relaxed text-slate-500">{HOSPITAL.address}<br />{HOSPITAL.phone} · {HOSPITAL.email}<br />GSTIN {HOSPITAL.gstin}</p></div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tax invoice</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{inv.invoice_number}</p>
            <div className="mt-2"><StatusBadge value={inv.status} /></div>
            <p className="mt-3 text-xs text-slate-500">Issued {fmtDate(inv.issue_date)}<br />Due {fmtDate(inv.due_date)}</p>
          </div>
        </div>
        <div className="grid gap-6 border-b border-slate-100 p-8 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Billed to</p>
            <p className="mt-2 font-semibold text-slate-900">{patient?.full_name ?? '—'}</p>
            <p className="text-sm text-slate-500">MRN {patient?.mrn}<br />{patient?.phone}<br />{patient?.address}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Insurance</p>
            <p className="mt-2 text-sm text-slate-700">{patient?.insurance_provider ?? 'Self pay'}</p>
          </div>
        </div>
        <div className="overflow-x-auto p-8">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><th className="pb-2">Description</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Rate</th><th className="pb-2 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {inv.items.map((it, i) => (
                <tr key={i}><td className="py-3 text-slate-800">{it.description}</td><td className="py-3 text-right tabular-nums">{it.quantity}</td><td className="py-3 text-right tabular-nums">{money(it.unit_price)}</td><td className="py-3 text-right font-medium tabular-nums">{money(it.quantity * it.unit_price)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="ml-auto mt-6 w-full max-w-xs space-y-2 text-sm">
            <Row label="Subtotal" value={money(inv.subtotal)} />
            {inv.discount > 0 && <Row label="Discount" value={`− ${money(inv.discount)}`} />}
            <Row label="Tax (GST)" value={money(inv.tax)} />
            <div className="border-t border-slate-200 pt-2"><Row label={<b>Total</b>} value={<b className="text-base">{money(inv.total)}</b>} /></div>
            <Row label="Paid" value={<span className="text-emerald-700">{money(inv.amount_paid)}</span>} />
            <div className="rounded-lg bg-slate-50 px-3 py-2"><Row label={<b>Balance due</b>} value={<b className={balance > 0 ? 'text-rose-600' : 'text-emerald-700'}>{money(balance)}</b>} /></div>
          </div>
          {inv.notes && <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{inv.notes}</p>}
        </div>
        <div className="border-t border-slate-100 bg-slate-50/60 p-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Payment history</p>
          {history.length === 0 ? <p className="text-sm text-slate-500">No payments recorded yet.</p> : (
            <ul className="space-y-2">
              {history.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-lg bg-white px-4 py-2.5 text-sm ring-1 ring-slate-200">
                  <span className="flex items-center gap-3"><CreditCard className="h-4 w-4 text-slate-400" />{fmtDate(p.paid_on)} <Badge tone="blue">{p.method === 'upi' ? 'UPI' : titleCase(p.method)}</Badge><span className="hidden font-mono text-xs text-slate-400 sm:inline">{p.reference}</span></span>
                  <b className="text-emerald-700">{money(p.amount)}</b>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-center text-[11px] text-slate-400">This is a computer generated invoice. Thank you for choosing {HOSPITAL.name}.</p>
        </div>
      </Card>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" footer={<><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={submitPayment}>Save payment</Button></>}>
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between"><span className="text-slate-500">Invoice</span><b>{inv.invoice_number}</b></div><div className="flex justify-between"><span className="text-slate-500">Balance due</span><b className="text-rose-600">{money(balance)}</b></div></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required error={err}><Input type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Method"><Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as Payment['method'] })}>{['upi', 'cash', 'card', 'insurance', 'bank_transfer'].map((m) => <option key={m} value={m}>{m === 'upi' ? 'UPI' : titleCase(m)}</option>)}</Select></Field>
            <Field label="Date"><Input type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></Field>
            <Field label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Txn ID" /></Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}
function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className="tabular-nums text-slate-800">{value}</span></div>
}

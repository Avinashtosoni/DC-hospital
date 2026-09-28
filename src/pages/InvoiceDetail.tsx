import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Ban, Printer, Receipt, Wallet } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { useCreate, useLookup, useTable, useUpdate } from '../hooks/useData'
import { Button, EmptyState, Field, Input, Modal, Select, Skeleton } from '../components/ui'
import { InvoiceDocument, printInvoice } from '../components/InvoiceDocument'
import { RecordHistory } from '../components/RecordHistory'
import { Forbidden } from '../components/layout/Guards'
import { money, titleCase, today } from '../lib/utils'
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
  const dLk = useLookup('doctors')
  const appts = useTable('appointments')
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
  const ref = /DCB-[A-F0-9]+/i.exec(inv.notes ?? '')?.[0]
  const appt = ref ? appts.data?.find((a) => a.booking_ref === ref) : undefined
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
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={printInvoice}>Print / PDF</Button>
          {canPay && balance > 0 && !['cancelled', 'draft'].includes(inv.status) && <Button icon={<Wallet className="h-4 w-4" />} onClick={() => { setForm((f) => ({ ...f, amount: String(balance) })); setPayOpen(true) }}>Record payment</Button>}
        </div>
      </div>

      <InvoiceDocument invoice={inv} patient={patient} payments={[...history].reverse()} appointment={appt ? {
        ref: appt.booking_ref, doctor: dLk.get(appt.doctor_id)?.full_name ?? 'Doctor', specialization: dLk.get(appt.doctor_id)?.specialization,
        date: appt.appointment_date, time: appt.appointment_time,
      } : null} />
      {history.length === 0 && <p className="no-print mt-3 text-center text-xs text-slate-400">No payments recorded yet.</p>}
      {role === 'owner' && <div className="no-print mt-6"><RecordHistory table="invoices" ids={[inv.id, ...history.map((p) => p.id)]} title="Invoice history" /></div>}

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

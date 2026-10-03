import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Receipt } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, Select, Skeleton } from '../../../src/components/ui'
import { downloadCsv } from '../../../src/lib/utils'
import { cp } from '../api'
import { ErrorBox, paise, planLabel } from '../ui'
import { PaymentsTable } from './HospitalPage'
import { CreditNotesSection } from './hospital/BillingExtras'

export function PaymentsPage() {
  const [hospital, setHospital] = useState('')
  const [kind, setKind] = useState('')
  const q = useQuery({ queryKey: ['cp-payments'], queryFn: () => cp.payments() })
  const hospitals = useMemo(() => [...new Map((q.data ?? []).map((p) => [p.tenant_id, p.hospital])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [q.data])
  const rows = (q.data ?? []).filter((p) => (!hospital || p.tenant_id === hospital) && (!kind || p.kind === kind))
  const paid = rows.filter((p) => p.status === 'paid')
  const sum = (f: (p: (typeof rows)[number]) => number) => paid.reduce((a, p) => a + f(p), 0)

  const exportCsv = () => downloadCsv('hospital-comrade-payments.csv', rows.map((p) => ({
    date: p.paid_at ?? p.created_at, hospital: p.hospital, invoice: p.invoice_no ?? '', for: p.kind === 'plan' ? `${planLabel(p.plan)} ${p.months} mo` : 'Wallet top-up',
    base: p.base_paise / 100, gst: p.gst_paise / 100, total: p.total_paise / 100, via: p.provider, method: p.method ?? '', status: p.status,
  })))

  return (
    <>
      <PageHeader title="Payments" description="Plan payments and wallet top-ups from every hospital you can see."
        actions={<Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Received (with GST)</p><p className="mt-1 font-display text-xl font-bold text-brand-950">{paise(sum((p) => p.total_paise))}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Before GST</p><p className="mt-1 font-display text-xl font-bold text-brand-950">{paise(sum((p) => p.base_paise))}</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-slate-500">GST collected</p><p className="mt-1 font-display text-xl font-bold text-brand-950">{paise(sum((p) => p.gst_paise))}</p></Card>
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select value={hospital} onChange={(e) => setHospital(e.target.value)} className="sm:w-64" aria-label="Hospital"><option value="">All hospitals</option>{hospitals.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-48" aria-label="Type"><option value="">Plans & top-ups</option><option value="plan">Plans</option><option value="wallet">Wallet top-ups</option></Select>
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <Card className="px-5 py-2">
        {q.isLoading ? <div className="space-y-2 py-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : !rows.length ? <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments yet" description="Online payments (Razorpay) and payments you record show up here." />
          : <PaymentsTable rows={rows} showHospital />}
      </Card>
      <div className="mt-6"><CreditNotesSection tenantId={hospital || undefined} showHospital={!hospital} /></div>
    </>
  )
}

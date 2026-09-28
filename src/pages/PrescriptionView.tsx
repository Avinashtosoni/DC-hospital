import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pill, Printer } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useLookup, useTable } from '../hooks/useData'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { Forbidden } from '../components/layout/Guards'
import { Logo } from '../components/layout/AppLayout'
import { age, fmtDate, titleCase } from '../lib/utils'
import { useSiteSettings } from '../site/cms/content'

export default function PrescriptionView() {
  const { id } = useParams()
  const { user } = useAuth()
  const site = useSiteSettings()
  const nav = useNavigate()
  const rx = useTable('prescriptions')
  const pLk = useLookup('patients')
  const dLk = useLookup('doctors')
  const deptLk = useLookup('departments')
  const r = rx.data?.find((x) => x.id === id)
  if (rx.isLoading) return <div className="mx-auto max-w-3xl"><Skeleton className="h-[600px]" /></div>
  if (!r) return <EmptyState className="py-24" icon={<Pill className="h-6 w-6" />} title="Prescription not found" action={<Link to="/prescriptions"><Button variant="outline">Back</Button></Link>} />
  const p = pLk.get(r.patient_id)
  const d = dLk.get(r.doctor_id)
  if (user!.role === 'patient' && p?.profile_id !== user!.id) return <Forbidden />
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={() => nav(-1)} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Back</button>
        <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
      </div>
      <Card className="print-area overflow-hidden">
        <div className="flex flex-col justify-between gap-4 border-b-4 border-brand-600 p-8 sm:flex-row">
          <div><Logo /><p className="mt-2 text-xs text-slate-500">{site.address} · {site.phone}</p></div>
          <div className="sm:text-right">
            <p className="text-lg font-semibold text-slate-900">{d?.full_name}</p>
            <p className="text-sm text-slate-500">{d?.qualification}</p>
            <p className="text-xs text-slate-500">{d?.specialization} · {deptLk.get(d?.department_id ?? '')?.name}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b border-slate-100 bg-slate-50/60 px-8 py-4 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-slate-500">Patient</div><div className="font-medium">{p?.full_name}</div></div>
          <div><div className="text-xs text-slate-500">MRN</div><div className="font-mono text-xs font-medium">{p?.mrn}</div></div>
          <div><div className="text-xs text-slate-500">Age / Sex</div><div className="font-medium">{age(p?.date_of_birth) ?? '—'} / {titleCase(p?.gender)}</div></div>
          <div><div className="text-xs text-slate-500">Date</div><div className="font-medium">{fmtDate(r.prescribed_on)}</div></div>
        </div>
        <div className="space-y-6 p-8">
          {r.symptoms && <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Complaints</p><p className="mt-1 text-sm text-slate-700">{r.symptoms}</p></div>}
          <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Diagnosis</p><p className="mt-1 text-base font-semibold text-slate-900">{r.diagnosis}</p></div>
          {p?.allergies && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">⚠ Allergies: {p.allergies}</p>}
          <div>
            <p className="font-serif text-4xl font-bold italic text-brand-700">℞</p>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><th className="pb-2">#</th><th className="pb-2">Medicine</th><th className="pb-2">Dosage</th><th className="pb-2">Frequency</th><th className="pb-2">Duration</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {r.medications.map((m, i) => <tr key={i}><td className="py-2.5 text-slate-400">{i + 1}</td><td className="py-2.5 font-medium text-slate-900">{m.name}</td><td className="py-2.5">{m.dosage}</td><td className="py-2.5">{m.frequency}</td><td className="py-2.5">{m.duration}</td></tr>)}
              </tbody>
            </table>
          </div>
          {r.advice && <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Advice</p><p className="mt-1 text-sm text-slate-700">{r.advice}</p></div>}
          {r.follow_up_date && <p className="text-sm"><span className="text-slate-500">Follow-up on:</span> <b>{fmtDate(r.follow_up_date, 'EEEE, dd MMM yyyy')}</b></p>}
          <div className="flex justify-end pt-10"><div className="text-center"><div className="w-48 border-t border-slate-300 pt-1 text-xs text-slate-500">{d?.full_name}<br />Signature</div></div></div>
        </div>
      </Card>
    </div>
  )
}

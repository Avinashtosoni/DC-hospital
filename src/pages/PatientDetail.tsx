import { useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarPlus, Droplet, FlaskConical, Mail, MapPin, Pencil, Phone, Pill, Receipt, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { useLookup, useRow, useUpdate, useWindow } from '../hooks/useData'
import { useMe } from '../hooks/useScope'
import { RecordHistory } from '../components/RecordHistory'
import { useResourceCtx } from '../resources/useResourceCtx'
import { patientsRes } from '../resources/definitions'
import { ResourceFormDrawer } from '../components/ResourceForm'
import { Avatar, Badge, Button, Card, EmptyState, Skeleton, StatusBadge, Tabs } from '../components/ui'
import { Forbidden } from '../components/layout/Guards'
import { age, fmtDate, fmtTime, money, titleCase } from '../lib/utils'
import { invoiceBalance } from '../lib/billing'
import type { Patient } from '../types'

type Tab = 'overview' | 'appointments' | 'prescriptions' | 'labs' | 'admissions' | 'invoices' | 'history'

export function MyRecord() {
  const me = useMe()
  if (me.loading) return <DetailSkeleton />
  if (!me.patient) return <EmptyState className="py-24" title="No patient record linked" description="Your account is not linked to a patient record yet. Please contact the front desk." />
  return <Navigate to={`/patients/${me.patient.id}`} replace />
}

export default function PatientDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  // one patient's chart: the record by id and their history by patient_id (indexed) — no whole-table reads
  const patient = useRow('patients', id)
  const mine = { where: [['patient_id', 'eq', id ?? '']] as const }
  const appts = useWindow('appointments', mine, { enabled: !!id })
  const rx = useWindow('prescriptions', mine, { enabled: !!id })
  const labs = useWindow('lab_tests', mine, { enabled: !!id })
  const adm = useWindow('admissions', mine, { enabled: !!id })
  const inv = useWindow('invoices', mine, { enabled: !!id })
  const dLk = useLookup('doctors')
  const bLk = useLookup('beds')
  const wLk = useLookup('wards')
  const upd = useUpdate('patients', { label: 'Patient' })
  const { ctx } = useResourceCtx([])
  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)

  const p = patient.data ?? undefined
  const role = user!.role
  const data = useMemo(() => ({
    appts: (appts.data ?? []).filter((a) => a.patient_id === id).sort((a, b) => (b.appointment_date + b.appointment_time).localeCompare(a.appointment_date + a.appointment_time)),
    rx: (rx.data ?? []).filter((r) => r.patient_id === id).sort((a, b) => b.prescribed_on.localeCompare(a.prescribed_on)),
    labs: (labs.data ?? []).filter((l) => l.patient_id === id).sort((a, b) => b.requested_on.localeCompare(a.requested_on)),
    adm: (adm.data ?? []).filter((a) => a.patient_id === id).sort((a, b) => b.admission_date.localeCompare(a.admission_date)),
    inv: (inv.data ?? []).filter((i) => i.patient_id === id).sort((a, b) => b.issue_date.localeCompare(a.issue_date)),
  }), [appts.data, rx.data, labs.data, adm.data, inv.data, id])

  if (patient.isLoading) return <DetailSkeleton />
  if (!p) return <EmptyState className="py-24" icon={<UserRound className="h-6 w-6" />} title="Patient not found" description="The record may have been removed." action={<Link to="/patients"><Button variant="outline">Back to patients</Button></Link>} />
  if (role === 'patient' && p.profile_id !== user!.id) return <Forbidden />

  const tabs: { value: Tab; label: string; count?: number; show: boolean }[] = [
    { value: 'overview', label: 'Overview', show: true },
    { value: 'appointments', label: 'Appointments', count: data.appts.length, show: can(role, 'appointments', 'read') },
    { value: 'prescriptions', label: 'Prescriptions', count: data.rx.length, show: can(role, 'prescriptions', 'read') },
    { value: 'labs', label: 'Lab reports', count: data.labs.length, show: can(role, 'lab_tests', 'read') },
    { value: 'admissions', label: 'Admissions', count: data.adm.length, show: can(role, 'admissions', 'read') },
    { value: 'invoices', label: 'Billing', count: data.inv.length, show: can(role, 'invoices', 'read') },
    { value: 'history', label: 'Change history', show: role === 'owner' },
  ]
  const outstanding = data.inv.filter((i) => !['cancelled', 'draft'].includes(i.status)).reduce((s, i) => s + invoiceBalance(i), 0)
  const lastVisit = data.appts.find((a) => a.status === 'completed')

  return (
    <div>
      {role !== 'patient' && <button onClick={() => nav(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Back</button>}
      <Card className="overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-brand-600 via-brand-500 to-sky-500" />
        <div className="px-6 pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-4">
              <Avatar name={p.full_name} size="xl" className="-mt-10 h-20 w-20 text-xl ring-4 ring-white" />
              <div className="pt-3">
                <h1 className="text-xl font-semibold text-slate-900">{p.full_name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span className="font-mono text-xs">{p.mrn}</span>·<span>{titleCase(p.gender)}</span>{age(p.date_of_birth) !== null && <>·<span>{age(p.date_of_birth)} yrs</span></>}
                  <StatusBadge value={p.status} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {can(role, 'patients', 'update') && role !== 'patient' && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>Edit</Button>}
              {role === 'doctor' && <Link to={`/prescriptions?new=1&patient_id=${p.id}`}><Button variant="outline" icon={<Pill className="h-4 w-4" />}>Prescribe</Button></Link>}
              {can(role, 'invoices', 'create') && <Link to={`/invoices?new=1&patient_id=${p.id}`}><Button variant="outline" icon={<Receipt className="h-4 w-4" />}>Bill</Button></Link>}
              {can(role, 'appointments', 'create') && <Link to={`/appointments?new=1${role === 'patient' ? '' : `&patient_id=${p.id}`}`}><Button icon={<CalendarPlus className="h-4 w-4" />}>Book appointment</Button></Link>}
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact icon={<Droplet className="h-4 w-4 text-rose-500" />} label="Blood group" value={p.blood_group ?? '—'} />
            <Fact icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Allergies" value={p.allergies ?? 'None known'} />
            <Fact icon={<ShieldCheck className="h-4 w-4 text-brand-600" />} label="Insurance" value={p.insurance_provider ?? 'Self pay'} />
            <Fact icon={<Receipt className="h-4 w-4 text-violet-500" />} label="Outstanding" value={can(role, 'invoices', 'read') ? money(outstanding) : '—'} />
          </div>
        </div>
      </Card>

      <div className="mt-6"><Tabs tabs={tabs.filter((t) => t.show)} value={tab} onChange={setTab} /></div>
      <div className="mt-4">
        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-slate-900">Contact & personal details</h3>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <Info icon={<Phone className="h-4 w-4" />} label="Phone" value={p.phone} />
                <Info icon={<Mail className="h-4 w-4" />} label="Email" value={p.email} />
                <Info icon={<MapPin className="h-4 w-4" />} label="Address" value={p.address} />
                <Info icon={<UserRound className="h-4 w-4" />} label="Date of birth" value={fmtDate(p.date_of_birth)} />
                <Info icon={<UserRound className="h-4 w-4" />} label="Emergency contact" value={p.emergency_contact_name ? `${p.emergency_contact_name} · ${p.emergency_contact_phone ?? ''}` : null} />
                <Info icon={<UserRound className="h-4 w-4" />} label="Registered" value={fmtDate(p.created_at)} />
              </dl>
            </Card>
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-900">Clinical summary</h3>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex justify-between"><span className="text-slate-500">Total visits</span><b>{data.appts.filter((a) => a.status === 'completed').length}</b></li>
                <li className="flex justify-between"><span className="text-slate-500">Last visit</span><b>{lastVisit ? fmtDate(lastVisit.appointment_date) : '—'}</b></li>
                <li className="flex justify-between"><span className="text-slate-500">Latest diagnosis</span><b className="max-w-[60%] truncate text-right">{data.rx[0]?.diagnosis ?? '—'}</b></li>
                <li className="flex justify-between"><span className="text-slate-500">Lab tests</span><b>{data.labs.length}</b></li>
                <li className="flex justify-between"><span className="text-slate-500">Admissions</span><b>{data.adm.length}</b></li>
              </ul>
              {role !== 'patient' && can(role, 'patients', 'update') && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <label className="label">Quick status update</label>
                  <div className="flex gap-1.5">
                    {(['outpatient', 'inpatient', 'discharged'] as Patient['status'][]).map((s) => (
                      <button key={s} onClick={() => upd.mutate({ id: p.id, patch: { status: s } })}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition ${p.status === s ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
        {tab === 'appointments' && (
          <SubTable empty="No appointments" headers={['Date', 'Doctor', 'Reason', 'Type', 'Status']} rows={data.appts.map((a) => [
            <div key="d"><div className="font-medium">{fmtDate(a.appointment_date)}</div><div className="text-xs text-slate-500">{fmtTime(a.appointment_time)}</div></div>,
            dLk.get(a.doctor_id)?.full_name, a.reason, <StatusBadge key="t" value={a.type} />, <StatusBadge key="s" value={a.status} />])} />
        )}
        {tab === 'prescriptions' && (
          <div className="grid gap-4 md:grid-cols-2">
            {data.rx.length === 0 && <Card className="md:col-span-2"><EmptyState icon={<Pill className="h-6 w-6" />} title="No prescriptions" /></Card>}
            {data.rx.map((r) => (
              <Link key={r.id} to={`/prescriptions/${r.id}`}>
                <Card className="h-full p-5 transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{r.diagnosis}</div><div className="text-xs text-slate-500">{dLk.get(r.doctor_id)?.full_name} · {fmtDate(r.prescribed_on)}</div></div>{r.follow_up_date && <Badge tone="blue">Follow-up {fmtDate(r.follow_up_date, 'dd MMM')}</Badge>}</div>
                  <ul className="mt-3 space-y-1.5">{r.medications.map((m, i) => <li key={i} className="flex items-center gap-2 text-sm"><Pill className="h-3.5 w-3.5 text-brand-500" /><span className="font-medium text-slate-700">{m.name}</span><span className="text-xs text-slate-500">· {m.frequency} · {m.duration}</span></li>)}</ul>
                </Card>
              </Link>
            ))}
          </div>
        )}
        {tab === 'labs' && (
          <SubTable empty="No lab tests" icon={<FlaskConical className="h-6 w-6" />} headers={['Test', 'Requested', 'Priority', 'Status', 'Result']} rows={data.labs.map((l) => [
            <div key="t"><div className="font-medium">{l.test_name}</div><div className="text-xs text-slate-500">{l.category}</div></div>, fmtDate(l.requested_on), <StatusBadge key="p" value={l.priority} />, <StatusBadge key="s" value={l.status} />, <span key="r" className="text-xs text-slate-600">{l.result ?? '—'}</span>])} />
        )}
        {tab === 'admissions' && (
          <SubTable empty="No admissions" headers={['Admitted', 'Discharged', 'Bed', 'Doctor', 'Reason', 'Status']} rows={data.adm.map((a) => {
            const b = bLk.get(a.bed_id ?? '')
            return [fmtDate(a.admission_date), fmtDate(a.discharge_date), b ? `${b.bed_number} · ${wLk.get(b.ward_id)?.name ?? ''}` : '—', dLk.get(a.doctor_id ?? '')?.full_name, a.reason, <StatusBadge key="s" value={a.status} />]
          })} />
        )}
        {tab === 'invoices' && (
          <SubTable empty="No invoices" headers={['Invoice', 'Issued', 'Total', 'Balance', 'Status']} rows={data.inv.map((i) => [
            <Link key="n" to={`/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">{i.invoice_number}</Link>, fmtDate(i.issue_date), money(i.total),
            <span key="b" className={invoiceBalance(i) > 0 ? 'font-medium text-rose-600' : 'text-slate-400'}>{money(invoiceBalance(i))}</span>, <StatusBadge key="s" value={i.status} />])} />
        )}
      </div>

        {tab === 'history' && (
          <div className="mt-4"><RecordHistory table="patients" title="Everything that changed for this patient"
            ids={[p.id, ...data.appts.map((x) => x.id), ...data.rx.map((x) => x.id), ...data.labs.map((x) => x.id), ...data.adm.map((x) => x.id), ...data.inv.map((x) => x.id)]} /></div>
        )}
      {ctx && (
        <ResourceFormDrawer def={patientsRes} ctx={ctx} open={editOpen} onClose={() => setEditOpen(false)} initial={p} rows={[p]}
          onSubmit={(v) => { setEditOpen(false); upd.mutate({ id: p.id, patch: v }) }} />
      )}
    </div>
  )
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}
function Info({ icon, label, value }: { icon: ReactNode; label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">{icon}</div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="text-sm font-medium text-slate-800">{value || '—'}</dd></div>
    </div>
  )
}
function SubTable({ headers, rows, empty, icon }: { headers: string[]; rows: ReactNode[][]; empty: string; icon?: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      {rows.length === 0 ? <EmptyState icon={icon} title={empty} /> : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i} className="hover:bg-slate-50/70">{r.map((c, j) => <td key={j} className="px-4 py-3 text-slate-700">{c ?? '—'}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden"><Skeleton className="h-24 rounded-none" /><div className="flex gap-4 p-6"><Skeleton className="-mt-12 h-20 w-20 rounded-full" /><div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-3 w-32" /></div></div></Card>
      <div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-56 lg:col-span-2" /><Skeleton className="h-56" /></div>
    </div>
  )
}

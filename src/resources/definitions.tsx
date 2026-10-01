import {
  BedDouble, Building2, CalendarCheck, CalendarDays, CheckCircle2, ClipboardList, CreditCard, Eye, FileText, FlaskConical,
  CalendarOff, CalendarX2, PartyPopper, ThumbsDown, ThumbsUp, UserX, CalendarClock, Star, FileDown,
  LogOut, Megaphone, Package, PackagePlus, Pill, Printer, Receipt, Stethoscope, UserCheck, UserCog, Users, Wallet, XCircle, Ban, PlayCircle, TestTube,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { downloadInvoice, downloadLabReport } from '../lib/pdf'
import { toast } from 'sonner'
import type { Admission, Appointment, Department, Doctor, DoctorLeave, Expense, InventoryItem, Invoice, LabTest, Notice, Patient, Payment, Prescription, Profile, Staff } from '../types'
import { ROLE_LABEL } from '../types'
import { Avatar, Badge, StatusBadge } from '../components/ui'
import { age, fmtDate, fmtTime, money, today, titleCase } from '../lib/utils'
import { deriveInvoiceStatus, invoiceBalance } from '../lib/billing'
import { defineResource, type Option, type RelationSpec, type ResourceCtx } from './types'
import type { Filter } from '../data/query'
import { db } from '../data/adapter'
import { LEAVE_LABEL, conflictOf, isFullDay, type ScheduleExt } from '../lib/schedule'

// ------------------------------------------------------------------ helpers
const opts = (...values: string[]): Option[] => values.map((v) => ({ value: v, label: titleCase(v) }))
const TIMES = Array.from({ length: 22 }, (_, i) => { const h = 8 + Math.floor(i / 2); const m = i % 2 ? '30' : '00'; return `${String(h).padStart(2, '0')}:${m}` })
const TIME_OPTS: Option[] = TIMES.map((t) => ({ value: t, label: fmtTime(t) }))
const isPatient = (c: ResourceCtx) => c.role === 'patient'
const pName = (c: ResourceCtx, id?: string | null) => (id && c.lk.patients.get(id)?.full_name) || '—'
const dName = (c: ResourceCtx, id?: string | null) => (id && c.lk.doctors.get(id)?.full_name) || '—'
const deptName = (c: ResourceCtx, id?: string | null) => (id && c.lk.departments.get(id)?.name) || '—'

export function Person({ name, sub, size = 'md' }: { name: string; sub?: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={size === 'sm' ? 'sm' : 'md'} />
      <div className="min-w-0">
        <div className="name truncate font-medium text-slate-900 transition">{name}</div>
        {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  )
}
const Muted = ({ children }: { children: ReactNode }) => <span className="text-slate-500">{children}</span>

const patientField = (label = 'Patient') => ({
  name: 'patient_id', label, type: 'relation' as const, required: true,
  relation: { table: 'patients' as const, label: (p: Patient) => `${p.full_name} · ${p.mrn}`, search: PATIENT_SEARCH },
  default: (c: ResourceCtx) => c.me.patient?.id,
  hidden: (c: ResourceCtx) => isPatient(c),
})
const doctorField = (required = true) => ({
  name: 'doctor_id', label: 'Doctor', type: 'relation' as const, required,
  relation: { table: 'doctors' as const, label: (d: Doctor, c: ResourceCtx) => `${d.full_name} · ${deptName(c, d.department_id)}`, filter: (d: Doctor) => d.status === 'active' },
  default: (c: ResourceCtx) => c.me.doctor?.id,
})
const ownPatient = (row: { patient_id: string }, c: ResourceCtx) => !isPatient(c) || row.patient_id === c.me.patient?.id
const NO_ID = '00000000-0000-0000-0000-000000000000'
/** server-side twin of ownPatient (RLS enforces the same rule in Supabase) */
const ownPatientQ = (c: ResourceCtx): Filter[] => (isPatient(c) ? [['patient_id', 'eq', c.me.patient?.id ?? NO_ID]] : [])
/** search box also matches the patient's name, MRN or phone */
const viaPatient = { column: 'patient_id', table: 'patients' as const, columns: ['full_name', 'mrn', 'phone'] }
const PATIENT_SEARCH = { columns: ['full_name', 'mrn', 'phone'], order: 'full_name' }

// ================================================================== PATIENTS
export const patientsRes = defineResource({
  table: 'patients', path: '/patients', title: 'Patients', singular: 'Patient', icon: Users,
  description: 'Registered patients, demographics and contact details.',
  defaultSort: { key: 'created_at', dir: 'desc' },
  server: {
    search: ['full_name', 'mrn', 'phone', 'email'],
    scope: (c) => (isPatient(c) ? [['profile_id', 'eq', c.user.id]] : []),
    sort: { full_name: 'full_name', gender: 'gender', blood_group: 'blood_group', phone: 'phone', insurance_provider: 'insurance_provider', status: 'status', created_at: 'created_at' },
    latestBy: 'mrn',
  },
  rowLink: (r) => `/patients/${r.id}`,
  scope: (r, c) => !isPatient(c) || r.profile_id === c.user.id,
  searchText: (r) => `${r.full_name} ${r.mrn} ${r.phone} ${r.email}`,
  filters: [
    { key: 'status', label: 'Status', options: opts('outpatient', 'inpatient', 'discharged') },
    { key: 'gender', label: 'Gender', options: opts('male', 'female', 'other') },
  ],
  columns: [
    { key: 'full_name', header: 'Patient', render: (r) => <Person name={r.full_name} sub={r.mrn} /> },
    { key: 'gender', header: 'Gender / Age', render: (r) => <Muted>{titleCase(r.gender)}{age(r.date_of_birth) !== null && ` · ${age(r.date_of_birth)} yrs`}</Muted>, hideBelow: 'sm' },
    { key: 'blood_group', header: 'Blood', render: (r) => r.blood_group ? <Badge tone="red">{r.blood_group}</Badge> : <Muted>—</Muted>, hideBelow: 'md' },
    { key: 'phone', header: 'Phone', render: (r) => <Muted>{r.phone ?? '—'}</Muted>, hideBelow: 'lg' },
    { key: 'insurance_provider', header: 'Insurance', render: (r) => <Muted>{r.insurance_provider ?? 'Self pay'}</Muted>, hideBelow: 'xl' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'created_at', header: 'Registered', render: (r) => <Muted>{fmtDate(r.created_at)}</Muted>, hideBelow: 'lg' },
  ],
  rowActions: (r, c) => [
    { label: 'View profile', icon: Eye, onClick: () => c.navigate(`/patients/${r.id}`) },
    c.role !== 'patient' && c.role !== 'accountant' && { label: 'Book appointment', icon: CalendarDays, onClick: () => c.navigate(`/appointments?new=1&patient_id=${r.id}`) },
  ],
  fields: [
    { name: 'mrn', label: 'MRN', type: 'text', required: true, readOnly: () => true, hint: 'Auto-generated medical record number',
      default: (_c, rows: Patient[]) => `DCH-${Math.max(100000, ...rows.map((p) => Number(p.mrn?.replace(/\D/g, '')) || 0)) + 1}` },
    { name: 'full_name', label: 'Full name', type: 'text', required: true, placeholder: 'e.g. Anita Sharma' },
    { name: 'gender', label: 'Gender', type: 'select', required: true, options: opts('male', 'female', 'other') },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
    { name: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((b) => ({ value: b, label: b })) },
    { name: 'phone', label: 'Phone', type: 'tel', required: true, placeholder: '+91 98xxx xxxxx' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'insurance_provider', label: 'Insurance provider', type: 'text', placeholder: 'Self pay' },
    { name: 'address', label: 'Address', type: 'text', span: 2 },
    { name: 'emergency_contact_name', label: 'Emergency contact', type: 'text' },
    { name: 'emergency_contact_phone', label: 'Emergency phone', type: 'tel' },
    { name: 'allergies', label: 'Known allergies', type: 'text', span: 2, placeholder: 'e.g. Penicillin' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('outpatient', 'inpatient', 'discharged'), default: () => 'outpatient' },
  ],
})

// ================================================================== APPOINTMENTS
const INACTIVE_APPT = ['cancelled', 'no_show']
const setApptStatus = (status: Appointment['status']) => (r: Appointment, c: ResourceCtx) => c.patch('appointments', r.id, { status })
export const appointmentsRes = defineResource({
  table: 'appointments', path: '/appointments', singular: 'Appointment', icon: CalendarCheck,
  title: (role) => (role === 'patient' || role === 'doctor' ? 'My Appointments' : 'Appointments'),
  description: (role) => role === 'patient' ? 'Book, track or cancel your visits.' : role === 'doctor' ? 'Your consultation schedule.' : 'Schedule and manage OPD appointments across departments.',
  relations: ['patients', 'doctors', 'departments', 'doctor_leaves', 'holidays'],
  defaultSort: { key: 'appointment_date', dir: 'desc' },
  scope: (r, c) => (isPatient(c) ? r.patient_id === c.me.patient?.id : c.role === 'doctor' ? r.doctor_id === c.me.doctor?.id : true),
  searchText: (r, c) => `${pName(c, r.patient_id)} ${dName(c, r.doctor_id)} ${r.reason} ${r.status}`,
  filters: [
    { key: 'when', label: 'When', options: [{ value: 'today', label: 'Today' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }],
      predicate: (r, v) => { const t = today(); return v === 'today' ? r.appointment_date === t : v === 'upcoming' ? r.appointment_date >= t : r.appointment_date < t } },
    { key: 'status', label: 'Status', options: opts('scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show') },
    { key: 'type', label: 'Type', options: opts('consultation', 'follow_up', 'checkup', 'emergency') },
  ],
  columns: [
    { key: 'doctor_p', header: 'Doctor', showFor: ['patient'], render: (r, c) => <Person name={dName(c, r.doctor_id)} sub={deptName(c, c.lk.doctors.get(r.doctor_id ?? '')?.department_id)} />, sortValue: (r, c) => dName(c, r.doctor_id) },
    { key: 'patient', header: 'Patient', hideFor: ['patient'], render: (r, c) => <Person name={pName(c, r.patient_id)} sub={c.lk.patients.get(r.patient_id)?.mrn} />, sortValue: (r, c) => pName(c, r.patient_id) },
    { key: 'doctor', header: 'Doctor', hideFor: ['patient'], render: (r, c) => <div><div className="font-medium text-slate-800">{dName(c, r.doctor_id)}</div><div className="text-xs text-slate-500">{deptName(c, c.lk.doctors.get(r.doctor_id)?.department_id)}</div></div>, sortValue: (r, c) => dName(c, r.doctor_id), hideBelow: 'md' },
    { key: 'appointment_date', header: 'Date & time', render: (r) => <div><div className="font-medium text-slate-800">{fmtDate(r.appointment_date, 'EEE, dd MMM')}</div><div className="text-xs text-slate-500">{fmtTime(r.appointment_time)}</div></div>, sortValue: (r) => r.appointment_date + r.appointment_time },
    { key: 'type', header: 'Type', render: (r) => <StatusBadge value={r.type} />, hideBelow: 'lg' },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-1 max-w-[220px] text-slate-600">{r.reason ?? '—'}</span>, hideBelow: 'xl' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  // patients move / cancel through the Reschedule dialog (the database only lets them change date, time and reason)
  canEdit: (_r, c) => !isPatient(c),
  rowActions: (r, c) => {
    const upcoming = r.appointment_date >= today()
    const open = !['completed', 'cancelled', 'no_show'].includes(r.status)
    if (isPatient(c)) {
      const movable = ['scheduled', 'confirmed'].includes(r.status) && upcoming
      const recent = r.status === 'completed' && r.appointment_date >= format(addDays(new Date(), -60), 'yyyy-MM-dd')
      return [
        movable && { label: 'Reschedule', icon: CalendarClock, onClick: () => c.navigate(`/appointments?reschedule=${r.id}`) },
        recent && { label: 'Rate this visit', icon: Star, onClick: () => c.navigate(`/appointments?rate=${r.id}`) },
        movable && { label: 'Cancel appointment', icon: XCircle, tone: 'danger', onClick: setApptStatus('cancelled') },
      ]
    }
    const staffish = c.role === 'owner' || c.role === 'receptionist' || c.role === 'doctor'
    return [
      staffish && r.status === 'scheduled' && { label: 'Confirm', icon: CheckCircle2, onClick: setApptStatus('confirmed') },
      staffish && ['scheduled', 'confirmed'].includes(r.status) && { label: 'Check in', icon: UserCheck, onClick: setApptStatus('checked_in') },
      staffish && open && { label: 'Mark completed', icon: CheckCircle2, onClick: setApptStatus('completed') },
      c.role === 'doctor' && { label: 'Write prescription', icon: Pill, onClick: () => c.navigate(`/prescriptions?new=1&patient_id=${r.patient_id}&doctor_id=${r.doctor_id}`) },
      c.role === 'doctor' && { label: 'Order lab test', icon: FlaskConical, onClick: () => c.navigate(`/lab-tests?new=1&patient_id=${r.patient_id}&doctor_id=${r.doctor_id}`) },
      { label: 'Patient profile', icon: Eye, onClick: () => c.navigate(`/patients/${r.patient_id}`) },
      staffish && open && { label: 'Mark no-show', icon: Ban, onClick: setApptStatus('no_show') },
      staffish && open && { label: 'Cancel', icon: XCircle, onClick: setApptStatus('cancelled') },
    ]
  },
  fields: [
    patientField(),
    { ...doctorField(), default: (c: ResourceCtx) => c.me.doctor?.id },
    { name: 'appointment_date', label: 'Date', type: 'date', required: true, default: () => today() },
    { name: 'appointment_time', label: 'Time slot', type: 'select', required: true, options: TIME_OPTS, default: () => '10:00' },
    { name: 'type', label: 'Visit type', type: 'select', required: true, options: opts('consultation', 'follow_up', 'checkup', 'emergency'), default: () => 'consultation' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'), default: () => 'scheduled', hidden: (c) => isPatient(c) },
    { name: 'reason', label: 'Reason for visit', type: 'textarea', placeholder: 'Briefly describe symptoms or purpose' },
    { name: 'notes', label: 'Internal notes', type: 'textarea', hidden: (c) => isPatient(c) },
  ],
  beforeSave: (v, c) => (isPatient(c) ? { ...v, patient_id: c.me.patient?.id, status: v.status ?? 'scheduled' } : v),
  validate: async (v, c, _rows, existing): Promise<Record<string, string>> => {
    if (INACTIVE_APPT.includes(v.status)) return {}
    // ask the database: the list on screen is only a page / window (the unique slot index is the final guard)
    const clash = v.doctor_id && v.appointment_date && v.appointment_time && (await db.query('appointments', { where: [
      ['doctor_id', 'eq', v.doctor_id], ['appointment_date', 'eq', v.appointment_date], ['status', 'nin', INACTIVE_APPT],
    ] })).rows.find((r) => r.id !== existing?.id && r.appointment_time.slice(0, 5) === String(v.appointment_time).slice(0, 5))
    if (clash) return { appointment_time: `This doctor is already booked at ${fmtTime(v.appointment_time)} — pick another slot` }
    // new booking or moved slot → must not fall on leave, blocked time or a hospital holiday
    const moved = !existing || existing.doctor_id !== v.doctor_id || existing.appointment_date !== v.appointment_date || existing.appointment_time !== v.appointment_time
    const why = moved && conflictOf({ ...(existing ?? {}), ...v, status: 'scheduled' } as Appointment, c.lk.doctors.get(v.doctor_id), scheduleExt(c))
    return why ? { appointment_date: `Unavailable: ${why}` } : {}
  },
})

// ================================================================== PRESCRIPTIONS
export const prescriptionsRes = defineResource({
  table: 'prescriptions', path: '/prescriptions', singular: 'Prescription', icon: Pill,
  title: (role) => (role === 'patient' ? 'My Prescriptions' : 'Prescriptions'),
  description: (role) => role === 'patient' ? 'Medicines and advice from your doctors.' : 'E-prescriptions issued after consultations.',
  relations: ['doctors', 'departments'],
  defaultSort: { key: 'prescribed_on', dir: 'desc' },
  server: {
    search: ['diagnosis', 'symptoms', 'advice'], searchVia: [viaPatient], scope: ownPatientQ,
    sort: { diagnosis: 'diagnosis', doctor: 'doctor_id', prescribed_on: 'prescribed_on', follow_up_date: 'follow_up_date' },
    resolve: { patient_id: 'patients' },
  },
  scope: ownPatient,
  searchText: (r, c) => `${pName(c, r.patient_id)} ${dName(c, r.doctor_id)} ${r.diagnosis} ${r.medications?.map((m) => m.name).join(' ')}`,
  columns: [
    { key: 'patient', header: 'Patient', hideFor: ['patient'], render: (r, c) => <Person name={pName(c, r.patient_id)} sub={c.lk.patients.get(r.patient_id)?.mrn} />, sortValue: (r, c) => pName(c, r.patient_id) },
    { key: 'diagnosis', header: 'Diagnosis', render: (r) => <span className="font-medium text-slate-800">{r.diagnosis}</span> },
    { key: 'medications', header: 'Medicines', render: (r) => <div className="max-w-[260px] truncate text-slate-600" title={r.medications?.map((m) => m.name).join(', ')}><Badge tone="teal" className="mr-1.5">{r.medications?.length ?? 0}</Badge>{r.medications?.map((m) => m.name).join(', ')}</div>, hideBelow: 'lg' },
    { key: 'doctor', header: 'Doctor', render: (r, c) => <Muted>{dName(c, r.doctor_id)}</Muted>, sortValue: (r, c) => dName(c, r.doctor_id), hideBelow: 'sm' },
    { key: 'prescribed_on', header: 'Date', render: (r) => <Muted>{fmtDate(r.prescribed_on)}</Muted> },
    { key: 'follow_up_date', header: 'Follow-up', render: (r) => r.follow_up_date ? <Badge tone={r.follow_up_date >= today() ? 'blue' : 'slate'}>{fmtDate(r.follow_up_date, 'dd MMM')}</Badge> : <Muted>—</Muted>, hideBelow: 'xl' },
  ],
  rowLink: (r) => `/prescriptions/${r.id}`,
  rowActions: (r, c) => [{ label: 'View & print', icon: Printer, onClick: () => c.navigate(`/prescriptions/${r.id}`) }],
  drawerWidth: 'max-w-3xl',
  fields: [
    patientField(),
    doctorField(),
    { name: 'prescribed_on', label: 'Date', type: 'date', required: true, default: () => today() },
    { name: 'follow_up_date', label: 'Follow-up date', type: 'date' },
    { name: 'diagnosis', label: 'Diagnosis', type: 'text', required: true, span: 2, placeholder: 'e.g. Viral fever' },
    { name: 'symptoms', label: 'Symptoms / complaints', type: 'text', span: 2 },
    { name: 'medications', label: 'Medicines', type: 'medications', required: true, default: () => [{ name: '', dosage: '1 tab', frequency: 'Twice daily', duration: '5 days' }] },
    { name: 'advice', label: 'Advice', type: 'textarea', placeholder: 'Diet, rest, precautions…' },
  ],
})

// ================================================================== LAB TESTS
const LAB_CATS = opts('Hematology', 'Biochemistry', 'Microbiology', 'Radiology', 'Diagnostics')
LAB_CATS.forEach((o) => (o.label = o.value))
export const labTestsRes = defineResource({
  table: 'lab_tests', path: '/lab-tests', singular: 'Lab test', icon: FlaskConical,
  title: (role) => (role === 'patient' ? 'My Lab Reports' : 'Laboratory'),
  description: (role) => role === 'patient' ? 'Your diagnostic tests and results.' : 'Track test orders from request to report.',
  relations: ['doctors', 'departments'],
  defaultSort: { key: 'requested_on', dir: 'desc' },
  server: {
    search: ['test_name', 'category', 'status', 'result'], searchVia: [viaPatient], scope: ownPatientQ,
    sort: { test_name: 'test_name', doctor: 'doctor_id', priority: 'priority', requested_on: 'requested_on', price: 'price', status: 'status', result: 'result' },
    resolve: { patient_id: 'patients' },
  },
  scope: ownPatient,
  searchText: (r, c) => `${r.test_name} ${pName(c, r.patient_id)} ${r.category} ${r.status}`,
  filters: [
    { key: 'status', label: 'Status', options: opts('requested', 'sample_collected', 'in_progress', 'completed', 'cancelled') },
    { key: 'priority', label: 'Priority', options: opts('routine', 'urgent', 'stat') },
  ],
  columns: [
    { key: 'test_name', header: 'Test', render: (r) => <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600"><TestTube className="h-4 w-4" /></div><div><div className="font-medium text-slate-900">{r.test_name}</div><div className="text-xs text-slate-500">{r.category}</div></div></div> },
    { key: 'patient', header: 'Patient', hideFor: ['patient'], render: (r, c) => <span className="text-slate-700">{pName(c, r.patient_id)}</span>, sortValue: (r, c) => pName(c, r.patient_id), hideBelow: 'sm' },
    { key: 'doctor', header: 'Ordered by', render: (r, c) => <Muted>{dName(c, r.doctor_id)}</Muted>, hideBelow: 'lg' },
    { key: 'priority', header: 'Priority', render: (r) => <StatusBadge value={r.priority} />, hideBelow: 'md' },
    { key: 'requested_on', header: 'Requested', render: (r) => <Muted>{fmtDate(r.requested_on, 'dd MMM')}</Muted>, hideBelow: 'md' },
    { key: 'price', header: 'Price', render: (r) => money(r.price), align: 'right', hideBelow: 'xl' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'result', header: 'Result', render: (r) => <span className="line-clamp-1 max-w-[240px] text-xs text-slate-600" title={r.result ?? ''}>{r.result ?? '—'}</span>, hideBelow: 'xl' },
  ],
  rowActions: (r, c) => {
    const download = r.status === 'completed' && { label: 'Download report (PDF)', icon: FileDown, onClick: () => downloadLabReport(r, { site: c.site, patient: c.lk.patients.get(r.patient_id) ?? (isPatient(c) ? c.me.patient : null), doctor: r.doctor_id ? dName(c, r.doctor_id) : null }) }
    if (isPatient(c) || c.role === 'accountant') return [download]
    return [
      download,
      r.status === 'requested' && { label: 'Sample collected', icon: TestTube, onClick: () => c.patch('lab_tests', r.id, { status: 'sample_collected' }) },
      ['requested', 'sample_collected'].includes(r.status) && { label: 'Start processing', icon: PlayCircle, onClick: () => c.patch('lab_tests', r.id, { status: 'in_progress' }) },
    ]
  },
  fields: [
    patientField(),
    doctorField(false),
    { name: 'test_name', label: 'Test name', type: 'text', required: true, placeholder: 'e.g. CBC' },
    { name: 'category', label: 'Category', type: 'select', required: true, options: LAB_CATS, default: () => 'Biochemistry' },
    { name: 'priority', label: 'Priority', type: 'select', required: true, options: opts('routine', 'urgent', 'stat'), default: () => 'routine' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('requested', 'sample_collected', 'in_progress', 'completed', 'cancelled'), default: () => 'requested' },
    { name: 'price', label: 'Price (₹)', type: 'currency', required: true, min: 0, default: () => 500 },
    { name: 'requested_on', label: 'Requested on', type: 'date', required: true, default: () => today() },
    { name: 'completed_on', label: 'Completed on', type: 'date', hidden: (_c, v) => v.status !== 'completed' },
    { name: 'result', label: 'Result / findings', type: 'textarea', hidden: (_c, v) => !['completed', 'in_progress'].includes(v.status) },
  ],
  beforeSave: (v) => (v.status === 'completed' && !v.completed_on ? { ...v, completed_on: today() } : v),
})

// ================================================================== ADMISSIONS
const bedLabel = (c: ResourceCtx, bedId?: string | null) => {
  const b = bedId ? c.lk.beds.get(bedId) : undefined
  if (!b) return '—'
  return `${b.bed_number} · ${c.lk.wards.get(b.ward_id)?.name ?? ''}`
}
export const admissionsRes = defineResource({
  table: 'admissions', path: '/admissions', singular: 'Admission', icon: ClipboardList,
  title: 'Admissions (IPD)', description: 'In-patient admissions, bed allocation and discharges.',
  relations: ['doctors', 'beds', 'wards', 'departments'],
  defaultSort: { key: 'admission_date', dir: 'desc' },
  server: {
    search: ['reason', 'notes'], searchVia: [viaPatient],
    sort: { admission_date: 'admission_date', los: 'admission_date', status: 'status', doctor: 'doctor_id', bed: 'bed_id' },
    resolve: { patient_id: 'patients' },
  },
  searchText: (r, c) => `${pName(c, r.patient_id)} ${dName(c, r.doctor_id)} ${r.reason} ${bedLabel(c, r.bed_id)}`,
  filters: [{ key: 'status', label: 'Status', options: opts('admitted', 'discharged') }],
  columns: [
    { key: 'patient', header: 'Patient', render: (r, c) => <Person name={pName(c, r.patient_id)} sub={r.reason} />, sortValue: (r, c) => pName(c, r.patient_id) },
    { key: 'bed', header: 'Bed / Ward', render: (r, c) => <div className="flex items-center gap-2 text-slate-700"><BedDouble className="h-4 w-4 text-slate-400" />{bedLabel(c, r.bed_id)}</div>, hideBelow: 'md' },
    { key: 'doctor', header: 'Attending', render: (r, c) => <Muted>{dName(c, r.doctor_id)}</Muted>, hideBelow: 'lg' },
    { key: 'admission_date', header: 'Admitted', render: (r) => <Muted>{fmtDate(r.admission_date)}</Muted> },
    { key: 'los', header: 'Stay', render: (r) => <Muted>{Math.max(1, differenceInCalendarDays(r.discharge_date ? parseISO(r.discharge_date) : new Date(), parseISO(r.admission_date)))} days</Muted>, sortValue: (r) => r.admission_date, hideBelow: 'sm' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  rowActions: (r, c) => [
    r.status === 'admitted' && c.role !== 'staff' && { label: 'Discharge patient', icon: LogOut, onClick: async () => {
      await c.patch('admissions', r.id, { status: 'discharged', discharge_date: today() })
      if (r.bed_id) await c.patch('beds', r.bed_id, { status: 'available' })
      await c.patch('patients', r.patient_id, { status: 'discharged' })
    } },
    { label: 'Patient profile', icon: Eye, onClick: () => c.navigate(`/patients/${r.patient_id}`) },
  ],
  fields: [
    { ...patientField(), relation: { table: 'patients', label: (p: Patient) => `${p.full_name} · ${p.mrn}`, filter: (p: Patient) => p.status !== 'inpatient',
      search: { ...PATIENT_SEARCH, where: (): Filter[] => [['status', 'neq', 'inpatient']] } } },
    doctorField(),
    { name: 'bed_id', label: 'Bed', type: 'relation', required: true,
      relation: { table: 'beds', label: (b, c) => `${b.bed_number} · ${c.lk.wards.get(b.ward_id)?.name ?? ''}`, filter: (b) => b.status === 'available' },
      hint: 'Only available beds are listed' },
    { name: 'admission_date', label: 'Admission date', type: 'date', required: true, default: () => today() },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('admitted', 'discharged'), default: () => 'admitted', hidden: (_c, _v, editing) => !editing },
    { name: 'discharge_date', label: 'Discharge date', type: 'date', hidden: (_c, v) => v.status !== 'discharged' },
    { name: 'reason', label: 'Reason for admission', type: 'text', required: true, span: 2 },
    { name: 'notes', label: 'Clinical notes', type: 'textarea' },
  ],
  beforeSave: (v) => (v.status === 'discharged' && !v.discharge_date ? { ...v, discharge_date: today() } : v.status === 'admitted' ? { ...v, discharge_date: null } : v),
  afterSave: async (s: Admission, c, prev?: Admission) => {
    if (prev?.bed_id && prev.bed_id !== s.bed_id) await c.patch('beds', prev.bed_id, { status: 'available' })
    if (s.bed_id) await c.patch('beds', s.bed_id, { status: s.status === 'admitted' ? 'occupied' : 'available' })
    await c.patch('patients', s.patient_id, { status: s.status === 'admitted' ? 'inpatient' : 'discharged' })
  },
  afterDelete: async (r: Admission, c) => {
    if (r.status === 'admitted' && r.bed_id) await c.patch('beds', r.bed_id, { status: 'available' })
    if (r.status === 'admitted') await c.patch('patients', r.patient_id, { status: 'outpatient' })
  },
})

// ================================================================== DOCTORS
export const doctorsRes = defineResource({
  table: 'doctors', path: '/doctors', title: 'Doctors', singular: 'Doctor', icon: Stethoscope,
  description: (role) => role === 'patient' ? 'Find a specialist and book a consultation.' : 'Medical staff, specialisations and OPD schedules.',
  relations: ['departments'],
  defaultSort: { key: 'full_name', dir: 'asc' },
  scope: (r, c) => !isPatient(c) || r.status === 'active',
  searchText: (r, c) => `${r.full_name} ${r.specialization} ${deptName(c, r.department_id)} ${r.qualification}`,
  filters: [
    { key: 'department_id', label: 'Department', options: (c) => [...c.lk.departments.values()].map((d) => ({ value: d.id, label: d.name })).sort((a, b) => a.label.localeCompare(b.label)) },
    { key: 'status', label: 'Status', options: opts('active', 'on_leave', 'inactive') },
  ],
  columns: [
    { key: 'full_name', header: 'Doctor', render: (r) => <Person name={r.full_name} sub={r.qualification} /> },
    { key: 'department', header: 'Department', render: (r, c) => <span className="text-slate-700">{deptName(c, r.department_id)}</span>, sortValue: (r, c) => deptName(c, r.department_id), hideBelow: 'sm' },
    { key: 'specialization', header: 'Specialization', render: (r) => <Muted>{r.specialization}</Muted>, hideBelow: 'lg' },
    { key: 'experience_years', header: 'Exp.', render: (r) => <Muted>{r.experience_years ?? 0} yrs</Muted>, hideBelow: 'md' },
    { key: 'available_days', header: 'OPD days', render: (r) => <div className="flex gap-0.5">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className={`grid h-5 w-5 place-items-center rounded text-[9px] font-semibold ${r.available_days?.includes(d) ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-300'}`}>{d[0]}</span>)}</div>, hideBelow: 'xl' },
    { key: 'consultation_fee', header: 'Fee', render: (r) => money(r.consultation_fee), align: 'right', hideBelow: 'md' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  rowActions: (r, c) => [
    (isPatient(c) || c.role === 'receptionist' || c.role === 'owner') && r.status === 'active' && { label: 'Book appointment', icon: CalendarDays, onClick: () => c.navigate(`/appointments?new=1&doctor_id=${r.id}`) },
    (c.role === 'receptionist' || c.role === 'owner') && { label: 'Add leave / block time', icon: CalendarOff, onClick: () => c.navigate(`/schedule?new=1&doctor_id=${r.id}`) },
    (c.role === 'receptionist' || c.role === 'owner') && r.status !== 'active' && { label: 'Set status: Active', icon: UserCheck, onClick: () => c.patch('doctors', r.id, { status: 'active' }) },
    (c.role === 'receptionist' || c.role === 'owner') && r.status !== 'on_leave' && { label: 'Set status: On leave (indefinite)', icon: CalendarX2, onClick: async () => { await c.patch('doctors', r.id, { status: 'on_leave' }); flagAffected(c, (a) => a.doctor_id === r.id, `${r.full_name} is now on leave`) } },
    c.role === 'owner' && r.status !== 'inactive' && { label: 'Set status: Inactive', icon: UserX, tone: 'danger' as const, onClick: async () => { await c.patch('doctors', r.id, { status: 'inactive' }); flagAffected(c, (a) => a.doctor_id === r.id, `${r.full_name} marked inactive`) } },
  ],
  fields: [
    { name: 'full_name', label: 'Full name', type: 'text', required: true, placeholder: 'Dr. …' },
    { name: 'department_id', label: 'Department', type: 'relation', required: true, relation: { table: 'departments', label: (d) => d.name } },
    { name: 'specialization', label: 'Specialization', type: 'text', required: true },
    { name: 'qualification', label: 'Qualification', type: 'text', placeholder: 'MBBS, MD' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'experience_years', label: 'Experience (years)', type: 'number', min: 0 },
    { name: 'consultation_fee', label: 'Consultation fee (₹)', type: 'currency', required: true, min: 0, default: () => 700 },
    { name: 'shift', label: 'OPD timings', type: 'text', placeholder: '10:00 – 17:00' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('active', 'on_leave', 'inactive'), default: () => 'active' },
    { name: 'available_days', label: 'OPD days', type: 'days', default: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
    { name: 'bio', label: 'Short bio', type: 'textarea' },
  ],
})

// ================================================================== STAFF
export const staffRes = defineResource({
  table: 'staff', path: '/staff', title: 'Staff', singular: 'Staff member', icon: UserCog,
  description: 'Nurses, technicians, front office and support staff.',
  relations: ['departments'],
  defaultSort: { key: 'full_name', dir: 'asc' },
  searchText: (r, c) => `${r.full_name} ${r.designation} ${deptName(c, r.department_id)} ${r.email}`,
  filters: [
    { key: 'shift', label: 'Shift', options: opts('morning', 'evening', 'night') },
    { key: 'status', label: 'Status', options: opts('active', 'on_leave', 'inactive') },
  ],
  columns: [
    { key: 'full_name', header: 'Name', render: (r) => <Person name={r.full_name} sub={r.email} /> },
    { key: 'designation', header: 'Designation', render: (r) => <span className="text-slate-700">{r.designation}</span>, hideBelow: 'sm' },
    { key: 'department', header: 'Department', render: (r, c) => <Muted>{r.department_id ? deptName(c, r.department_id) : 'Administration'}</Muted>, hideBelow: 'lg' },
    { key: 'shift', header: 'Shift', render: (r) => <Badge tone={r.shift === 'night' ? 'violet' : r.shift === 'evening' ? 'amber' : 'blue'}>{titleCase(r.shift)}</Badge>, hideBelow: 'md' },
    { key: 'salary', header: 'Salary / mo', render: (r) => money(r.salary), align: 'right', hideBelow: 'md' },
    { key: 'join_date', header: 'Joined', render: (r) => <Muted>{fmtDate(r.join_date, 'MMM yyyy')}</Muted>, hideBelow: 'xl' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  fields: [
    { name: 'full_name', label: 'Full name', type: 'text', required: true },
    { name: 'designation', label: 'Designation', type: 'text', required: true, placeholder: 'e.g. Staff Nurse' },
    { name: 'department_id', label: 'Department', type: 'relation', relation: { table: 'departments', label: (d) => d.name }, hint: 'Leave empty for administration' },
    { name: 'shift', label: 'Shift', type: 'select', required: true, options: opts('morning', 'evening', 'night'), default: () => 'morning' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'salary', label: 'Monthly salary (₹)', type: 'currency', required: true, min: 0 },
    { name: 'join_date', label: 'Joining date', type: 'date', default: () => today() },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('active', 'on_leave', 'inactive'), default: () => 'active' },
  ],
})

// ================================================================== DEPARTMENTS
export const departmentsRes = defineResource({
  table: 'departments', path: '/departments', title: 'Departments', singular: 'Department', icon: Building2,
  description: 'Clinical and diagnostic departments of the hospital.',
  relations: ['doctors', 'staff'],
  defaultSort: { key: 'name', dir: 'asc' },
  searchText: (r) => `${r.name} ${r.description} ${r.location}`,
  columns: [
    { key: 'name', header: 'Department', render: (r) => <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600"><Building2 className="h-4 w-4" /></div><div className="min-w-0"><div className="font-medium text-slate-900">{r.name}</div><div className="max-w-xs truncate text-xs text-slate-500">{r.description}</div></div></div> },
    { key: 'location', header: 'Location', render: (r) => <Muted>{r.location ?? '—'}</Muted>, hideBelow: 'md' },
    { key: 'phone', header: 'Extension', render: (r) => <Muted>{r.phone ?? '—'}</Muted>, hideBelow: 'lg' },
    { key: 'doctors', header: 'Doctors', render: (r, c) => <Badge tone="teal">{[...c.lk.doctors.values()].filter((d) => d.department_id === r.id).length}</Badge>, sortValue: (r, c) => [...c.lk.doctors.values()].filter((d) => d.department_id === r.id).length },
    { key: 'staffc', header: 'Staff', render: (r, c) => <Badge>{[...c.lk.staff.values()].filter((d) => d.department_id === r.id).length}</Badge>, hideBelow: 'sm' },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'location', label: 'Location', type: 'text', placeholder: 'Block A · 2nd Floor' },
    { name: 'phone', label: 'Phone / extension', type: 'tel' },
    { name: 'description', label: 'Description', type: 'textarea' },
  ],
})

// ================================================================== INVOICES
export const invoicesRes = defineResource({
  table: 'invoices', path: '/invoices', singular: 'Invoice', icon: Receipt,
  title: (role) => (role === 'patient' ? 'My Bills' : 'Invoices'),
  description: (role) => role === 'patient' ? 'Your hospital bills and payment status.' : 'Patient billing — consultations, IPD, labs and pharmacy.',
  defaultSort: { key: 'issue_date', dir: 'desc' },
  server: {
    search: ['invoice_number', 'status', 'notes'], searchVia: [viaPatient], scope: ownPatientQ,
    sort: { invoice_number: 'invoice_number', issue_date: 'issue_date', due_date: 'due_date', total: 'total', amount_paid: 'amount_paid', status: 'status' },
    resolve: { patient_id: 'patients' },
    latestBy: 'invoice_number',
  },
  rowLink: (r) => `/invoices/${r.id}`,
  scope: ownPatient,
  searchText: (r, c) => `${r.invoice_number} ${pName(c, r.patient_id)} ${r.status}`,
  filters: [{ key: 'status', label: 'Status', options: opts('draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled') }],
  columns: [
    { key: 'invoice_number', header: 'Invoice', render: (r, c) => <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-600"><FileText className="h-4 w-4" /></div><div><div className="name font-medium text-slate-900 transition">{r.invoice_number}</div><div className="text-xs text-slate-500">{pName(c, r.patient_id)}</div></div></div> },
    { key: 'issue_date', header: 'Issued', render: (r) => <Muted>{fmtDate(r.issue_date)}</Muted>, hideBelow: 'md' },
    { key: 'due_date', header: 'Due', render: (r) => <Muted>{fmtDate(r.due_date)}</Muted>, hideBelow: 'xl' },
    { key: 'total', header: 'Total', render: (r) => <span className="font-medium text-slate-900">{money(r.total)}</span>, align: 'right' },
    { key: 'amount_paid', header: 'Paid', render: (r) => <span className="text-emerald-700">{money(r.amount_paid)}</span>, align: 'right', hideBelow: 'lg' },
    { key: 'balance', header: 'Balance', render: (r) => <span className={invoiceBalance(r) > 0 ? 'font-medium text-rose-600' : 'text-slate-400'}>{money(invoiceBalance(r))}</span>, sortValue: (r) => invoiceBalance(r), align: 'right', hideBelow: 'sm' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  rowActions: (r, c) => [
    { label: 'View & print', icon: Printer, onClick: () => c.navigate(`/invoices/${r.id}`) },
    { label: 'Download PDF', icon: FileDown, onClick: () => downloadInvoice(r, { site: c.site, patient: c.lk.patients.get(r.patient_id) ?? (isPatient(c) ? c.me.patient : null) }) },
    !isPatient(c) && invoiceBalance(r) > 0 && r.status !== 'cancelled' && r.status !== 'draft' && { label: 'Record payment', icon: Wallet, onClick: () => c.navigate(`/invoices/${r.id}?pay=1`) },
  ],
  canEdit: (r, c) => c.role !== 'receptionist' || r.amount_paid === 0,
  drawerWidth: 'max-w-3xl',
  fields: [
    { name: 'invoice_number', label: 'Invoice #', type: 'text', required: true, readOnly: () => true,
      default: (_c, rows: Invoice[]) => `INV-${String(Math.max(10000, ...rows.map((i) => Number(i.invoice_number?.replace(/\D/g, '')) || 0)) + 1).padStart(5, '0')}` },
    { ...patientField(), hidden: () => false },
    { name: 'issue_date', label: 'Issue date', type: 'date', required: true, default: () => today() },
    { name: 'due_date', label: 'Due date', type: 'date', default: () => format(addDays(new Date(), 15), 'yyyy-MM-dd') },
    { name: 'items', label: 'Line items', type: 'line_items', required: true, default: () => [{ description: 'Consultation fee', quantity: 1, unit_price: 700 }] },
    { name: 'discount', label: 'Discount (₹)', type: 'currency', min: 0, default: () => 0 },
    { name: 'tax', label: 'Tax / GST (₹)', type: 'currency', min: 0, default: () => 0 },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('draft', 'unpaid', 'cancelled'), default: () => 'unpaid', hint: 'Paid / partial / overdue are set automatically from payments' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  beforeSave: (v, _c, existing?: Invoice) => {
    const subtotal = (v.items ?? []).reduce((s: number, it: { quantity: number; unit_price: number }) => s + it.quantity * it.unit_price, 0)
    const discount = Number(v.discount) || 0
    const tax = Number(v.tax) || 0
    const total = Math.max(0, subtotal - discount + tax)
    const amount_paid = existing?.amount_paid ?? 0
    return { ...v, subtotal, discount, tax, total, amount_paid, status: deriveInvoiceStatus({ total, amount_paid, due_date: v.due_date, status: v.status }) }
  },
})

// ================================================================== PAYMENTS
const invLabel = (i: Invoice, c: ResourceCtx) => `${i.invoice_number} · ${pName(c, i.patient_id)} · due ${money(invoiceBalance(i))}`
/** the invoice's amount paid / status and the payment's patient are kept in sync by the database
 *  (trg_payments_sync_invoice in scripts/sql/scale.sql, mirrored by the demo store) — just refresh the caches */
const refreshInvoices = (c: ResourceCtx) => c.refresh('invoices')
export const paymentsRes = defineResource({
  table: 'payments', path: '/payments', singular: 'Payment', icon: CreditCard,
  title: (role) => (role === 'patient' ? 'My Payments' : 'Payments'),
  description: 'Money received against invoices.',
  defaultSort: { key: 'paid_on', dir: 'desc' },
  server: {
    search: ['reference', 'method'], scope: ownPatientQ,
    searchVia: [viaPatient, { column: 'invoice_id', table: 'invoices', columns: ['invoice_number'] }],
    sort: { paid_on: 'paid_on', method: 'method', reference: 'reference', amount: 'amount' },
    resolve: { patient_id: 'patients', invoice_id: 'invoices' },
  },
  scope: ownPatient,
  searchText: (r, c) => `${pName(c, r.patient_id)} ${c.lk.invoices.get(r.invoice_id)?.invoice_number} ${r.reference} ${r.method}`,
  filters: [{ key: 'method', label: 'Method', options: [...opts('cash', 'card', 'insurance', 'bank_transfer'), { value: 'upi', label: 'UPI' }] }],
  columns: [
    { key: 'invoice_p', header: 'Invoice', showFor: ['patient'], render: (r, c) => <span className="font-medium text-slate-800">{c.lk.invoices.get(r.invoice_id)?.invoice_number ?? '—'}</span> },
    { key: 'patient', header: 'Patient', hideFor: ['patient'], render: (r, c) => <Person name={pName(c, r.patient_id)} sub={c.lk.invoices.get(r.invoice_id)?.invoice_number} />, sortValue: (r, c) => pName(c, r.patient_id) },
    { key: 'paid_on', header: 'Date', render: (r) => <Muted>{fmtDate(r.paid_on)}</Muted> },
    { key: 'method', header: 'Method', render: (r) => <Badge tone="blue">{r.method === 'upi' ? 'UPI' : titleCase(r.method)}</Badge>, hideBelow: 'sm' },
    { key: 'reference', header: 'Reference', render: (r) => <span className="font-mono text-xs text-slate-500">{r.reference ?? '—'}</span>, hideBelow: 'lg' },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-semibold text-emerald-700">{money(r.amount)}</span>, align: 'right' },
  ],
  rowActions: (r, c) => [{ label: 'View invoice', icon: Receipt, onClick: () => c.navigate(`/invoices/${r.invoice_id}`) }],
  fields: [
    { name: 'invoice_id', label: 'Invoice', type: 'relation', required: true, span: 2,
      relation: { table: 'invoices', label: invLabel, filter: (i: Invoice) => invoiceBalance(i) > 0 && !['cancelled', 'draft'].includes(i.status),
        search: { columns: ['invoice_number'], order: 'invoice_number', where: (): Filter[] => [['status', 'in', ['unpaid', 'partial', 'overdue']]] } } },
    { name: 'amount', label: 'Amount (₹)', type: 'currency', required: true, min: 1 },
    { name: 'method', label: 'Method', type: 'select', required: true, options: [...opts('cash', 'card', 'insurance', 'bank_transfer'), { value: 'upi', label: 'UPI' }], default: () => 'upi' },
    { name: 'paid_on', label: 'Payment date', type: 'date', required: true, default: () => today() },
    { name: 'reference', label: 'Reference / Txn ID', type: 'text' },
  ],
  afterSave: (_s, c) => refreshInvoices(c),
  afterDelete: (_r, c) => refreshInvoices(c),
})

// ================================================================== EXPENSES
export const expensesRes = defineResource({
  table: 'expenses', path: '/expenses', title: 'Expenses', singular: 'Expense', icon: Wallet,
  description: 'Operational spending — payroll, supplies, utilities and more.',
  defaultSort: { key: 'expense_date', dir: 'desc' },
  server: {
    search: ['description', 'vendor', 'category'],
    sort: { description: 'description', category: 'category', expense_date: 'expense_date', amount: 'amount', status: 'status' },
  },
  searchText: (r) => `${r.description} ${r.vendor} ${r.category}`,
  filters: [
    { key: 'category', label: 'Category', options: opts('salaries', 'supplies', 'utilities', 'equipment', 'maintenance', 'rent', 'other') },
    { key: 'status', label: 'Status', options: opts('paid', 'pending') },
  ],
  columns: [
    { key: 'description', header: 'Description', render: (r) => <div><div className="font-medium text-slate-900">{r.description}</div><div className="text-xs text-slate-500">{r.vendor ?? '—'}</div></div> },
    { key: 'category', header: 'Category', render: (r) => <Badge tone="violet">{titleCase(r.category)}</Badge>, hideBelow: 'sm' },
    { key: 'expense_date', header: 'Date', render: (r) => <Muted>{fmtDate(r.expense_date)}</Muted>, hideBelow: 'md' },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-semibold text-slate-900">{money(r.amount)}</span>, align: 'right' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  rowActions: (r, c) => [r.status === 'pending' && { label: 'Mark as paid', icon: CheckCircle2, onClick: () => c.patch('expenses', r.id, { status: 'paid' }) }],
  fields: [
    { name: 'description', label: 'Description', type: 'text', required: true, span: 2 },
    { name: 'category', label: 'Category', type: 'select', required: true, options: opts('salaries', 'supplies', 'utilities', 'equipment', 'maintenance', 'rent', 'other') },
    { name: 'amount', label: 'Amount (₹)', type: 'currency', required: true, min: 0 },
    { name: 'expense_date', label: 'Date', type: 'date', required: true, default: () => today() },
    { name: 'vendor', label: 'Vendor / payee', type: 'text' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('paid', 'pending'), default: () => 'paid' },
  ],
})

// ================================================================== INVENTORY
const daysTo = (d?: string | null) => (d ? differenceInCalendarDays(parseISO(d), new Date()) : Infinity)
export const inventoryRes = defineResource({
  table: 'inventory', path: '/inventory', title: 'Pharmacy & Inventory', singular: 'Item', icon: Package,
  description: 'Medicines, consumables and equipment stock levels.',
  defaultSort: { key: 'name', dir: 'asc' },
  searchText: (r) => `${r.name} ${r.sku} ${r.supplier} ${r.category}`,
  filters: [
    { key: 'category', label: 'Category', options: opts('medicine', 'consumable', 'surgical', 'equipment') },
    { key: 'stock', label: 'Stock', options: [{ value: 'low', label: 'Low stock' }, { value: 'expiring', label: 'Expiring ≤ 60d' }, { value: 'ok', label: 'Healthy' }],
      predicate: (r, v) => v === 'low' ? r.quantity <= r.reorder_level : v === 'expiring' ? daysTo(r.expiry_date) <= 60 : r.quantity > r.reorder_level && daysTo(r.expiry_date) > 60 },
  ],
  columns: [
    { key: 'name', header: 'Item', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="font-mono text-[11px] text-slate-400">{r.sku}</div></div> },
    { key: 'category', header: 'Category', render: (r) => <Badge tone="slate">{titleCase(r.category)}</Badge>, hideBelow: 'md' },
    { key: 'quantity', header: 'Stock', render: (r) => {
      const pct = Math.min(100, (r.quantity / Math.max(1, r.reorder_level * 3)) * 100)
      const low = r.quantity <= r.reorder_level
      return <div className="w-32"><div className="flex items-center justify-between text-xs"><span className={low ? 'font-semibold text-rose-600' : 'text-slate-700'}>{r.quantity.toLocaleString('en-IN')} {r.unit}</span>{low && <Badge tone="red">Low</Badge>}</div><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${low ? 'bg-rose-500' : pct < 50 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div></div>
    } },
    { key: 'unit_price', header: 'Unit price', render: (r) => money(r.unit_price), align: 'right', hideBelow: 'lg' },
    { key: 'value', header: 'Stock value', render: (r) => money(r.quantity * r.unit_price), sortValue: (r) => r.quantity * r.unit_price, align: 'right', hideBelow: 'xl' },
    { key: 'expiry_date', header: 'Expiry', render: (r) => { const d = daysTo(r.expiry_date); return r.expiry_date ? <Badge tone={d < 0 ? 'red' : d <= 60 ? 'amber' : 'slate'}>{d < 0 ? 'Expired' : fmtDate(r.expiry_date, 'MMM yyyy')}</Badge> : <Muted>—</Muted> }, hideBelow: 'sm' },
    { key: 'supplier', header: 'Supplier', render: (r) => <Muted>{r.supplier ?? '—'}</Muted>, hideBelow: 'xl' },
  ],
  rowActions: (r, c) => [
    c.role !== 'doctor' && c.role !== 'accountant' && { label: `Restock +${Math.max(10, r.reorder_level)}`, icon: PackagePlus, onClick: () => c.patch('inventory', r.id, { quantity: r.quantity + Math.max(10, r.reorder_level) }) },
  ],
  fields: [
    { name: 'name', label: 'Item name', type: 'text', required: true, span: 2 },
    { name: 'sku', label: 'SKU', type: 'text', required: true },
    { name: 'category', label: 'Category', type: 'select', required: true, options: opts('medicine', 'consumable', 'surgical', 'equipment'), default: () => 'medicine' },
    { name: 'quantity', label: 'Quantity in stock', type: 'number', required: true, min: 0, default: () => 0 },
    { name: 'unit', label: 'Unit', type: 'text', required: true, default: () => 'tablets' },
    { name: 'reorder_level', label: 'Reorder level', type: 'number', required: true, min: 0, default: () => 50 },
    { name: 'unit_price', label: 'Unit price (₹)', type: 'currency', required: true, min: 0 },
    { name: 'supplier', label: 'Supplier', type: 'text' },
    { name: 'expiry_date', label: 'Expiry date', type: 'date' },
  ],
})

// ================================================================== NOTICES
export const noticesRes = defineResource({
  table: 'notices', path: '/notices', title: 'Notice Board', singular: 'Notice', icon: Megaphone,
  description: 'Announcements for staff, doctors and patients.',
  defaultSort: { key: 'published_on', dir: 'desc' },
  scope: (r, c) => c.role === 'owner' || r.audience === 'all' || (isPatient(c) ? r.audience === 'patients' : r.audience === 'staff' || (c.role === 'doctor' && r.audience === 'doctors')),
  searchText: (r) => `${r.title} ${r.body}`,
  filters: [{ key: 'audience', label: 'Audience', options: opts('all', 'staff', 'doctors', 'patients') }],
  columns: [
    { key: 'title', header: 'Notice', render: (r) => <div className="max-w-xl"><div className="font-medium text-slate-900">{r.title}</div><div className="line-clamp-1 text-xs text-slate-500">{r.body}</div></div> },
    { key: 'audience', header: 'Audience', render: (r) => <Badge tone="blue">{titleCase(r.audience)}</Badge>, hideBelow: 'sm' },
    { key: 'priority', header: 'Priority', render: (r) => <StatusBadge value={r.priority} />, hideBelow: 'md' },
    { key: 'published_on', header: 'Published', render: (r) => <Muted>{fmtDate(r.published_on)}</Muted> },
  ],
  fields: [
    { name: 'title', label: 'Title', type: 'text', required: true, span: 2 },
    { name: 'audience', label: 'Audience', type: 'select', required: true, options: opts('all', 'staff', 'doctors', 'patients'), default: () => 'all' },
    { name: 'priority', label: 'Priority', type: 'select', required: true, options: opts('normal', 'important', 'urgent'), default: () => 'normal' },
    { name: 'published_on', label: 'Publish date', type: 'date', required: true, default: () => today() },
    { name: 'body', label: 'Message', type: 'textarea', required: true },
  ],
})

// ================================================================== USERS (profiles)
const ROLE_TONE = { owner: 'violet', doctor: 'teal', receptionist: 'blue', accountant: 'amber', staff: 'slate', patient: 'green' } as const
export const usersRes = defineResource({
  table: 'profiles', path: '/users', title: 'Users & Roles', singular: 'User', icon: UserCog,
  description: 'Login accounts and their access level. Patients sign up themselves; invite staff so they get the right role automatically.',
  allowCreate: false,
  canDelete: () => false,
  defaultSort: { key: 'full_name', dir: 'asc' },
  searchText: (r) => `${r.full_name} ${r.email} ${r.role}`,
  filters: [{ key: 'role', label: 'Role', options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) }],
  columns: [
    { key: 'full_name', header: 'User', render: (r) => <Person name={r.full_name} sub={r.email} /> },
    { key: 'role', header: 'Role', render: (r) => <Badge tone={ROLE_TONE[r.role]}>{ROLE_LABEL[r.role]}</Badge> },
    { key: 'phone', header: 'Phone', render: (r) => <Muted>{r.phone ?? '—'}</Muted>, hideBelow: 'md' },
    { key: 'created_at', header: 'Joined', render: (r) => <Muted>{fmtDate(r.created_at)}</Muted>, hideBelow: 'sm' },
  ],
  fields: [
    { name: 'full_name', label: 'Full name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'role', label: 'Role', type: 'select', required: true, options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })), span: 2, hint: 'Controls which modules this user can access' },
  ],
})

// re-export row types used by pages (keeps imports tidy)
export type { Appointment, Department, Doctor, Expense, InventoryItem, Invoice, LabTest, Notice, Patient, Payment, Prescription, Profile, Staff }

// ================================================================== LEAVE, BLOCKED TIME & HOLIDAYS
/** leave / holiday screens only need bookings from today on (to count the ones a change would hit) */
const UPCOMING_APPTS: RelationSpec = { table: 'appointments', where: [['appointment_date', 'gte', today()]] }
export const scheduleExt = (c: ResourceCtx): ScheduleExt => ({ leaves: [...c.lk.doctor_leaves.values()], holidays: [...c.lk.holidays.values()] })
const QUEUE = '/schedule?tab=reschedule'
/**
 * After leave / a holiday takes effect, count the upcoming bookings that now clash and tell the user.
 * `extra` lets callers include the change that was just saved (lookups refresh a moment later).
 */
export function flagAffected(c: ResourceCtx, match: (a: Appointment) => boolean, what: string, extra: ScheduleExt = {}) {
  const t = today()
  const ext = scheduleExt(c)
  const merged: ScheduleExt = {
    leaves: [...(ext.leaves ?? []).filter((l) => !extra.leaves?.some((x) => x.id === l.id)), ...(extra.leaves ?? [])],
    holidays: [...(ext.holidays ?? []).filter((h) => !extra.holidays?.some((x) => x.id === h.id)), ...(extra.holidays ?? [])],
  }
  const n = [...c.lk.appointments.values()].filter((a) => a.appointment_date >= t && match(a)
    && (conflictOf(a, c.lk.doctors.get(a.doctor_id), merged) || (c.lk.doctors.get(a.doctor_id)?.status !== 'active' && (a.status === 'scheduled' || a.status === 'confirmed')))).length
  if (n) toast.warning(`${what} — ${n} booked patient${n === 1 ? '' : 's'} flagged for rescheduling`, { duration: 9000, action: { label: 'Open queue', onClick: () => c.navigate(QUEUE) } })
  else toast.success(`${what} — no existing bookings are affected`)
}
const affectedBy = (l: DoctorLeave, c: ResourceCtx) => {
  const t = today()
  return [...c.lk.appointments.values()].filter((a) => a.doctor_id === l.doctor_id && a.appointment_date >= t && a.appointment_date >= l.start_date && a.appointment_date <= l.end_date
    && (a.status === 'scheduled' || a.status === 'confirmed') && (isFullDay(l) || (a.appointment_time.slice(0, 5) >= l.start_time! && a.appointment_time.slice(0, 5) < l.end_time!))).length
}
const isDoctor = (c: ResourceCtx) => c.role === 'doctor'
const canApprove = (c: ResourceCtx) => c.role === 'owner' || c.role === 'receptionist'
const LEAVE_TONE = { leave: 'amber', surgery: 'red', meeting: 'blue', conference: 'violet', training: 'teal', other: 'slate' } as const
const setLeave = (status: DoctorLeave['status']) => async (r: DoctorLeave, c: ResourceCtx) => {
  await c.patch('doctor_leaves', r.id, { status })
  if (status === 'approved') flagAffected(c, (a) => a.doctor_id === r.doctor_id, `${LEAVE_LABEL[r.kind]} approved`, { leaves: [{ ...r, status }] })
  else toast.success(`${LEAVE_LABEL[r.kind]} request rejected`)
}

export const leavesRes = defineResource({
  table: 'doctor_leaves', path: '/schedule', singular: 'Leave / block', icon: CalendarOff,
  title: (role) => (role === 'doctor' ? 'My Leave & Blocked Time' : 'Leave & Holidays'),
  description: (role) => role === 'doctor'
    ? 'Request leave or block time for surgery and meetings. Reception approves it and reschedules affected patients.'
    : 'Doctor leave, blocked time (surgery, meetings) and hospital holidays. Approved entries close those slots everywhere — including online booking.',
  relations: ['doctors', 'departments', UPCOMING_APPTS, 'doctor_leaves', 'holidays'],
  defaultSort: { key: 'start_date', dir: 'desc' },
  scope: (r, c) => !isDoctor(c) || r.doctor_id === c.me.doctor?.id,
  searchText: (r, c) => `${dName(c, r.doctor_id)} ${r.kind} ${r.reason ?? ''} ${r.status}`,
  filters: [
    { key: 'status', label: 'Status', options: opts('pending', 'approved', 'rejected') },
    { key: 'kind', label: 'Type', options: Object.entries(LEAVE_LABEL).map(([value, label]) => ({ value, label })) },
    { key: 'when', label: 'When', options: [{ value: 'upcoming', label: 'Upcoming & ongoing' }, { value: 'past', label: 'Past' }], predicate: (r, v) => (v === 'past' ? r.end_date < today() : r.end_date >= today()) },
  ],
  columns: [
    { key: 'doctor', header: 'Doctor', render: (r, c) => <Person name={dName(c, r.doctor_id)} sub={deptName(c, c.lk.doctors.get(r.doctor_id)?.department_id)} />, sortValue: (r, c) => dName(c, r.doctor_id), hideFor: ['doctor'] },
    { key: 'kind', header: 'Type', render: (r) => <Badge tone={LEAVE_TONE[r.kind]}>{LEAVE_LABEL[r.kind]}</Badge> },
    { key: 'start_date', header: 'When', sortValue: (r) => r.start_date + (r.start_time ?? ''), render: (r) => {
      const days = differenceInCalendarDays(parseISO(r.end_date), parseISO(r.start_date)) + 1
      return <div><div className="font-medium text-slate-800">{fmtDate(r.start_date, 'EEE, dd MMM')}{r.end_date !== r.start_date && <> → {fmtDate(r.end_date, 'EEE, dd MMM')}</>}</div>
        <div className="text-xs text-slate-500">{isFullDay(r) ? `Full day${days > 1 ? ` · ${days} days` : ''}` : `${fmtTime(r.start_time)} – ${fmtTime(r.end_time)}`}</div></div>
    } },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-1 max-w-[16rem] text-slate-600">{r.reason || '—'}</span>, hideBelow: 'lg' },
    { key: 'affected', header: 'Bookings hit', sortValue: (r, c) => affectedBy(r, c), render: (r, c) => {
      const n = affectedBy(r, c)
      return n ? <Badge tone={r.status === 'approved' ? 'red' : 'amber'}>{n} patient{n === 1 ? '' : 's'}</Badge> : <Muted>None</Muted>
    }, hideBelow: 'md' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  rowActions: (r, c) => [
    canApprove(c) && r.status !== 'approved' && { label: 'Approve', icon: ThumbsUp, onClick: setLeave('approved') },
    canApprove(c) && r.status === 'pending' && { label: 'Reject', icon: ThumbsDown, tone: 'danger' as const, onClick: setLeave('rejected') },
    r.status === 'approved' && affectedBy(r, c) > 0 && !isDoctor(c) && { label: 'Reschedule affected patients', icon: CalendarDays, onClick: () => c.navigate(`${QUEUE}&doctor=${r.doctor_id}`) },
  ],
  canEdit: (r, c) => !isDoctor(c) || (r.doctor_id === c.me.doctor?.id && r.status === 'pending'),
  canDelete: (r, c) => !isDoctor(c) || (r.doctor_id === c.me.doctor?.id && r.status === 'pending'),
  fields: [
    { ...doctorField(), hidden: (c) => isDoctor(c), relation: { ...doctorField().relation, filter: (d: Doctor) => d.status !== 'inactive' } },
    { name: 'kind', label: 'Type', type: 'select', required: true, options: Object.entries(LEAVE_LABEL).map(([value, label]) => ({ value, label })), default: () => 'leave' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: opts('pending', 'approved', 'rejected'), default: (c) => (isDoctor(c) ? 'pending' : 'approved'), hidden: (c) => isDoctor(c), hint: 'Only approved entries close slots' },
    { name: 'start_date', label: 'From', type: 'date', required: true, default: () => today() },
    { name: 'end_date', label: 'To', type: 'date', hint: 'Leave empty for a single day' },
    { name: 'start_time', label: 'Block from', type: 'select', options: [{ value: '', label: 'Full day' }, ...TIME_OPTS], hint: 'Pick times to block part of the day (e.g. surgery 10–1)', hidden: (_c, v) => v.kind === 'leave' },
    { name: 'end_time', label: 'Block until', type: 'select', options: [{ value: '', label: '—' }, ...TIMES.slice(1).concat('19:00').map((t) => ({ value: t, label: fmtTime(t) }))], hidden: (_c, v) => v.kind === 'leave' || !v.start_time },
    { name: 'reason', label: 'Reason / note', type: 'textarea', placeholder: 'e.g. Knee replacement — OT 2 · Family function · CME at AIIMS' },
  ],
  beforeSave: (v, c, existing) => {
    const out: Record<string, any> = { ...v, end_date: v.end_date || v.start_date }
    if (v.kind === 'leave' || !v.start_time || !v.end_time) { out.start_time = null; out.end_time = null }
    if (isDoctor(c)) { out.doctor_id = c.me.doctor?.id; out.status = 'pending' }
    if (!existing && !out.status) out.status = 'approved'
    return out
  },
  validate: (v, c, rows, existing) => {
    const e: Record<string, string> = {}
    const end = v.end_date || v.start_date
    if (end < v.start_date) e.end_date = 'Must be on or after the start date'
    if (v.kind !== 'leave' && v.start_time && v.end_time && v.end_time <= v.start_time) e.end_time = 'Must be after the start time'
    if (v.kind !== 'leave' && v.start_time && !v.end_time) e.end_time = 'Pick when the block ends'
    const docId = isDoctor(c) ? c.me.doctor?.id : v.doctor_id
    const full = v.kind === 'leave' || !v.start_time
    const overlap = rows.find((r) => r.id !== existing?.id && r.doctor_id === docId && r.status !== 'rejected' && r.start_date <= end && r.end_date >= v.start_date
      && (full || isFullDay(r) || (r.start_time! < v.end_time && r.end_time! > v.start_time)))
    if (overlap) e.start_date = `Overlaps ${LEAVE_LABEL[overlap.kind].toLowerCase()} on ${fmtDate(overlap.start_date, 'dd MMM')}${overlap.end_date !== overlap.start_date ? `–${fmtDate(overlap.end_date, 'dd MMM')}` : ''}`
    return e
  },
  afterSave: (saved, c, existing) => {
    if (saved.status === 'approved' && existing?.status !== 'approved' || (saved.status === 'approved' && existing && (existing.start_date !== saved.start_date || existing.end_date !== saved.end_date || existing.start_time !== saved.start_time)))
      flagAffected(c, (a) => a.doctor_id === saved.doctor_id, `${LEAVE_LABEL[saved.kind]} saved`, { leaves: [saved] })
    else if (saved.status === 'pending' && !existing) toast.info('Request sent — reception will review it')
  },
  emptyText: 'No leave or blocked time yet.',
})

export const holidaysRes = defineResource({
  table: 'holidays', path: '/schedule', title: 'Leave & Holidays', singular: 'Holiday', icon: PartyPopper,
  description: 'Hospital-wide OPD closures. Emergency, ICU and pharmacy stay open 24×7. Holidays close all slots, including online booking.',
  relations: ['doctors', UPCOMING_APPTS, 'doctor_leaves', 'holidays'],
  defaultSort: { key: 'holiday_date', dir: 'asc' },
  searchText: (r) => `${r.name} ${r.note ?? ''} ${r.holiday_date}`,
  filters: [{ key: 'when', label: 'When', options: [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }], predicate: (r, v) => (v === 'past' ? r.holiday_date < today() : r.holiday_date >= today()) }],
  columns: [
    { key: 'holiday_date', header: 'Date', render: (r) => <div><div className="font-medium text-slate-800">{fmtDate(r.holiday_date, 'dd MMM yyyy')}</div><div className="text-xs text-slate-500">{fmtDate(r.holiday_date, 'EEEE')}</div></div> },
    { key: 'name', header: 'Holiday', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div>{r.note && <div className="line-clamp-1 text-xs text-slate-500">{r.note}</div>}</div> },
    { key: 'affected', header: 'Bookings hit', render: (r, c) => {
      const n = [...c.lk.appointments.values()].filter((a) => a.appointment_date === r.holiday_date && (a.status === 'scheduled' || a.status === 'confirmed')).length
      return n && r.holiday_date >= today() ? <Badge tone="red">{n} patient{n === 1 ? '' : 's'}</Badge> : <Muted>None</Muted>
    }, hideBelow: 'sm' },
    { key: 'in', header: '', render: (r) => r.holiday_date >= today() ? <Muted>in {differenceInCalendarDays(parseISO(r.holiday_date), new Date())} days</Muted> : <Muted>Past</Muted>, hideBelow: 'md', align: 'right' },
  ],
  fields: [
    { name: 'holiday_date', label: 'Date', type: 'date', required: true },
    { name: 'name', label: 'Holiday name', type: 'text', required: true, placeholder: 'e.g. Holi' },
    { name: 'note', label: 'Note (shown in calendars)', type: 'textarea', placeholder: 'e.g. OPD closed · Emergency & pharmacy open 24×7' },
  ],
  validate: (v, _c, rows, existing): Record<string, string> => (rows.some((r) => r.id !== existing?.id && r.holiday_date === v.holiday_date) ? { holiday_date: 'There is already a holiday on this date' } : {}),
  afterSave: (saved, c) => flagAffected(c, (a) => a.appointment_date === saved.holiday_date, `${saved.name} added`, { holidays: [saved] }),
  emptyText: 'No holidays added yet.',
})

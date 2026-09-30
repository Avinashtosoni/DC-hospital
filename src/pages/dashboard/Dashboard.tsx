import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format, parseISO, subDays } from 'date-fns'
import {
  AlertTriangle, BedDouble, CalendarCheck, CalendarPlus, CheckCircle2, ClipboardList, Clock, CreditCard, FlaskConical, HeartPulse,
  IndianRupee, Megaphone, CalendarClock, FileDown, Star, Package, Pill, Receipt, Stethoscope, TrendingDown, TrendingUp, UserCheck, UserPlus, Users, Wallet,
} from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { useAppSettings } from '../../settings/AppSettingsProvider'
import { useSiteSettings } from '../../site/cms/content'
import { Widget, WidgetScope } from '../../settings/widgetScope'
import { useLookup, useTable, useUpdate } from '../../hooks/useData'
import { useMe } from '../../hooks/useScope'
import { Avatar, Badge, Button, Card, CardHeader, StatCard, StatusBadge } from '../../components/ui'
import { Donut, Greeting, ListCard, ListRow, QuickAction, RevenueChart, SimpleBar, monthBuckets } from './widgets'
import { fmtDate, fmtTime, money, moneyCompact, num, today, titleCase, ago, cn } from '../../lib/utils'
import { invoiceBalance } from '../../lib/billing'
import { downloadLabReport } from '../../lib/pdf'
import { useT } from '../../i18n'
import type { Appointment, Doctor, Patient } from '../../types'

export default function Dashboard() {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const role = user?.role
  const hidden = useMemo(() => new Set(settings.dashboard.hidden.filter((k) => k.startsWith(`${role}:`)).map((k) => k.slice(String(role).length + 1))), [settings.dashboard.hidden, role])
  return <WidgetScope.Provider value={hidden}><RoleDashboard role={role} /></WidgetScope.Provider>
}

function RoleDashboard({ role }: { role?: string }) {
  switch (role) {
    case 'owner': return <OwnerDashboard />
    case 'doctor': return <DoctorDashboard />
    case 'receptionist': return <ReceptionDashboard />
    case 'accountant': return <AccountantDashboard />
    case 'staff': return <StaffDashboard />
    case 'patient': return <PatientDashboard />
    default: return null
  }
}

// ---------------------------------------------------------------- shared
function useFinance() {
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const expenses = useTable('expenses')
  return useMemo(() => {
    const buckets = monthBuckets(6)
    const series = buckets.map((b) => ({
      label: b.label,
      revenue: (payments.data ?? []).filter((p) => p.paid_on.startsWith(b.key)).reduce((s, p) => s + Number(p.amount), 0),
      expenses: (expenses.data ?? []).filter((e) => e.expense_date.startsWith(b.key)).reduce((s, e) => s + Number(e.amount), 0),
    }))
    const thisMonth = series[series.length - 1]
    const lastMonth = series[series.length - 2]
    const outstanding = (invoices.data ?? []).filter((i) => !['cancelled', 'draft'].includes(i.status)).reduce((s, i) => s + invoiceBalance(i), 0)
    const methods = Object.entries((payments.data ?? []).reduce<Record<string, number>>((acc, p) => { acc[p.method] = (acc[p.method] ?? 0) + Number(p.amount); return acc }, {}))
      .map(([name, value]) => ({ name: name === 'upi' ? 'UPI' : titleCase(name), value }))
    return { series, thisMonth, lastMonth, outstanding, methods, loading: invoices.isLoading || payments.isLoading || expenses.isLoading, invoices: invoices.data ?? [], payments: payments.data ?? [], expenses: expenses.data ?? [] }
  }, [invoices.data, payments.data, expenses.data, invoices.isLoading, payments.isLoading, expenses.isLoading])
}

const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0)
function Trend({ now, prev, invert }: { now: number; prev: number; invert?: boolean }) {
  const p = pct(now, prev)
  const good = invert ? p <= 0 : p >= 0
  return <span className={cn('inline-flex items-center gap-1 font-medium', good ? 'text-emerald-600' : 'text-rose-600')}>{p >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{Math.abs(p)}% vs last month</span>
}

function ApptRow({ a, patients, doctors, actions, showDoctor = true }: { a: Appointment; patients: Map<string, Patient>; doctors: Map<string, Doctor>; actions?: boolean; showDoctor?: boolean }) {
  const upd = useUpdate('appointments', { label: 'Appointment', silent: true })
  const p = patients.get(a.patient_id)
  const next: Partial<Record<Appointment['status'], { to: Appointment['status']; label: string }>> = {
    scheduled: { to: 'confirmed', label: 'Confirm' }, confirmed: { to: 'checked_in', label: 'Check in' }, checked_in: { to: 'completed', label: 'Complete' },
  }
  const n = next[a.status]
  return (
    <div className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50/70">
      <div className="w-16 shrink-0 text-xs font-semibold text-slate-700">{fmtTime(a.appointment_time)}</div>
      <Link to={`/patients/${a.patient_id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={p?.full_name} size="sm" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{p?.full_name ?? '—'}</div>
          <div className="truncate text-xs text-slate-500">{showDoctor ? doctors.get(a.doctor_id)?.full_name : a.reason}</div>
        </div>
      </Link>
      <StatusBadge value={a.status} />
      {actions && n && <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => upd.mutate({ id: a.id, patch: { status: n.to } })}>{n.label}</Button>}
    </div>
  )
}

// ---------------------------------------------------------------- OWNER
function OwnerDashboard() {
  const site = useSiteSettings()
  const { user } = useAuth()
  const fin = useFinance()
  const appts = useTable('appointments')
  const patients = useTable('patients')
  const beds = useTable('beds')
  const inventory = useTable('inventory')
  const admissions = useTable('admissions')
  const pLk = useLookup('patients')
  const dLk = useLookup('doctors')
  const deptLk = useLookup('departments')
  const t = today()
  const todays = (appts.data ?? []).filter((a) => a.appointment_date === t).sort((a, b) => a.appointment_time.localeCompare(b.appointment_time))
  const occupied = (beds.data ?? []).filter((b) => b.status === 'occupied').length
  const totalBeds = beds.data?.length ?? 0
  const lowStock = (inventory.data ?? []).filter((i) => i.quantity <= i.reorder_level)
  const newPatients = (patients.data ?? []).filter((p) => p.created_at && p.created_at >= subDays(new Date(), 30).toISOString()).length

  const byDept = useMemo(() => {
    const m: Record<string, number> = {}
    ;(appts.data ?? []).filter((a) => a.appointment_date >= format(subDays(new Date(), 30), 'yyyy-MM-dd')).forEach((a) => {
      const dep = deptLk.get(dLk.get(a.doctor_id)?.department_id ?? '')?.name ?? 'Other'
      m[dep] = (m[dep] ?? 0) + 1
    })
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7)
  }, [appts.data, dLk, deptLk])

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), i - 6)
    const key = format(d, 'yyyy-MM-dd')
    return { label: format(d, 'EEE'), value: (appts.data ?? []).filter((a) => a.appointment_date === key && a.status !== 'cancelled').length }
  }), [appts.data])

  return (
    <div>
      <Greeting name={user!.full_name} subtitle={`Here's how ${site.name} is performing today.`}>
        <Link to="/reports"><Button variant="outline" icon={<TrendingUp className="h-4 w-4" />}>Reports</Button></Link>
        <Link to="/appointments?new=1"><Button icon={<CalendarPlus className="h-4 w-4" />}>New appointment</Button></Link>
      </Greeting>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="Revenue (this month)" value={money(fin.thisMonth?.revenue)} icon={<IndianRupee className="h-5 w-5" />} loading={fin.loading} hint={fin.lastMonth && <Trend now={fin.thisMonth.revenue} prev={fin.lastMonth.revenue} />} />
        <StatCard label="Total patients" value={num(patients.data?.length)} icon={<Users className="h-5 w-5" />} tone="blue" loading={patients.isLoading} hint={`+${newPatients} in last 30 days`} />
        <StatCard label="Today's appointments" value={todays.length} icon={<CalendarCheck className="h-5 w-5" />} tone="violet" loading={appts.isLoading} hint={`${todays.filter((a) => a.status === 'completed').length} completed`} />
        <StatCard label="Bed occupancy" value={totalBeds ? `${Math.round((occupied / totalBeds) * 100)}%` : '—'} icon={<BedDouble className="h-5 w-5" />} tone="amber" loading={beds.isLoading} hint={`${occupied} of ${totalBeds} beds occupied`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Widget id="Revenue vs expenses"><Card className="xl:col-span-2">
          <CardHeader title="Revenue vs expenses" subtitle="Collections and spending over the last 6 months" icon={<TrendingUp className="h-4 w-4" />} />
          <RevenueChart data={fin.series} loading={fin.loading} />
        </Card></Widget>
        <Widget id="Appointments by department"><Card>
          <CardHeader title="Appointments by department" subtitle="Last 30 days" icon={<Stethoscope className="h-4 w-4" />} />
          <Donut data={byDept} loading={appts.isLoading} height={290} />
        </Card></Widget>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <ListCard widgetId="Today's appointments list" title="Today's appointments" subtitle={`${todays.length} scheduled`} icon={<Clock className="h-4 w-4" />} link="/appointments?when=today" loading={appts.isLoading} empty={!todays.length} emptyText="No appointments today" className="xl:col-span-2">
          {todays.slice(0, 7).map((a) => <ApptRow key={a.id} a={a} patients={pLk} doctors={dLk} />)}
        </ListCard>
        <div className="space-y-6">
          <Widget id="Patient flow"><Card>
            <CardHeader title="Patient flow" subtitle="Appointments, last 7 days" icon={<CalendarCheck className="h-4 w-4" />} />
            <SimpleBar data={week} loading={appts.isLoading} height={180} />
          </Card></Widget>
          <ListCard title="Low stock alerts" icon={<AlertTriangle className="h-4 w-4" />} link="/inventory?stock=low" loading={inventory.isLoading} empty={!lowStock.length} emptyText="All stock levels healthy">
            {lowStock.slice(0, 4).map((i) => <ListRow key={i.id} left={<div><div className="text-sm font-medium text-slate-800">{i.name}</div><div className="text-xs text-slate-500">Reorder at {i.reorder_level}</div></div>} right={<Badge tone="red">{i.quantity} {i.unit}</Badge>} />)}
          </ListCard>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ListCard title="Current admissions" icon={<ClipboardList className="h-4 w-4" />} link="/admissions?status=admitted" loading={admissions.isLoading} empty={!admissions.data?.some((a) => a.status === 'admitted')}>
          {(admissions.data ?? []).filter((a) => a.status === 'admitted').slice(0, 5).map((a) => (
            <ListRow key={a.id} to={`/patients/${a.patient_id}`} left={<div className="flex items-center gap-3"><Avatar name={pLk.get(a.patient_id)?.full_name} size="sm" /><div><div className="text-sm font-medium text-slate-800">{pLk.get(a.patient_id)?.full_name}</div><div className="text-xs text-slate-500">{a.reason}</div></div></div>} right={<span className="text-xs text-slate-500">since {fmtDate(a.admission_date, 'dd MMM')}</span>} />
          ))}
        </ListCard>
        <ListCard title="Outstanding invoices" subtitle={`${money(fin.outstanding)} receivable`} icon={<Receipt className="h-4 w-4" />} link="/invoices?status=overdue" loading={fin.loading} empty={!fin.invoices.some((i) => invoiceBalance(i) > 0)}>
          {fin.invoices.filter((i) => invoiceBalance(i) > 0 && !['cancelled', 'draft'].includes(i.status)).sort((a, b) => invoiceBalance(b) - invoiceBalance(a)).slice(0, 5).map((i) => (
            <ListRow key={i.id} to={`/invoices/${i.id}`} left={<div><div className="text-sm font-medium text-slate-800">{i.invoice_number} · {pLk.get(i.patient_id)?.full_name}</div><div className="text-xs text-slate-500">Due {fmtDate(i.due_date)}</div></div>} right={<div className="flex items-center gap-2"><span className="text-sm font-semibold text-rose-600">{money(invoiceBalance(i))}</span><StatusBadge value={i.status} /></div>} />
          ))}
        </ListCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- DOCTOR
function DoctorDashboard() {
  const { user } = useAuth()
  const me = useMe()
  const appts = useTable('appointments')
  const labs = useTable('lab_tests')
  const admissions = useTable('admissions')
  const rx = useTable('prescriptions')
  const pLk = useLookup('patients')
  const dLk = useLookup('doctors')
  const bLk = useLookup('beds')
  const docId = me.doctor?.id
  const t = today()
  const mine = (appts.data ?? []).filter((a) => a.doctor_id === docId)
  const todays = mine.filter((a) => a.appointment_date === t).sort((a, b) => a.appointment_time.localeCompare(b.appointment_time))
  const waiting = todays.filter((a) => a.status === 'checked_in').length
  const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const completedWeek = mine.filter((a) => a.status === 'completed' && a.appointment_date >= weekAgo && a.appointment_date <= t).length
  const pendingLabs = (labs.data ?? []).filter((l) => l.doctor_id === docId && l.status !== 'completed' && l.status !== 'cancelled')
  const myInpatients = (admissions.data ?? []).filter((a) => a.doctor_id === docId && a.status === 'admitted')
  const followUps = (rx.data ?? []).filter((r) => r.doctor_id === docId && r.follow_up_date && r.follow_up_date >= t).sort((a, b) => a.follow_up_date!.localeCompare(b.follow_up_date!))
  const loading = appts.isLoading || me.loading
  const upcoming = mine.filter((a) => a.appointment_date > t && ['scheduled', 'confirmed'].includes(a.status)).sort((a, b) => (a.appointment_date + a.appointment_time).localeCompare(b.appointment_date + b.appointment_time))

  return (
    <div>
      <Greeting name={user!.full_name} subtitle={me.doctor ? `${me.doctor.specialization} · ${todays.length} patients on your list today` : 'Your clinical overview'}>
        <Link to="/prescriptions?new=1"><Button variant="outline" icon={<Pill className="h-4 w-4" />}>New prescription</Button></Link>
        <Link to="/appointments?when=today"><Button icon={<CalendarCheck className="h-4 w-4" />}>Today's queue</Button></Link>
      </Greeting>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="Today's patients" value={todays.length} icon={<CalendarCheck className="h-5 w-5" />} loading={loading} hint={`${todays.filter((a) => a.status === 'completed').length} seen so far`} />
        <StatCard label="In waiting room" value={waiting} icon={<UserCheck className="h-5 w-5" />} tone="violet" loading={loading} hint="Checked-in patients" />
        <StatCard label="Completed (7 days)" value={completedWeek} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" loading={loading} />
        <StatCard label="Pending lab results" value={pendingLabs.length} icon={<FlaskConical className="h-5 w-5" />} tone="amber" loading={labs.isLoading} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <ListCard title="Today's queue" subtitle="Advance patients through the visit with one click" icon={<Clock className="h-4 w-4" />} link="/appointments?when=today" loading={loading} empty={!todays.length} emptyText="No patients scheduled today" className="xl:col-span-2">
          {todays.map((a) => <ApptRow key={a.id} a={a} patients={pLk} doctors={dLk} actions showDoctor={false} />)}
        </ListCard>
        <ListCard title="My in-patients" icon={<BedDouble className="h-4 w-4" />} link="/admissions" loading={admissions.isLoading} empty={!myInpatients.length} emptyText="No admitted patients">
          {myInpatients.map((a) => <ListRow key={a.id} to={`/patients/${a.patient_id}`} left={<div className="flex items-center gap-3"><Avatar name={pLk.get(a.patient_id)?.full_name} size="sm" /><div><div className="text-sm font-medium text-slate-800">{pLk.get(a.patient_id)?.full_name}</div><div className="text-xs text-slate-500">{a.reason}</div></div></div>} right={<Badge tone="violet">{bLk.get(a.bed_id ?? '')?.bed_number ?? '—'}</Badge>} />)}
        </ListCard>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ListCard title="Upcoming appointments" icon={<CalendarCheck className="h-4 w-4" />} link="/appointments?when=upcoming" loading={loading} empty={!upcoming.length}>
          {upcoming.slice(0, 5).map((a) => <ListRow key={a.id} to={`/patients/${a.patient_id}`} left={<div><div className="text-sm font-medium text-slate-800">{pLk.get(a.patient_id)?.full_name}</div><div className="text-xs text-slate-500">{a.reason}</div></div>} right={<div className="text-xs text-slate-600">{fmtDate(a.appointment_date, 'EEE dd MMM')}<div className="text-slate-400">{fmtTime(a.appointment_time)}</div></div>} />)}
        </ListCard>
        <ListCard widgetId="Pending lab results list" title="Pending lab results" icon={<FlaskConical className="h-4 w-4" />} link="/lab-tests" loading={labs.isLoading} empty={!pendingLabs.length} emptyText="All results are in">
          {pendingLabs.slice(0, 5).map((l) => <ListRow key={l.id} left={<div><div className="text-sm font-medium text-slate-800">{l.test_name}</div><div className="text-xs text-slate-500">{pLk.get(l.patient_id)?.full_name}</div></div>} right={<StatusBadge value={l.status} />} />)}
        </ListCard>
        <ListCard title="Follow-ups due" icon={<Pill className="h-4 w-4" />} link="/prescriptions" loading={rx.isLoading} empty={!followUps.length}>
          {followUps.slice(0, 5).map((r) => <ListRow key={r.id} to={`/patients/${r.patient_id}`} left={<div><div className="text-sm font-medium text-slate-800">{pLk.get(r.patient_id)?.full_name}</div><div className="text-xs text-slate-500">{r.diagnosis}</div></div>} right={<Badge tone="blue">{fmtDate(r.follow_up_date, 'dd MMM')}</Badge>} />)}
        </ListCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- RECEPTION
function ReceptionDashboard() {
  const { user } = useAuth()
  const appts = useTable('appointments')
  const patients = useTable('patients')
  const beds = useTable('beds')
  const wards = useTable('wards')
  const pLk = useLookup('patients')
  const dLk = useLookup('doctors')
  const t = today()
  const todays = (appts.data ?? []).filter((a) => a.appointment_date === t).sort((a, b) => a.appointment_time.localeCompare(b.appointment_time))
  const weekAgo = subDays(new Date(), 7).toISOString()
  const available = (beds.data ?? []).filter((b) => b.status === 'available')
  return (
    <div>
      <Greeting name={user!.full_name} subtitle="Front desk overview — keep the queue moving." />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickAction to="/patients?new=1" icon={<UserPlus className="h-5 w-5" />} label="Register patient" desc="Create a new medical record" />
        <QuickAction to="/appointments?new=1" icon={<CalendarPlus className="h-5 w-5" />} label="Book appointment" desc="Schedule an OPD visit" />
        <QuickAction to="/admissions?new=1" icon={<BedDouble className="h-5 w-5" />} label="Admit patient" desc="Allocate an available bed" />
        <QuickAction to="/invoices?new=1" icon={<Receipt className="h-5 w-5" />} label="Create invoice" desc="Bill consultation or services" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="Today's appointments" value={todays.length} icon={<CalendarCheck className="h-5 w-5" />} loading={appts.isLoading} />
        <StatCard label="Checked in" value={todays.filter((a) => a.status === 'checked_in').length} icon={<UserCheck className="h-5 w-5" />} tone="violet" loading={appts.isLoading} hint="Waiting for doctor" />
        <StatCard label="New patients (7d)" value={(patients.data ?? []).filter((p) => (p.created_at ?? '') >= weekAgo).length} icon={<UserPlus className="h-5 w-5" />} tone="blue" loading={patients.isLoading} />
        <StatCard label="Available beds" value={available.length} icon={<BedDouble className="h-5 w-5" />} tone="green" loading={beds.isLoading} hint={`of ${beds.data?.length ?? 0} total`} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <ListCard title="Today's schedule" subtitle="Confirm and check in arriving patients" icon={<Clock className="h-4 w-4" />} link="/appointments?when=today" loading={appts.isLoading} empty={!todays.length} emptyText="No appointments today" className="xl:col-span-2">
          {todays.map((a) => <ApptRow key={a.id} a={a} patients={pLk} doctors={dLk} actions />)}
        </ListCard>
        <ListCard title="Bed availability" icon={<BedDouble className="h-4 w-4" />} link="/beds" loading={beds.isLoading || wards.isLoading}>
          {(wards.data ?? []).map((w) => {
            const wb = (beds.data ?? []).filter((b) => b.ward_id === w.id)
            const free = wb.filter((b) => b.status === 'available').length
            return (
              <div key={w.id} className="px-5 py-3">
                <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-800">{w.name}</span><span className={free ? 'text-emerald-600' : 'text-rose-600'}>{free}/{wb.length} free</span></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${wb.length ? ((wb.length - free) / wb.length) * 100 : 0}%` }} /></div>
              </div>
            )
          })}
        </ListCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- ACCOUNTANT
function AccountantDashboard() {
  const { user } = useAuth()
  const fin = useFinance()
  const pLk = useLookup('patients')
  const net = (fin.thisMonth?.revenue ?? 0) - (fin.thisMonth?.expenses ?? 0)
  const overdue = fin.invoices.filter((i) => i.status === 'overdue').sort((a, b) => invoiceBalance(b) - invoiceBalance(a))
  const recent = [...fin.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on)).slice(0, 6)
  return (
    <div>
      <Greeting name={user!.full_name} subtitle="Financial snapshot for this month.">
        <Link to="/payments?new=1"><Button variant="outline" icon={<CreditCard className="h-4 w-4" />}>Record payment</Button></Link>
        <Link to="/invoices?new=1"><Button icon={<Receipt className="h-4 w-4" />}>New invoice</Button></Link>
      </Greeting>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="Collected (month)" value={money(fin.thisMonth?.revenue)} icon={<IndianRupee className="h-5 w-5" />} loading={fin.loading} hint={fin.lastMonth && <Trend now={fin.thisMonth.revenue} prev={fin.lastMonth.revenue} />} />
        <StatCard label="Outstanding" value={money(fin.outstanding)} icon={<Receipt className="h-5 w-5" />} tone="amber" loading={fin.loading} hint={`${fin.invoices.filter((i) => invoiceBalance(i) > 0 && i.status !== 'cancelled').length} open invoices`} />
        <StatCard label="Expenses (month)" value={money(fin.thisMonth?.expenses)} icon={<Wallet className="h-5 w-5" />} tone="violet" loading={fin.loading} hint={fin.lastMonth && <Trend now={fin.thisMonth.expenses ?? 0} prev={fin.lastMonth.expenses ?? 0} invert />} />
        <StatCard label="Net (month)" value={money(net)} icon={net >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />} tone={net >= 0 ? 'green' : 'red'} loading={fin.loading} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Widget id="Cash flow"><Card className="xl:col-span-2"><CardHeader title="Cash flow" subtitle="Last 6 months" icon={<TrendingUp className="h-4 w-4" />} /><RevenueChart data={fin.series} loading={fin.loading} /></Card></Widget>
        <Widget id="Collections by method"><Card><CardHeader title="Collections by method" icon={<CreditCard className="h-4 w-4" />} /><Donut data={fin.methods} loading={fin.loading} formatter={money} height={290} /></Card></Widget>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ListCard title="Overdue invoices" icon={<AlertTriangle className="h-4 w-4" />} link="/invoices?status=overdue" loading={fin.loading} empty={!overdue.length} emptyText="No overdue invoices 🎉">
          {overdue.slice(0, 6).map((i) => <ListRow key={i.id} to={`/invoices/${i.id}`} left={<div><div className="text-sm font-medium text-slate-800">{i.invoice_number} · {pLk.get(i.patient_id)?.full_name}</div><div className="text-xs text-slate-500">Due {fmtDate(i.due_date)} · {ago(i.due_date)}</div></div>} right={<span className="text-sm font-semibold text-rose-600">{money(invoiceBalance(i))}</span>} />)}
        </ListCard>
        <ListCard title="Recent payments" icon={<CreditCard className="h-4 w-4" />} link="/payments" loading={fin.loading} empty={!recent.length}>
          {recent.map((p) => <ListRow key={p.id} to={`/invoices/${p.invoice_id}`} left={<div className="flex items-center gap-3"><Avatar name={pLk.get(p.patient_id)?.full_name} size="sm" /><div><div className="text-sm font-medium text-slate-800">{pLk.get(p.patient_id)?.full_name}</div><div className="text-xs text-slate-500">{fmtDate(p.paid_on)} · {p.method === 'upi' ? 'UPI' : titleCase(p.method)}</div></div></div>} right={<span className="text-sm font-semibold text-emerald-700">+{moneyCompact(p.amount)}</span>} />)}
        </ListCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- STAFF
function StaffDashboard() {
  const { user } = useAuth()
  const labs = useTable('lab_tests')
  const admissions = useTable('admissions')
  const inventory = useTable('inventory')
  const beds = useTable('beds')
  const pLk = useLookup('patients')
  const bLk = useLookup('beds')
  const upd = useUpdate('lab_tests', { label: 'Lab test' })
  const pending = (labs.data ?? []).filter((l) => ['requested', 'sample_collected', 'in_progress'].includes(l.status)).sort((a, b) => (a.priority === 'stat' ? -1 : b.priority === 'stat' ? 1 : a.requested_on.localeCompare(b.requested_on)))
  const inpatients = (admissions.data ?? []).filter((a) => a.status === 'admitted')
  const low = (inventory.data ?? []).filter((i) => i.quantity <= i.reorder_level)
  const nextStatus = { requested: 'sample_collected', sample_collected: 'in_progress' } as const
  return (
    <div>
      <Greeting name={user!.full_name} subtitle="Ward, lab and pharmacy tasks at a glance." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="Admitted patients" value={inpatients.length} icon={<BedDouble className="h-5 w-5" />} loading={admissions.isLoading} />
        <StatCard label="Pending lab tests" value={pending.length} icon={<FlaskConical className="h-5 w-5" />} tone="violet" loading={labs.isLoading} hint={`${pending.filter((p) => p.priority !== 'routine').length} urgent / STAT`} />
        <StatCard label="Low stock items" value={low.length} icon={<Package className="h-5 w-5" />} tone="red" loading={inventory.isLoading} />
        <StatCard label="Beds available" value={(beds.data ?? []).filter((b) => b.status === 'available').length} icon={<BedDouble className="h-5 w-5" />} tone="green" loading={beds.isLoading} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <ListCard title="Lab work queue" subtitle="STAT & urgent first" icon={<FlaskConical className="h-4 w-4" />} link="/lab-tests" loading={labs.isLoading} empty={!pending.length} emptyText="Lab queue is clear" className="xl:col-span-2">
          {pending.slice(0, 8).map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm font-medium text-slate-800">{l.test_name}{l.priority !== 'routine' && <StatusBadge value={l.priority} />}</div><div className="text-xs text-slate-500">{pLk.get(l.patient_id)?.full_name} · {fmtDate(l.requested_on, 'dd MMM')}</div></div>
              <StatusBadge value={l.status} />
              {l.status in nextStatus ? <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => upd.mutate({ id: l.id, patch: { status: nextStatus[l.status as keyof typeof nextStatus] } })}>{l.status === 'requested' ? 'Collect' : 'Process'}</Button> : <Link to="/lab-tests?status=in_progress"><Button size="sm" variant="outline" className="hidden sm:inline-flex">Add result</Button></Link>}
            </div>
          ))}
        </ListCard>
        <ListCard title="Low stock" icon={<Package className="h-4 w-4" />} link="/inventory?stock=low" loading={inventory.isLoading} empty={!low.length} emptyText="Stock levels healthy">
          {low.map((i) => <ListRow key={i.id} left={<div><div className="text-sm font-medium text-slate-800">{i.name}</div><div className="text-xs text-slate-500">{i.sku}</div></div>} right={<Badge tone="red">{i.quantity} {i.unit}</Badge>} />)}
        </ListCard>
      </div>
      <div className="mt-6">
        <ListCard title="Ward patients" icon={<ClipboardList className="h-4 w-4" />} link="/admissions?status=admitted" loading={admissions.isLoading} empty={!inpatients.length}>
          <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">
            {inpatients.map((a) => <ListRow key={a.id} to={`/patients/${a.patient_id}`} left={<div className="flex items-center gap-3"><Avatar name={pLk.get(a.patient_id)?.full_name} size="sm" /><div><div className="text-sm font-medium text-slate-800">{pLk.get(a.patient_id)?.full_name}</div><div className="text-xs text-slate-500">{a.reason}</div></div></div>} right={<Badge tone="violet">{bLk.get(a.bed_id ?? '')?.bed_number}</Badge>} />)}
          </div>
        </ListCard>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- PATIENT
function PatientDashboard() {
  const { user } = useAuth()
  const { t } = useT()
  const site = useSiteSettings()
  const me = useMe()
  const appts = useTable('appointments')
  const rx = useTable('prescriptions')
  const labs = useTable('lab_tests')
  const invoices = useTable('invoices')
  const notices = useTable('notices')
  const feedback = useTable('visit_feedback')
  const dLk = useLookup('doctors')
  const deptLk = useLookup('departments')
  const pid = me.patient?.id
  const td = today()
  const mine = (appts.data ?? []).filter((a) => a.patient_id === pid)
  const upcoming = mine.filter((a) => a.appointment_date >= td && ['scheduled', 'confirmed', 'checked_in'].includes(a.status)).sort((a, b) => (a.appointment_date + a.appointment_time).localeCompare(b.appointment_date + b.appointment_time))
  const next = upcoming[0]
  const rated = new Set((feedback.data ?? []).map((f) => f.appointment_id))
  const since = format(addDays(new Date(), -60), 'yyyy-MM-dd')
  const toRate = feedback.isLoading ? undefined : mine.filter((a) => a.status === 'completed' && a.appointment_date >= since && !rated.has(a.id)).sort((a, b) => b.appointment_date.localeCompare(a.appointment_date))[0]
  const myRx = (rx.data ?? []).filter((r) => r.patient_id === pid).sort((a, b) => b.prescribed_on.localeCompare(a.prescribed_on))
  const myLabs = (labs.data ?? []).filter((l) => l.patient_id === pid).sort((a, b) => b.requested_on.localeCompare(a.requested_on))
  const due = (invoices.data ?? []).filter((i) => i.patient_id === pid && !['cancelled', 'draft'].includes(i.status)).reduce((s, i) => s + invoiceBalance(i), 0)
  const loading = me.loading || appts.isLoading
  const nextDoc = next ? dLk.get(next.doctor_id) : undefined
  const STATUS: Record<string, string> = { scheduled: t('Scheduled'), confirmed: t('Confirmed'), checked_in: t('Checked in') }

  return (
    <div>
      <Greeting t={t} name={user!.full_name} subtitle={me.patient ? `MRN ${me.patient.mrn} · ${me.patient.blood_group ?? ''} ${me.patient.insurance_provider ? '· ' + me.patient.insurance_provider : ''}` : t('Welcome to your patient portal')}>
        <Link to="/doctors"><Button variant="outline" icon={<Stethoscope className="h-4 w-4" />}>{t('Find a doctor')}</Button></Link>
        <Link to="/appointments?new=1"><Button icon={<CalendarPlus className="h-4 w-4" />}>{t('Book appointment')}</Button></Link>
      </Greeting>

      <div className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-800 to-brand-950 p-6 text-white shadow-lg">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <HeartPulse className="absolute bottom-4 right-6 h-24 w-24 text-white/10" />
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-100">{t('Next appointment')}</p>
        {loading ? <div className="mt-3 h-8 w-64 animate-pulse rounded bg-white/20" /> : next ? (
          <div className="relative mt-2">
            <h2 className="text-2xl font-semibold">{format(parseISO(next.appointment_date), 'EEEE, d MMMM')} · {fmtTime(next.appointment_time)}</h2>
            <p className="mt-1 text-brand-100">{nextDoc?.full_name} · {deptLk.get(nextDoc?.department_id ?? '')?.name} · <span>{STATUS[next.status] ?? next.status}</span></p>
            {next.reason && <p className="mt-3 inline-block rounded-lg bg-white/10 px-3 py-1.5 text-sm">{next.reason}</p>}
            {['scheduled', 'confirmed'].includes(next.status) && (
              <div className="mt-4"><Link to={`/appointments?reschedule=${next.id}`}><Button variant="secondary" size="sm" className="bg-white/15 text-white hover:bg-white/25" icon={<CalendarClock className="h-4 w-4" />}>{t('Reschedule')}</Button></Link></div>
            )}
          </div>
        ) : (
          <div className="relative mt-2"><h2 className="text-xl font-semibold">{t('No upcoming appointments')}</h2><p className="mt-1 text-brand-100">{t('Book a consultation with one of our specialists.')}</p>
            <Link to="/appointments?new=1"><Button variant="secondary" className="mt-4 bg-white text-brand-950 hover:bg-brand-50">{t('Book now')}</Button></Link></div>
        )}
      </div>

      {toRate && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-600"><Star className="h-5 w-5 fill-amber-400" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">{t('How was your visit with {doctor}?', { doctor: dLk.get(toRate.doctor_id)?.full_name ?? t('the doctor') })}</p>
            <p className="text-sm text-slate-600">{t('Rate it in 10 seconds — it helps us improve.')}</p>
          </div>
          <Link to={`/appointments?rate=${toRate.id}`}><Button size="sm">{t('Rate visit')}</Button></Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard widgetId="Upcoming visits" label={t('Upcoming visits')} value={upcoming.length} icon={<CalendarCheck className="h-5 w-5" />} loading={loading} />
        <StatCard widgetId="Prescriptions" label={t('Prescriptions')} value={myRx.length} icon={<Pill className="h-5 w-5" />} tone="violet" loading={rx.isLoading} />
        <StatCard widgetId="Lab reports" label={t('Lab reports')} value={myLabs.filter((l) => l.status === 'completed').length} icon={<FlaskConical className="h-5 w-5" />} tone="blue" loading={labs.isLoading} hint={t('{n} in progress', { n: myLabs.filter((l) => l.status !== 'completed' && l.status !== 'cancelled').length })} />
        <StatCard widgetId="Amount due" label={t('Amount due')} value={money(due)} icon={<Receipt className="h-5 w-5" />} tone={due > 0 ? 'amber' : 'green'} loading={invoices.isLoading} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ListCard widgetId="Recent prescriptions" title={t('Recent prescriptions')} icon={<Pill className="h-4 w-4" />} link="/prescriptions" linkLabel={t('View all')} loading={rx.isLoading} empty={!myRx.length} emptyText={t('No prescriptions yet')}>
          {myRx.slice(0, 4).map((r) => <ListRow key={r.id} to={`/prescriptions/${r.id}`} left={<div><div className="text-sm font-medium text-slate-800">{r.diagnosis}</div><div className="text-xs text-slate-500">{dLk.get(r.doctor_id)?.full_name} · {t('{n} medicines', { n: r.medications.length })}</div></div>} right={<span className="text-xs text-slate-500">{fmtDate(r.prescribed_on, 'dd MMM')}</span>} />)}
        </ListCard>
        <ListCard widgetId="Lab reports list" title={t('Lab reports')} icon={<FlaskConical className="h-4 w-4" />} link="/lab-tests" linkLabel={t('View all')} loading={labs.isLoading} empty={!myLabs.length} emptyText={t('No lab tests yet')}>
          {myLabs.slice(0, 4).map((l) => <ListRow key={l.id} left={<div className="min-w-0"><div className="text-sm font-medium text-slate-800">{l.test_name}</div><div className="max-w-xs truncate text-xs text-slate-500">{l.result ?? t('Awaiting result')}</div></div>}
            right={l.status === 'completed'
              ? <button type="button" onClick={() => downloadLabReport(l, { site, patient: me.patient, doctor: l.doctor_id ? dLk.get(l.doctor_id)?.full_name : null })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50" aria-label={`${t('Download')} ${l.test_name}`}><FileDown className="h-3.5 w-3.5" />PDF</button>
              : <StatusBadge value={l.status} />} />)}
        </ListCard>
      </div>
      <div className="mt-6">
        <ListCard widgetId="Hospital notices" title={t('Hospital notices')} icon={<Megaphone className="h-4 w-4" />} link="/notices" linkLabel={t('View all')} loading={notices.isLoading} empty={!notices.data?.some((n) => n.audience === 'all' || n.audience === 'patients')} emptyText={t('Nothing here yet')}>
          {(notices.data ?? []).filter((n) => n.audience === 'all' || n.audience === 'patients').slice(0, 3).map((n) => <ListRow key={n.id} left={<div><div className="text-sm font-medium text-slate-800">{n.title}</div><div className="line-clamp-1 text-xs text-slate-500">{n.body}</div></div>} right={<span className="text-xs text-slate-400">{ago(n.published_on)}</span>} />)}
        </ListCard>
      </div>
    </div>
  )
}

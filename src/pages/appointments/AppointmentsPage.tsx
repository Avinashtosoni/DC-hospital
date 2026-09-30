/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import {
  AlertTriangle, ArrowRight, Ban, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock, Coffee, List, PartyPopper, Plus, UserRoundCheck,
} from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { ResourcePage, RowMenu } from '../../components/ResourcePage'
import { ResourceFormDrawer } from '../../components/ResourceForm'
import { Avatar, Button, PageHeader, Select, Skeleton, StatusBadge } from '../../components/ui'
import { useCreate, useTable, useUpdate } from '../../hooks/useData'
import { cn, fmtTime, num, today } from '../../lib/utils'
import {
  APPT_STYLE, LEAVE_LABEL, LEVEL, REST_LABEL, SLOTS, WEEKDAYS, blockAt, conflictOf, doctorSlots, holdsSlot, levelOf, summarizeDay,
  type DaySummary, type Level, type ScheduleExt,
} from '../../lib/schedule'
import { appointmentsRes } from '../../resources/definitions'
import { RateVisitDialog, RescheduleDialog } from './PatientDialogs'
import type { ResourceCtx, RowAction } from '../../resources/types'
import { useResourceCtx } from '../../resources/useResourceCtx'
import { useAppSettings } from '../../settings/AppSettingsProvider'
import type { Appointment, Doctor } from '../../types'

type View = 'month' | 'day' | 'list'
const VIEW_KEY = 'dch:appt-view'
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export default function AppointmentsPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const isPatient = user?.role === 'patient'
  // Deep links such as ?new=1&patient_id=… are handled by the list view, so they start there.
  const [view, setViewState] = useState<View>(() => {
    if (isPatient || params.get('new')) return 'list'
    const v = params.get('view') ?? localStorage.getItem(VIEW_KEY) ?? localStorage.getItem('dch:pref:appt-view')
    return v === 'day' || v === 'list' ? v : 'month'
  })
  const setView = (v: View) => {
    setViewState(v); localStorage.setItem(VIEW_KEY, v)
    const next = new URLSearchParams(params); next.set('view', v); setParams(next, { replace: true })
  }
  const switcher = isPatient ? null : <ViewSwitcher view={view} onChange={setView} />
  if (isPatient) {
    const close = (k: string) => () => { const next = new URLSearchParams(params); next.delete(k); setParams(next, { replace: true }) }
    return <>
      <ResourcePage def={appointmentsRes} />
      <RescheduleDialog id={params.get('reschedule')} onClose={close('reschedule')} />
      <RateVisitDialog id={params.get('rate')} onClose={close('rate')} />
    </>
  }
  if (view === 'list') return <ResourcePage def={appointmentsRes} headerExtra={switcher} />
  return <CalendarViews view={view} setView={setView} switcher={switcher} />
}

function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const items: [View, string, typeof List][] = [['month', 'Month', CalendarDays], ['day', 'Day', CalendarRange], ['list', 'List', List]]
  return (
    <div role="tablist" aria-label="Appointment view" className="inline-flex rounded-xl border border-brand-100 bg-white p-1 shadow-sm">
      {items.map(([v, label, Icon]) => (
        <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => onChange(v)}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition',
            view === v ? 'bg-brand-900 text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-900')}>
          <Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}

// ================================================================== calendar shell
function CalendarViews({ view, setView, switcher }: { view: Exclude<View, 'list'>; setView: (v: View) => void; switcher: ReactNode }) {
  const { ctx } = useResourceCtx(appointmentsRes.relations)
  const apptQ = useTable('appointments')
  const docQ = useTable('doctors')
  const deptQ = useTable('departments')
  const leaveQ = useTable('doctor_leaves')
  const holQ = useTable('holidays')
  const ext = useMemo<ScheduleExt>(() => ({ leaves: leaveQ.data ?? [], holidays: holQ.data ?? [] }), [leaveQ.data, holQ.data])
  const create = useCreate('appointments', { label: 'Appointment' })
  const update = useUpdate('appointments', { label: 'Appointment' })
  const [params, setParams] = useSearchParams()
  const role = ctx?.role
  const isDoctor = role === 'doctor'

  const cursor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today()
  const dept = params.get('dept') ?? ''
  const docId = params.get('doctor') ?? ''
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }) }
  const setCursor = (d: string) => setParam('date', d === today() ? '' : d)

  // ---- scope: doctors only see their own column; filters narrow everyone else
  const doctors = useMemo(() => {
    let d = (docQ.data ?? []).filter((x) => x.status !== 'inactive')
    if (isDoctor) d = d.filter((x) => x.id === ctx?.me.doctor?.id)
    if (dept) d = d.filter((x) => x.department_id === dept)
    if (docId) d = d.filter((x) => x.id === docId)
    return d.sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [docQ.data, isDoctor, ctx, dept, docId])
  const docSet = useMemo(() => new Set(doctors.map((d) => d.id)), [doctors])
  const appts = useMemo(() => (apptQ.data ?? []).filter((a) => docSet.has(a.doctor_id)), [apptQ.data, docSet])
  const byDate = useMemo(() => {
    const m = new Map<string, Appointment[]>()
    for (const a of appts) { const l = m.get(a.appointment_date); if (l) l.push(a); else m.set(a.appointment_date, [a]) }
    return m
  }, [appts])
  const summarize = (date: string) => summarizeDay(date, doctors, byDate.get(date) ?? [], ext)
  // upcoming bookings that clash with approved leave / holidays / blocked time (all doctors in scope)
  const clashes = useMemo(() => {
    const t = today()
    const docs = new Map((docQ.data ?? []).map((d) => [d.id, d]))
    return (apptQ.data ?? []).filter((a) => a.appointment_date >= t && (!isDoctor || a.doctor_id === ctx?.me.doctor?.id) && conflictOf(a, docs.get(a.doctor_id), ext))
  }, [apptQ.data, docQ.data, ext, isDoctor, ctx])

  // ---- create / edit drawer
  const [drawer, setDrawer] = useState<{ open: boolean; initial: Appointment | null; prefill: Record<string, any> }>({ open: false, initial: null, prefill: {} })
  const canCreate = can(role, 'appointments', 'create')
  const canUpdate = can(role, 'appointments', 'update')
  const openNew = (prefill: Record<string, any> = {}) => canCreate && setDrawer({ open: true, initial: null, prefill: { appointment_date: cursor, ...(docId ? { doctor_id: docId } : {}), ...prefill } })
  const openEdit = (a: Appointment) => canUpdate && setDrawer({ open: true, initial: a, prefill: {} })
  const submit = (values: Record<string, any>) => {
    if (!ctx) return
    const existing = drawer.initial ?? undefined
    const payload = appointmentsRes.beforeSave ? appointmentsRes.beforeSave(values, ctx, existing as any) : values
    setDrawer((d) => ({ ...d, open: false }))
    if (existing) update.mutate({ id: existing.id, patch: payload })
    else create.mutate(payload as never)
  }

  const loading = apptQ.isPending || docQ.isPending || !ctx
  const title = role === 'doctor' ? 'My Appointments' : 'Appointments'
  const label = view === 'month' ? format(parseISO(cursor), 'MMMM yyyy') : format(parseISO(cursor), 'EEEE, d MMMM yyyy')
  const step = (dir: 1 | -1) => setCursor(iso(view === 'month' ? addMonths(parseISO(cursor), dir) : addDays(parseISO(cursor), dir)))

  return (
    <div>
      <PageHeader title={title} description={isDoctor ? 'Your consultation calendar — bookings, free slots and rest days.' : 'Capacity at a glance — bookings, free slots and doctors on rest, by month or by day.'}
        actions={<>{switcher}{canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => openNew()} disabled={!ctx}>New appointment</Button>}</>} />

      {/* toolbar */}
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1">
          <IconBtn label={view === 'month' ? 'Previous month' : 'Previous day'} onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></IconBtn>
          <Button variant="outline" size="sm" onClick={() => setCursor(today())} disabled={cursor === today()}>Today</Button>
          <IconBtn label={view === 'month' ? 'Next month' : 'Next day'} onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></IconBtn>
        </div>
        <h2 className="min-w-0 font-display text-base font-semibold text-brand-950 sm:text-lg" aria-live="polite">{label}</h2>
        <input type="date" value={cursor} onChange={(e) => e.target.value && setCursor(e.target.value)} aria-label="Jump to date" className="input h-9 w-auto py-1 text-sm" />
        {!isDoctor && (
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <Select aria-label="Department" value={dept} onChange={(e) => { const n = new URLSearchParams(params); if (e.target.value) n.set('dept', e.target.value); else n.delete('dept'); n.delete('doctor'); setParams(n, { replace: true }) }} className="h-9 flex-1 py-1 text-sm sm:w-44 sm:flex-none">
              <option value="">All departments</option>
              {(deptQ.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select aria-label="Doctor" value={docId} onChange={(e) => setParam('doctor', e.target.value)} className="h-9 flex-1 py-1 text-sm sm:w-48 sm:flex-none">
              <option value="">All doctors</option>
              {(docQ.data ?? []).filter((d) => d.status !== 'inactive' && (!dept || d.department_id === dept)).sort((a, b) => a.full_name.localeCompare(b.full_name))
                .map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </Select>
          </div>
        )}
      </div>

      {!loading && clashes.length > 0 && canUpdate && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-rose-600 shadow-sm"><AlertTriangle className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{clashes.length} booked patient{clashes.length === 1 ? '' : 's'} need{clashes.length === 1 ? 's' : ''} rescheduling</p>
            <p className="text-xs text-rose-700/80">Their doctor is now on leave, blocked (surgery / meeting) or the OPD is closed for a holiday.</p>
          </div>
          <Link to="/schedule?tab=reschedule" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700">Open reschedule queue<ArrowRight className="h-4 w-4" /></Link>
        </div>
      )}

      {loading ? <CalendarSkeleton /> : view === 'month'
        ? <MonthView cursor={cursor} summarize={summarize} onPick={setCursor} ctx={ctx!} ext={ext} onOpenDay={(d) => { setCursor(d); setView('day') }} onNew={openNew} onEdit={openEdit} canCreate={canCreate} />
        : <DayView summary={summarize(cursor)} ctx={ctx!} ext={ext} onNew={openNew} onEdit={openEdit} canCreate={canCreate} />}

      {ctx && (
        <ResourceFormDrawer def={appointmentsRes} ctx={ctx} open={drawer.open} onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          initial={drawer.initial} prefill={drawer.prefill} rows={apptQ.data ?? []} onSubmit={submit} saving={create.isPending || update.isPending} />
      )}
    </div>
  )
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} aria-label={label} className="grid h-9 w-9 place-items-center rounded-lg text-brand-800 transition hover:bg-brand-50">{children}</button>
)

// ------------------------------------------------------------------ summary tiles + legend
function Totals({ items }: { items: { label: string; value: number | string; hint?: string; icon: typeof Clock; tone: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className="card relative overflow-hidden p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
              <p className="mt-1 font-display text-2xl font-bold text-brand-950">{t.value}</p>
              {t.hint && <p className="mt-0.5 truncate text-xs text-slate-500">{t.hint}</p>}
            </div>
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', t.tone)}><t.icon className="h-4 w-4" /></span>
          </div>
        </div>
      ))}
    </div>
  )
}
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {(['open', 'filling', 'busy', 'full', 'rest'] as Level[]).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', LEVEL[l].dot, l === 'rest' && 'ring-1 ring-slate-300')} />{LEVEL[l].label}</span>
      ))}
    </div>
  )
}
function CapacityBar({ used, total, level, className }: { used: number; total: number; level: Level; className?: string }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-[#ececf8]', className)} role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-label={`${used} of ${total} slots booked`}>
      <div className={cn('h-full rounded-full transition-all duration-500', LEVEL[level].bar)} style={{ width: `${pct}%` }} />
    </div>
  )
}
const hatch = 'bg-[repeating-linear-gradient(135deg,#f4f4fa_0_6px,#ffffff_6px_12px)]'

// ================================================================== month view
function MonthView({ cursor, summarize, onPick, onOpenDay, onNew, onEdit, canCreate, ctx, ext }: {
  cursor: string; summarize: (d: string) => DaySummary; onPick: (d: string) => void; onOpenDay: (d: string) => void
  onNew: (p?: Record<string, any>) => void; onEdit: (a: Appointment) => void; canCreate: boolean; ctx: ResourceCtx; ext: ScheduleExt
}) {
  const month = parseISO(cursor)
  const weekStartsOn = useAppSettings().settings.locale.weekStartsOn
  const heads = weekStartsOn === 0 ? ['Sun', ...WEEKDAYS.slice(0, 6)] : [...WEEKDAYS]
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn }), end: endOfWeek(endOfMonth(month), { weekStartsOn }) }).map(iso), [cursor, weekStartsOn]) // eslint-disable-line react-hooks/exhaustive-deps
  const sums = days.map(summarize)
  const inMonth = sums.filter((s) => isSameMonth(parseISO(s.date), month))
  const cap = inMonth.reduce((n, s) => n + s.capacity, 0)
  const booked = inMonth.reduce((n, s) => n + s.bookedInSlots, 0)
  const restDays = inMonth.filter((s) => s.capacity === 0).length
  const offDoctorDays = inMonth.reduce((n, s) => n + s.resting.length, 0)
  const holidays = inMonth.filter((s) => s.holiday).length
  const t = today()
  const selected = sums.find((s) => s.date === cursor) ?? summarize(cursor)

  return (
    <div className="space-y-4">
      <Totals items={[
        { label: 'Total slots', value: num(cap), hint: `${inMonth.length - restDays} OPD days this month`, icon: Clock, tone: 'bg-brand-50 text-brand-700' },
        { label: 'Booked', value: num(booked), hint: cap ? `${Math.round((booked / cap) * 100)}% utilisation` : '—', icon: UserRoundCheck, tone: 'bg-brand-900 text-white' },
        { label: 'Available', value: num(Math.max(0, cap - booked)), hint: 'Free slots left to book', icon: CalendarDays, tone: 'bg-emerald-50 text-emerald-600' },
        { label: 'Rest', value: restDays, hint: `${restDays === 1 ? 'day' : 'days'} closed${holidays ? ` (${holidays} holiday${holidays === 1 ? '' : 's'})` : ''} · ${num(offDoctorDays)} doctor-days off`, icon: Coffee, tone: 'bg-slate-100 text-slate-500' },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#efeff8] px-4 py-3">
            <Legend />
            <p className="hidden text-[11px] text-slate-400 md:block">Tap a day for details · double-click to open the day timeline</p>
          </div>
          <div className="grid grid-cols-7 border-b border-[#efeff8] bg-brand-50/60 text-center text-[11px] font-semibold uppercase tracking-wider text-brand-700/80">
            {heads.map((w) => <div key={w} className="py-2"><span className="sm:hidden">{w[0]}</span><span className="hidden sm:inline">{w}</span></div>)}
          </div>
          <div className="grid grid-cols-7">
            {sums.map((s, i) => {
              const d = parseISO(s.date)
              const out = !isSameMonth(d, month)
              const isToday = s.date === t
              const isSel = s.date === cursor
              const past = s.date < t
              const rest = s.level === 'rest'
              const chips = s.appointments.filter(holdsSlot)
              return (
                <button key={s.date} type="button" onClick={() => onPick(s.date)} onDoubleClick={() => onOpenDay(s.date)}
                  aria-label={`${format(d, 'EEEE d MMMM')}: ${s.holiday ? `holiday, ${s.holiday.name}` : rest ? 'rest day' : `${s.bookedInSlots} booked, ${s.available} available`}${s.conflicts ? `, ${s.conflicts} need rescheduling` : ''}`} aria-pressed={isSel}
                  className={cn('group relative flex min-h-[64px] flex-col gap-1 border-[#efeff8] p-1.5 text-left transition sm:min-h-[92px] sm:p-2 lg:min-h-[112px]',
                    i % 7 !== 6 && 'border-r', i < sums.length - 7 && 'border-b',
                    s.holiday ? 'bg-[repeating-linear-gradient(135deg,#fff7ed_0_6px,#ffffff_6px_12px)]' : rest ? hatch : 'bg-white hover:bg-brand-50/50', out && 'opacity-40', isSel && 'z-10 ring-2 ring-inset ring-brand-600')}>
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold',
                      isToday ? 'bg-brand-900 text-white' : past ? 'text-slate-400' : 'text-brand-950')}>{format(d, 'd')}</span>
                    <span className={cn('h-2 w-2 shrink-0 rounded-full sm:hidden', LEVEL[s.level].dot)} />
                    {!rest && <span className={cn('hidden rounded-full px-1.5 py-0.5 text-[10px] font-semibold sm:inline-block', LEVEL[s.level].soft, LEVEL[s.level].text)}>{s.bookedInSlots}/{s.capacity}</span>}
                    {rest && !s.holiday && <span className="hidden items-center gap-1 text-[10px] font-medium text-slate-400 sm:inline-flex"><Coffee className="h-3 w-3" />Rest</span>}
                  </div>
                  {s.holiday && <span className="line-clamp-2 inline-flex items-start gap-1 text-[10px] font-semibold leading-tight text-orange-700"><PartyPopper className="mt-px hidden h-3 w-3 shrink-0 sm:block" /><span className="hidden sm:inline">{s.holiday.name}</span><span className="sm:hidden">Hol.</span></span>}
                  {s.conflicts > 0 && <span title={`${s.conflicts} booking(s) need rescheduling`} className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded-full bg-rose-600 px-1.5 py-px text-[9px] font-bold text-white shadow-sm"><AlertTriangle className="h-2.5 w-2.5" />{s.conflicts}</span>}
                  {!rest && <>
                    <CapacityBar used={s.bookedInSlots} total={s.capacity} level={s.level} className="hidden sm:block" />
                    <p className="hidden text-[10px] leading-tight text-slate-500 sm:block"><b className="font-semibold text-slate-700">{s.available}</b> free{s.resting.length ? <> · <span className="text-slate-400">{s.resting.length} off</span></> : null}</p>
                    <div className="mt-auto hidden space-y-0.5 lg:block">
                      {chips.slice(0, 2).map((a) => (
                        <div key={a.id} className={cn('truncate rounded border-l-2 px-1 py-px text-[10px]', APPT_STYLE[a.status])}>
                          {a.appointment_time.slice(0, 5)} {ctx.lk.patients.get(a.patient_id)?.full_name.split(' ')[0] ?? ''}
                        </div>
                      ))}
                      {chips.length > 2 && <div className="px-1 text-[10px] font-medium text-brand-600">+{chips.length - 2} more</div>}
                    </div>
                  </>}
                </button>
              )
            })}
          </div>
        </div>
        <DayPanel s={selected} ctx={ctx} ext={ext} onOpenDay={() => onOpenDay(selected.date)} onNew={canCreate ? () => onNew({ appointment_date: selected.date }) : undefined} onEdit={onEdit} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ selected-day panel
function DayPanel({ s, ctx, ext, onOpenDay, onNew, onEdit }: { s: DaySummary; ctx: ResourceCtx; ext: ScheduleExt; onOpenDay: () => void; onNew?: () => void; onEdit: (a: Appointment) => void }) {
  const d = parseISO(s.date)
  const lv = LEVEL[s.level]
  return (
    <aside className="card h-fit overflow-hidden xl:sticky xl:top-20" aria-label="Selected day">
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-[#3a3a7a] to-brand-600 p-4 text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-300/25 blur-2xl" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-300">{format(d, 'EEEE')}</p>
        <p className="font-display text-xl font-semibold">{format(d, 'd MMMM yyyy')}</p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-white/15"><span className={cn('h-2 w-2 rounded-full', s.holiday ? 'bg-orange-400' : lv.dot)} />{s.holiday ? `Holiday · ${s.holiday.name}` : lv.label}</span>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[['Slots', s.capacity], ['Booked', s.bookedInSlots], ['Free', s.available], ['Rest', s.resting.length]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/10 py-1.5"><p className="text-base font-bold leading-tight">{v}</p><p className="text-[10px] text-brand-200">{k}</p></div>
          ))}
        </div>
      </div>
      <div className="space-y-4 p-4">
        {s.conflicts > 0 && (
          <Link to="/schedule?tab=reschedule" className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-100">
            <AlertTriangle className="h-4 w-4 shrink-0" /><span className="flex-1">{s.conflicts} booking{s.conflicts === 1 ? '' : 's'} on this day need{s.conflicts === 1 ? 's' : ''} rescheduling</span><ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" icon={<CalendarRange className="h-4 w-4" />} onClick={onOpenDay}>Day timeline</Button>
          {onNew && s.date >= today() && s.capacity > 0 && <Button size="sm" className="flex-1" icon={<Plus className="h-4 w-4" />} onClick={onNew}>Book</Button>}
        </div>

        {s.working.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand-600">On duty · {s.working.length}</p>
            <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {s.working.map((doc) => {
                const slots = doctorSlots(doc, s.date, ext).length
                const used = new Set(s.appointments.filter((a) => a.doctor_id === doc.id && holdsSlot(a)).map((a) => a.appointment_time.slice(0, 5))).size
                const l = levelOf(used, slots)
                return (
                  <li key={doc.id} className="flex items-center gap-2.5">
                    <Avatar name={doc.full_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium text-slate-800">{doc.full_name}</span><span className="shrink-0 text-slate-500">{used}/{slots}</span></div>
                      <CapacityBar used={used} total={slots} level={l} className="mt-1" />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {s.resting.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Resting · {s.resting.length}</p>
            <div className="flex flex-wrap gap-1.5">
              {s.resting.map(({ doctor, reason, leave }) => (
                <span key={doctor.id} title={leave?.reason ?? REST_LABEL[reason]} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset', reason === 'on_leave' || reason === 'leave' ? 'bg-amber-50 text-amber-700 ring-amber-200' : reason === 'holiday' ? 'bg-orange-50 text-orange-700 ring-orange-200' : 'bg-slate-50 text-slate-500 ring-slate-200')}>
                  {doctor.full_name.replace('Dr. ', 'Dr ')}<span className="text-[10px] opacity-70">· {leave ? LEAVE_LABEL[leave.kind] : REST_LABEL[reason]}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {s.blocks.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Blocked time · {s.blocks.length}</p>
            <ul className="space-y-1.5">
              {s.blocks.map((b) => (
                <li key={b.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                  <Ban className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate"><b className="font-medium text-slate-800">{ctx.lk.doctors.get(b.doctor_id)?.full_name ?? 'Doctor'}</b> · {LEAVE_LABEL[b.kind]}{b.reason ? ` — ${b.reason}` : ''}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{fmtTime(b.start_time!)}–{fmtTime(b.end_time!)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand-600">Appointments · {s.appointments.length}</p>
          {s.appointments.length === 0 ? (
            <p className="rounded-xl bg-brand-50/60 p-4 text-center text-xs text-slate-500">{s.capacity ? 'No bookings yet — every slot is free.' : 'OPD closed — no doctors on duty.'}</p>
          ) : (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {s.appointments.map((a) => <ApptRow key={a.id} a={a} ctx={ctx} onEdit={onEdit} conflict={conflictOf(a, ctx.lk.doctors.get(a.doctor_id), ext)} />)}
            </ul>
          )}
        </div>
      </div>
    </aside>
  )
}

function ApptRow({ a, ctx, onEdit, conflict }: { a: Appointment; ctx: ResourceCtx; onEdit: (a: Appointment) => void; conflict?: string | null }) {
  const actions = (appointmentsRes.rowActions?.(a as any, ctx) ?? []).filter(Boolean) as RowAction<any>[]
  return (
    <li title={conflict ? `Needs rescheduling: ${conflict}` : undefined} className={cn('flex items-center gap-2 rounded-lg border-l-[3px] py-1.5 pl-2 pr-1', APPT_STYLE[a.status], conflict && 'border-l-rose-500 ring-1 ring-inset ring-rose-200')}>
      <button type="button" onClick={() => onEdit(a)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="w-12 shrink-0 text-[11px] font-semibold tabular-nums">{fmtTime(a.appointment_time)}</span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{ctx.lk.patients.get(a.patient_id)?.full_name ?? 'Patient'}</span>
          <span className="block truncate text-[10px] opacity-70">{conflict ? <span className="font-semibold text-rose-600">⚠ Reschedule — {conflict}</span> : <>{ctx.lk.doctors.get(a.doctor_id)?.full_name}{a.source === 'website' && ' · 🌐 Online'}</>}</span>
        </span>
      </button>
      <span className="hidden shrink-0 sm:block"><StatusBadge value={a.status} /></span>
      {actions.length > 0 && <RowMenu row={a} actions={actions} ctx={ctx} />}
    </li>
  )
}

// ================================================================== day view (doctor × time grid)
function DayView({ summary: s, ctx, ext, onNew, onEdit, canCreate }: { summary: DaySummary; ctx: ResourceCtx; ext: ScheduleExt; onNew: (p?: Record<string, any>) => void; onEdit: (a: Appointment) => void; canCreate: boolean }) {
  const t = today()
  const [now, setNow] = useState(() => format(new Date(), 'HH:mm'))
  useEffect(() => { const id = setInterval(() => setNow(format(new Date(), 'HH:mm')), 60_000); return () => clearInterval(id) }, [])
  const nowSlot = s.date === t ? SLOTS.filter((x) => x <= now).pop() : undefined
  const nowRow = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Centre the current time inside the grid only — never scroll the page itself.
  useEffect(() => {
    const box = scroller.current, row = nowRow.current
    if (box) box.scrollTop = row ? Math.max(0, row.offsetTop - box.clientHeight / 2) : 0
  }, [s.date])

  // Doctors with bookings on the day are shown even when resting (e.g. booked before leave was set).
  const cols: { doc: Doctor; slots: Set<string> }[] = useMemo(() => {
    const ids = new Set(s.working.map((d) => d.id))
    const extra = s.resting.filter((r) => s.appointments.some((a) => a.doctor_id === r.doctor.id && holdsSlot(a))).map((r) => r.doctor)
    return [...s.working, ...extra.filter((d) => !ids.has(d.id))].map((doc) => ({ doc, slots: new Set(doctorSlots(doc, s.date, ext)) }))
  }, [s, ext])
  const rows = useMemo(() => {
    const used = new Set<string>()
    cols.forEach((c) => c.slots.forEach((x) => used.add(x)))
    s.blocks.forEach((b) => SLOTS.forEach((x) => { if (x >= b.start_time! && x < b.end_time! && cols.some((c) => c.doc.id === b.doctor_id)) used.add(x) }))
    s.appointments.forEach((a) => used.add(a.appointment_time.slice(0, 5)))
    if (!used.size) return []
    const idx = [...used].map((x) => SLOTS.indexOf(x)).filter((i) => i >= 0)
    return SLOTS.slice(Math.min(...idx), Math.max(...idx) + 1)
  }, [cols, s.appointments])
  const cell = (docId: string, time: string) => s.appointments.filter((a) => a.doctor_id === docId && a.appointment_time.slice(0, 5) === time)

  return (
    <div className="space-y-4">
      <Totals items={[
        { label: 'Total slots', value: s.capacity, hint: `${s.working.length} doctor${s.working.length === 1 ? '' : 's'} on duty`, icon: Clock, tone: 'bg-brand-50 text-brand-700' },
        { label: 'Booked', value: s.bookedInSlots, hint: s.cancelled ? `${s.cancelled} cancelled / no-show` : s.capacity ? `${Math.round((s.bookedInSlots / s.capacity) * 100)}% utilisation` : '—', icon: UserRoundCheck, tone: 'bg-brand-900 text-white' },
        { label: 'Available', value: s.available, hint: s.date < t ? 'Day is over' : 'Free slots to book', icon: CalendarDays, tone: 'bg-emerald-50 text-emerald-600' },
        { label: 'Rest', value: s.resting.length, hint: s.holiday ? `Holiday — ${s.holiday.name}` : s.resting.length ? `${s.resting.filter((r) => r.reason === 'on_leave' || r.reason === 'leave').length} on leave · ${s.resting.filter((r) => r.reason === 'weekly_off').length} weekly off` : 'Everyone is on duty', icon: Coffee, tone: 'bg-slate-100 text-slate-500' },
      ]} />

      {cols.length === 0 ? (
        <div className={cn('card grid place-items-center px-6 py-16 text-center', hatch)}>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm">{s.holiday ? <PartyPopper className="h-6 w-6 text-orange-500" /> : <Coffee className="h-6 w-6" />}</span>
          <p className="mt-3 font-semibold text-brand-950">{s.holiday ? `${s.holiday.name} — OPD closed` : 'Rest day — OPD closed'}</p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">{s.holiday ? (s.holiday.note || 'Hospital holiday. Emergency & pharmacy stay open 24×7.') : s.resting.some((r) => r.reason === 'leave') ? 'The doctor(s) matching the filters are on leave this day.' : `No doctor matching the filters works on ${format(parseISO(s.date), 'EEEE')}s. Try another day or clear the filters.`}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#efeff8] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border-l-[3px] border-l-brand-900 bg-brand-100" />Booked</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-dashed border-emerald-400 bg-emerald-50/50" />Available</span>
              <span className={cn('inline-flex items-center gap-1.5')}><span className={cn('h-3 w-5 rounded border border-slate-200', hatch)} />Off shift / rest</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-slate-200/80" />Blocked</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border-l-[3px] border-l-rose-500 bg-rose-50 ring-1 ring-inset ring-rose-200" />Needs rescheduling</span>
            </div>
            {canCreate && s.date >= t && <p className="text-[11px] text-slate-400">Click a free slot to book it</p>}
          </div>
          <div ref={scroller} className="scrollbar-thin relative max-h-[70vh] overflow-auto">
            <div className="grid" style={{ gridTemplateColumns: `72px repeat(${cols.length}, minmax(168px, 1fr))` }}>
              {/* header row */}
              <div className="sticky left-0 top-0 z-30 border-b border-r border-[#efeff8] bg-white" />
              {cols.map(({ doc, slots }) => {
                const used = new Set(s.appointments.filter((a) => a.doctor_id === doc.id && holdsSlot(a) && slots.has(a.appointment_time.slice(0, 5))).map((a) => a.appointment_time.slice(0, 5))).size
                const resting = slots.size === 0
                return (
                  <div key={doc.id} className="sticky top-0 z-20 border-b border-r border-[#efeff8] bg-white/95 p-2.5 backdrop-blur last:border-r-0">
                    <div className="flex items-center gap-2">
                      <Avatar name={doc.full_name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-brand-950">{doc.full_name}</p>
                        <p className="truncate text-[10px] text-slate-500">{ctx.lk.departments.get(doc.department_id ?? '')?.name ?? doc.specialization}</p>
                      </div>
                    </div>
                    {resting ? <p className="mt-2 text-[10px] font-medium text-amber-600">{(() => { const r = s.resting.find((x) => x.doctor.id === doc.id); return r ? `${r.leave ? LEAVE_LABEL[r.leave.kind] : REST_LABEL[r.reason]} — bookings need moving` : 'Resting today' })()}</p> : <>
                      <CapacityBar used={used} total={slots.size} level={levelOf(used, slots.size)} className="mt-2" />
                      <p className="mt-1 text-[10px] text-slate-500"><b className="text-slate-700">{used}</b>/{slots.size} booked · <b className="text-emerald-600">{slots.size - used}</b> free</p>
                    </>}
                  </div>
                )
              })}
              {/* slot rows */}
              {rows.map((time) => {
                const isNow = time === nowSlot
                return [
                  <div key={time} ref={isNow ? nowRow : undefined} className={cn('sticky left-0 z-10 border-b border-r border-[#efeff8] bg-white px-2 py-2 text-right text-[11px] font-medium tabular-nums', isNow ? 'text-brand-900' : 'text-slate-400')}>
                    {fmtTime(time)}{isNow && <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wider text-rose-500">Now</span>}
                  </div>,
                  ...cols.map(({ doc, slots }) => {
                    const list = cell(doc.id, time)
                    const active = list.filter(holdsSlot)
                    const inShift = slots.has(time)
                    const block = blockAt(doc.id, s.date, time, ext)
                    const blockStart = block && (time === block.start_time || time === rows[0])
                    const past = s.date < t || (s.date === t && time < (nowSlot ?? ''))
                    return (
                      <div key={doc.id + time} className={cn('relative min-h-[52px] border-b border-r border-[#efeff8] p-1 last:border-r-0', !inShift && !block && !active.length && hatch, isNow && 'bg-rose-50/30')}>
                        {isNow && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-rose-400/70" />}
                        {block && !active.length && (
                          <div title={`${LEAVE_LABEL[block.kind]} ${block.start_time}–${block.end_time}${block.reason ? ` · ${block.reason}` : ''}`} className="flex h-full min-h-[40px] items-center gap-1 rounded-md bg-slate-200/70 px-2 text-[10px] font-medium text-slate-600">
                            {blockStart ? <><Ban className="h-3 w-3 shrink-0" /><span className="truncate">{LEAVE_LABEL[block.kind]}{block.reason ? ` · ${block.reason}` : ''}</span></> : <span className="sr-only">{LEAVE_LABEL[block.kind]}</span>}
                          </div>
                        )}
                        {list.map((a) => {
                          const clash = conflictOf(a, doc, ext)
                          return (
                            <button key={a.id} type="button" onClick={() => onEdit(a)} title={clash ? `Needs rescheduling: ${clash}` : `${fmtTime(a.appointment_time)} · ${a.reason ?? ''}`}
                              className={cn('mb-0.5 block w-full rounded-md border-l-[3px] px-2 py-1 text-left transition hover:shadow-sm', APPT_STYLE[a.status], clash && 'border-l-rose-500 ring-1 ring-inset ring-rose-300', !holdsSlot(a) && active.length && 'hidden')}>
                              <span className="flex items-center gap-1 truncate text-[11px] font-semibold">{clash && <AlertTriangle className="h-3 w-3 shrink-0 text-rose-600" />}<span className="truncate">{ctx.lk.patients.get(a.patient_id)?.full_name ?? 'Patient'}</span></span>
                              <span className="block truncate text-[10px] capitalize opacity-70">{clash ? 'Reschedule needed' : <>{a.status.replace('_', ' ')} · {a.type.replace('_', ' ')}{a.source === 'website' && ' · online'}</>}</span>
                            </button>
                          )
                        })}
                        {inShift && !active.length && (canCreate && !past ? (
                          <button type="button" onClick={() => onNew({ doctor_id: doc.id, appointment_date: s.date, appointment_time: time })} aria-label={`Book ${doc.full_name} at ${fmtTime(time)}`}
                            className="group grid h-full min-h-[40px] w-full place-items-center rounded-md border border-dashed border-emerald-300/70 bg-emerald-50/40 text-[11px] font-medium text-emerald-600/50 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:text-emerald-700">
                            <span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Book</span>
                          </button>
                        ) : !list.length && <div className={cn('grid h-full min-h-[40px] place-items-center rounded-md text-[10px]', past ? 'text-slate-300' : 'border border-dashed border-emerald-300/70 bg-emerald-50/40 text-emerald-700')}>{past ? '—' : 'Free'}</div>)}
                      </div>
                    )
                  }),
                ]
              })}
            </div>
          </div>
          {s.resting.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[#efeff8] bg-brand-50/40 px-4 py-2.5 text-[11px] text-slate-500">
              <Coffee className="h-3.5 w-3.5" />Resting today:
              {s.resting.map(({ doctor, reason, leave }) => <span key={doctor.id} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-inset ring-slate-200">{doctor.full_name} · {leave ? LEAVE_LABEL[leave.kind] : REST_LABEL[reason]}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[560px] rounded-2xl" />
        <Skeleton className="hidden h-[560px] rounded-2xl xl:block" />
      </div>
    </div>
  )
}


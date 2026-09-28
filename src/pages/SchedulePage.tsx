/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import {
  AlertTriangle, CalendarCheck2, CalendarClock, CalendarOff, CheckCheck, Globe, MessageCircle, PartyPopper, Phone, Search, XCircle,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { ResourcePage } from '../components/ResourcePage'
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, Modal, PageHeader, Select, Skeleton } from '../components/ui'
import { useTable, useUpdate } from '../hooks/useData'
import { conflictOf, freeSlots, type ScheduleExt } from '../lib/schedule'
import { HOSPITAL, ago, cn, fmtDate, fmtTime, today } from '../lib/utils'
import { holidaysRes, leavesRes } from '../resources/definitions'
import { useResourceCtx } from '../resources/useResourceCtx'
import type { Appointment, Doctor, Patient } from '../types'

type Tab = 'leave' | 'holidays' | 'reschedule'

export default function SchedulePage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'holidays' || raw === 'reschedule' ? raw : 'leave'
  const setTab = (t: Tab) => setParams(t === 'leave' ? {} : { tab: t }, { replace: false })

  // badge counts (shared react-query cache with the tabs below)
  const leaves = useTable('doctor_leaves').data ?? []
  const holidays = useTable('holidays').data ?? []
  const appts = useTable('appointments').data ?? []
  const docs = useTable('doctors').data ?? []
  const me = docs.find((d) => d.profile_id === user?.id)
  const isDoctor = user?.role === 'doctor'
  const ext = useMemo<ScheduleExt>(() => ({ leaves, holidays }), [leaves, holidays])
  const clashes = useMemo(() => {
    const t = today(); const byId = new Map(docs.map((d) => [d.id, d]))
    return appts.filter((a) => a.appointment_date >= t && (!isDoctor || a.doctor_id === me?.id) && conflictOf(a, byId.get(a.doctor_id), ext)).length
  }, [appts, docs, ext, isDoctor, me])
  const pending = leaves.filter((l) => l.status === 'pending' && (!isDoctor || l.doctor_id === me?.id)).length
  const upcomingHol = holidays.filter((h) => h.holiday_date >= today()).length

  const tabs = (
    <div role="tablist" aria-label="Schedule sections" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-[#e6e6f5] bg-white p-1 shadow-sm">
      {([
        ['leave', isDoctor ? 'My leave & blocks' : 'Leave & blocked time', CalendarOff, pending, 'bg-amber-100 text-amber-800'],
        ['holidays', 'Holidays', PartyPopper, upcomingHol, 'bg-brand-100 text-brand-800'],
        ['reschedule', 'Reschedule queue', CalendarClock, clashes, 'bg-rose-600 text-white'],
      ] as [Tab, string, typeof CalendarOff, number, string][]).map(([v, label, Icon, n, tone]) => (
        <button key={v} role="tab" type="button" aria-selected={tab === v} onClick={() => setTab(v)}
          className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition',
            tab === v ? 'bg-brand-900 text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-900')}>
          <Icon className="h-4 w-4" />{label}
          {n > 0 && <span className={cn('min-w-5 rounded-full px-1.5 text-[10px] font-bold leading-4', tab === v && v !== 'reschedule' ? 'bg-white/20 text-white' : tone)}>{n}</span>}
        </button>
      ))}
    </div>
  )

  if (tab === 'leave') return <ResourcePage key="leave" def={leavesRes} headerExtra={tabs} />
  if (tab === 'holidays') return <ResourcePage key="holidays" def={holidaysRes} headerExtra={tabs} />
  return <RescheduleQueue tabs={tabs} />
}

// ================================================================== reschedule queue
const waDigits = (phone?: string | null) => { const d = (phone ?? '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d }
const shortWhy = (why: string) => why.replace(/^Dr\.[^—]+— /, '').replace(/^Hospital holiday — /, '')

function RescheduleQueue({ tabs }: { tabs: ReactNode }) {
  const { ctx } = useResourceCtx(['patients', 'doctors', 'departments', 'doctor_leaves', 'holidays'])
  const apptQ = useTable('appointments')
  const leaveQ = useTable('doctor_leaves')
  const holQ = useTable('holidays')
  const update = useUpdate('appointments', { label: 'Appointment', silent: true })
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<'all' | 'todo' | 'contacted'>('all')
  const [moving, setMoving] = useState<{ a: Appointment; why: string } | null>(null)
  const [cancelling, setCancelling] = useState<{ a: Appointment; why: string } | null>(null)
  const docFilter = params.get('doctor') ?? ''
  const role = ctx?.role
  const canAct = can(role, 'appointments', 'update')
  const ext = useMemo<ScheduleExt>(() => ({ leaves: leaveQ.data ?? [], holidays: holQ.data ?? [] }), [leaveQ.data, holQ.data])

  const items = useMemo(() => {
    if (!ctx) return []
    const t = today()
    return (apptQ.data ?? [])
      .filter((a) => a.appointment_date >= t && (role !== 'doctor' || a.doctor_id === ctx.me.doctor?.id) && (!docFilter || a.doctor_id === docFilter))
      .map((a) => ({ a, why: conflictOf(a, ctx.lk.doctors.get(a.doctor_id), ext) }))
      .filter((x): x is { a: Appointment; why: string } => !!x.why)
      .sort((x, y) => (x.a.appointment_date + x.a.appointment_time).localeCompare(y.a.appointment_date + y.a.appointment_time))
  }, [apptQ.data, ctx, ext, docFilter, role])

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase()
    return items.filter(({ a }) => {
      if (show === 'todo' && a.contacted_at) return false
      if (show === 'contacted' && !a.contacted_at) return false
      if (!s || !ctx) return true
      const p = ctx.lk.patients.get(a.patient_id)
      return `${p?.full_name} ${p?.phone} ${p?.mrn} ${ctx.lk.doctors.get(a.doctor_id)?.full_name} ${a.booking_ref ?? ''}`.toLowerCase().includes(s)
    })
  }, [items, search, show, ctx])
  const groups = useMemo(() => {
    const m = new Map<string, typeof visible>()
    visible.forEach((x) => { const l = m.get(x.a.appointment_date); if (l) l.push(x); else m.set(x.a.appointment_date, [x]) })
    return [...m.entries()]
  }, [visible])
  const docsInQueue = useMemo(() => [...new Set(items.map((x) => x.a.doctor_id))], [items])
  const contacted = items.filter((x) => x.a.contacted_at).length

  const markContacted = (a: Appointment) => {
    update.mutate({ id: a.id, patch: { contacted_at: a.contacted_at ? null : new Date().toISOString() } })
    toast.success(a.contacted_at ? 'Marked as not contacted' : 'Marked as contacted')
  }
  const whatsapp = (a: Appointment, why: string) => {
    if (!ctx) return
    const p = ctx.lk.patients.get(a.patient_id), d = ctx.lk.doctors.get(a.doctor_id)
    const msg = `Namaste ${p?.full_name.split(' ')[0] ?? ''}, this is ${HOSPITAL.name}. Your appointment with ${d?.full_name ?? 'the doctor'} on ${fmtDate(a.appointment_date, 'EEE, d MMM')} at ${fmtTime(a.appointment_time)} needs to be moved (${shortWhy(why)}). Please reply with a convenient day/time, or call us on ${HOSPITAL.phone}. We are sorry for the inconvenience.`
    window.open(`https://wa.me/${waDigits(p?.phone)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
    if (!a.contacted_at) update.mutate({ id: a.id, patch: { contacted_at: new Date().toISOString() } })
  }

  return (
    <div>
      <PageHeader title={role === 'doctor' ? 'My Leave & Blocked Time' : 'Leave & Holidays'}
        description="Upcoming bookings that clash with approved leave, blocked time or a hospital holiday. Contact each patient, then move or cancel the booking." actions={tabs} />

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          ['Need rescheduling', items.length, 'bg-rose-50 text-rose-600', AlertTriangle],
          ['Not contacted yet', items.length - contacted, 'bg-amber-50 text-amber-600', Phone],
          ['Contacted', contacted, 'bg-emerald-50 text-emerald-600', CheckCheck],
        ].map(([label, n, tone, Icon]: any) => (
          <div key={label} className="card flex items-center gap-3 p-3 sm:p-4">
            <span className={cn('hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid', tone)}><Icon className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="font-display text-xl font-bold text-brand-950 sm:text-2xl">{n}</p><p className="truncate text-[11px] font-medium text-slate-500 sm:text-xs">{label}</p></div>
          </div>
        ))}
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, phone, MRN, booking ref…" className="input h-9 pl-9 text-sm" aria-label="Search queue" />
        </div>
        {role !== 'doctor' && (
          <Select aria-label="Doctor" value={docFilter} onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); if (e.target.value) n.set('doctor', e.target.value); else n.delete('doctor'); return n }, { replace: true })} className="h-9 w-auto py-1 text-sm">
            <option value="">All doctors</option>
            {docsInQueue.map((id) => <option key={id} value={id}>{ctx?.lk.doctors.get(id)?.full_name}</option>)}
          </Select>
        )}
        <Select aria-label="Contact status" value={show} onChange={(e) => setShow(e.target.value as any)} className="h-9 w-auto py-1 text-sm">
          <option value="all">Everyone</option><option value="todo">Not contacted</option><option value="contacted">Contacted</option>
        </Select>
      </div>

      {!ctx || apptQ.isPending ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="card"><EmptyState icon={<CalendarCheck2 className="h-6 w-6" />} title="All clear" description="No upcoming booking clashes with leave, blocked time or a holiday. When leave is approved, affected patients show up here automatically." action={<Link to="/appointments"><Button variant="outline">Open calendar</Button></Link>} /></div>
      ) : visible.length === 0 ? (
        <div className="card"><EmptyState icon={<Search className="h-6 w-6" />} title="No matches" description="Try a different search or filter." /></div>
      ) : (
        <div className="space-y-5">
          {groups.map(([date, list]) => (
            <section key={date}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
                {fmtDate(date, 'EEEE, d MMMM')}<span className="rounded-full bg-rose-100 px-2 py-px text-[10px] text-rose-700">{list.length}</span>
                {date === today() && <Badge tone="red">Today</Badge>}
              </h3>
              <ul className="space-y-2">
                {list.map(({ a, why }) => {
                  const p = ctx.lk.patients.get(a.patient_id), d = ctx.lk.doctors.get(a.doctor_id)
                  return (
                    <li key={a.id} className={cn('card flex flex-col gap-3 border-l-4 p-3 sm:p-4 lg:flex-row lg:items-center', a.contacted_at ? 'border-l-emerald-400' : 'border-l-rose-500')}>
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="grid w-14 shrink-0 place-items-center rounded-xl bg-brand-50 py-1.5 text-center">
                          <span className="text-[10px] font-semibold uppercase text-brand-600">{format(parseISO(a.appointment_date), 'MMM')}</span>
                          <span className="font-display text-lg font-bold leading-none text-brand-950">{format(parseISO(a.appointment_date), 'd')}</span>
                          <span className="text-[10px] tabular-nums text-slate-500">{fmtTime(a.appointment_time)}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Link to={`/patients/${a.patient_id}`} className="truncate font-semibold text-brand-950 hover:underline">{p?.full_name ?? 'Patient'}</Link>
                            {p?.mrn && <span className="text-xs text-slate-400">{p.mrn}</span>}
                            {a.source === 'website' && <Badge tone="violet"><Globe className="mr-0.5 inline h-3 w-3" />Online {a.booking_ref}</Badge>}
                            {a.contacted_at && <Badge tone="green">Contacted {ago(a.contacted_at)}</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500"><span className="tabular-nums">{p?.phone ?? 'No phone'}</span> · {d?.full_name} · {ctx.lk.departments.get(d?.department_id ?? '')?.name ?? d?.specialization}</p>
                          <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{why}</p>
                        </div>
                      </div>
                      {canAct && (
                        <div className="flex flex-wrap gap-1.5 lg:justify-end">
                          <Button size="sm" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setMoving({ a, why })}>Reschedule</Button>
                          <Button size="sm" variant="outline" icon={<MessageCircle className="h-4 w-4" />} onClick={() => whatsapp(a, why)} disabled={!p?.phone}>WhatsApp</Button>
                          <a href={p?.phone ? `tel:${p.phone.replace(/\s/g, '')}` : undefined} aria-disabled={!p?.phone} className={cn('inline-flex h-8 items-center gap-2 rounded-lg border border-[#e0e0f2] bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-900', !p?.phone && 'pointer-events-none opacity-50')} onClick={() => !a.contacted_at && update.mutate({ id: a.id, patch: { contacted_at: new Date().toISOString() } })}><Phone className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Call</span></a>
                          <Button size="sm" variant="ghost" icon={<CheckCheck className="h-4 w-4" />} onClick={() => markContacted(a)}>{a.contacted_at ? 'Undo' : 'Contacted'}</Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" icon={<XCircle className="h-4 w-4" />} onClick={() => setCancelling({ a, why })}>Cancel</Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {moving && ctx && (
        <RescheduleModal item={moving} ctx={ctx} ext={ext} appts={apptQ.data ?? []} onClose={() => setMoving(null)}
          onSave={(patch) => {
            const a = moving.a
            update.mutate({ id: a.id, patch: { ...patch, status: 'scheduled', contacted_at: new Date().toISOString(),
              notes: [a.notes, `Rescheduled from ${fmtDate(a.appointment_date, 'dd MMM')} ${fmtTime(a.appointment_time)} — ${shortWhy(moving.why)}`].filter(Boolean).join('\n') } })
            const p = ctx.lk.patients.get(a.patient_id), d = ctx.lk.doctors.get(patch.doctor_id)
            const msg = `Namaste ${p?.full_name.split(' ')[0] ?? ''}, your appointment at ${HOSPITAL.name} has been moved to ${fmtDate(patch.appointment_date, 'EEE, d MMM')} at ${fmtTime(patch.appointment_time)} with ${d?.full_name}. Reply if this time doesn't suit you. Thank you!`
            toast.success(`Moved to ${fmtDate(patch.appointment_date, 'EEE d MMM')}, ${fmtTime(patch.appointment_time)}`, {
              duration: 9000, action: p?.phone ? { label: 'Tell patient on WhatsApp', onClick: () => window.open(`https://wa.me/${waDigits(p.phone)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener') } : undefined,
            })
            setMoving(null)
          }} />
      )}
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} confirmLabel="Cancel booking"
        title="Cancel this booking?" description="The slot is released and the booking is marked cancelled. Let the patient know first — WhatsApp or call."
        onConfirm={() => {
          const c = cancelling!
          update.mutate({ id: c.a.id, patch: { status: 'cancelled', notes: [c.a.notes, `Cancelled — ${shortWhy(c.why)}`].filter(Boolean).join('\n') } })
          toast.success('Booking cancelled'); setCancelling(null)
        }} />
    </div>
  )
}

function RescheduleModal({ item, ctx, ext, appts, onClose, onSave }: {
  item: { a: Appointment; why: string }; ctx: NonNullable<ReturnType<typeof useResourceCtx>['ctx']>; ext: ScheduleExt; appts: Appointment[]
  onClose: () => void; onSave: (p: { doctor_id: string; appointment_date: string; appointment_time: string }) => void
}) {
  const { a } = item
  const orig = ctx.lk.doctors.get(a.doctor_id)
  const all = [...ctx.lk.doctors.values()].filter((d) => d.status === 'active')
  const same = all.filter((d) => d.department_id === orig?.department_id)
  const others = all.filter((d) => d.department_id !== orig?.department_id)
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => format(addDays(new Date(), i), 'yyyy-MM-dd')), [])
  const slotsFor = (doc: Doctor | undefined, date: string) => (doc ? freeSlots(doc, date, appts.filter((x) => x.id !== a.id), ext, { minNoticeMinutes: 30 }) : [])
  const firstDoc = [orig, ...same, ...others].find((d) => d && d.status === 'active' && days.some((x) => slotsFor(d, x).length)) ?? orig
  const [docId, setDocId] = useState(firstDoc?.id ?? a.doctor_id)
  const doc = ctx.lk.doctors.get(docId)
  const counts = useMemo(() => days.map((d) => slotsFor(doc, d).length), [docId, days]) // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(() => days[counts.findIndex((n) => n > 0)] ?? days[0])
  const slots = slotsFor(doc, date)
  const [time, setTime] = useState('')
  const pickDoc = (id: string) => { setDocId(id); setTime(''); const d = ctx.lk.doctors.get(id); const i = days.findIndex((x) => slotsFor(d, x).length); if (i >= 0) setDate(days[i]) }
  const p: Patient | undefined = ctx.lk.patients.get(a.patient_id)

  return (
    <Modal open onClose={onClose} size="max-w-2xl" title={`Reschedule ${p?.full_name ?? 'booking'}`}
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!time} icon={<CalendarCheck2 className="h-4 w-4" />} onClick={() => onSave({ doctor_id: docId, appointment_date: date, appointment_time: time })}>{time ? `Move to ${fmtDate(date, 'd MMM')}, ${fmtTime(time)}` : 'Pick a slot'}</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <b>Currently:</b> {fmtDate(a.appointment_date, 'EEE, d MMM')} · {fmtTime(a.appointment_time)} · {orig?.full_name} <span className="opacity-80">— {item.why}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Doctor</span>
          <Select value={docId} onChange={(e) => pickDoc(e.target.value)}>
            {orig?.status === 'active' && <option value={orig.id}>{orig.full_name} (same doctor)</option>}
            <optgroup label={`Same department · ${ctx.lk.departments.get(orig?.department_id ?? '')?.name ?? ''}`}>
              {same.filter((d) => d.id !== orig?.id).map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.specialization}</option>)}
            </optgroup>
            <optgroup label="Other departments">{others.map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.specialization}</option>)}</optgroup>
          </Select>
        </label>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Day</span>
          <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {days.map((d, i) => (
              <button key={d} type="button" disabled={!counts[i]} onClick={() => { setDate(d); setTime('') }}
                className={cn('flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5 text-center transition disabled:cursor-not-allowed disabled:opacity-40',
                  d === date ? 'border-brand-900 bg-brand-900 text-white' : 'border-[#e6e6f5] bg-white hover:border-brand-400')}>
                <span className="text-[10px] font-semibold uppercase opacity-70">{format(parseISO(d), 'EEE')}</span>
                <span className="text-base font-bold leading-tight">{format(parseISO(d), 'd')}</span>
                <span className={cn('text-[10px]', d === date ? 'text-[#ccccff]' : counts[i] ? 'text-emerald-600' : 'text-slate-400')}>{counts[i] ? `${counts[i]} free` : 'off'}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Free slots · {fmtDate(date, 'EEEE d MMM')}</span>
          {slots.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">No free slots on this day — pick another day or doctor.</p> : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {slots.map((s) => (
                <button key={s} type="button" onClick={() => setTime(s)} aria-pressed={time === s}
                  className={cn('rounded-lg border py-1.5 text-xs font-semibold tabular-nums transition', time === s ? 'border-brand-900 bg-brand-900 text-white' : 'border-emerald-200 bg-emerald-50/60 text-emerald-800 hover:border-emerald-500')}>
                  {fmtTime(s)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><Avatar name={p?.full_name} size="sm" />{p?.full_name} · <span className="tabular-nums">{p?.phone ?? 'no phone'}</span></div>
      </div>
    </Modal>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import {
  ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, CalendarPlus, Check, CheckCircle2, ChevronRight, Clock, IndianRupee, Loader2, Lock, Mail, MapPin,
  MessageCircle, Moon, Navigation, Phone, Printer, RefreshCw, Search, ShieldCheck, Smartphone, Sparkles, Stethoscope, Sun, Sunrise, UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { useContact, useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import { useSeo } from '../hooks'
import { AmbientBackdrop, Breadcrumbs, inr } from '../ui'
import { BookingError, bookingApi, icsFor, loadReceipt, phone10, prettyPhone, saveReceipt, slotsFor as slotsForRaw, validMobile, type BookingReceipt, type OtpChannel } from '../../booking/api'
import { BOOK_QK, buildDirectory, firstFree, useBookingData, useDoctorDays, whenLabel, type BookDoc } from '../../booking/useBooking'
import { InvoiceDocument, printInvoice } from '../../components/InvoiceDocument'
import { LanguageSwitch, useT } from '../../i18n'

type Step = 'speciality' | 'doctor' | 'slot' | 'details' | 'verify'
const STEPS: { id: Step; label: string }[] = [
  { id: 'speciality', label: 'Speciality' }, { id: 'doctor', label: 'Doctor' }, { id: 'slot', label: 'Date & time' }, { id: 'details', label: 'Your details' }, { id: 'verify', label: 'Verify & book' },
]
interface Details { phone: string; name: string; gender: 'male' | 'female' | 'other' | ''; dob: string; email: string; reason: string; consent: boolean }
const EMPTY: Details = { phone: '', name: '', gender: '', dob: '', email: '', reason: '', consent: false }

export default function Book() {
  const { t } = useT()
  useSeo('Book an appointment online', 'Pick a speciality, choose your doctor and a free slot, verify your mobile — your appointment is confirmed instantly.')
  const [params, setParams] = useSearchParams()
  const ref = params.get('confirmed')
  const [receipt, setReceipt] = useState<BookingReceipt | null>(() => (ref ? loadReceipt(ref) : null))
  const { settings } = useSite()

  useEffect(() => { if (ref && !receipt) setReceipt(loadReceipt(ref)) }, [ref]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ref) setReceipt(null) }, [ref])

  return (
    <section className="relative isolate min-h-screen overflow-hidden pb-20 pt-28 sm:pt-32">
      <AmbientBackdrop />
      <div className="l-container">
        <div className="flex items-center justify-between gap-3"><Breadcrumbs items={[{ label: t('Book an appointment') }]} /><LanguageSwitch /></div>
        {receipt ? <Confirmation r={receipt} onAnother={() => { setParams({}); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
          : !settings.booking.enabled ? <Closed />
            : <Wizard onDone={(r) => { saveReceipt(r); setReceipt(r); setParams({ confirmed: r.ref }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
      </div>
    </section>
  )
}

function Closed() {
  const { t } = useT()
  const c = useContact()
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-[1.75rem] border border-peri-200 bg-white p-8 text-center shadow-soft">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-peri-100 text-peri-700"><Phone className="h-6 w-6" /></span>
      <h1 className="mt-4 font-display text-2xl font-bold text-peri-900">{t('Online booking is paused')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('Please call our appointments desk — we’ll book you in right away.')}</p>
      <a href={c.appointmentsTel} className="mt-6 inline-flex items-center gap-2 rounded-full bg-peri-800 px-6 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-peri-900"><Phone className="h-4 w-4" />{c.appointmentsPhone}</a>
    </div>
  )
}

// ================================================================== wizard
function Wizard({ onDone }: { onDone: (r: BookingReceipt) => void }) {
  const { t } = useT()
  const { settings, services, doctors: siteDocs } = useSite()
  const c = useContact()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { days, docsQ, availQ } = useBookingData(settings)
  const dir = useMemo(() => buildDirectory(docsQ.data ?? [], siteDocs, services), [docsQ.data, siteDocs, services])
  const bookableServices = useMemo(() => services.filter((s) => dir.some((d) => d.service === s.slug)), [services, dir])

  const [step, setStep] = useState<Step>('speciality')
  const [service, setService] = useState('')
  const [docId, setDocId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [f, setF] = useState<Details>(EMPTY)
  const [token, setToken] = useState<{ phone: string; token: string } | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const go = (s: Step) => { setStep(s); requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }

  const doc = dir.find((d) => d.db.id === docId)
  const docDays = useDoctorDays(doc?.db, days, availQ.data, settings)

  // deep links: /book?doctor=<cms slug | id> · /book?service=<slug>
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !dir.length) return
    seeded.current = true
    const qd = params.get('doctor'), qs = params.get('service')
    const d = qd ? dir.find((x) => x.site?.slug === qd || x.db.id === qd) : undefined
    if (d) {
      setService(d.service); setDocId(d.db.id)
      const qdate = params.get('date'), qtime = params.get('time')
      if (qdate && /^\d{4}-\d{2}-\d{2}$/.test(qdate)) { setDate(qdate); if (qtime && /^\d{2}:\d{2}$/.test(qtime)) setTime(qtime) }
      setStep('slot'); return
    }
    if (qs && dir.some((x) => x.service === qs)) { setService(qs); setStep('doctor') }
  }, [dir, params])
  // pick the first free day when a doctor is chosen
  useEffect(() => {
    if (!doc || step !== 'slot') return
    if (!date || !docDays.get(date)) { const ff = firstFree(docDays); setDate(ff?.date ?? days[0]); setTime('') }
  }, [doc, docDays, step]) // eslint-disable-line react-hooks/exhaustive-deps

  const svc = services.find((s) => s.slug === service)
  const loading = docsQ.isPending || availQ.isPending
  const failed = docsQ.isError || availQ.isError
  const stepIdx = STEPS.findIndex((s) => s.id === step)

  const refreshAvail = () => qc.invalidateQueries({ queryKey: [...BOOK_QK, 'availability'] })

  return (
    <div ref={top} className="scroll-mt-24">
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl">{t('Book an appointment')}</h1>
          <p className="mt-1.5 text-sm text-slate-600 sm:text-base">{t('Real-time availability · instant confirmation · pay at the hospital')}</p>
        </div>
        <p className="inline-flex items-center gap-2 text-xs text-slate-500"><Lock className="h-3.5 w-3.5 text-peri-600" />{t('Your details are only used for this booking')}</p>
      </div>

      {/* stepper */}
      <ol className="mt-6 grid grid-cols-5 gap-1.5 sm:gap-3" aria-label="Booking progress">
        {STEPS.map((s, i) => {
          const done = i < stepIdx, cur = i === stepIdx
          const reachable = i < stepIdx
          return (
            <li key={s.id}>
              <button type="button" disabled={!reachable} onClick={() => go(s.id)} aria-current={cur ? 'step' : undefined}
                className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-default">
                <span className={cn('h-1.5 rounded-full transition-all duration-500', done ? 'bg-peri-700' : cur ? 'bg-gradient-to-r from-peri-700 to-peri-400' : 'bg-peri-200/70')} />
                <span className={cn('hidden items-center gap-1.5 text-xs font-semibold sm:flex', cur ? 'text-peri-900' : done ? 'text-peri-700 group-hover:underline' : 'text-slate-400')}>
                  <span className={cn('grid h-5 w-5 place-items-center rounded-full text-[10px]', done ? 'bg-peri-700 text-white' : cur ? 'bg-peri-900 text-white' : 'bg-peri-100 text-peri-500')}>{done ? <Check className="h-3 w-3" /> : i + 1}</span>{t(s.label)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-xs font-semibold text-peri-800 sm:hidden">{t('Step {n} of 5', { n: stepIdx + 1 })} · {t(STEPS[stepIdx].label)}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 rounded-[1.75rem] border border-peri-200/80 bg-white/90 p-4 shadow-soft backdrop-blur sm:p-6">
          {failed ? (
            <div className="grid place-items-center py-16 text-center">
              <p className="font-semibold text-peri-900">{t('We couldn’t load live availability')}</p>
              <p className="mt-1 text-sm text-slate-500">{t('Please try again, or call {phone}.', { phone: c.appointmentsPhone })}</p>
              <button type="button" onClick={() => { docsQ.refetch(); availQ.refetch() }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-peri-800 px-5 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />{t('Retry')}</button>
            </div>
          ) : loading ? <StepSkeleton /> : (
            <>
              {step === 'speciality' && (
                <SpecialityStep services={bookableServices} dir={dir} onPick={(s) => { setService(s); setDocId(''); go('doctor') }} selected={service} />
              )}
              {step === 'doctor' && (
                <DoctorStep docs={dir.filter((d) => d.service === service)} title={svc?.name ?? t('Doctors')} days={days} av={availQ.data} cfg={settings}
                  onBack={() => go('speciality')} onPick={(id) => { setDocId(id); setDate(''); setTime(''); go('slot') }} selected={docId} />
              )}
              {step === 'slot' && doc && (
                <SlotStep doc={doc} days={days} docDays={docDays} date={date} time={time} setDate={(d) => { setDate(d); setTime('') }} setTime={setTime}
                  onBack={() => go('doctor')} onNext={() => go('details')} fetching={availQ.isFetching} onRefresh={refreshAvail} />
              )}
              {step === 'details' && (
                <DetailsStep f={f} setF={setF} onBack={() => go('slot')} onNext={() => go('verify')} />
              )}
              {step === 'verify' && doc && (
                <VerifyStep f={f} token={token} setToken={setToken} onBack={() => go('details')}
                  onBook={async (tk) => {
                    try {
                      const r = await bookingApi.book({ token: tk, phone: phone10(f.phone), doctorId: doc.db.id, date, time, name: f.name, gender: f.gender || 'other', dob: f.dob || null, email: f.email || null, reason: f.reason || null }, settings)
                      setToken(null)
                      refreshAvail()
                      toast.success(t('Appointment confirmed'))
                      onDone(r)
                    } catch (e) {
                      const err = e as BookingError
                      if (err.code === 'OTP_REQUIRED') { setToken(null); toast.error(err.message); return }
                      if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE') { toast.error(err.message); refreshAvail(); setTime(''); go('slot'); return }
                      toast.error(err.message || t('Could not complete the booking'))
                    }
                  }} />
              )}
            </>
          )}
        </div>
        <Summary svc={svc?.name} doc={doc} date={date} time={time} step={step} />
      </div>
    </div>
  )
}

function StepSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading availability">
      <div className="h-6 w-48 animate-pulse rounded-lg bg-peri-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-peri-100/70" />)}</div>
    </div>
  )
}

const StepTitle = ({ title, sub, onBack }: { title: string; sub?: ReactNode; onBack?: () => void }) => (
  <div className="mb-5 flex items-start gap-3">
    {onBack && <button type="button" onClick={onBack} aria-label="Back" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-peri-200 text-peri-700 transition hover:bg-peri-50"><ArrowLeft className="h-4 w-4" /></button>}
    <div><h2 className="font-display text-xl font-bold text-peri-900">{title}</h2>{sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}</div>
  </div>
)

// ------------------------------------------------------------------ 1. speciality
function SpecialityStep({ services, dir, onPick, selected }: { services: ReturnType<typeof useSite>['services']; dir: BookDoc[]; onPick: (s: string) => void; selected: string }) {
  const { t } = useT()
  const [q, setQ] = useState('')
  const list = services.filter((s) => !q || `${s.name} ${s.tagline} ${s.conditions.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <StepTitle title={t('What do you need help with?')} sub={t('Choose a speciality — not sure? Pick General Medicine.')} />
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-peri-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search e.g. fever, knee pain, skin allergy…')} aria-label={t('Search specialities')}
          className="block w-full rounded-2xl border border-peri-200 bg-white py-3 pl-11 pr-4 text-sm text-peri-900 outline-none transition placeholder:text-slate-400 focus:border-peri-500 focus:ring-4 focus:ring-peri-200/60" />
      </label>
      {list.length === 0 ? <p className="rounded-2xl bg-peri-50 p-6 text-center text-sm text-slate-500">{t('No speciality matches “{q}”. Try General Medicine.', { q })}</p> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((s) => {
            const docs = dir.filter((d) => d.service === s.slug)
            const Icon = iconFor(s.icon)
            return (
              <button key={s.slug} type="button" onClick={() => onPick(s.slug)} aria-pressed={selected === s.slug}
                className={cn('group flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition duration-300 hover:-translate-y-0.5 hover:shadow-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-peri-300',
                  selected === s.slug ? 'border-peri-700 bg-peri-50' : 'border-peri-200/80 bg-white hover:border-peri-400')}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-peri-200 to-peri-300 text-peri-800 transition group-hover:from-peri-600 group-hover:to-peri-800 group-hover:text-white"><Icon className="h-5 w-5" /></span>
                <span>
                  <span className="block font-semibold leading-tight text-peri-900">{s.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">{t(docs.length === 1 ? '{n} doctor' : '{n} doctors', { n: docs.length })} · {t('from {fee}', { fee: inr(Math.min(...docs.map((d) => d.fee))) })}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ 2. doctor
function DocPhoto({ d, className }: { d: BookDoc; className?: string }) {
  return d.img ? <img src={d.img} alt="" loading="lazy" className={cn('object-cover', className)} />
    : <span className={cn('grid place-items-center bg-gradient-to-br from-peri-200 to-peri-400 font-display font-bold text-peri-900', className)}>{d.name.replace(/^Dr\.?\s*/, '').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
}
function DoctorStep({ docs, title, days, av, cfg, onBack, onPick, selected }: {
  docs: BookDoc[]; title: string; days: string[]; av: Parameters<typeof useDoctorDays>[2]; cfg: Parameters<typeof useDoctorDays>[3]
  onBack: () => void; onPick: (id: string) => void; selected: string
}) {
  const { t } = useT()
  const rows = docs.map((d) => ({ d, next: nextFor(d, days, av, cfg) })).sort((a, b) => (a.next ? a.next.date + a.next.time : 'z').localeCompare(b.next ? b.next.date + b.next.time : 'z'))
  return (
    <div>
      <StepTitle title={t('Choose your doctor')} sub={title} onBack={onBack} />
      <ul className="space-y-3">
        {rows.map(({ d, next }) => (
          <li key={d.db.id}>
            <button type="button" onClick={() => next && onPick(d.db.id)} disabled={!next} aria-pressed={selected === d.db.id}
              className={cn('group flex w-full items-center gap-4 rounded-2xl border p-3 text-left transition duration-300 sm:p-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-peri-300 disabled:cursor-not-allowed disabled:opacity-60',
                selected === d.db.id ? 'border-peri-700 bg-peri-50' : 'border-peri-200/80 bg-white enabled:hover:border-peri-400 enabled:hover:shadow-soft')}>
              <DocPhoto d={d} className="h-16 w-16 shrink-0 rounded-2xl text-lg sm:h-20 sm:w-20" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-bold text-peri-900 sm:text-lg">{d.name}</span>
                <span className="block truncate text-xs text-slate-500 sm:text-sm">{d.role}{d.site?.quals ? ` · ${d.site.quals}` : ''}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  {d.site && <span className="inline-flex items-center gap-1"><Stethoscope className="h-3.5 w-3.5 text-peri-500" />{t('{n} yrs', { n: d.site.exp })}</span>}
                  {d.site && <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-amber-500" />{d.site.rating.toFixed(1)}</span>}
                  <span className={cn('inline-flex items-center gap-1 font-semibold', next ? 'text-emerald-700' : 'text-amber-600')}><Clock className="h-3.5 w-3.5" />{next ? t('Next: {when}', { when: whenLabel(next.date, next.time) }) : t('No free slots in this window')}</span>
                </span>
              </span>
              <span className="hidden shrink-0 text-right sm:block">
                <span className="block font-display text-lg font-bold text-peri-900">{inr(d.fee)}</span>
                <span className="text-[11px] text-slate-500">{t('consultation')}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-peri-300 transition group-hover:translate-x-0.5 group-hover:text-peri-700" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
function nextFor(d: BookDoc, days: string[], av: Parameters<typeof useDoctorDays>[2], cfg: Parameters<typeof useDoctorDays>[3]) {
  if (!av) return null
  const mine = { booked: av.booked.filter((b) => b.doctor_id === d.db.id), leaves: av.leaves.filter((l) => l.doctor_id === d.db.id), holidays: av.holidays }
  for (const day of days) {
    const s = slotsForDoc(d, day, mine, cfg)
    if (s.length) return { date: day, time: s[0] }
  }
  return null
}
const slotsForDoc = (d: BookDoc, day: string, av: NonNullable<Parameters<typeof useDoctorDays>[2]>, cfg: Parameters<typeof useDoctorDays>[3]) => slotsForRaw(d.db, day, av, cfg)

// ------------------------------------------------------------------ 3. date & time
function SlotStep({ doc, days, docDays, date, time, setDate, setTime, onBack, onNext, fetching, onRefresh }: {
  doc: BookDoc; days: string[]; docDays: Map<string, string[]>; date: string; time: string; setDate: (d: string) => void; setTime: (t: string) => void
  onBack: () => void; onNext: () => void; fetching: boolean; onRefresh: () => void
}) {
  const { t } = useT()
  const slots = docDays.get(date) ?? []
  const worksOn = (d: string) => (doc.db.available_days?.length ? doc.db.available_days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).includes(format(parseISO(d), 'EEE'))
  const parts: [string, typeof Sun, string[]][] = [
    [t('Morning'), Sunrise, slots.filter((s) => s < '12:00')], [t('Afternoon'), Sun, slots.filter((s) => s >= '12:00' && s < '17:00')], [t('Evening'), Moon, slots.filter((s) => s >= '17:00')],
  ]
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => { strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }) }, [date])
  const ff = firstFree(docDays)
  return (
    <div>
      <StepTitle title={t('Pick a date & time')} sub={<>{doc.name} · {t('consultations of ~15–20 min in 30-min slots')}</>} onBack={onBack} />
      <div ref={strip} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]" role="listbox" aria-label={t('Choose a day')}>
        {days.map((d) => {
          const n = docDays.get(d)?.length ?? 0
          const off = !worksOn(d)
          return (
            <button key={d} type="button" role="option" aria-selected={d === date} aria-pressed={d === date} disabled={!n} onClick={() => setDate(d)}
              className={cn('flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-2xl border py-2.5 text-center transition disabled:cursor-not-allowed',
                d === date ? 'border-peri-800 bg-peri-800 text-white shadow-soft' : n ? 'border-peri-200 bg-white hover:border-peri-500' : 'border-dashed border-peri-200 bg-peri-50/50 text-slate-400')}>
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{format(parseISO(d), 'EEE')}</span>
              <span className="font-display text-xl font-bold leading-tight">{format(parseISO(d), 'd')}</span>
              <span className="text-[10px] opacity-70">{format(parseISO(d), 'MMM')}</span>
              <span className={cn('mt-1 text-[10px] font-semibold', d === date ? 'text-peri-200' : n ? 'text-emerald-600' : 'text-slate-400')}>{n ? t('{n} free', { n }) : off ? t('Off') : t('Full')}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-peri-900">{date ? format(parseISO(date), 'EEEE, d MMMM') : ''}</p>
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1.5 text-xs font-medium text-peri-700 hover:underline"><RefreshCw className={cn('h-3.5 w-3.5', fetching && 'animate-spin')} />{t('Live · refresh')}</button>
      </div>
      {slots.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-peri-50 p-6 text-center">
          <p className="text-sm text-slate-600">{t('No free slots on this day.')}</p>
          {ff && <button type="button" onClick={() => setDate(ff.date)} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-peri-800 shadow-sm ring-1 ring-peri-200 hover:ring-peri-400">{t('Jump to next available — {when}', { when: whenLabel(ff.date, ff.time) })}</button>}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {parts.filter(([, , l]) => l.length).map(([label, Icon, list]) => (
            <div key={label}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><Icon className="h-3.5 w-3.5 text-peri-500" />{label}<span className="font-medium normal-case tracking-normal text-slate-400">· {t('{n} free', { n: list.length })}</span></p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {list.map((s) => {
                  const [h, m] = s.split(':').map(Number)
                  return (
                    <button key={s} type="button" onClick={() => setTime(s)} aria-pressed={time === s}
                      className={cn('rounded-xl border py-2.5 text-sm font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-peri-300',
                        time === s ? 'border-peri-800 bg-peri-800 text-white shadow-soft' : 'border-peri-200 bg-white text-peri-900 hover:border-peri-500 hover:bg-peri-50')}>
                      {((h + 11) % 12) + 1}:{String(m).padStart(2, '0')} <span className="text-[10px] font-medium opacity-70">{h < 12 ? 'AM' : 'PM'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <NextBar disabled={!time} onClick={onNext} label={time ? t('Continue with {when}', { when: whenLabel(date, time) }) : t('Pick a time to continue')} />
    </div>
  )
}

const NextBar = ({ disabled, onClick, label, loading, type = 'button' }: { disabled?: boolean; onClick?: () => void; label: string; loading?: boolean; type?: 'button' | 'submit' }) => (
  <div className="sticky bottom-3 z-10 mt-6 sm:static">
    <button type={type} disabled={disabled || loading} onClick={onClick}
      className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-peri-800 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_-15px_rgba(41,41,102,.7)] transition hover:bg-peri-900 disabled:cursor-not-allowed disabled:bg-peri-300 disabled:shadow-none sm:w-auto">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{label}{!loading && <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />}
    </button>
  </div>
)

// ------------------------------------------------------------------ 4. details
function DetailsStep({ f, setF, onBack, onNext }: { f: Details; setF: (f: Details) => void; onBack: () => void; onNext: () => void }) {
  const { t } = useT()
  const [touched, setTouched] = useState(false)
  const errs: Partial<Record<keyof Details, string>> = {}
  if (!validMobile(f.phone)) errs.phone = t('Enter a valid 10-digit Indian mobile number')
  if (f.name.trim().length < 2) errs.name = t('Enter the patient’s full name')
  if (!f.gender) errs.gender = t('Select gender')
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) errs.email = t('Enter a valid email')
  if (f.dob && f.dob > format(new Date(), 'yyyy-MM-dd')) errs.dob = t('Date of birth can’t be in the future')
  if (!f.consent) errs.consent = t('Please accept to continue')
  const up = <K extends keyof Details>(k: K, v: Details[K]) => setF({ ...f, [k]: v })
  const input = (k: keyof Details) => cn('block w-full rounded-2xl border bg-white px-4 py-3 text-sm text-peri-900 outline-none transition placeholder:text-slate-400 focus:ring-4',
    touched && errs[k] ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-peri-200 focus:border-peri-500 focus:ring-peri-200/60')
  const Err = ({ k }: { k: keyof Details }) => (touched && errs[k] ? <p className="mt-1.5 text-xs font-medium text-rose-600">{errs[k]}</p> : null)
  const submit = () => {
    setTouched(true)
    const first = Object.keys(errs)[0]
    if (first) { document.getElementById(`b-${first}`)?.focus(); return }
    onNext()
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
      <StepTitle title={t('Patient details')} sub={t('Booking for a family member? Enter their name — your mobile is fine.')} onBack={onBack} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold text-peri-900">{t('Mobile number')} <span className="text-rose-500">*</span></span>
          <span className="flex">
            <span className="inline-flex items-center rounded-l-2xl border border-r-0 border-peri-200 bg-peri-50 px-3 text-sm font-semibold text-peri-800">+91</span>
            <input id="b-phone" inputMode="numeric" autoComplete="tel-national" maxLength={14} value={f.phone} onChange={(e) => up('phone', e.target.value.replace(/[^\d\s]/g, ''))}
              placeholder="98765 43210" className={cn(input('phone'), 'rounded-l-none')} aria-invalid={touched && !!errs.phone} />
          </span>
          <span className="mt-1.5 block text-xs text-slate-500">{t('We’ll send a one-time code to confirm it’s you.')}</span>
          <Err k="phone" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold text-peri-900">{t('Patient’s full name')} <span className="text-rose-500">*</span></span>
          <input id="b-name" autoComplete="name" value={f.name} onChange={(e) => up('name', e.target.value)} placeholder={t('e.g. Anita Sharma')} className={input('name')} aria-invalid={touched && !!errs.name} />
          <Err k="name" />
        </label>
        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold text-peri-900">{t('Gender')} <span className="text-rose-500">*</span></legend>
          <div id="b-gender" tabIndex={-1} className="grid grid-cols-3 gap-2">
            {(['female', 'male', 'other'] as const).map((g) => (
              <button key={g} type="button" onClick={() => up('gender', g)} aria-pressed={f.gender === g}
                className={cn('rounded-2xl border py-3 text-sm font-semibold capitalize transition', f.gender === g ? 'border-peri-800 bg-peri-800 text-white' : 'border-peri-200 bg-white text-peri-900 hover:border-peri-500')}>{t(g === 'female' ? 'Female' : g === 'male' ? 'Male' : 'Other')}</button>
            ))}
          </div>
          <Err k="gender" />
        </fieldset>
        <label>
          <span className="mb-1.5 block text-sm font-semibold text-peri-900">{t('Date of birth')} <span className="font-normal text-slate-400">({t('optional')})</span></span>
          <input id="b-dob" type="date" max={format(new Date(), 'yyyy-MM-dd')} value={f.dob} onChange={(e) => up('dob', e.target.value)} className={input('dob')} />
          <Err k="dob" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold text-peri-900">{t('Email')} <span className="font-normal text-slate-400">({t('optional — for the invoice')})</span></span>
          <input id="b-email" type="email" autoComplete="email" value={f.email} onChange={(e) => up('email', e.target.value)} placeholder="you@example.com" className={input('email')} />
          <Err k="email" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold text-peri-900">{t('Reason for visit')} <span className="font-normal text-slate-400">({t('optional')})</span></span>
          <textarea id="b-reason" rows={2} maxLength={500} value={f.reason} onChange={(e) => up('reason', e.target.value)} placeholder={t('e.g. Knee pain for two weeks')} className={input('reason')} />
        </label>
        <label className="flex items-start gap-3 sm:col-span-2">
          <input id="b-consent" type="checkbox" checked={f.consent} onChange={(e) => up('consent', e.target.checked)} className="mt-0.5 h-5 w-5 rounded-md border-peri-300 text-peri-800 focus:ring-peri-300" />
          <span className="text-sm text-slate-600">{t('I agree to the')} <Link to="/terms" target="_blank" className="font-semibold text-peri-800 underline">{t('terms')}</Link> {t('and')} <Link to="/privacy" target="_blank" className="font-semibold text-peri-800 underline">{t('privacy policy')}</Link>{t(', and consent to be contacted about this appointment.')}</span>
        </label>
        <div className="sm:col-span-2"><Err k="consent" /></div>
      </div>
      <NextBar type="submit" label={t('Verify mobile & book')} />
    </form>
  )
}

// ------------------------------------------------------------------ 5. verify (OTP) + book
function VerifyStep({ f, token, setToken, onBack, onBook }: {
  f: Details; token: { phone: string; token: string } | null; setToken: (t: { phone: string; token: string } | null) => void
  onBack: () => void; onBook: (token: string | null) => Promise<void>
}) {
  const { t } = useT()
  const { settings } = useSite()
  const phone = phone10(f.phone)
  const verified = token && token.phone === phone ? token.token : null
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [sent, setSent] = useState<{ at: number; channel: OtpChannel | null } | null>(null)
  // channels that can deliver the code (null = still loading); the preferred one is listed first
  const [channels, setChannels] = useState<OtpChannel[] | null>(null)
  const preferred: OtpChannel = settings.booking.otpPreferred ?? 'whatsapp'
  const email = f.email?.trim() || ''
  // e-mail needs the address from the previous step
  const ordered = (channels ?? []).filter((c) => c !== 'email' || email).sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0))
  /** the hospital switched the booking code off (Settings → Security): confirm straight away */
  const [noCode, setNoCode] = useState(false)
  const dest = (c: OtpChannel | null | undefined) => c === 'email' ? email : prettyPhone(phone)
  const [busy, setBusy] = useState<'send' | 'verify' | 'book' | null>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const wait = sent ? Math.max(0, 30 - Math.floor((now - sent.at) / 1000)) : 0

  const send = async (channel?: OtpChannel) => {
    setBusy('send'); setErr('')
    try {
      const r = await bookingApi.requestOtp(phone, settings, channel, channel === 'email' ? email : null)
      const used = r.channels[0] ?? channel ?? null
      setSent({ at: Date.now(), channel: used }); setCode(r.demo_code ?? ''); setDemoCode(r.demo_code ?? null)
      if (r.demo_code) toast.info(t('Demo hospital: nothing is sent — your code is {code}', { code: r.demo_code }))
      else toast.success(used === 'whatsapp' ? t('Code sent on WhatsApp to {phone}', { phone: prettyPhone(phone) }) : t('Code sent to {phone}', { phone: dest(used) }))
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  // with a single channel (or none) the code goes out straight away; with WhatsApp + SMS the visitor picks
  const sentOnce = useRef(false)
  useEffect(() => {
    if (verified || sentOnce.current) return
    sentOnce.current = true
    bookingApi.otpConfig().catch(() => ({ required: true, channels: [] as OtpChannel[] })).then((cfg) => {
      if (!cfg.required) { setNoCode(true); setChannels([]); return }
      const usable = cfg.channels.filter((c) => c !== 'email' || email)
      setChannels(cfg.channels)
      if (usable.length <= 1) send(usable[0] ?? cfg.channels[0])
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const other = sent?.channel ? ordered.find((c) => c !== sent.channel) : undefined

  const verifyAndBook = async (c = code) => {
    if (!/^\d{6}$/.test(c)) return setErr(t('Enter the 6-digit code'))
    setBusy('verify'); setErr('')
    try {
      const r = await bookingApi.verifyOtp(phone, c)
      if (!r.ok || !r.token) { setErr(r.error ?? t('Could not verify the code')); setBusy(null); return }
      setToken({ phone, token: r.token })
      setBusy('book')
      await onBook(r.token)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const bookNow = async () => { if (!verified) return; setBusy('book'); try { await onBook(verified) } finally { setBusy(null) } }
  const bookWithoutCode = async () => { setBusy('book'); try { await onBook(null) } finally { setBusy(null) } }

  if (noCode && !verified) return (
    <div>
      <StepTitle title={t('Confirm your booking')} onBack={onBack} />
      <p className="flex items-center gap-2 rounded-2xl bg-peri-50 px-4 py-3 text-sm text-peri-900"><Smartphone className="h-5 w-5 shrink-0 text-peri-600" />{t('Booking for {phone}', { phone: prettyPhone(phone) })} · <button type="button" onClick={onBack} className="font-semibold text-peri-700 underline">{t('change')}</button></p>
      <p className="mt-3 text-xs text-slate-500">{t('Your booking confirmation will also be sent on WhatsApp / SMS to this number.')}</p>
      <NextBar onClick={bookWithoutCode} loading={busy === 'book'} label={busy === 'book' ? t('Confirming…') : t('Confirm booking')} />
    </div>
  )

  if (verified) return (
    <div>
      <StepTitle title={t('Confirm your booking')} onBack={onBack} />
      <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"><BadgeCheck className="h-5 w-5" />{t('{phone} is verified', { phone: prettyPhone(phone) })}</p>
      <NextBar onClick={bookNow} loading={busy === 'book'} label={busy === 'book' ? t('Confirming…') : t('Confirm booking')} />
    </div>
  )

  // WhatsApp + SMS available and nothing sent yet → let the visitor choose
  if (!sent && ordered.length > 1) return (
    <div>
      <StepTitle title={t('Verify your mobile')} sub={<>{t('Where should we send your 6-digit code for')} <b className="text-peri-900">{prettyPhone(phone)}</b>? · <button type="button" onClick={onBack} className="font-semibold text-peri-700 underline">{t('change')}</button></>} onBack={onBack} />
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t('Send the code by')}>
        {ordered.map((c, i) => {
          const wa = c === 'whatsapp', mail = c === 'email'
          return (
            <button key={c} type="button" disabled={!!busy} onClick={() => send(c)}
              className={cn('group flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition disabled:opacity-60',
                i === 0 ? (wa ? 'border-emerald-500 bg-emerald-50/70 hover:bg-emerald-50' : 'border-peri-600 bg-peri-50 hover:bg-peri-100/70') : 'border-peri-200 bg-white hover:border-peri-400')}>
              <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white', wa ? 'bg-[#25D366]' : 'bg-peri-700')}>
                {busy === 'send' ? <Loader2 className="h-6 w-6 animate-spin" /> : wa ? <MessageCircle className="h-6 w-6" /> : mail ? <Mail className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-display text-base font-bold text-peri-900">{wa ? t('Get code on WhatsApp') : mail ? t('Get code by e-mail') : t('Get code by SMS')}
                  {i === 0 && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">{t('Recommended')}</span>}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{wa ? t('Instant, free — arrives as a WhatsApp chat') : mail ? email : t('Text message to your mobile')}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-peri-400 transition group-hover:translate-x-0.5" />
            </button>
          )
        })}
      </div>
      {err && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{err}</p>}
      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{t('Your booking confirmation will also be sent on WhatsApp / SMS to this number.')}</p>
      <p className="mt-2 text-xs text-slate-500">{t('Already registered?')} <Link to="/login" className="font-semibold text-peri-700 underline">{t('Sign in')}</Link> {t('to book from your patient portal without a code.')}</p>
    </div>
  )

  return (
    <div>
      <StepTitle title={t('Verify your mobile')} sub={channels === null && !sent ? t('Sending code…') : <>{sent?.channel === 'whatsapp' ? t('Enter the 6-digit code sent on WhatsApp to') : t('Enter the 6-digit code sent to')} <b className="text-peri-900">{dest(sent?.channel)}</b> · <button type="button" onClick={onBack} className="font-semibold text-peri-700 underline">{t('change')}</button></>} onBack={onBack} />
      {demoCode && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200"><ShieldCheck className="h-4 w-4 shrink-0" />
          <span>{t('Demo hospital — nothing is sent. Your code is')} <b className="font-mono tracking-widest">{demoCode}</b> {t('(already filled in).')}</span></p>
      )}
      {sent?.channel === 'whatsapp' && !demoCode && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"><MessageCircle className="h-4 w-4 shrink-0" />{t('Open WhatsApp — the code is in a chat from {hospital}.', { hospital: settings.brand?.shortName || settings.name })}</p>
      )}
      <form onSubmit={(e) => { e.preventDefault(); verifyAndBook() }}>
        <label className="block">
          <span className="sr-only">{t('One-time code')}</span>
          <input ref={inputRef} value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setErr(''); if (v.length === 6) verifyAndBook(v) }}
            inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" aria-invalid={!!err} disabled={busy === 'verify' || busy === 'book'}
            className={cn('block w-full max-w-xs rounded-2xl border bg-white px-5 py-4 text-center font-mono text-2xl font-bold tracking-[.6em] text-peri-900 outline-none transition placeholder:text-peri-200 focus:ring-4',
              err ? 'border-rose-300 focus:ring-rose-100' : 'border-peri-200 focus:border-peri-500 focus:ring-peri-200/60')} />
        </label>
        {err && <p role="alert" className="mt-2 text-sm font-medium text-rose-600">{err}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          {busy === 'send' ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" />{t('Sending code…')}</span>
            : wait > 0 ? <span>{t('Resend code in {s}s', { s: wait })}</span>
              : <>
                <button type="button" onClick={() => send(sent?.channel ?? undefined)} className="font-semibold text-peri-800 underline">{sent ? t('Resend code') : t('Send code')}</button>
                {other && <><span className="text-slate-300">·</span><button type="button" onClick={() => send(other)} className="font-semibold text-peri-800 underline">{other === 'sms' ? t('Send by SMS instead') : other === 'email' ? t('Send by e-mail instead') : t('Send on WhatsApp instead')}</button></>}
              </>}
          <span className="text-slate-300">·</span><span>{t('Code valid for 10 minutes')}</span>
        </div>
        <NextBar type="submit" disabled={code.length !== 6} loading={busy === 'verify' || busy === 'book'} label={busy === 'book' ? t('Confirming your appointment…') : busy === 'verify' ? t('Verifying…') : t('Verify & confirm booking')} />
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ summary sidebar
function Summary({ svc, doc, date, time, step }: { svc?: string; doc?: BookDoc; date: string; time: string; step: Step }) {
  const { t } = useT()
  const { settings } = useSite()
  const c = useContact()
  const gst = Number(settings.billing.gstRate) || 0
  const fee = doc?.fee ?? 0
  const tax = Math.round(fee * gst) / 100
  const Row = ({ icon: Icon, label, value, done }: { icon: typeof Clock; label: string; value?: ReactNode; done: boolean }) => (
    <li className="flex items-start gap-3">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl', done ? 'bg-peri-800 text-white' : 'bg-peri-100 text-peri-400')}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span><span className={cn('block truncate text-sm font-semibold', done ? 'text-peri-900' : 'text-slate-400')}>{value || '—'}</span></span>
    </li>
  )
  return (
    <aside className="h-fit space-y-4 lg:sticky lg:top-24">
      <div className="rounded-[1.75rem] border border-peri-200/80 bg-white/90 p-5 shadow-soft backdrop-blur">
        <p className="font-display text-base font-bold text-peri-900">{t('Your booking')}</p>
        {doc && <div className="mt-4 flex items-center gap-3 rounded-2xl bg-peri-50 p-3"><DocPhoto d={doc} className="h-12 w-12 rounded-xl text-sm" /><div className="min-w-0"><p className="truncate text-sm font-bold text-peri-900">{doc.name}</p><p className="truncate text-xs text-slate-500">{doc.role}</p></div></div>}
        <ul className="mt-4 space-y-3">
          <Row icon={Stethoscope} label={t('Speciality')} value={svc} done={!!svc} />
          <Row icon={UserRound} label={t('Doctor')} value={doc?.name} done={!!doc} />
          <Row icon={CalendarDays} label={t('Date & time')} value={date && time ? whenLabel(date, time) : undefined} done={!!(date && time)} />
          <Row icon={ShieldCheck} label={t('Mobile')} value={step === 'verify' ? t('Verification') : undefined} done={false} />
        </ul>
        {doc && (
          <div className="mt-4 space-y-1.5 border-t border-dashed border-peri-200 pt-4 text-sm">
            <div className="flex justify-between text-slate-600"><span>{t('Consultation fee')}</span><span className="tabular-nums">{inr(fee)}</span></div>
            <div className="flex justify-between text-slate-600"><span>GST</span><span className="tabular-nums">{gst ? inr(tax) : t('Exempt')}</span></div>
            <div className="flex justify-between font-display text-base font-bold text-peri-900"><span>{t('Pay at hospital')}</span><span className="tabular-nums">{inr(fee + tax)}</span></div>
          </div>
        )}
      </div>
      <div className="rounded-[1.75rem] border border-peri-200/80 bg-white/70 p-4 text-xs text-slate-600 backdrop-blur">
        <p className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-peri-600" />{t('No online payment needed — pay at reception')}</p>
        <p className="mt-2 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-peri-600" />{t('Instant confirmation & GST invoice')}</p>
        <p className="mt-2 flex items-center gap-2"><Phone className="h-4 w-4 text-peri-600" />{t('Need help?')} <a href={c.appointmentsTel} className="font-semibold text-peri-800">{c.appointmentsPhone}</a></p>
      </div>
    </aside>
  )
}

// ================================================================== confirmation + invoice
function Confirmation({ r, onAnother }: { r: BookingReceipt; onAnother: () => void }) {
  const { t } = useT()
  const { settings } = useSite()
  const c = useContact()
  const when = whenLabel(r.appointment.appointment_date, r.appointment.appointment_time.slice(0, 5))
  const downloadIcs = () => {
    const blob = new Blob([icsFor(r, { name: settings.name, address: settings.address, phone: settings.appointmentsPhone || settings.phone })], { type: 'text/calendar;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `appointment-${r.ref}.ics`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`✅ Appointment confirmed at ${settings.name}\n${r.doctor.full_name} (${r.doctor.specialization})\n🗓 ${format(parseISO(r.appointment.appointment_date), 'EEE, d MMM yyyy')} at ${when.split(', ').pop()}\nBooking ref: ${r.ref}\n📍 ${settings.address}`)}`
  const actions: [string, typeof Printer, () => void, string?][] = [
    [t('Invoice PDF'), Printer, printInvoice, t('Print or “Save as PDF”')],
    [t('Add to calendar'), CalendarPlus, downloadIcs],
    [t('Share on WhatsApp'), MessageCircle, () => window.open(wa, '_blank', 'noopener')],
  ]
  if (settings.map.directionsUrl) actions.push([t('Get directions'), Navigation, () => window.open(settings.map.directionsUrl, '_blank', 'noopener')])

  return (
    <div className="mx-auto mt-6 max-w-4xl">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-peri-900 via-peri-800 to-peri-600 p-6 text-white shadow-soft sm:p-8">
        <div aria-hidden="true" className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-peri-300/30 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="grid h-16 w-16 shrink-0 animate-pop-in place-items-center rounded-full bg-white text-emerald-600 shadow-lg"><Check className="h-8 w-8" strokeWidth={3} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-peri-200">{t('Appointment confirmed')}</p>
            <h1 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">{when}</h1>
            <p className="mt-1 text-sm text-peri-100">{r.doctor.full_name} · {r.doctor.specialization}{r.doctor.department ? ` · ${r.doctor.department}` : ''}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 text-center ring-1 ring-inset ring-white/20">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-peri-200">{t('Booking ref')}</p>
            <p className="font-mono text-xl font-bold tracking-wider">{r.ref}</p>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <p className="flex items-start gap-2 text-peri-100"><UserRound className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="text-white">{r.patient.full_name}</b><br />MRN {r.patient.mrn}{r.is_new_patient && <span className="ml-1.5 rounded-full bg-emerald-400/20 px-2 py-px text-[10px] font-semibold text-emerald-200">{t('New record')}</span>}</span></p>
          <p className="flex items-start gap-2 text-peri-100"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{settings.address}</span></p>
          <p className="flex items-start gap-2 text-peri-100"><Clock className="mt-0.5 h-4 w-4 shrink-0" /><span>{t('Please arrive 15 minutes early with a photo ID and any previous reports.')}</span></p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map(([label, Icon, fn, hint]) => (
          <button key={label} type="button" onClick={fn} title={hint}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-peri-200 bg-white p-4 text-center text-sm font-semibold text-peri-900 shadow-sm transition hover:-translate-y-0.5 hover:border-peri-400 hover:shadow-soft">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-peri-100 text-peri-800 transition group-hover:bg-peri-800 group-hover:text-white"><Icon className="h-5 w-5" /></span>{label}
          </button>
        ))}
      </div>

      {settings.booking.payNote && <p className="mt-5 flex items-start gap-2 rounded-2xl bg-white/80 p-4 text-sm text-slate-600 ring-1 ring-peri-200"><IndianRupee className="mt-0.5 h-4 w-4 shrink-0 text-peri-600" />{settings.booking.payNote}</p>}

      <h2 className="mb-3 mt-8 font-display text-lg font-bold text-peri-900">{t('Your invoice')}</h2>
      <InvoiceDocument invoice={r.invoice} patient={r.patient} appointment={{
        ref: r.ref, doctor: r.doctor.full_name, specialization: r.doctor.specialization, department: r.doctor.department,
        date: r.appointment.appointment_date, time: r.appointment.appointment_time.slice(0, 5),
      }} />

      <div className="mt-8 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="text-sm text-slate-600">{t('Need to change? Sign in to the patient portal to reschedule, or call')} <a href={c.appointmentsTel} className="font-semibold text-peri-800">{c.appointmentsPhone}</a> {t('and quote')} <b className="font-mono">{r.ref}</b>.</p>
        <button type="button" onClick={onAnother} className="inline-flex items-center gap-2 rounded-full border border-peri-300 bg-white px-5 py-2.5 text-sm font-semibold text-peri-800 transition hover:bg-peri-50"><CalendarPlus className="h-4 w-4" />{t('Book another appointment')}</button>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Award, BadgeCheck, CalendarDays, Check, Clock, GraduationCap, Languages, MapPin, Phone, Share2, Stethoscope, ThumbsUp, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { WEEK, nextAvailable, useContact, useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import { REVIEW_POOL } from '../data/doctors'
import { useSeo } from '../hooks'
import { Reveal, Stars } from '../parts'
import { Breadcrumbs, DoctorCard, inr, useBookHref } from '../ui'
import NotFound from './NotFound'

const SLOTS = { morning: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'], afternoon: ['14:00', '14:30', '15:00', '15:30'], evening: ['17:00', '17:30', '18:00', '18:30'] }

// Deterministic "booked" slots so the picker feels real without randomness on each render.
const isTaken = (slug: string, day: number, slot: string) => ((slug.length * 7 + day * 13 + slot.charCodeAt(1) * 3 + slot.charCodeAt(3)) % 5) === 0

/** Keyed by slug so date/slot state resets when moving between profiles. */
export default function DoctorProfile() {
  const { slug } = useParams()
  return <Profile key={slug} slug={slug} />
}

function Profile({ slug }: { slug?: string }) {
  const { doctors: DOCTORS, services } = useSite()
  const c = useContact()
  const d = DOCTORS.find((x) => x.slug === slug)
  const book = useBookHref()
  const navigate = useNavigate()
  useSeo(d ? `${d.name} — ${d.role}` : 'Doctor not found', d ? `${d.name}, ${d.quals}. ${d.exp}+ years experience. Book an appointment at ${c.name}.` : undefined)

  const days = useMemo(() => {
    const out: { date: Date; dow: string; ok: boolean }[] = []
    const now = new Date()
    for (let i = 0; i < 7; i++) {
      const dt = new Date(now); dt.setDate(now.getDate() + i)
      const dow = WEEK[(dt.getDay() + 6) % 7]
      out.push({ date: dt, dow, ok: !!d && !d.onLeave && d.days.includes(dow) })
    }
    return out
  }, [d])
  const firstOk = Math.max(0, days.findIndex((x) => x.ok))
  const [day, setDay] = useState(firstOk)
  const [slot, setSlot] = useState<string | null>(null)

  if (!d) return <NotFound />
  const service = services.find((x) => x.slug === d.service)
  const ServiceIcon = iconFor(service?.icon)
  const reviews = [0, 1, 2].map((k) => REVIEW_POOL[(d.slug.length + k * 2) % REVIEW_POOL.length])
  const similar = DOCTORS.filter((x) => x.slug !== d.slug && (x.dept === d.dept || x.service === d.service)).concat(DOCTORS.filter((x) => x.slug !== d.slug && x.featured)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3)
  const selected = days[day]

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: d.name, url })
      else { await navigator.clipboard.writeText(url); toast.success('Profile link copied') }
    } catch { /* user cancelled */ }
  }

  return (
    <>
      <section className="relative isolate overflow-hidden pb-12 pt-28 sm:pt-36">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-peri-200/80 via-peri-100/50 to-transparent" />
        <div aria-hidden="true" className="motion-safe-only absolute -right-32 top-10 -z-10 h-96 w-96 animate-drift rounded-full bg-peri-300/50 blur-[100px]" />
        <div className="l-container">
          <Breadcrumbs items={[{ label: 'Find a doctor', to: '/find-a-doctor' }, { label: d.name }]} />
          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_400px]">
            {/* profile */}
            <div className="min-w-0">
              <div className="l-rise flex flex-col gap-6 sm:flex-row sm:items-end" style={{ animationDelay: '100ms' }}>
                <div className="relative w-40 shrink-0 sm:w-48">
                  <div className="overflow-hidden rounded-[2rem] border-[5px] border-white bg-peri-300 shadow-[0_30px_60px_-25px_rgba(41,41,102,.5)]">
                    <img src={d.img} alt={`Portrait of ${d.name}`} width={560} height={560} className="aspect-square w-full object-cover" />
                  </div>
                  <span className={cn('absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm ring-4 ring-[#f3f3ff]', d.onLeave ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', d.onLeave ? 'bg-amber-500' : 'animate-pulse bg-emerald-500')} />{d.onLeave ? 'On leave' : `Available ${nextAvailable(d).toLowerCase()}`}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  {service && <Link to={`/services/${service.slug}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-peri-700 backdrop-blur transition hover:bg-white"><ServiceIcon className="h-3.5 w-3.5" />{service.name}</Link>}
                  <h1 className="mt-3 flex items-center gap-2 font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl">{d.name}<BadgeCheck className="h-7 w-7 shrink-0 text-peri-600" aria-label="Verified specialist" /></h1>
                  <p className="mt-1 text-base font-medium text-slate-600">{d.role}</p>
                  <p className="mt-1 text-sm text-slate-500">{d.quals}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-peri-900 shadow-sm"><Stars value={d.rating} className="[&_svg]:h-3.5 [&_svg]:w-3.5" />{d.rating.toFixed(1)} · {d.reviews.toLocaleString('en-IN')}</span>
                    <button type="button" onClick={share} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-peri-700 shadow-sm transition hover:bg-peri-100"><Share2 className="h-3.5 w-3.5" />Share</button>
                  </div>
                </div>
              </div>

              <dl className="l-rise mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4" style={{ animationDelay: '220ms' }}>
                {[
                  [Stethoscope, `${d.exp}+ yrs`, 'Experience'],
                  [Users, `${(d.reviews * 6).toLocaleString('en-IN')}+`, 'Patients treated'],
                  [ThumbsUp, `${Math.round(d.rating * 20 - 2)}%`, 'Recommend'],
                  [Languages, `${d.langs.length}`, 'Languages'],
                ].map(([Icon, v, l]) => {
                  const I = Icon as typeof Users
                  return (
                    <div key={l as string} className="rounded-2xl border border-peri-200/80 bg-white/80 p-4 shadow-sm backdrop-blur">
                      <I className="h-5 w-5 text-peri-500" />
                      <dd className="mt-2 font-display text-xl font-extrabold text-peri-900">{v as string}</dd>
                      <dt className="text-xs text-slate-500">{l as string}</dt>
                    </div>
                  )
                })}
              </dl>

              <div className="mt-14 space-y-12">
                <Reveal>
                  <h2 className="font-display text-xl font-bold text-peri-900 sm:text-2xl">About</h2>
                  <p className="mt-3 text-base leading-relaxed text-slate-600">{d.bio}</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {d.expertise.map((e) => <span key={e} className="rounded-full border border-peri-200 bg-white px-3.5 py-1.5 text-sm font-medium text-peri-800">{e}</span>)}
                  </div>
                </Reveal>

                <Reveal>
                  <h2 className="flex items-center gap-2 font-display text-xl font-bold text-peri-900 sm:text-2xl"><GraduationCap className="h-6 w-6 text-peri-600" />Education & training</h2>
                  <ol className="relative mt-6 space-y-5 border-l-2 border-peri-200 pl-6">
                    {d.education.map((e) => (
                      <li key={e.degree} className="relative">
                        <span className="absolute -left-[33px] top-1 h-4 w-4 rounded-full border-4 border-white bg-peri-600 shadow" />
                        <p className="font-semibold text-peri-900">{e.degree}</p>
                        <p className="text-sm text-slate-500">{e.inst} · {e.year}</p>
                      </li>
                    ))}
                  </ol>
                  {d.awards && (
                    <ul className="mt-6 space-y-2">
                      {d.awards.map((a) => <li key={a} className="flex items-start gap-3 rounded-2xl bg-gradient-to-r from-amber-50 to-transparent p-3 text-sm text-slate-700"><Award className="h-5 w-5 shrink-0 text-amber-500" />{a}</li>)}
                    </ul>
                  )}
                </Reveal>

                <Reveal>
                  <h2 className="flex items-center gap-2 font-display text-xl font-bold text-peri-900 sm:text-2xl"><CalendarDays className="h-6 w-6 text-peri-600" />Weekly schedule</h2>
                  <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
                    {WEEK.map((w) => {
                      const on = d.days.includes(w) && !d.onLeave
                      return (
                        <div key={w} className={cn('rounded-xl py-3 text-center text-xs font-semibold', on ? 'bg-peri-800 text-white' : 'bg-slate-100 text-slate-400')}>
                          {w}<span className="mt-1 block text-[10px] font-medium opacity-80">{on ? 'OPD' : 'Off'}</span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Clock className="h-4 w-4 text-peri-500" />{d.time} · <MapPin className="h-4 w-4 text-peri-500" />OPD Block, {c.name}</p>
                </Reveal>

                <Reveal>
                  <div className="flex items-end justify-between">
                    <h2 className="font-display text-xl font-bold text-peri-900 sm:text-2xl">Patient reviews</h2>
                    <p className="text-sm text-slate-500"><strong className="text-peri-900">{d.rating.toFixed(1)}</strong> / 5 · {d.reviews.toLocaleString('en-IN')} reviews</p>
                  </div>
                  <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                    {reviews.map((r) => (
                      <li key={r.name} className="rounded-2xl border border-peri-200/80 bg-white p-5 shadow-sm">
                        <Stars value={r.rating} />
                        <p className="mt-3 text-sm leading-relaxed text-slate-700">“{r.text}”</p>
                        <p className="mt-4 text-xs font-semibold text-peri-900">{r.name} <span className="font-normal text-slate-400">· Verified patient</span></p>
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </div>
            </div>

            {/* booking card */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <div className="l-rise rounded-[2rem] border border-peri-200 bg-white p-6 shadow-[0_30px_70px_-30px_rgba(41,41,102,.35)]" style={{ animationDelay: '300ms' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-peri-500">Consultation fee</p>
                    <p className="font-display text-3xl font-extrabold text-peri-900">{inr(d.fee)}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">No booking fee</span>
                </div>

                <p className="mt-6 text-sm font-semibold text-peri-900">Select a date</p>
                <div className="mt-3 grid grid-cols-7 gap-1" role="radiogroup" aria-label="Date">
                  {days.map((x, i) => (
                    <button key={i} type="button" role="radio" aria-checked={day === i} disabled={!x.ok} onClick={() => { setDay(i); setSlot(null) }}
                      className={cn('rounded-xl py-2 text-center transition duration-300',
                        !x.ok ? 'cursor-not-allowed text-slate-300' : day === i ? 'bg-peri-800 text-white shadow-glow' : 'bg-peri-50 text-peri-800 hover:bg-peri-100')}>
                      <span className="block text-[10px] font-medium">{i === 0 ? 'Today' : x.dow}</span>
                      <span className="block text-sm font-bold">{x.date.getDate()}</span>
                    </button>
                  ))}
                </div>

                {d.onLeave || !selected?.ok ? (
                  <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                    {d.onLeave ? `${d.name} is currently on leave. Please choose another specialist or call us to be notified when bookings reopen.` : 'No OPD on this day. Please choose another date.'}
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    {(Object.entries(SLOTS) as [string, string[]][]).map(([part, slots]) => (
                      <div key={part}>
                        <p className="text-xs font-semibold capitalize text-slate-500">{part}</p>
                        <div className="mt-2 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`${part} slots`}>
                          {slots.map((s) => {
                            const taken = isTaken(d.slug, day, s)
                            return (
                              <button key={s} type="button" role="radio" aria-checked={slot === s} disabled={taken} onClick={() => setSlot(s)}
                                className={cn('rounded-lg border py-1.5 text-xs font-semibold transition',
                                  taken ? 'cursor-not-allowed border-transparent bg-slate-50 text-slate-300 line-through'
                                    : slot === s ? 'border-peri-700 bg-peri-800 text-white' : 'border-peri-200 text-peri-800 hover:border-peri-500')}>
                                {s}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button type="button" disabled={!slot} onClick={() => { toast.success(`Slot ${slot} held — sign in to confirm`); navigate(book) }}
                  className="btn-peri mt-6 w-full disabled:pointer-events-none disabled:opacity-50">
                  {slot ? <><Check className="h-4 w-4" />Continue with {selected.dow}, {slot}</> : <>Select a time slot</>}
                </button>
                <a href={c.tel} className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold text-peri-700 transition hover:text-peri-900"><Phone className="h-4 w-4" />or call {c.phone}</a>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {similar.length > 0 && (
        <section className="py-16 sm:py-24" aria-labelledby="similar-title">
          <div className="l-container">
            <div className="flex items-end justify-between gap-4">
              <Reveal as="h2" id="similar-title" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">You may also consider</Reveal>
              <Reveal><Link to="/find-a-doctor" className="hidden items-center gap-1.5 text-sm font-semibold text-peri-700 hover:text-peri-900 sm:inline-flex">All doctors<ArrowRight className="h-4 w-4" /></Link></Reveal>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {similar.map((x, i) => <DoctorCard key={x.slug} d={x} delay={i * 80} />)}
            </div>
          </div>
        </section>
      )}
    </>
  )
}

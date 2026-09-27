import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Car, CheckCircle2, Clock, Loader2, Mail, MapPin, MessageCircle, Phone, Send, Siren, Train } from 'lucide-react'
import { toast } from 'sonner'
import { HOSPITAL, cn } from '../../lib/utils'
import { SERVICES } from '../data/services'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { PageHero, TEL } from '../ui'

const TOPICS = ['Book an appointment', 'Billing & insurance', 'Medical records', 'Feedback or complaint', 'Careers', 'Something else']

const METHODS = [
  { icon: Siren, title: 'Emergency', value: HOSPITAL.phone, sub: 'Open 24×7 · Ambulance', href: TEL, tone: 'rose' },
  { icon: Phone, title: 'Appointments', value: '+91 11 4000 2200', sub: 'Mon–Sat, 8 AM – 9 PM', href: 'tel:+911140002200', tone: 'peri' },
  { icon: MessageCircle, title: 'WhatsApp', value: '+91 98100 40002', sub: 'Replies within 15 min', href: 'https://wa.me/919810040002', tone: 'emerald' },
  { icon: Mail, title: 'Email', value: HOSPITAL.email, sub: 'Replies within 24 hours', href: `mailto:${HOSPITAL.email}`, tone: 'peri' },
] as const

const HOURS: [string, string][] = [
  ['Emergency & ICU', '24 × 7'], ['OPD consultations', 'Mon–Sat · 8 AM – 9 PM'], ['Laboratory', '24 × 7'], ['Pharmacy', '24 × 7'], ['Visiting hours', '11–1 PM · 5–7 PM'], ['Billing desk', 'Daily · 8 AM – 10 PM'],
]

type Form = { name: string; phone: string; email: string; topic: string; dept: string; message: string; consent: boolean }
const EMPTY: Form = { name: '', phone: '', email: '', topic: TOPICS[0], dept: '', message: '', consent: false }

function validate(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {}
  if (f.name.trim().length < 2) e.name = 'Please enter your full name'
  if (!/^(\+91[\s-]?)?[6-9]\d{9}$/.test(f.phone.replace(/\s+/g, ''))) e.phone = 'Enter a valid 10-digit mobile number'
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address'
  if (f.message.trim().length < 10) e.message = 'Tell us a little more (at least 10 characters)'
  if (!f.consent) e.consent = 'Please accept to continue'
  return e
}

export default function Contact() {
  useSeo('Contact us', `Reach DC Hospital 24×7 at ${HOSPITAL.phone}. Visit us at ${HOSPITAL.address}, or send us a message online.`)
  const [f, setF] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [touched, setTouched] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [ref, setRef] = useState('')

  const up = <K extends keyof Form>(k: K, v: Form[K]) => {
    const next = { ...f, [k]: v }
    setF(next)
    if (touched) setErrors(validate(next))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    const errs = validate(f)
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields')
      document.getElementById(`c-${Object.keys(errs)[0]}`)?.focus()
      return
    }
    setState('sending')
    await new Promise((r) => setTimeout(r, 900))
    const id = `DCH-${Date.now().toString().slice(-6)}`
    try {
      const key = 'dch:enquiries:v1'
      const all = JSON.parse(localStorage.getItem(key) ?? '[]')
      localStorage.setItem(key, JSON.stringify([{ ...f, id, at: new Date().toISOString() }, ...all].slice(0, 50)))
    } catch { /* storage unavailable */ }
    setRef(id)
    setState('done')
    toast.success('Message sent — we’ll be in touch shortly')
  }

  const field = (k: keyof Form) => cn(
    'block w-full rounded-2xl border bg-white px-4 py-3 text-sm text-peri-900 outline-none transition placeholder:text-slate-400 focus:ring-4',
    errors[k] ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100' : 'border-peri-200 focus:border-peri-500 focus:ring-peri-200/60',
  )
  const Err = ({ k }: { k: keyof Form }) => errors[k] ? <p id={`c-${k}-err`} className="mt-1.5 animate-fade-in text-xs font-medium text-rose-600">{errors[k]}</p> : null

  return (
    <>
      <PageHero center crumbs={[{ label: 'Contact' }]} eyebrow="We’re here for you"
        title={<>Let’s talk about <span className="text-gradient">your health</span></>}
        lead="Questions about appointments, bills or reports? Our patient care team is available round the clock — call, WhatsApp or write to us." />

      {/* contact methods */}
      <section aria-label="Ways to reach us" className="pb-16">
        <div className="l-container grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {METHODS.map((m, i) => (
            <Reveal key={m.title} delay={i * 80}>
              <a href={m.href} target={m.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
                className="group flex h-full flex-col rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft transition duration-500 hover:-translate-y-1 hover:border-peri-300 hover:shadow-[0_24px_60px_-20px_rgba(41,41,102,.28)]">
                <span className={cn('grid h-12 w-12 place-items-center rounded-2xl transition duration-300 group-hover:scale-110',
                  m.tone === 'rose' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30' : m.tone === 'emerald' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-peri-100 text-peri-800 group-hover:bg-peri-800 group-hover:text-white')}>
                  <m.icon className="h-6 w-6" />
                </span>
                <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-peri-500">{m.title}</p>
                <p className="mt-1 break-all font-display text-lg font-bold text-peri-900">{m.value}</p>
                <p className="mt-1 text-xs text-slate-500">{m.sub}</p>
              </a>
            </Reveal>
          ))}
        </div>
      </section>

      {/* form + info */}
      <section className="pb-20 sm:pb-28" aria-labelledby="form-title">
        <div className="l-container grid grid-cols-1 gap-8 lg:grid-cols-[1.25fr_1fr]">
          <Reveal variant="left" className="relative overflow-hidden rounded-[2rem] border border-peri-200 bg-white/90 p-6 shadow-[0_30px_70px_-35px_rgba(41,41,102,.35)] backdrop-blur sm:p-10">
            <div aria-hidden="true" className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-peri-200/60 blur-3xl" />
            {state === 'done' ? (
              <div className="relative flex min-h-[520px] animate-pop-in flex-col items-center justify-center text-center" role="status">
                <span className="relative grid h-20 w-20 place-items-center">
                  <span className="motion-safe-only absolute inset-0 animate-pulse-ring rounded-full bg-emerald-300" />
                  <span className="relative grid h-20 w-20 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"><CheckCircle2 className="h-10 w-10" /></span>
                </span>
                <h2 className="mt-8 font-display text-2xl font-bold text-peri-900 sm:text-3xl">Thank you, {f.name.split(' ')[0]}!</h2>
                <p className="mt-3 max-w-sm text-slate-600">Your message has reached our patient care team. We’ll call you on <strong className="text-peri-900">{f.phone}</strong> within 2 working hours.</p>
                <p className="mt-6 rounded-full bg-peri-50 px-4 py-2 text-sm text-peri-800">Reference: <strong>{ref}</strong></p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <button type="button" onClick={() => { setF(EMPTY); setErrors({}); setTouched(false); setState('idle') }} className="btn-ghost">Send another message</button>
                  <Link to="/find-a-doctor" className="btn-peri">Find a doctor<ArrowRight className="h-4 w-4" /></Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="relative">
                <h2 id="form-title" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">Send us a message</h2>
                <p className="mt-2 text-sm text-slate-500">Fields marked * are required. For medical emergencies, please call {HOSPITAL.phone}.</p>
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="c-name" className="mb-1.5 block text-xs font-semibold text-peri-900">Full name *</label>
                    <input id="c-name" value={f.name} onChange={(e) => up('name', e.target.value)} autoComplete="name" placeholder="Priya Sharma" className={field('name')} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'c-name-err' : undefined} />
                    <Err k="name" />
                  </div>
                  <div>
                    <label htmlFor="c-phone" className="mb-1.5 block text-xs font-semibold text-peri-900">Mobile number *</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500">+91</span>
                      <input id="c-phone" value={f.phone} onChange={(e) => up('phone', e.target.value.replace(/[^\d\s+]/g, ''))} inputMode="tel" autoComplete="tel-national" placeholder="98100 12345" className={cn(field('phone'), 'pl-12')} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'c-phone-err' : undefined} />
                    </div>
                    <Err k="phone" />
                  </div>
                  <div>
                    <label htmlFor="c-email" className="mb-1.5 block text-xs font-semibold text-peri-900">Email <span className="font-normal text-slate-400">(optional)</span></label>
                    <input id="c-email" type="email" value={f.email} onChange={(e) => up('email', e.target.value)} autoComplete="email" placeholder="you@example.com" className={field('email')} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'c-email-err' : undefined} />
                    <Err k="email" />
                  </div>
                  <div>
                    <label htmlFor="c-dept" className="mb-1.5 block text-xs font-semibold text-peri-900">Speciality <span className="font-normal text-slate-400">(optional)</span></label>
                    <select id="c-dept" value={f.dept} onChange={(e) => up('dept', e.target.value)} className={cn(field('dept'), 'cursor-pointer')}>
                      <option value="">Not sure / general</option>
                      {SERVICES.map((s) => <option key={s.slug}>{s.name}</option>)}
                    </select>
                  </div>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-2 block text-xs font-semibold text-peri-900">How can we help? *</legend>
                    <div className="flex flex-wrap gap-2">
                      {TOPICS.map((t) => (
                        <label key={t} className={cn('cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition focus-within:ring-4 focus-within:ring-peri-200', f.topic === t ? 'border-peri-800 bg-peri-800 text-white' : 'border-peri-200 bg-white text-slate-600 hover:border-peri-400')}>
                          <input type="radio" name="topic" value={t} checked={f.topic === t} onChange={() => up('topic', t)} className="sr-only" />{t}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="sm:col-span-2">
                    <label htmlFor="c-message" className="mb-1.5 flex justify-between text-xs font-semibold text-peri-900">Message *<span className="font-normal text-slate-400">{f.message.length}/1000</span></label>
                    <textarea id="c-message" rows={5} maxLength={1000} value={f.message} onChange={(e) => up('message', e.target.value)} placeholder="Tell us how we can help…" className={cn(field('message'), 'resize-none')} aria-invalid={!!errors.message} aria-describedby={errors.message ? 'c-message-err' : undefined} />
                    <Err k="message" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-600">
                      <input id="c-consent" type="checkbox" checked={f.consent} onChange={(e) => up('consent', e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer rounded border-peri-300 accent-peri-800" aria-invalid={!!errors.consent} />
                      <span>I agree to be contacted by DC Hospital about my enquiry and accept the <Link to="/privacy" className="font-semibold text-peri-700 underline-offset-2 hover:underline">privacy policy</Link>.</span>
                    </label>
                    <Err k="consent" />
                  </div>
                </div>
                <button type="submit" disabled={state === 'sending'} className="btn-peri mt-8 w-full sm:w-auto disabled:opacity-70">
                  {state === 'sending' ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</> : <><Send className="h-4 w-4" />Send message</>}
                </button>
              </form>
            )}
          </Reveal>

          <div className="space-y-5">
            <Reveal variant="right" className="overflow-hidden rounded-[2rem] border border-peri-200 bg-white shadow-soft">
              <div className="relative aspect-[4/3] bg-peri-100">
                {/* placeholder shown until (or if) the map tiles load */}
                <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[linear-gradient(rgba(92,92,153,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(92,92,153,.12)_1px,transparent_1px)] [background-size:32px_32px]">
                  <span className="relative grid h-14 w-14 place-items-center"><span className="motion-safe-only absolute inset-0 animate-pulse-ring rounded-full bg-peri-400" /><span className="relative grid h-12 w-12 place-items-center rounded-full bg-peri-800 text-white shadow-glow"><MapPin className="h-6 w-6" /></span></span>
                </div>
                <iframe title="DC Hospital location map" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                  src="https://www.openstreetmap.org/export/embed.html?bbox=77.030%2C28.582%2C77.062%2C28.602&layer=mapnik&marker=28.5921%2C77.0460"
                  className="absolute inset-0 h-full w-full border-0 grayscale-[.3] saturate-[.8]" />
              </div>
              <div className="p-6">
                <p className="flex items-start gap-3 text-sm text-slate-700"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" /><span><strong className="block font-display text-base text-peri-900">{HOSPITAL.name}</strong>{HOSPITAL.address}</span></p>
                <a href="https://www.openstreetmap.org/?mlat=28.5921&mlon=77.0460#map=16/28.5921/77.0460" target="_blank" rel="noreferrer" className="btn-ghost mt-5 w-full">Get directions<ArrowRight className="h-4 w-4" /></a>
              </div>
            </Reveal>

            <Reveal variant="right" delay={100} className="rounded-[2rem] border border-peri-200 bg-white p-6 shadow-soft">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-peri-900"><Clock className="h-5 w-5 text-peri-600" />Hours</h2>
              <dl className="mt-4 divide-y divide-peri-100">
                {HOURS.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <dt className="text-slate-600">{k}</dt>
                    <dd className={cn('text-right font-semibold', v.includes('24') ? 'text-emerald-700' : 'text-peri-900')}>{v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            <Reveal variant="right" delay={180} className="rounded-[2rem] bg-gradient-to-br from-peri-100 to-peri-200/70 p-6">
              <h2 className="font-display text-lg font-bold text-peri-900">Getting here</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-700">
                <li className="flex gap-3"><Train className="mt-0.5 h-5 w-5 shrink-0 text-peri-700" />Dwarka Sector 21 Metro (Blue Line) — 6 min by e-rickshaw</li>
                <li className="flex gap-3"><Car className="mt-0.5 h-5 w-5 shrink-0 text-peri-700" />Free multi-level parking · Valet at main entrance</li>
                <li className="flex gap-3"><Siren className="mt-0.5 h-5 w-5 shrink-0 text-peri-700" />Dedicated emergency drop-off at Gate 2</li>
              </ul>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  )
}

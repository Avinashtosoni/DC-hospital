import { Link } from 'react-router-dom'
import { ArrowRight, Clock, Mail, MapPin, MessageCircle, Phone, Siren } from 'lucide-react'
import { usePublicForm } from '../../forms/api'
import { FormRenderer } from '../../forms/FormRenderer'
import { cn } from '../../lib/utils'
import { useContact, useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { PageHero } from '../ui'

export default function Contact() {
  const { contactPage: pg } = useSite()
  const c = useContact()
  useSeo(pg.seo.title, pg.seo.description)
  const METHODS = [
    { icon: Siren, title: 'Emergency', value: c.phone, sub: 'Open 24×7 · Ambulance', href: c.tel, tone: 'rose' },
    { icon: Phone, title: 'Appointments', value: c.appointmentsPhone, sub: 'Mon–Sat, 8 AM – 9 PM', href: c.appointmentsTel, tone: 'peri' },
    { icon: MessageCircle, title: 'WhatsApp', value: c.whatsapp, sub: 'Replies within 15 min', href: c.wa, tone: 'emerald' },
    { icon: Mail, title: 'Email', value: c.email, sub: 'Replies within 24 hours', href: c.mailto, tone: 'peri' },
  ].filter((m) => m.value.trim())
  const formQ = usePublicForm('contact')

  return (
    <>
      <PageHero center crumbs={[{ label: 'Contact' }]} eyebrow={pg.hero.eyebrow} title={pg.hero.title} lead={pg.hero.lead} />

      {/* contact methods */}
      <section aria-label="Ways to reach us" className="pb-16">
        <div className={cn('l-container grid gap-4 sm:grid-cols-2', METHODS.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
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
            {formQ.isPending ? (
              <div className="relative space-y-5" aria-busy="true" aria-label="Loading the form">
                <div className="h-8 w-2/3 animate-pulse rounded-xl bg-peri-100" />
                <div className="h-4 w-1/2 animate-pulse rounded-lg bg-peri-50" />
                <div className="grid gap-5 pt-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-peri-50" />)}</div>
                <div className="h-32 animate-pulse rounded-2xl bg-peri-50" />
              </div>
            ) : formQ.data ? (
              <FormRenderer key={formQ.data.updated_at} form={formQ.data} idPrefix="c" fallbackSuccessText={pg.successText}
                title={<h2 id="form-title" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">{pg.formTitle}</h2>}
                note={<p className="mt-2 text-sm text-slate-500">{pg.formNote}</p>}
                successActions={<Link to="/find-a-doctor" className="btn-peri">Find a doctor<ArrowRight className="h-4 w-4" /></Link>} />
            ) : (
              <div className="relative flex min-h-[320px] flex-col items-center justify-center text-center">
                <h2 id="form-title" className="font-display text-2xl font-bold text-peri-900">{formQ.isError ? 'The form could not be loaded' : 'Talk to us directly'}</h2>
                <p className="mt-3 max-w-sm text-slate-600">Please call us on <a href={c.tel} className="font-semibold text-peri-800">{c.phone}</a>{c.whatsapp ? <> or message us on <a href={c.wa} target="_blank" rel="noreferrer" className="font-semibold text-peri-800">WhatsApp</a></> : null}.</p>
              </div>
            )}
          </Reveal>

          <div className="space-y-5">
            <Reveal variant="right" className="overflow-hidden rounded-[2rem] border border-peri-200 bg-white shadow-soft">
              <div className="relative aspect-[4/3] bg-peri-100">
                {/* placeholder shown until (or if) the map tiles load */}
                <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-[linear-gradient(rgba(92,92,153,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(92,92,153,.12)_1px,transparent_1px)] [background-size:32px_32px]">
                  <span className="relative grid h-14 w-14 place-items-center"><span className="motion-safe-only absolute inset-0 animate-pulse-ring rounded-full bg-peri-400" /><span className="relative grid h-12 w-12 place-items-center rounded-full bg-peri-800 text-white shadow-glow"><MapPin className="h-6 w-6" /></span></span>
                </div>
                {c.map.embedUrl && <iframe title={`${c.name} location map`} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                  src={c.map.embedUrl}
                  className="absolute inset-0 h-full w-full border-0 grayscale-[.3] saturate-[.8]" />}
              </div>
              <div className="p-6">
                <p className="flex items-start gap-3 text-sm text-slate-700"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" /><span><strong className="block font-display text-base text-peri-900">{c.name}</strong>{c.address}</span></p>
                {c.map.directionsUrl && <a href={c.map.directionsUrl} target="_blank" rel="noreferrer" className="btn-ghost mt-5 w-full">Get directions<ArrowRight className="h-4 w-4" /></a>}
              </div>
            </Reveal>

            {c.hours.length > 0 && <Reveal variant="right" delay={100} className="rounded-[2rem] border border-peri-200 bg-white p-6 shadow-soft">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-peri-900"><Clock className="h-5 w-5 text-peri-600" />Hours</h2>
              <dl className="mt-4 divide-y divide-peri-100">
                {c.hours.map((h, i) => (
                  <div key={h.label + i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <dt className="text-slate-600">{h.label}</dt>
                    <dd className={cn('text-right font-semibold', h.highlight ? 'text-emerald-700' : 'text-peri-900')}>{h.value}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>}

            {c.directions.length > 0 && <Reveal variant="right" delay={180} className="rounded-[2rem] bg-gradient-to-br from-peri-100 to-peri-200/70 p-6">
              <h2 className="font-display text-lg font-bold text-peri-900">Getting here</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-700">
                {c.directions.map((d, i) => { const Icon = iconFor(d.icon); return <li key={i} className="flex gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-peri-700" />{d.text}</li> })}
              </ul>
            </Reveal>}
          </div>
        </div>
      </section>
    </>
  )
}

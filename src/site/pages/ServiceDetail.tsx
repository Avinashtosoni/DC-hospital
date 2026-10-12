import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CalendarCheck, CheckCircle2, Clock, Cpu, Phone, ShieldCheck, Stethoscope } from 'lucide-react'
import { doctorsForService, fillTokens, useContact, useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { Accordion, CtaBand, DoctorCard, PageHero, SectionHeader, useBookHref } from '../ui'
import NotFound from './NotFound'

export default function ServiceDetail() {
  const { slug } = useParams()
  const { services: SERVICES, doctors, servicesPage: pg } = useSite()
  const c = useContact()
  const s = SERVICES.find((x) => x.slug === slug)
  const book = useBookHref({ service: slug })
  useSeo(s ? `${s.name} — ${s.tagline}` : 'Service not found', s?.summary)
  if (!s) return <NotFound />

  const Icon = iconFor(s.icon)
  const docs = doctorsForService(doctors, s.slug)
  const idx = SERVICES.findIndex((x) => x.slug === s.slug)
  const related = SERVICES.length > 1 ? [1, 2, 3].map((k) => SERVICES[(idx + k) % SERVICES.length]).filter((r, i, a) => r.slug !== s.slug && a.indexOf(r) === i) : []
  const svcTokens = { service: s.name.toLowerCase() }
  const faqs = fillTokens(pg.detailFaqs, svcTokens)
  const cta = fillTokens(pg.detailCta, svcTokens)

  return (
    <>
      <PageHero
        crumbs={[{ label: 'Services', to: '/services' }, { label: s.name }]}
        eyebrow={s.tagline}
        title={<>{s.name.split(' ').slice(0, -1).join(' ')} <span className="text-gradient">{s.name.split(' ').slice(-1)}</span></>}
        lead={s.summary}
        aside={
          <div className="relative mx-auto w-full max-w-md">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-peri-300/70 to-transparent blur-2xl" />
            <div className="relative overflow-hidden rounded-[2.25rem] bg-peri-900 p-7 text-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.7)] sm:p-8">
              <div aria-hidden="true" className="absolute -right-14 -top-14 h-52 w-52 rounded-full bg-peri-500/50 blur-3xl" />
              <div aria-hidden="true" className="motion-safe-only absolute -bottom-10 -left-10 h-40 w-40 animate-drift rounded-full bg-peri-300/20 blur-3xl" />
              <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-white/15 backdrop-blur"><Icon className="h-8 w-8" /></span>
              {s.stats.length > 0 && <dl className="relative mt-8 grid grid-cols-3 gap-4">
                {s.stats.map(({ value: v, label: l }) => (
                  <div key={l}><dt className="sr-only">{l}</dt><dd className="whitespace-nowrap font-display text-lg font-extrabold sm:text-xl">{v}</dd><dd className="mt-1 text-[11px] leading-tight text-peri-300">{l}</dd></div>
                ))}
              </dl>}
              {s.hours && <p className="relative mt-8 flex items-start gap-2 rounded-2xl bg-white/10 p-3 text-xs text-peri-100"><Clock className="mt-0.5 h-4 w-4 shrink-0" />{s.hours}</p>}
            </div>
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Link to={book} className="btn-peri"><CalendarCheck className="h-4 w-4" />Book consultation</Link>
          <a href={c.tel} className="btn-ghost"><Phone className="h-4 w-4" />{c.phone}</a>
        </div>
      </PageHero>

      <section className="py-16 sm:py-24">
        <div className="l-container grid grid-cols-1 gap-12 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-16">
            <div>
              <Reveal as="h2" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">Overview</Reveal>
              {s.description.map((p, i) => <Reveal as="p" key={i} delay={80 + i * 80} className="mt-4 text-base leading-relaxed text-slate-600">{p}</Reveal>)}
            </div>

            {s.conditions.length > 0 && <div>
              <Reveal as="h2" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">Conditions we treat</Reveal>
              <Reveal delay={100} className="mt-6 flex flex-wrap gap-2">
                {s.conditions.map((c) => <span key={c} className="rounded-full border border-peri-200 bg-white px-4 py-2 text-sm font-medium text-peri-800 shadow-sm transition hover:-translate-y-0.5 hover:border-peri-400">{c}</span>)}
              </Reveal>
            </div>}

            {s.treatments.length > 0 && <div>
              <Reveal as="h2" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">Treatments & procedures</Reveal>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {s.treatments.map((t, i) => (
                  <Reveal as="li" key={t} delay={(i % 2) * 80} className="flex items-start gap-3 rounded-2xl border border-peri-200/80 bg-white p-4 shadow-sm transition hover:border-peri-300 hover:shadow-soft">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" /><span className="text-sm font-medium text-peri-900">{t}</span>
                  </Reveal>
                ))}
              </ul>
            </div>}

            {s.technology.length > 0 && <Reveal className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-peri-100 to-peri-200/70 p-6 sm:p-8">
              <div aria-hidden="true" className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/60 blur-2xl" />
              <h2 className="relative flex items-center gap-3 font-display text-xl font-bold text-peri-900"><Cpu className="h-6 w-6 text-peri-700" />Technology & infrastructure</h2>
              <ul className="relative mt-5 grid gap-3 sm:grid-cols-2">
                {s.technology.map((t) => <li key={t} className="flex items-center gap-2.5 rounded-xl bg-white/70 px-4 py-3 text-sm font-medium text-peri-900 backdrop-blur"><ShieldCheck className="h-4 w-4 text-peri-600" />{t}</li>)}
              </ul>
            </Reveal>}

            {faqs.length > 0 && <div>
              <Reveal as="h2" className="font-display text-2xl font-bold text-peri-900 sm:text-3xl">Frequently asked</Reveal>
              <div className="mt-6"><Accordion idPrefix={`svc-${s.slug}`} items={faqs} /></div>
            </div>}
          </div>

          {/* sticky sidebar */}
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <Reveal variant="right" className="space-y-4">
              <div className="rounded-[1.75rem] border border-peri-200 bg-white p-6 shadow-soft">
                <p className="font-display text-lg font-bold text-peri-900">Book a consultation</p>
                <p className="mt-1 text-sm text-slate-500">Confirmed instantly. No booking fee.</p>
                <Link to={book} className="btn-peri mt-5 w-full">Book now<ArrowRight className="h-4 w-4" /></Link>
                <a href={c.tel} className="btn-ghost mt-3 w-full"><Phone className="h-4 w-4" />Call {c.phone}</a>
                {s.hours && <p className="mt-5 flex items-start gap-2 border-t border-peri-100 pt-4 text-xs text-slate-500"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-peri-500" />{s.hours}</p>}
              </div>
              {related.length > 0 && <div className="rounded-[1.75rem] border border-peri-200 bg-white/80 p-5 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wider text-peri-500">Other specialities</p>
                <ul className="mt-3 space-y-1">
                  {related.map((r) => { const RIcon = iconFor(r.icon); return (
                    <li key={r.slug}>
                      <Link to={`/services/${r.slug}`} className="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-peri-50">
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-peri-100 text-peri-700 transition group-hover:bg-peri-800 group-hover:text-white"><RIcon className="h-4 w-4" /></span>
                        <span className="flex-1 text-sm font-medium text-peri-900">{r.name}</span>
                        <ArrowRight className="h-4 w-4 text-peri-300 transition group-hover:translate-x-0.5 group-hover:text-peri-700" />
                      </Link>
                    </li>
                  ) })}
                </ul>
              </div>}
            </Reveal>
          </aside>
        </div>
      </section>

      {/* specialists */}
      <section className="relative overflow-hidden py-20 sm:py-24" aria-labelledby="svc-docs">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/60 to-transparent" />
        <div className="l-container">
          <SectionHeader id="svc-docs" eyebrow="Your care team" title={<>Meet our <span className="text-gradient">{s.name.toLowerCase()}</span> specialists</>} />
          {docs.length > 0 ? (
            <div className="mx-auto mt-12 flex max-w-5xl flex-wrap justify-center gap-5">
              {docs.map((d, i) => <div key={d.slug} className="flex w-full sm:w-[calc(50%-10px)] lg:w-[calc(33.333%-14px)]"><DoctorCard d={d} delay={i * 90} /></div>)}
            </div>
          ) : (
            <Reveal className="mx-auto mt-10 max-w-md rounded-3xl border border-dashed border-peri-300 bg-white/70 p-8 text-center">
              <Stethoscope className="mx-auto h-8 w-8 text-peri-400" />
              <p className="mt-3 text-sm text-slate-600">Our specialist team rotates for this service. Call us and we’ll book you with the right doctor.</p>
            </Reveal>
          )}
          {c.pages.doctors !== false && <Reveal className="mt-10 flex justify-center"><Link to="/find-a-doctor" className="btn-ghost">Browse all doctors<ArrowRight className="h-4 w-4" /></Link></Reveal>}
        </div>
      </section>

      <CtaBand title={cta.title} lead={cta.lead} />
    </>
  )
}

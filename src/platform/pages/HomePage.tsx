import { ArrowRight, CheckCircle2, HeartPulse, Quote, Sparkles, Users, XCircle } from 'lucide-react'
import { platformName as platform } from '../../lib/supabase'
import { safeUrl } from '../../lib/safeUrl'
import { A, BrandMark, CtaBand, FaqList, Hi, IconCard, Section, SectionHead, useSeo } from '../site/ui'
import type { PlatformSite } from '../site/types'
import { PlanCards } from './shared'

export default function HomePage({ site }: { site: PlatformSite }) {
  const h = site.home
  useSeo(h.seo, site.brand.tagline)
  const heroImg = safeUrl(h.hero.image, 'image')
  const webImg = safeUrl(h.website.image, 'image')
  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-14 sm:pb-24 sm:pt-20">
        <div aria-hidden="true" className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#CCCCFF] opacity-60 blur-3xl" />
        <div aria-hidden="true" className="absolute -left-40 top-60 h-[420px] w-[420px] rounded-full bg-[#A3A3CC] opacity-30 blur-3xl" />
        <div className="l-container relative grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div className="text-center lg:text-left">
            {h.hero.badge && <span className="l-eyebrow"><Sparkles className="h-3.5 w-3.5" />{h.hero.badge}</span>}
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-peri-900 sm:text-5xl lg:text-[3.4rem]"><Hi text={h.hero.title} /></h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-600 lg:mx-0">{h.hero.lead}</p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              {h.hero.primary && <A to="/signup" className="btn-peri w-full sm:w-auto">{h.hero.primary}<ArrowRight className="h-4 w-4" /></A>}
              {h.hero.secondary && <A to="/contact" className="btn-ghost w-full sm:w-auto">{h.hero.secondary}</A>}
            </div>
            {h.hero.note && <p className="mt-5 text-sm text-slate-500">{h.hero.note}</p>}
          </div>
          {heroImg ? <img src={heroImg} alt="" className="mx-auto w-full max-w-[560px] rounded-[2rem] shadow-[0_40px_80px_-30px_rgba(41,41,102,.45)]" /> : <HeroCareVisual />}
        </div>
      </section>

      {h.stats.length > 0 && (
        <section aria-label="At a glance" className="pb-10">
          <div className="l-container">
            <dl className="grid grid-cols-2 gap-3 rounded-[2rem] border border-peri-200/80 bg-white/80 p-6 shadow-soft sm:p-8 lg:grid-cols-4">
              {h.stats.map((s) => (
                <div key={s.label} className="text-center">
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="font-display text-3xl font-extrabold text-peri-900 sm:text-4xl">{s.value}</dd>
                  <dd className="mt-1 text-sm text-slate-500">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {h.roles.items.length > 0 && (
        <section aria-label="Who uses it" className="py-8">
          <div className="l-container">
            <p className="text-center text-xs font-semibold uppercase tracking-[.2em] text-peri-500">{h.roles.title}</p>
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {h.roles.items.map((r) => (
                <li key={r.name} className="rounded-2xl border border-peri-200/80 bg-white/80 p-4 text-center shadow-soft">
                  <Users className="mx-auto h-5 w-5 text-peri-600" />
                  <p className="mt-2 font-display font-bold text-peri-900">{r.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{r.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {h.problems.before.length > 0 && (
        <Section>
          <SectionHead h={h.problems} />
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-rose-100 bg-white p-6 shadow-soft sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-rose-500">Without a system</p>
              <ul className="mt-5 space-y-3.5">{h.problems.before.map((t) => <li key={t} className="flex gap-3 text-slate-600"><XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />{t}</li>)}</ul>
            </div>
            <div className="rounded-[2rem] bg-[#292966] p-6 text-white shadow-soft sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-[#CCCCFF]">With {platform}</p>
              <ul className="mt-5 space-y-3.5">{h.problems.after.map((t) => <li key={t} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />{t}</li>)}</ul>
            </div>
          </div>
        </Section>
      )}

      <Section id="features">
        <SectionHead h={h.highlights} />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{h.highlights.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
        <p className="mt-10 text-center"><A to="/features" className="inline-flex items-center gap-1.5 font-semibold text-peri-700 hover:text-peri-500">See every feature<ArrowRight className="h-4 w-4" /></A></p>
      </Section>

      {h.steps.items.length > 0 && (
        <section className="py-8" aria-label="How it works">
          <div className="l-container">
            <ol className="grid gap-6 rounded-[2rem] bg-[#292966] p-6 text-white sm:grid-cols-3 sm:p-10">
              {h.steps.items.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#CCCCFF] font-display font-extrabold text-[#292966]">{i + 1}</span>
                  <div><p className="font-display text-lg font-bold">{s.title}</p><p className="mt-1 text-sm text-[#CCCCFF]">{s.text}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {h.india.items.length > 0 && (
        <Section>
          <SectionHead h={h.india} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{h.india.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
        </Section>
      )}

      {h.integrations.items.length > 0 && (
        <section aria-label={h.integrations.title} className="pb-8">
          <div className="l-container text-center">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-peri-500">{h.integrations.title}</p>
            <ul className="mt-5 flex flex-wrap justify-center gap-2.5">
              {h.integrations.items.map((t) => <li key={t} className="rounded-full border border-peri-200 bg-white px-4 py-2 text-sm font-semibold text-peri-800 shadow-soft">{t}</li>)}
            </ul>
          </div>
        </section>
      )}

      {h.website.title && (
        <Section>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHead h={h.website} className="!mx-0 !text-left" />
              <ul className="mt-8 space-y-3">
                {h.website.points.map((p) => <li key={p} className="flex gap-3 text-slate-700"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" />{p}</li>)}
              </ul>
            </div>
            {webImg ? <img src={webImg} alt="" loading="lazy" className="w-full rounded-[2rem] shadow-soft" /> : <SiteMock />}
          </div>
        </Section>
      )}

      <Section id="pricing">
        <SectionHead h={h.pricing} />
        <div className="mt-14"><PlanCards /></div>
        <p className="mt-8 text-center"><A to="/pricing" className="inline-flex items-center gap-1.5 font-semibold text-peri-700 hover:text-peri-500">Compare plans in detail<ArrowRight className="h-4 w-4" /></A></p>
      </Section>

      {h.testimonials.items.length > 0 && (
        <Section>
          <SectionHead h={h.testimonials} />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {h.testimonials.items.map((t) => {
              const photo = safeUrl(t.photo, 'image')
              return (
                <figure key={t.name + t.quote.slice(0, 10)} className="flex flex-col rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft">
                  <Quote className="h-7 w-7 text-peri-300" />
                  <blockquote className="mt-3 flex-1 leading-relaxed text-slate-700">{t.quote}</blockquote>
                  <figcaption className="mt-5 flex items-center gap-3">
                    {photo ? <img src={photo} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-[#CCCCFF] font-bold text-peri-900">{t.name.charAt(0)}</span>}
                    <span><span className="block font-semibold text-peri-900">{t.name}</span><span className="text-xs text-slate-500">{t.role}</span></span>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </Section>
      )}

      {h.faq.items.length > 0 && (
        <Section id="faq">
          <SectionHead h={h.faq} />
          <div className="mx-auto mt-12 max-w-3xl"><FaqList items={h.faq.items} /></div>
          <p className="mt-8 text-center"><A to="/faq" className="inline-flex items-center gap-1.5 font-semibold text-peri-700 hover:text-peri-500">More questions<ArrowRight className="h-4 w-4" /></A></p>
        </Section>
      )}

      <CtaBand cta={h.cta} />
    </>
  )
}

function HeroCareVisual() {
  const metrics = [['OPD today', '48'], ['Beds free', '12'], ['Collections', '₹1.8L']]
  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <figure className="relative isolate overflow-hidden rounded-[2rem] border border-white/80 bg-peri-100 shadow-[0_40px_80px_-30px_rgba(41,41,102,.45)]">
        <img
          src="/landing/indian-care-team.jpg"
          alt="An Indian doctor speaking with a patient in a modern hospital consultation room"
          className="aspect-[4/3] w-full object-cover object-center"
          fetchPriority="high"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#292966]/75 via-[#292966]/5 to-[#292966]/15" />
        <div className="absolute left-4 top-4 flex items-center gap-2.5 rounded-2xl border border-white/70 bg-white/95 px-3 py-2 shadow-lg backdrop-blur sm:left-5 sm:top-5">
          <BrandMark />
          <span>
            <span className="block font-display text-sm font-extrabold leading-tight text-peri-900">{platform}</span>
            <span className="mt-0.5 block text-[10px] font-medium text-slate-500">Made for Indian hospitals</span>
          </span>
        </div>
        <figcaption className="absolute bottom-16 left-5 right-5 text-white drop-shadow-sm sm:bottom-20 sm:left-7">
          <span className="text-[10px] font-bold uppercase tracking-[.2em] text-[#E0E0FF]">Care, connected</span>
          <p className="mt-1 max-w-sm font-display text-xl font-extrabold leading-tight sm:text-2xl">More time with patients. Less time chasing paperwork.</p>
        </figcaption>
      </figure>
      <div className="relative z-10 mx-3 -mt-8 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-[0_24px_60px_-24px_rgba(41,41,102,.5)] backdrop-blur-xl sm:mx-6 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-peri-800 text-white"><HeartPulse className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-bold text-peri-900">Hospital overview</span>
            <span className="block text-[11px] text-slate-500">Illustrative dashboard preview</span>
          </span>
          <span className="rounded-full bg-peri-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-peri-700">Sample</span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-peri-50/80 px-3 py-2.5">
              <dt className="truncate text-[10px] font-medium text-slate-500">{label}</dt>
              <dd className="mt-0.5 font-display text-lg font-extrabold leading-none text-peri-900">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/** illustrative hospital website (pure CSS) */
function SiteMock() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[520px] rounded-[2rem] border border-white bg-white/90 p-4 shadow-[0_40px_80px_-30px_rgba(41,41,102,.45)]">
      <div className="flex items-center gap-2 rounded-xl bg-peri-50 px-3 py-2 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-400" />Example preview · yourhospital.in</div>
      <div className="mt-3 rounded-2xl bg-gradient-to-br from-[#292966] to-[#5C5C99] p-5 text-white">
        <p className="font-display text-lg font-extrabold">Your Hospital</p>
        <p className="mt-1 text-xs text-[#CCCCFF]">Multi-speciality care, shaped around your team</p>
        <span className="mt-3 inline-block rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#292966]">Book appointment</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {['Cardiology', 'Paediatrics', 'Orthopaedics'].map((d) => (
          <div key={d} className="rounded-xl border border-peri-100 p-2 text-center">
            <span className="mx-auto block h-9 w-9 rounded-full bg-[#CCCCFF]" />
            <p className="mt-1.5 text-[10px] font-semibold text-peri-900">{d}</p>
            <p className="text-[9px] text-emerald-600">Slots today</p>
          </div>
        ))}
      </div>
    </div>
  )
}

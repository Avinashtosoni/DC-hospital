import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Search, X } from 'lucide-react'
import { doctorsForService, useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import { useSeo } from '../hooks'
import { Reveal, SpotlightCard } from '../parts'
import { CtaBand, FeatureIcon, PageHero, SectionHeader } from '../ui'

export default function Services() {
  const { servicesPage: pg, services: SERVICES, support: SUPPORT_SERVICES, doctors } = useSite()
  useSeo(pg.seo.title, pg.seo.description)
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return SERVICES
    return SERVICES.filter((s) => [s.name, s.tagline, s.summary, ...s.conditions, ...s.treatments].join(' ').toLowerCase().includes(t))
  }, [q, SERVICES])
  const featured = SERVICES.filter((s) => s.featured).slice(0, 3)

  return (
    <>
      <PageHero
        center
        crumbs={[{ label: 'Services' }]}
        eyebrow={pg.hero.eyebrow}
        title={pg.hero.title}
        lead={pg.hero.lead}
      >
        <div className="glass mx-auto flex max-w-xl items-center gap-3 rounded-full p-2 pl-5">
          <Search className="h-5 w-5 shrink-0 text-peri-500" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search a condition, treatment or speciality…" aria-label="Search services"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-peri-900 outline-none placeholder:text-slate-400" />
          {q && <button type="button" onClick={() => setQ('')} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-peri-100 hover:text-peri-800" aria-label="Clear search"><X className="h-4 w-4" /></button>}
          <span className="hidden rounded-full bg-peri-800 px-4 py-2 text-xs font-semibold text-white sm:block" aria-live="polite">{list.length} found</span>
        </div>
      </PageHero>

      {/* all specialities */}
      <section className="pb-20 sm:pb-28" aria-labelledby="all-title">
        <div className="l-container">
          <h2 id="all-title" className="sr-only">All specialities</h2>
          {list.length === 0 ? (
            <div className="mx-auto max-w-md animate-pop-in rounded-3xl border border-dashed border-peri-300 bg-white/70 p-10 text-center">
              <Search className="mx-auto h-8 w-8 text-peri-400" />
              <p className="mt-4 font-display text-lg font-bold text-peri-900">No matching services</p>
              <p className="mt-1 text-sm text-slate-500">Try a different keyword, or call us and we’ll guide you to the right specialist.</p>
              <button type="button" onClick={() => setQ('')} className="btn-ghost mt-6">Clear search</button>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((s, i) => {
                const n = doctorsForService(doctors, s.slug).length
                return (
                  <div key={s.slug} className="animate-pop-in" style={{ animationDelay: `${Math.min(i, 8) * 50}ms`, animationFillMode: 'both' }}>
                    <SpotlightCard as="article" className="h-full">
                      <Link to={`/services/${s.slug}`} className="flex h-full flex-col p-6 focus-visible:outline-none sm:p-7">
                        <div className="flex items-start justify-between">
                          <FeatureIcon icon={s.icon} />
                          <span className="grid h-9 w-9 place-items-center rounded-full border border-peri-200 text-peri-500 transition duration-300 group-hover:rotate-45 group-hover:border-peri-800 group-hover:bg-peri-800 group-hover:text-white"><ArrowUpRight className="h-4 w-4" /></span>
                        </div>
                        <h3 className="mt-5 font-display text-xl font-bold text-peri-900">{s.name}</h3>
                        <p className="mt-1 text-sm font-medium text-peri-600">{s.tagline}</p>
                        <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{s.summary}</p>
                        <div className="mt-5 flex flex-wrap gap-1.5">
                          {s.conditions.slice(0, 3).map((c) => <span key={c} className="rounded-full bg-peri-50 px-2.5 py-1 text-[11px] font-medium text-peri-700">{c}</span>)}
                        </div>
                        <p className="mt-5 border-t border-peri-100 pt-4 text-xs text-slate-500">{n > 0 ? `${n} specialist${n > 1 ? 's' : ''}` : 'Specialist team'} {s.stats[0] && <> · {s.stats[0].value} {s.stats[0].label.toLowerCase()}</>}</p>
                      </Link>
                    </SpotlightCard>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* featured centres */}
      {featured.length > 0 && <section className="relative overflow-hidden py-20 sm:py-28" aria-labelledby="coe-title">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/70 to-transparent" />
        <div className="l-container">
          <SectionHeader id="coe-title" eyebrow={pg.featured.eyebrow} title={pg.featured.title} />
          <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {featured.map((s, i) => { const Icon = iconFor(s.icon); return (
              <Reveal key={s.slug} delay={i * 110} variant="scale">
                <Link to={`/services/${s.slug}`} className={`group relative flex h-full flex-col overflow-hidden rounded-[2rem] p-7 transition duration-500 hover:-translate-y-1.5 sm:p-8 ${i === 1 ? 'bg-peri-900 text-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.7)]' : 'border border-peri-200 bg-white shadow-soft'}`}>
                  {i === 1 && <div aria-hidden="true" className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-peri-500/40 blur-3xl" />}
                  <span className={`relative grid h-14 w-14 place-items-center rounded-2xl ${i === 1 ? 'bg-white/15 text-white' : 'bg-peri-100 text-peri-800'}`}><Icon className="h-7 w-7" /></span>
                  <h3 className={`relative mt-6 font-display text-2xl font-bold ${i === 1 ? 'text-white' : 'text-peri-900'}`}>{s.name}</h3>
                  <p className={`relative mt-2 text-sm leading-relaxed ${i === 1 ? 'text-peri-200' : 'text-slate-600'}`}>{s.description[0]}</p>
                  <dl className="relative mt-8 grid grid-cols-3 gap-3 border-t pt-6 [border-color:inherit]">
                    {s.stats.map(({ value: v, label: l }) => (
                      <div key={l}>
                        <dt className="sr-only">{l}</dt>
                        <dd className={`font-display text-lg font-extrabold ${i === 1 ? 'text-white' : 'text-peri-900'}`}>{v}</dd>
                        <dd className={`text-[11px] leading-tight ${i === 1 ? 'text-peri-300' : 'text-slate-500'}`}>{l}</dd>
                      </div>
                    ))}
                  </dl>
                  <span className={`relative mt-8 inline-flex items-center gap-2 text-sm font-semibold transition-all group-hover:gap-3 ${i === 1 ? 'text-white' : 'text-peri-700'}`}>Explore {s.name}<ArrowRight className="h-4 w-4" /></span>
                </Link>
              </Reveal>
            ) })}
          </div>
        </div>
      </section>}

      {/* support services */}
      {SUPPORT_SERVICES.length > 0 && <section className="py-20 sm:py-24" aria-labelledby="support-title">
        <div className="l-container">
          <SectionHeader id="support-title" eyebrow={pg.support.eyebrow} title={pg.support.title} lead={pg.support.lead} />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SUPPORT_SERVICES.map((s, i) => { const Icon = iconFor(s.icon); return (
              <Reveal key={s.title} delay={(i % 4) * 80} className="group rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft transition duration-500 hover:-translate-y-1 hover:border-peri-300">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-peri-100 text-peri-700 transition duration-300 group-hover:rotate-[-6deg] group-hover:bg-peri-800 group-hover:text-white"><Icon className="h-5 w-5" /></span>
                <h3 className="mt-4 font-display text-base font-bold text-peri-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.text}</p>
              </Reveal>
            ) })}
          </div>
        </div>
      </section>}

      <CtaBand title={pg.cta.title} lead={pg.cta.lead} badge={pg.cta.badge} />
    </>
  )
}

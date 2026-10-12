import { Link } from 'react-router-dom'
import { ArrowRight, Award, BadgeCheck, Quote } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Rich, useSite } from '../cms/content'
import { useSeo } from '../hooks'
import { Counter, Reveal, SpotlightCard } from '../parts'
import { CtaBand, FeatureIcon, PageHero, SectionHeader } from '../ui'

const initialsOf = (n: string) => n.replace(/^Dr\.?\s+/i, '').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()

export default function About() {
  const { about: a, home, doctors, settings: { pages } } = useSite()
  useSeo(a.seo.title, a.seo.description)
  const STATS = home.stats
  const leaders = a.leadership.people
  const mosaic = doctors.slice(0, 6)

  return (
    <>
      <PageHero
        crumbs={[{ label: 'About us' }]}
        eyebrow={a.hero.eyebrow}
        title={a.hero.title}
        lead={a.hero.lead}
        aside={
          <div className="relative mx-auto max-w-[520px]">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-peri-300/70 to-transparent blur-2xl" />
            {mosaic.length === 0 && (
              <div className="relative overflow-hidden rounded-[2.5rem] border-[6px] border-white bg-peri-300 shadow-soft">
                <img src={a.mission.image} alt="" width={1100} height={821} className="aspect-[4/3.3] w-full object-cover" />
              </div>
            )}
            {mosaic.length > 0 && <div className="relative grid grid-cols-3 gap-3">
              {mosaic.map((d, i) => (
                <div key={d.slug} className={`overflow-hidden rounded-3xl border-4 border-white bg-peri-300 shadow-soft ${i % 3 === 1 ? 'translate-y-8' : ''}`}>
                  <img src={d.img} alt={d.name} width={280} height={280} className="aspect-square w-full object-cover transition duration-700 hover:scale-110" />
                </div>
              ))}
            </div>}
            {a.hero.badgeTitle && <div className="glass absolute -bottom-10 left-1/2 flex w-max -translate-x-1/2 items-center gap-3 rounded-2xl px-5 py-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-peri-800 text-white"><Award className="h-5 w-5" /></span>
              <div className="leading-tight"><p className="font-display text-lg font-extrabold text-peri-900">{a.hero.badgeTitle}</p><p className="text-xs text-slate-500">{a.hero.badgeText}</p></div>
            </div>}
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          {pages.doctors !== false
            ? <Link to="/find-a-doctor" className="btn-peri">Meet our doctors<ArrowRight className="h-4 w-4" /></Link>
            : <Link to="/book" className="btn-peri">Book an appointment<ArrowRight className="h-4 w-4" /></Link>}
          <Link to="/services" className="btn-ghost">Explore services</Link>
        </div>
      </PageHero>

      {/* stats */}
      {STATS.length > 0 && (
      <section aria-label="In numbers" className="pb-10 pt-16">
        <div className={cn('l-container grid grid-cols-2 gap-3 sm:gap-4', STATS.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 90} className="rounded-3xl border border-peri-200/80 bg-white/80 p-5 text-center shadow-soft sm:p-7">
              <p className="font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl"><Counter value={s.value} suffix={s.suffix} decimals={s.decimals} format={s.format} /></p>
              <p className="mt-1.5 text-xs font-medium text-slate-500 sm:text-sm">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>
      )}

      {/* mission / vision */}
      <section className="py-20 sm:py-24" aria-labelledby="mission-title">
        <div className="l-container grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <Reveal variant="left" className="relative">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-tr from-peri-300/60 to-transparent blur-2xl" />
            <div className="relative overflow-hidden rounded-[2.25rem] border-[6px] border-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.4)]">
              <img src={a.mission.image} alt="" width={1100} height={821} loading="lazy" className="aspect-[4/3.3] w-full object-cover" />
            </div>
            {a.mission.quote && <figure className="glass absolute -bottom-8 right-4 max-w-xs rounded-2xl p-5 sm:-right-6">
              <Quote className="h-6 w-6 text-peri-400" aria-hidden="true" />
              <blockquote className="mt-2 text-sm font-medium leading-relaxed text-peri-900">“{a.mission.quote}”</blockquote>
              {a.mission.quoteBy && <figcaption className="mt-3 text-xs text-slate-500">— {a.mission.quoteBy}</figcaption>}
            </figure>}
          </Reveal>
          <div>
            <SectionHeader id="mission-title" center={false} eyebrow={a.mission.eyebrow} title={a.mission.title} />
            <div className="mt-10 space-y-4">
              {a.mission.items.map((b, i) => (
                <Reveal key={b.title} delay={i * 100} className="group flex gap-4 rounded-2xl border border-transparent p-4 transition duration-300 hover:border-peri-200 hover:bg-white hover:shadow-soft">
                  <FeatureIcon icon={b.icon} />
                  <div><h3 className="font-display text-lg font-bold text-peri-900">{b.title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-600">{b.text}</p></div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* timeline */}
      {a.journey.milestones.length > 0 && (
      <section className="relative overflow-hidden py-20 sm:py-28" aria-labelledby="journey-title">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/60 to-transparent" />
        <div className="l-container">
          <SectionHeader id="journey-title" eyebrow={a.journey.eyebrow} title={a.journey.title} />
          <ol className="relative mx-auto mt-16 max-w-4xl">
            <span aria-hidden="true" className="absolute bottom-0 left-5 top-0 w-px bg-gradient-to-b from-peri-300 via-peri-500 to-peri-300 md:left-1/2" />
            {a.journey.milestones.map((m, i) => (
              <Reveal as="li" key={m.year + i} delay={80} variant={i % 2 ? 'right' : 'left'} className={`relative mb-10 pl-14 md:mb-12 md:w-1/2 ${i % 2 ? 'md:ml-auto md:pl-12' : 'md:pl-0 md:pr-12 md:text-right'}`}>
                <span className={`absolute left-0 top-1 grid h-10 w-10 place-items-center rounded-full bg-peri-800 text-[10px] font-bold text-white shadow-glow ring-8 ring-[#f6f6ff] md:left-auto ${i % 2 ? 'md:-left-5' : 'md:-right-5'}`}>{/^\d{4}$/.test(m.year) ? `’${m.year.slice(2)}` : '★'}</span>
                <div className="rounded-2xl border border-peri-200/80 bg-white p-5 shadow-soft transition duration-300 hover:-translate-y-1">
                  <p className="font-display text-sm font-bold text-peri-500">{m.year}</p>
                  <h3 className="mt-1 font-display text-lg font-bold text-peri-900">{m.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{m.text}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
      )}

      {/* values */}
      <section className="py-20 sm:py-24" aria-labelledby="values-title">
        <div className="l-container">
          <SectionHeader id="values-title" eyebrow={a.values.eyebrow} title={a.values.title} lead={a.values.lead} />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {a.values.items.map((v, i) => (
              <Reveal key={v.title} delay={(i % 3) * 90}>
                <SpotlightCard className="h-full p-6 sm:p-7">
                  <FeatureIcon icon={v.icon} />
                  <h3 className="mt-5 font-display text-lg font-bold text-peri-900">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{v.text}</p>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* leadership */}
      {leaders.length > 0 && (
      <section className="py-20 sm:py-24" aria-labelledby="leaders-title">
        <div className="l-container">
          <SectionHeader id="leaders-title" eyebrow={a.leadership.eyebrow} title={a.leadership.title} />
          <div className={cn('mt-14 grid gap-5 sm:grid-cols-2', leaders.length === 3 ? 'lg:grid-cols-3' : leaders.length <= 2 ? 'mx-auto max-w-3xl' : 'lg:grid-cols-4')}>
            {leaders.map((l, i) => (
              <Reveal key={l.name + i} delay={i * 90} className="group overflow-hidden rounded-[1.75rem] border border-peri-200/80 bg-white shadow-soft transition duration-500 hover:-translate-y-1.5">
                <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-peri-300 via-peri-400 to-peri-600">
                  {l.image
                    ? <img src={l.image} alt={l.name} width={560} height={560} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                    : (
                      <div className="grid h-full place-items-center p-6 text-center">
                        <div>
                          <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-white/20 font-display text-3xl font-extrabold text-white ring-4 ring-white/30 backdrop-blur">{initialsOf(l.name)}</span>
                          {l.quote && <p className="mt-5 text-sm font-medium italic leading-relaxed text-white/90">“{l.quote}”</p>}
                        </div>
                      </div>
                    )}
                </div>
                <div className="p-5">
                  <h3 className="font-display text-lg font-bold text-peri-900">{l.name}</h3>
                  <p className="text-sm text-slate-500">{l.role}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* accreditations */}
      {a.accreditations.items.length > 0 && (
      <section className="py-12" aria-labelledby="acc-title">
        <div className="l-container">
          <Reveal className="rounded-[2rem] border border-peri-200 bg-white/80 p-6 shadow-soft backdrop-blur sm:p-10">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_2fr]">
              <div>
                <span className="l-eyebrow">{a.accreditations.eyebrow}</span>
                <h2 id="acc-title" className="mt-3 font-display text-2xl font-bold text-peri-900 sm:text-3xl"><Rich text={a.accreditations.title} /></h2>
                <p className="mt-2 text-sm text-slate-600">{a.accreditations.lead}</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {a.accreditations.items.map((x) => (
                  <li key={x.title} className="flex items-center gap-3 rounded-2xl bg-peri-50 p-4 transition hover:bg-peri-100">
                    <BadgeCheck className="h-6 w-6 shrink-0 text-peri-700" />
                    <div><p className="text-sm font-semibold text-peri-900">{x.title}</p><p className="text-xs text-slate-500">{x.text}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>
      )}

      <CtaBand title={a.cta.title} lead={a.cta.lead} />
    </>
  )
}

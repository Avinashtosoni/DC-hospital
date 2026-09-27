import { Check, House, Minus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSite } from '../cms/content'
import { iconFor } from '../cms/icons'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { Accordion, CtaBand, PackagesGrid, PageHero, SectionHeader, inr } from '../ui'

const DAY_COLS: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }

export default function Packages() {
  const { packagesPage: pg, packages } = useSite()
  const PACKAGES = packages.items
  useSeo(pg.seo.title, pg.seo.description)
  const cell = (v: string) => { const t = v.trim().toLowerCase(); return t === 'yes' || t === 'true' ? true : t === '' || t === 'no' || t === 'false' ? false : v }
  return (
    <>
      <PageHero center crumbs={[{ label: 'Health packages' }]} eyebrow={pg.hero.eyebrow} title={pg.hero.title} lead={pg.hero.lead} />

      <section className="pb-20 sm:pb-28" aria-label="Packages">
        <div className="l-container -mt-6"><PackagesGrid /></div>
      </section>

      {/* compare */}
      {PACKAGES.length > 0 && packages.compare.length > 0 && <section className="py-16 sm:py-24" aria-labelledby="compare-title">
        <div className="l-container">
          <SectionHeader id="compare-title" eyebrow={pg.compare.eyebrow} title={pg.compare.title} lead={pg.compare.lead} />
          <Reveal className="mt-12 overflow-hidden rounded-[2rem] border border-peri-200 bg-white shadow-soft">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Comparison of health check-up packages</caption>
                <thead>
                  <tr className="bg-peri-50">
                    <th scope="col" className="w-2/5 px-6 py-5 text-left font-display text-base font-bold text-peri-900">Tests & services</th>
                    {PACKAGES.map((p) => (
                      <th key={p.name} scope="col" className={cn('px-4 py-5 text-center', p.popular && 'bg-peri-800 text-white')}>
                        <span className="block font-display text-base font-bold">{p.name}</span>
                        <span className={cn('text-xs font-medium', p.popular ? 'text-peri-200' : 'text-slate-500')}>{inr(p.price)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {packages.compare.map((g) => (
                  <tbody key={g.group}>
                    <tr><th colSpan={PACKAGES.length + 1} scope="colgroup" className="bg-white px-6 pb-2 pt-6 text-left text-xs font-semibold uppercase tracking-wider text-peri-500">{g.group}</th></tr>
                    {g.rows.map(({ label, cells }, ri) => (
                      <tr key={label + ri} className="border-t border-peri-100 transition hover:bg-peri-50/60">
                        <th scope="row" className="px-6 py-3.5 text-left font-medium text-slate-700">{label}</th>
                        {PACKAGES.map((_, i) => cell(cells[i] ?? '')).map((v, i) => (
                          <td key={i} className={cn('px-4 py-3.5 text-center', PACKAGES[i].popular && 'bg-peri-50/70')}>
                            {v === true ? <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-peri-800 text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /><span className="sr-only">Included</span></span>
                              : v === false ? <Minus className="mx-auto h-4 w-4 text-slate-300" aria-label="Not included" />
                                : <span className="text-xs font-semibold text-peri-800">{v}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </Reveal>
        </div>
      </section>}

      {/* check-up day */}
      <section className="relative overflow-hidden py-20 sm:py-28" aria-labelledby="day-title">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/70 to-transparent" />
        <div className="l-container">
          <SectionHeader id="day-title" eyebrow={pg.day.eyebrow} title={pg.day.title} lead={pg.day.lead} />
          <ol className={cn('relative mt-16 grid grid-cols-1 gap-6', DAY_COLS[Math.min(pg.day.steps.length, 6)] ?? 'md:grid-cols-5')}>
            <span aria-hidden="true" className="absolute left-6 right-6 top-7 hidden h-px bg-gradient-to-r from-peri-300 via-peri-500 to-peri-300 md:block" />
            {pg.day.steps.map((s, i) => { const Icon = iconFor(s.icon); return (
              <Reveal as="li" key={s.title + i} delay={i * 110} className="relative flex gap-4 md:block md:text-center">
                <span className="relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-peri-800 shadow-soft ring-8 ring-[#f3f3ff] md:mx-auto"><Icon className="h-6 w-6" /></span>
                <div className="md:mt-5">
                  <p className="text-xs font-semibold text-peri-500">{s.time}</p>
                  <h3 className="mt-1 font-display text-base font-bold text-peri-900">{s.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{s.text}</p>
                </div>
              </Reveal>
            ) })}
          </ol>
          {pg.homeCollection.title && <Reveal className="mx-auto mt-14 flex max-w-2xl items-center gap-4 rounded-3xl border border-peri-200 bg-white/80 p-5 shadow-soft backdrop-blur">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-peri-800 text-white"><House className="h-6 w-6" /></span>
            <div><p className="font-display font-bold text-peri-900">{pg.homeCollection.title}</p><p className="text-sm text-slate-600">{pg.homeCollection.text}</p></div>
          </Reveal>}
        </div>
      </section>

      {pg.faqs.length > 0 && <section className="py-16 sm:py-24" aria-labelledby="pkg-faq">
        <div className="l-container max-w-3xl">
          <SectionHeader id="pkg-faq" eyebrow={pg.faqTitle.eyebrow} title={pg.faqTitle.title} />
          <div className="mt-10"><Accordion idPrefix="pkg" items={pg.faqs} /></div>
        </div>
      </section>}

      <CtaBand title={pg.cta.title} lead={pg.cta.lead} badge={pg.cta.badge} />
    </>
  )
}

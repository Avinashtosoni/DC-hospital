import { ArrowRight, Building2, CheckCircle2, ClipboardList, Clock, Eye, Handshake, HeartHandshake, HeartPulse, Mail, MapPin, MessageCircle, Phone, Quote, ShieldCheck, Stethoscope, Target, Users, Wallet, XCircle } from 'lucide-react'
import { safeUrl } from '../../lib/safeUrl'
import { cn } from '../../lib/utils'
import { iconFor } from '../../site/cms/icons'
import { usePlans } from '../planStore'
import { A, CtaBand, FaqList, Hi, IconCard, PageHero, Section, SectionHead, StepsTimeline, useSeo } from '../site/ui'
import type { PlatformSite } from '../site/types'
import { ContactForm, PlanCards } from './shared'

type P = { site: PlatformSite }

export function FeaturesPage({ site }: P) {
  const c = site.features
  useSeo(c.seo, 'Features')
  return (
    <>
      <PageHero h={c.heading} />
      <section className="pb-8">
        <div className="l-container">
          <nav aria-label="Modules" className="flex flex-wrap justify-center gap-2">
            {c.modules.map((m, i) => <a key={m.title} href={`#m${i}`} className="rounded-full border border-peri-200 bg-white px-3.5 py-1.5 text-sm font-medium text-peri-800 hover:border-peri-400">{m.title}</a>)}
          </nav>
        </div>
      </section>
      <div className="l-container space-y-6 pb-8">
        {c.modules.map((m, i) => {
          const Icon = iconFor(m.icon)
          const img = safeUrl(m.image, 'image')
          return (
            <article key={m.title} id={`m${i}`} className="scroll-mt-24 grid items-center gap-8 rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-10 lg:grid-cols-2">
              <div className={cn(i % 2 === 1 && img && 'lg:order-2')}>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#CCCCFF] text-peri-900"><Icon className="h-6 w-6" /></span>
                <h2 className="mt-5 font-display text-2xl font-extrabold text-peri-900 sm:text-3xl">{m.title}</h2>
                {m.summary && <p className="mt-2 text-lg text-slate-600">{m.summary}</p>}
              </div>
              <div className={cn(img && 'space-y-6')}>
                {img && <img src={img} alt="" loading="lazy" className="w-full rounded-2xl" />}
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {m.points.map((p) => <li key={p} className="flex gap-3 text-slate-700"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" />{p}</li>)}
                </ul>
              </div>
            </article>
          )
        })}
      </div>
      {c.journey.items.length > 0 && (
        <Section>
          <SectionHead h={c.journey} />
          <div className="mt-12"><StepsTimeline items={c.journey.items} /></div>
        </Section>
      )}
      {c.byRole.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.byRole} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.byRole.items.map((r) => {
              const Icon = iconFor(r.icon)
              return (
                <div key={r.name} className="rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft">
                  <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#CCCCFF] text-peri-900"><Icon className="h-5 w-5" /></span><h3 className="font-display text-lg font-bold text-peri-900">{r.name}</h3></div>
                  <ul className="mt-4 space-y-2">{r.points.map((p) => <li key={p} className="flex gap-2.5 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-peri-600" />{p}</li>)}</ul>
                </div>
              )
            })}
          </div>
        </Section>
      )}
      {c.extras.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.extras} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{c.extras.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
        </Section>
      )}
      <CtaBand cta={c.cta} />
    </>
  )
}

export function PricingPage({ site }: P) {
  const c = site.pricing
  useSeo(c.seo, 'Pricing')
  const { plans } = usePlans()
  // the comparison table's columns are the CMS rows' clinic / hospital / enterprise values — names and order come live
  const cols = (['clinic', 'hospital', 'enterprise'] as const).map((id) => ({ id, name: plans.find((p) => p.id === id)?.name ?? id.replace(/^./, (c) => c.toUpperCase()) }))
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container pb-6"><PlanCards /></div>
      {c.note && <p className="l-container mx-auto max-w-3xl pb-6 text-center text-sm text-slate-500">{c.note}</p>}
      {c.included.items.length > 0 && (
        <Section className="!pb-0">
          <div className="rounded-[2rem] bg-[#292966] p-6 text-white sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-center">
              <div>
                {c.included.eyebrow && <p className="text-xs font-bold uppercase tracking-[.18em] text-[#CCCCFF]">{c.included.eyebrow}</p>}
                <h2 className="mt-2 font-display text-3xl font-extrabold">{c.included.title}</h2>
                {c.included.lead && <p className="mt-3 text-[#CCCCFF]">{c.included.lead}</p>}
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">{c.included.items.map((t) => <li key={t} className="flex gap-2.5 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{t}</li>)}</ul>
            </div>
          </div>
        </Section>
      )}
      {c.compare.rows.length > 0 && (
        <Section>
          <h2 className="text-center font-display text-3xl font-extrabold text-peri-900">{c.compare.title}</h2>
          <div className="mt-10 overflow-x-auto rounded-[1.5rem] border border-peri-200/80 bg-white shadow-soft">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-peri-100 bg-peri-50/60 text-left">
                  <th scope="col" className="px-5 py-4 font-semibold text-peri-900">Feature</th>
                  {cols.map((p) => <th key={p.id} scope="col" className="px-5 py-4 text-center font-display font-bold text-peri-900">{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {c.compare.rows.map((r) => (
                  <tr key={r.feature} className="border-b border-peri-100 last:border-0">
                    <th scope="row" className="px-5 py-3.5 text-left font-medium text-slate-700">{r.feature}</th>
                    {(['clinic', 'hospital', 'enterprise'] as const).map((k) => (
                      <td key={k} className={cn('px-5 py-3.5 text-center', r[k] === '✓' ? 'text-lg font-bold text-peri-600' : r[k] === '—' ? 'text-slate-300' : 'text-slate-600')}>
                        {r[k] === '✓' ? <><span aria-hidden="true">✓</span><span className="sr-only">Included</span></> : r[k] === '—' ? <><span aria-hidden="true">—</span><span className="sr-only">Not included</span></> : r[k]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {c.addons.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.addons} />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {c.addons.items.map((a) => (
              <div key={a.title} className="rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft">
                <p className="text-xs font-bold uppercase tracking-wider text-peri-500">{a.price}</p>
                <h3 className="mt-2 font-display text-lg font-bold text-peri-900">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{a.text}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {c.faqs.length > 0 && (
        <Section className="!pt-0">
          <h2 className="text-center font-display text-3xl font-extrabold text-peri-900">Pricing questions</h2>
          <div className="mx-auto mt-10 max-w-3xl"><FaqList items={c.faqs} /></div>
        </Section>
      )}
      <CtaBand cta={c.cta} />
    </>
  )
}

export function SolutionsPage({ site }: P) {
  const { plans } = usePlans()
  const c = site.solutions
  useSeo(c.seo, 'Solutions')
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container grid gap-6 pb-8 md:grid-cols-2">
        {c.items.map((s) => {
          const Icon = iconFor(s.icon)
          const plan = plans.find((p) => p.id === s.plan && !p.archived)
          const img = safeUrl(s.image, 'image')
          return (
            <article key={s.title} className="flex flex-col overflow-hidden rounded-[2rem] border border-peri-200/80 bg-white shadow-soft">
              {img && <img src={img} alt="" loading="lazy" className="h-48 w-full object-cover" />}
              <div className="flex flex-1 flex-col p-6 sm:p-8">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#CCCCFF] text-peri-900"><Icon className="h-6 w-6" /></span>
                <h2 className="mt-5 font-display text-2xl font-extrabold text-peri-900">{s.title}</h2>
                {s.lead && <p className="mt-1.5 text-slate-600">{s.lead}</p>}
                <ul className="mt-5 flex-1 space-y-2.5">
                  {s.points.map((p) => <li key={p} className="flex gap-3 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-peri-600" />{p}</li>)}
                </ul>
                {plan && (
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-peri-100 pt-5">
                    <p className="text-sm text-slate-500">Recommended: <b className="text-peri-900">{plan.name}</b>{plan.price ? ` · ₹${plan.price.toLocaleString('en-IN')}${plan.suffix ?? ''}/month` : ''}</p>
                    <A to={plan.id === 'clinic' || plan.id === 'hospital' ? `/signup?plan=${plan.id}` : `/contact?plan=${plan.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-peri-700 hover:text-peri-500">
                      {plan.id === 'clinic' || plan.id === 'hospital' ? 'Start free trial' : 'Talk to us'}<ArrowRight className="h-4 w-4" />
                    </A>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
      {c.specialities.items.length > 0 && (
        <Section>
          <SectionHead h={c.specialities} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{c.specialities.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
        </Section>
      )}
      {c.switching.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.switching} />
          <div className="mt-12"><StepsTimeline items={c.switching.items} /></div>
        </Section>
      )}
      <CtaBand cta={c.cta} />
    </>
  )
}

export function SecurityPage({ site }: P) {
  const c = site.security
  useSeo(c.seo, 'Security & privacy')
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container grid gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3">{c.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
      {c.compliance.points.length > 0 && (
        <Section>
          <div className="grid items-center gap-10 rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-10 lg:grid-cols-2">
            <SectionHead h={c.compliance} className="!mx-0 !text-left" />
            <ul className="space-y-3">
              {c.compliance.points.map((p) => <li key={p} className="flex gap-3 text-slate-700"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" />{p}</li>)}
            </ul>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            Read our <A to="/legal/privacy" className="font-medium text-peri-700 underline underline-offset-2">Privacy Policy</A>, <A to="/legal/dpa" className="font-medium text-peri-700 underline underline-offset-2">Data Processing Agreement</A> and <A to="/legal/sla" className="font-medium text-peri-700 underline underline-offset-2">Service Levels</A>.
          </p>
        </Section>
      )}
      {c.access.rows.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.access} />
          <div className="mt-10 overflow-x-auto rounded-[1.5rem] border border-peri-200/80 bg-white shadow-soft">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-peri-100 bg-peri-50/60 text-left"><th scope="col" className="px-5 py-4 font-semibold text-peri-900">Role</th><th scope="col" className="px-5 py-4 font-semibold text-peri-900">Can see & do</th><th scope="col" className="px-5 py-4 font-semibold text-peri-900">Can’t</th></tr></thead>
              <tbody>
                {c.access.rows.map((r) => (
                  <tr key={r.role} className="border-b border-peri-100 align-top last:border-0">
                    <th scope="row" className="whitespace-nowrap px-5 py-3.5 text-left font-semibold text-peri-900">{r.role}</th>
                    <td className="px-5 py-3.5 text-slate-700">{r.can}</td>
                    <td className="px-5 py-3.5 text-slate-500">{r.cannot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {c.faqs.length > 0 && (
        <Section className="!pt-0">
          <h2 className="text-center font-display text-3xl font-extrabold text-peri-900">Security questions</h2>
          <div className="mx-auto mt-10 max-w-3xl"><FaqList items={c.faqs} /></div>
        </Section>
      )}
      {c.note && <p className="l-container mx-auto max-w-2xl pb-4 text-center text-sm text-slate-600">{c.note}</p>}
      <CtaBand cta={c.cta} />
    </>
  )
}

export function AboutPage({ site }: P) {
  const c = site.about
  useSeo(c.seo, 'About us')
  const img = safeUrl(c.image, 'image')
  const company = c.company.rows.filter((r) => r.label && r.value.trim())
  const pillars = [{ ...c.mission, icon: Target }, { ...c.vision, icon: Eye }].filter((x) => x.title)
  return (
    <>
      {/* hero — heading on the left, picture (or an illustrated card) on the right */}
      <section className="relative overflow-hidden pb-12 pt-14 sm:pb-16 sm:pt-20">
        <div aria-hidden="true" className="absolute -right-32 -top-40 h-[460px] w-[460px] rounded-full bg-[#CCCCFF] opacity-60 blur-3xl" />
        <div aria-hidden="true" className="absolute -left-40 top-28 h-[340px] w-[340px] rounded-full bg-[#A3A3CC] opacity-25 blur-3xl" />
        <div className="l-container relative grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="text-center lg:text-left">
            <SectionHead h={c.heading} as="h1" className="lg:!mx-0 lg:!text-left" />
            {(c.buttons.primary || c.buttons.secondary) && (
              <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
                {c.buttons.primary && <A to="/signup" className="inline-flex items-center gap-2 rounded-full bg-[#292966] px-6 py-3 font-semibold text-white shadow-glow transition hover:bg-[#5C5C99]">{c.buttons.primary}<ArrowRight className="h-4 w-4" /></A>}
                {c.buttons.secondary && <A to="/contact" className="inline-flex items-center gap-2 rounded-full border border-peri-300 bg-white px-6 py-3 font-semibold text-peri-900 transition hover:border-peri-500">{c.buttons.secondary}</A>}
              </div>
            )}
          </div>
          {img ? <img src={img} alt="" className="w-full rounded-[2rem] object-cover shadow-soft" /> : <AboutArt />}
        </div>
        {c.highlights.length > 0 && (
          <div className="l-container relative mt-14">
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-peri-200/80 bg-peri-200/80 shadow-soft md:grid-cols-4">
              {c.highlights.map((h) => (
                <div key={h.label} className="bg-white px-5 py-6 text-center">
                  <dt className="sr-only">{h.label}</dt>
                  <dd className="font-display text-3xl font-extrabold text-peri-800 sm:text-4xl">{h.value}</dd>
                  <dd className="mt-1 text-sm text-slate-600">{h.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      {/* story — sticky heading + promise on the left, paragraphs on the right */}
      {c.story.length > 0 && (
        <Section className="!pt-4">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.4fr] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHead h={c.storyHeading} className="!mx-0 !text-left" />
              {c.promise.text && (
                <figure className="mt-8 rounded-3xl bg-gradient-to-br from-[#CCCCFF] to-[#A3A3CC]/60 p-6">
                  <Quote className="h-7 w-7 text-peri-700" aria-hidden="true" />
                  <blockquote className="mt-3 font-display text-lg font-bold leading-snug text-peri-900">{c.promise.text}</blockquote>
                  {c.promise.by && <figcaption className="mt-3 text-sm font-medium text-peri-700">— {c.promise.by}</figcaption>}
                </figure>
              )}
            </div>
            <div className="space-y-5 text-lg leading-relaxed text-slate-700 [&>p:first-child]:text-xl [&>p:first-child]:text-peri-900">
              {c.story.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>
        </Section>
      )}

      {/* mission & vision */}
      {pillars.length > 0 && (
        <Section className="!pt-0">
          <div className="grid gap-5 md:grid-cols-2">
            {pillars.map((x, i) => (
              <div key={x.title} className={cn('relative overflow-hidden rounded-[2rem] p-8 sm:p-10', i === 0 ? 'bg-[#292966] text-white' : 'bg-[#5C5C99] text-white')}>
                <div aria-hidden="true" className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#CCCCFF] opacity-20 blur-2xl" />
                <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><x.icon className="h-6 w-6 text-[#CCCCFF]" /></span>
                <h2 className="relative mt-5 font-display text-2xl font-extrabold">{x.title}</h2>
                <p className="relative mt-3 text-lg leading-relaxed text-[#E6E6FF]">{x.text}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* who we build for */}
      {c.audience.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.audience} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{c.audience.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
        </Section>
      )}

      {/* what makes us different — compare row by row */}
      {c.different.rows.length > 0 && (
        <section className="bg-gradient-to-b from-peri-50 to-white py-16 sm:py-20">
          <div className="l-container">
            <SectionHead h={c.different} />
            <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-[2rem] border border-peri-200/80 bg-white shadow-soft">
              <div className="hidden grid-cols-[0.8fr_1.2fr_1.2fr] border-b border-peri-200/80 text-sm font-bold uppercase tracking-wider md:grid">
                <span className="px-6 py-4 text-peri-500" />
                <span className="px-6 py-4 text-slate-500">{c.different.themLabel}</span>
                <span className="bg-[#292966] px-6 py-4 text-[#CCCCFF]">{c.different.usLabel}</span>
              </div>
              {c.different.rows.map((r, i) => (
                <div key={r.topic + i} className={cn('grid gap-2 px-6 py-5 md:grid-cols-[0.8fr_1.2fr_1.2fr] md:gap-0 md:p-0', i > 0 && 'border-t border-peri-100')}>
                  <p className="font-display font-bold text-peri-900 md:px-6 md:py-5">{r.topic}</p>
                  <p className="flex gap-2.5 text-slate-500 md:px-6 md:py-5"><XCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" aria-label={c.different.themLabel} />{r.them}</p>
                  <p className="flex gap-2.5 font-medium text-peri-900 md:bg-peri-50 md:px-6 md:py-5"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-peri-600" aria-label={c.different.usLabel} />{r.us}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {c.values.items.length > 0 && (
        <Section>
          <SectionHead h={c.values} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.values.items.map((it, i) => {
              const Icon = iconFor(it.icon)
              return (
                <div key={it.title} className="group relative overflow-hidden rounded-3xl border border-peri-200/80 bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-glow">
                  <span aria-hidden="true" className="absolute right-5 top-3 font-display text-6xl font-extrabold text-peri-100 transition group-hover:text-peri-200">{i + 1}</span>
                  <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-[#292966] text-[#CCCCFF]"><Icon className="h-6 w-6" /></span>
                  <h3 className="relative mt-5 font-display text-lg font-bold text-peri-900">{it.title}</h3>
                  {it.text && <p className="relative mt-2 text-sm leading-relaxed text-slate-600">{it.text}</p>}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* how we work — a vertical timeline */}
      {c.approach.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.approach} />
          <ol className="relative mx-auto mt-12 max-w-3xl space-y-6 before:absolute before:bottom-6 before:left-6 before:top-6 before:w-0.5 before:bg-gradient-to-b before:from-[#5C5C99] before:to-[#CCCCFF]">
            {c.approach.items.map((a, i) => (
              <li key={a.title + i} className="relative flex gap-5">
                <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border-4 border-white bg-[#292966] font-display font-extrabold text-white shadow-soft">{i + 1}</span>
                <div className="flex-1 rounded-3xl border border-peri-200/80 bg-white p-5 shadow-soft sm:p-6">
                  <h3 className="font-display text-lg font-bold text-peri-900">{a.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-slate-600">{a.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* commitments */}
      {c.commitments.items.length > 0 && (
        <section className="py-6 sm:py-10">
          <div className="l-container">
            <div className="relative overflow-hidden rounded-[2rem] bg-[#292966] px-6 py-12 sm:px-12 sm:py-14">
              <div aria-hidden="true" className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#5C5C99] opacity-60 blur-3xl" />
              <div className="relative grid gap-10 lg:grid-cols-[0.9fr_1.5fr] lg:items-center">
                <div>
                  {c.commitments.eyebrow && <p className="text-xs font-bold uppercase tracking-[.18em] text-[#A3A3CC]">{c.commitments.eyebrow}</p>}
                  <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl"><Hi text={c.commitments.title} hl="text-[#CCCCFF]" /></h2>
                  {c.commitments.lead && <p className="mt-4 text-[#CCCCFF]">{c.commitments.lead}</p>}
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {c.commitments.items.map((t) => (
                    <li key={t} className="flex gap-3 rounded-2xl bg-white/10 p-4 text-[#F0F0FF] ring-1 ring-white/10"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#CCCCFF]" />{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {c.team.items.length > 0 && (
        <Section>
          <SectionHead h={c.team} />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {c.team.items.map((t) => {
              const photo = safeUrl(t.photo, 'image')
              return (
                <div key={t.name} className="rounded-3xl border border-peri-200/80 bg-white p-6 text-center shadow-soft">
                  {photo ? <img src={photo} alt="" loading="lazy" className="mx-auto h-24 w-24 rounded-full object-cover ring-4 ring-[#CCCCFF]" /> : <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#CCCCFF] font-display text-2xl font-extrabold text-peri-900">{t.name.charAt(0)}</span>}
                  <p className="mt-4 font-display font-bold text-peri-900">{t.name}</p>
                  <p className="text-sm text-peri-600">{t.role}</p>
                  {t.bio && <p className="mt-3 text-sm leading-relaxed text-slate-600">{t.bio}</p>}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* company details + work with us */}
      {(company.length > 0 || c.partner.title) && (
        <Section>
          <div className={cn('grid gap-5', company.length > 0 && c.partner.title && 'lg:grid-cols-[1.3fr_1fr]')}>
            {company.length > 0 && (
              <div className="rounded-[2rem] border border-peri-200/80 bg-white p-6 shadow-soft sm:p-8">
                <SectionHead h={c.company} className="!mx-0 !text-left [&_h2]:!text-2xl" />
                <dl className="mt-6 divide-y divide-peri-100">
                  {company.map((r) => (
                    <div key={r.label} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
                      <dt className="text-sm font-semibold text-peri-500">{r.label}</dt>
                      <dd className="whitespace-pre-line break-words text-slate-800">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {c.partner.title && (
              <div className="flex flex-col justify-between rounded-[2rem] bg-gradient-to-br from-[#CCCCFF] to-[#A3A3CC] p-6 sm:p-8">
                <div>
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/70 text-peri-900"><Handshake className="h-6 w-6" /></span>
                  <h2 className="mt-5 font-display text-2xl font-extrabold text-peri-900">{c.partner.title}</h2>
                  {c.partner.text && <p className="mt-3 leading-relaxed text-peri-900/80">{c.partner.text}</p>}
                </div>
                {c.partner.button && <A to={c.partner.link || '/contact'} className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-[#292966] px-6 py-3 font-semibold text-white transition hover:bg-[#5C5C99]">{c.partner.button}<ArrowRight className="h-4 w-4" /></A>}
              </div>
            )}
          </div>
        </Section>
      )}
      <CtaBand cta={c.cta} />
    </>
  )
}

/** decorative hero card shown when no About picture is uploaded */
function AboutArt() {
  const roles = [[Stethoscope, 'Doctor'], [Users, 'Reception'], [Wallet, 'Accounts'], [Building2, 'Owner'], [HeartPulse, 'Patient'], [ClipboardList, 'Staff']] as const
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md">
      <div className="absolute inset-0 rotate-3 rounded-[2rem] bg-[#A3A3CC]/40" />
      <div className="relative rounded-[2rem] border border-peri-200/80 bg-white/90 p-6 shadow-lift backdrop-blur sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#292966] text-[#CCCCFF]"><HeartHandshake className="h-6 w-6" /></span>
          <div><p className="font-display font-bold text-peri-900">One hospital, one team</p><p className="text-sm text-slate-500">Everyone on the same page</p></div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {roles.map(([Icon, label]) => (
            <div key={label} className="rounded-2xl bg-peri-50 p-3 text-center ring-1 ring-peri-100">
              <Icon className="mx-auto h-6 w-6 text-peri-700" />
              <p className="mt-2 text-xs font-semibold text-peri-900">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-2.5">
          {[78, 56, 90].map((w, i) => <div key={i} className="h-2.5 rounded-full bg-peri-100"><div className="h-full rounded-full bg-gradient-to-r from-[#5C5C99] to-[#A3A3CC]" style={{ width: `${w}%` }} /></div>)}
        </div>
      </div>
      <div className="absolute -bottom-5 -left-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-lift ring-1 ring-peri-100">
        <ShieldCheck className="h-5 w-5 text-peri-600" /><span className="text-sm font-semibold text-peri-900">Private by design</span>
      </div>
    </div>
  )
}

export function ContactPage({ site, plan }: P & { plan: string | null }) {
  const c = site.contact, b = site.brand
  useSeo(c.seo, 'Contact us')
  const map = safeUrl(c.mapUrl, 'web')
  const wa = b.whatsapp.replace(/\D/g, '')
  const rows = [
    b.email && { icon: Mail, label: 'E-mail', value: b.email, href: `mailto:${b.email}` },
    b.phone && { icon: Phone, label: 'Phone', value: b.phone, href: `tel:${b.phone.replace(/[^\d+]/g, '')}` },
    wa && { icon: MessageCircle, label: 'WhatsApp', value: b.whatsapp, href: `https://wa.me/${wa.length === 10 ? `91${wa}` : wa}` },
    b.address && { icon: MapPin, label: 'Office', value: b.address },
    b.hours && { icon: Clock, label: 'Hours', value: b.hours },
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: string; href?: string }[]
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container grid gap-8 pb-16 lg:grid-cols-[1fr_1.6fr]">
        <aside className="space-y-4">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-4 rounded-2xl border border-peri-200/80 bg-white p-5 shadow-soft">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#CCCCFF] text-peri-900"><r.icon className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-peri-500">{r.label}</p>
                {r.href ? <a href={r.href} {...(r.href.startsWith('https') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="mt-0.5 block break-words font-medium text-peri-900 hover:text-peri-600">{r.value}</a> : <p className="mt-0.5 font-medium text-peri-900">{r.value}</p>}
              </div>
            </div>
          ))}
          <p className="px-1 text-sm text-slate-500">Complaints: see <A to="/legal/grievance" className="font-medium text-peri-700 underline underline-offset-2">Grievance Redressal</A>.</p>
        </aside>
        <ContactForm plan={plan} title={c.formTitle} thanks={c.thanks} />
      </div>
      {c.next.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.next} />
          <div className="mt-10"><StepsTimeline items={c.next.items} /></div>
        </Section>
      )}
      {c.faqs.length > 0 && (
        <Section className="!pt-0">
          <div className="mx-auto max-w-3xl"><FaqList items={c.faqs} /></div>
        </Section>
      )}
      {map && (
        <div className="l-container pb-16">
          <iframe src={map} title="Office location" loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-80 w-full rounded-[2rem] border border-peri-200/80" />
        </div>
      )}
    </>
  )
}

export function FaqPage({ site }: P) {
  const c = site.faq
  useSeo(c.seo, 'FAQ')
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container mx-auto max-w-3xl space-y-12 pb-8">
        {c.groups.filter((g) => g.items.length).map((g) => (
          <section key={g.title}>
            <h2 className="mb-4 font-display text-xl font-bold text-peri-900">{g.title}</h2>
            <FaqList items={g.items} />
          </section>
        ))}
      </div>
      <CtaBand cta={c.cta} />
    </>
  )
}

import { ArrowRight, CheckCircle2, Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react'
import { safeUrl } from '../../lib/safeUrl'
import { cn } from '../../lib/utils'
import { iconFor } from '../../site/cms/icons'
import { PLANS } from '../plans'
import { A, CtaBand, FaqList, IconCard, PageHero, Section, SectionHead, useSeo } from '../site/ui'
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
      {c.extras.items.length > 0 && (
        <Section>
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
  const cols = PLANS.filter((p) => p.id !== 'custom')
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container pb-6"><PlanCards /></div>
      {c.note && <p className="l-container mx-auto max-w-3xl pb-6 text-center text-sm text-slate-500">{c.note}</p>}
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
  const c = site.solutions
  useSeo(c.seo, 'Solutions')
  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container grid gap-6 pb-8 md:grid-cols-2">
        {c.items.map((s) => {
          const Icon = iconFor(s.icon)
          const plan = PLANS.find((p) => p.id === s.plan)
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
      {c.note && <p className="l-container mx-auto max-w-2xl pb-4 text-center text-sm text-slate-600">{c.note}</p>}
      <CtaBand cta={c.cta} />
    </>
  )
}

export function AboutPage({ site }: P) {
  const c = site.about
  useSeo(c.seo, 'About us')
  const img = safeUrl(c.image, 'image')
  return (
    <>
      <PageHero h={c.heading} />
      <Section className="!pt-4">
        <div className={cn('grid items-start gap-10', img && 'lg:grid-cols-2')}>
          <div className={cn('space-y-5 text-lg leading-relaxed text-slate-700', !img && 'mx-auto max-w-3xl')}>{c.story.map((p, i) => <p key={i}>{p}</p>)}</div>
          {img && <img src={img} alt="" loading="lazy" className="w-full rounded-[2rem] shadow-soft" />}
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {[c.mission, c.vision].filter((x) => x.title).map((x) => (
            <div key={x.title} className="rounded-[2rem] bg-[#292966] p-8 text-white">
              <h2 className="font-display text-xl font-bold">{x.title}</h2>
              <p className="mt-3 leading-relaxed text-[#CCCCFF]">{x.text}</p>
            </div>
          ))}
        </div>
      </Section>
      {c.values.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.values} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{c.values.items.map((it) => <IconCard key={it.title} item={it} />)}</div>
        </Section>
      )}
      {c.team.items.length > 0 && (
        <Section className="!pt-0">
          <SectionHead h={c.team} />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {c.team.items.map((t) => {
              const photo = safeUrl(t.photo, 'image')
              return (
                <div key={t.name} className="rounded-3xl border border-peri-200/80 bg-white p-6 text-center shadow-soft">
                  {photo ? <img src={photo} alt="" loading="lazy" className="mx-auto h-24 w-24 rounded-full object-cover" /> : <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#CCCCFF] font-display text-2xl font-extrabold text-peri-900">{t.name.charAt(0)}</span>}
                  <p className="mt-4 font-display font-bold text-peri-900">{t.name}</p>
                  <p className="text-sm text-peri-600">{t.role}</p>
                  {t.bio && <p className="mt-3 text-sm leading-relaxed text-slate-600">{t.bio}</p>}
                </div>
              )
            })}
          </div>
        </Section>
      )}
      <CtaBand cta={c.cta} />
    </>
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

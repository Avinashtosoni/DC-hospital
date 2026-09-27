import { Link } from 'react-router-dom'
import { ArrowRight, Award, BadgeCheck, Eye, HandHeart, HeartHandshake, Leaf, Lightbulb, Quote, ShieldCheck, Target, Users } from 'lucide-react'
import { STATS } from '../content'
import { DOCTORS, doctorBySlug } from '../data/doctors'
import { useSeo } from '../hooks'
import { Counter, Reveal, SpotlightCard } from '../parts'
import { CtaBand, FeatureIcon, PageHero, SectionHeader } from '../ui'

const MILESTONES = [
  { year: '2009', title: 'A 40-bed promise', text: 'DC Hospital opens in Dwarka with 40 beds, 6 doctors and one belief — every patient deserves to be heard.' },
  { year: '2013', title: 'Cardiac & critical care', text: 'Launch of our cath-lab, cardiac ICU and 24×7 emergency — the first in the neighbourhood.' },
  { year: '2017', title: 'Growing to 150 beds', text: 'New tower with modular OTs, level-III NICU and a dedicated mother & child wing.' },
  { year: '2021', title: 'Digital-first care', text: 'Online booking, e-prescriptions and reports-on-phone for every patient.' },
  { year: '2024', title: 'Centres of excellence', text: 'Neuro-sciences, joint replacement and diabetes reversal programmes established.' },
  { year: 'Today', title: '1.2 lakh+ families', text: '35+ specialists, 12 super-specialities and a patient portal that puts you in control.' },
]

const VALUES = [
  { icon: HandHeart, title: 'Compassion first', text: 'We treat every patient like family — with patience, dignity and warmth.' },
  { icon: ShieldCheck, title: 'Uncompromising safety', text: 'Infection control, medication safety and clinical audits built into every process.' },
  { icon: Eye, title: 'Radical transparency', text: 'Clear explanations, honest estimates and itemised bills. No surprises, ever.' },
  { icon: Lightbulb, title: 'Always improving', text: 'We adopt technology that makes care faster and kinder — never just for show.' },
  { icon: Users, title: 'Teamwork', text: 'Doctors, nurses and staff work as one team around each patient.' },
  { icon: Leaf, title: 'Responsible care', text: 'Green operations, fair pricing and free health camps for our community.' },
]

const ACCREDITATIONS = [
  { title: 'NABH-grade protocols', text: 'Patient safety & quality standards' },
  { title: 'NABL-standard lab', text: 'Accurate, audited diagnostics' },
  { title: 'ISO 9001:2015', text: 'Quality management systems' },
  { title: 'Green OT certified', text: 'Energy-efficient operation theatres' },
]

export default function About() {
  useSeo('About us', 'Since 2009, DC Hospital has cared for over 1.2 lakh families in Delhi NCR with compassion, safety and transparent, technology-first healthcare.')
  const leaders = [
    { name: 'Avinash Tosoni', role: 'Founder & Managing Director', img: null as string | null, quote: 'We built DC Hospital so that no family ever feels lost in a hospital again.' },
    ...(['vikram-singh', 'nikhil-joshi', 'lakshmi-reddy'] as const).map((s) => { const d = doctorBySlug(s)!; return { name: d.name, role: d.role, img: d.img, quote: '' } }),
  ]
  const mosaic = DOCTORS.slice(0, 6)

  return (
    <>
      <PageHero
        crumbs={[{ label: 'About us' }]}
        eyebrow="Our story"
        title={<>Healthcare with a <span className="text-gradient">human heart</span></>}
        lead="For more than 15 years, DC Hospital has combined senior specialists, modern technology and genuine warmth to deliver care that families across Delhi NCR trust."
        aside={
          <div className="relative mx-auto max-w-[520px]">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-peri-300/70 to-transparent blur-2xl" />
            <div className="relative grid grid-cols-3 gap-3">
              {mosaic.map((d, i) => (
                <div key={d.slug} className={`overflow-hidden rounded-3xl border-4 border-white bg-peri-300 shadow-soft ${i % 3 === 1 ? 'translate-y-8' : ''}`}>
                  <img src={d.img} alt={d.name} width={280} height={280} className="aspect-square w-full object-cover transition duration-700 hover:scale-110" />
                </div>
              ))}
            </div>
            <div className="glass absolute -bottom-10 left-1/2 flex w-max -translate-x-1/2 items-center gap-3 rounded-2xl px-5 py-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-peri-800 text-white"><Award className="h-5 w-5" /></span>
              <div className="leading-tight"><p className="font-display text-lg font-extrabold text-peri-900">Since 2009</p><p className="text-xs text-slate-500">Serving Delhi NCR</p></div>
            </div>
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Link to="/find-a-doctor" className="btn-peri">Meet our doctors<ArrowRight className="h-4 w-4" /></Link>
          <Link to="/services" className="btn-ghost">Explore services</Link>
        </div>
      </PageHero>

      {/* stats */}
      <section aria-label="DC Hospital in numbers" className="pb-10 pt-16">
        <div className="l-container grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 90} className="rounded-3xl border border-peri-200/80 bg-white/80 p-5 text-center shadow-soft sm:p-7">
              <p className="font-display text-3xl font-extrabold tracking-tight text-peri-900 sm:text-4xl"><Counter value={s.value} suffix={s.suffix} decimals={s.decimals} format={s.format} /></p>
              <p className="mt-1.5 text-xs font-medium text-slate-500 sm:text-sm">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* mission / vision */}
      <section className="py-20 sm:py-24" aria-labelledby="mission-title">
        <div className="l-container grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
          <Reveal variant="left" className="relative">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[3rem] bg-gradient-to-tr from-peri-300/60 to-transparent blur-2xl" />
            <div className="relative overflow-hidden rounded-[2.25rem] border-[6px] border-white shadow-[0_40px_80px_-30px_rgba(41,41,102,.4)]">
              <img src="/landing/care.webp" alt="A calm, sunlit private room at DC Hospital" width={1100} height={821} loading="lazy" className="aspect-[4/3.3] w-full object-cover" />
            </div>
            <figure className="glass absolute -bottom-8 right-4 max-w-xs rounded-2xl p-5 sm:-right-6">
              <Quote className="h-6 w-6 text-peri-400" aria-hidden="true" />
              <blockquote className="mt-2 text-sm font-medium leading-relaxed text-peri-900">“Good medicine starts with listening. Everything else follows.”</blockquote>
              <figcaption className="mt-3 text-xs text-slate-500">— Dr. Vikram Singh, Medical Director</figcaption>
            </figure>
          </Reveal>
          <div>
            <SectionHeader id="mission-title" center={false} eyebrow="Why we exist" title={<>Care that is <span className="text-gradient">personal, safe & honest</span></>} />
            <div className="mt-10 space-y-4">
              {[
                { icon: Target, title: 'Our mission', text: 'To deliver world-class, affordable healthcare with compassion — making every patient feel informed, respected and safe.' },
                { icon: Eye, title: 'Our vision', text: 'To be North India’s most trusted family hospital, where technology makes care simpler and kinder for everyone.' },
                { icon: HeartHandshake, title: 'Our promise', text: 'Senior doctors, transparent costs and a care team that picks up the phone — at 3 PM or 3 AM.' },
              ].map((b, i) => (
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
      <section className="relative overflow-hidden py-20 sm:py-28" aria-labelledby="journey-title">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/60 to-transparent" />
        <div className="l-container">
          <SectionHeader id="journey-title" eyebrow="Our journey" title={<>From 40 beds to <span className="text-gradient">1.2 lakh families</span></>} />
          <ol className="relative mx-auto mt-16 max-w-4xl">
            <span aria-hidden="true" className="absolute bottom-0 left-5 top-0 w-px bg-gradient-to-b from-peri-300 via-peri-500 to-peri-300 md:left-1/2" />
            {MILESTONES.map((m, i) => (
              <Reveal as="li" key={m.year} delay={80} variant={i % 2 ? 'right' : 'left'} className={`relative mb-10 pl-14 md:mb-12 md:w-1/2 ${i % 2 ? 'md:ml-auto md:pl-12' : 'md:pl-0 md:pr-12 md:text-right'}`}>
                <span className={`absolute left-0 top-1 grid h-10 w-10 place-items-center rounded-full bg-peri-800 text-[10px] font-bold text-white shadow-glow ring-8 ring-[#f6f6ff] md:left-auto ${i % 2 ? 'md:-left-5' : 'md:-right-5'}`}>{m.year === 'Today' ? '★' : `’${m.year.slice(2)}`}</span>
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

      {/* values */}
      <section className="py-20 sm:py-24" aria-labelledby="values-title">
        <div className="l-container">
          <SectionHeader id="values-title" eyebrow="Our values" title={<>What guides <span className="text-gradient">every decision</span></>} lead="Six principles every member of our 900-strong team lives by — from surgeons to security." />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {VALUES.map((v, i) => (
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
      <section className="py-20 sm:py-24" aria-labelledby="leaders-title">
        <div className="l-container">
          <SectionHeader id="leaders-title" eyebrow="Leadership" title={<>The people <span className="text-gradient">behind the care</span></>} />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {leaders.map((l, i) => (
              <Reveal key={l.name} delay={i * 90} className="group overflow-hidden rounded-[1.75rem] border border-peri-200/80 bg-white shadow-soft transition duration-500 hover:-translate-y-1.5">
                <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-peri-300 via-peri-400 to-peri-600">
                  {l.img
                    ? <img src={l.img} alt={l.name} width={560} height={560} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                    : (
                      <div className="grid h-full place-items-center p-6 text-center">
                        <div>
                          <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-white/20 font-display text-3xl font-extrabold text-white ring-4 ring-white/30 backdrop-blur">AT</span>
                          <p className="mt-5 text-sm font-medium italic leading-relaxed text-white/90">“{l.quote}”</p>
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

      {/* accreditations */}
      <section className="py-12" aria-labelledby="acc-title">
        <div className="l-container">
          <Reveal className="rounded-[2rem] border border-peri-200 bg-white/80 p-6 shadow-soft backdrop-blur sm:p-10">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_2fr]">
              <div>
                <span className="l-eyebrow">Quality & safety</span>
                <h2 id="acc-title" className="mt-3 font-display text-2xl font-bold text-peri-900 sm:text-3xl">Certified to care</h2>
                <p className="mt-2 text-sm text-slate-600">Independent standards that hold us accountable, every single day.</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {ACCREDITATIONS.map((a) => (
                  <li key={a.title} className="flex items-center gap-3 rounded-2xl bg-peri-50 p-4 transition hover:bg-peri-100">
                    <BadgeCheck className="h-6 w-6 shrink-0 text-peri-700" />
                    <div><p className="text-sm font-semibold text-peri-900">{a.title}</p><p className="text-xs text-slate-500">{a.text}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <CtaBand title={<>Experience care that <span className="text-peri-300">feels different.</span></>} lead="Join 1.2 lakh+ families who trust DC Hospital with their health." />
    </>
  )
}

import { Check, ClipboardList, Coffee, FileCheck2, House, Minus, Stethoscope, Syringe } from 'lucide-react'
import { cn } from '../../lib/utils'
import { FAQ_GROUPS, PACKAGES, PACKAGE_COMPARE } from '../content'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { Accordion, CtaBand, PackagesGrid, PageHero, SectionHeader, inr } from '../ui'

const DAY = [
  { icon: ClipboardList, time: '7:30 AM', title: 'Check-in', text: 'Quick registration at our dedicated health check lounge — no queues.' },
  { icon: Syringe, time: '7:45 AM', title: 'Samples & vitals', text: 'Fasting blood & urine samples, BP, BMI and body composition.' },
  { icon: Coffee, time: '8:15 AM', title: 'Healthy breakfast', text: 'Complimentary breakfast while you wait for the next tests.' },
  { icon: Stethoscope, time: '9:00 AM', title: 'Scans & consults', text: 'ECG, X-ray, ultrasound and specialist consultations as per package.' },
  { icon: FileCheck2, time: 'Same day', title: 'Reports & review', text: 'Reports on your phone and a doctor review of every result.' },
]

export default function Packages() {
  useSeo('Health check-up packages', 'Doctor-designed preventive health check-up packages from ₹1,499 with same-day reports, specialist consultation and home sample collection.')
  const faqs = [
    { q: 'Do I need to fast before my health check?', a: 'Yes — please fast for 10–12 hours before your appointment (water is allowed). Take your regular BP or thyroid medicines unless your doctor says otherwise.' },
    { q: 'How long does the check-up take?', a: 'Essential takes about 2 hours, Comprehensive about 3 hours and Executive about 4 hours, including breakfast and consultations.' },
    { q: 'Can samples be collected at home?', a: 'Yes, blood and urine samples can be collected at home across Delhi NCR. Imaging and consultations are done at the hospital at a time of your choice.' },
    ...FAQ_GROUPS[1].items.slice(0, 2),
  ]
  return (
    <>
      <PageHero center crumbs={[{ label: 'Health packages' }]} eyebrow="Preventive health"
        title={<>Know your health. <span className="text-gradient">Stay ahead of it.</span></>}
        lead="Doctor-designed check-ups that catch problems early — with same-day reports and a specialist to explain every result." />

      <section className="pb-20 sm:pb-28" aria-label="Packages">
        <div className="l-container -mt-6"><PackagesGrid /></div>
      </section>

      {/* compare */}
      <section className="py-16 sm:py-24" aria-labelledby="compare-title">
        <div className="l-container">
          <SectionHeader id="compare-title" eyebrow="Compare" title={<>What’s <span className="text-gradient">included</span></>} lead="Every package includes a doctor consultation and online reports." />
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
                {PACKAGE_COMPARE.map((g) => (
                  <tbody key={g.group}>
                    <tr><th colSpan={4} scope="colgroup" className="bg-white px-6 pb-2 pt-6 text-left text-xs font-semibold uppercase tracking-wider text-peri-500">{g.group}</th></tr>
                    {g.rows.map(([label, ...vals]) => (
                      <tr key={label} className="border-t border-peri-100 transition hover:bg-peri-50/60">
                        <th scope="row" className="px-6 py-3.5 text-left font-medium text-slate-700">{label}</th>
                        {vals.map((v, i) => (
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
      </section>

      {/* check-up day */}
      <section className="relative overflow-hidden py-20 sm:py-28" aria-labelledby="day-title">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-peri-100/70 to-transparent" />
        <div className="l-container">
          <SectionHeader id="day-title" eyebrow="Your check-up day" title={<>Done by <span className="text-gradient">breakfast time</span></>} lead="A smooth, guided morning — with a care coordinator by your side at every step." />
          <ol className="relative mt-16 grid grid-cols-1 gap-6 md:grid-cols-5">
            <span aria-hidden="true" className="absolute left-6 right-6 top-7 hidden h-px bg-gradient-to-r from-peri-300 via-peri-500 to-peri-300 md:block" />
            {DAY.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 110} className="relative flex gap-4 md:block md:text-center">
                <span className="relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-peri-800 shadow-soft ring-8 ring-[#f3f3ff] md:mx-auto"><s.icon className="h-6 w-6" /></span>
                <div className="md:mt-5">
                  <p className="text-xs font-semibold text-peri-500">{s.time}</p>
                  <h3 className="mt-1 font-display text-base font-bold text-peri-900">{s.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{s.text}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Reveal className="mx-auto mt-14 flex max-w-2xl items-center gap-4 rounded-3xl border border-peri-200 bg-white/80 p-5 shadow-soft backdrop-blur">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-peri-800 text-white"><House className="h-6 w-6" /></span>
            <div><p className="font-display font-bold text-peri-900">Prefer home collection?</p><p className="text-sm text-slate-600">Our phlebotomist visits between 6 and 10 AM across Delhi NCR — at no extra cost on Comprehensive & Executive.</p></div>
          </Reveal>
        </div>
      </section>

      <section className="py-16 sm:py-24" aria-labelledby="pkg-faq">
        <div className="l-container max-w-3xl">
          <SectionHeader id="pkg-faq" eyebrow="Good to know" title={<>Before your <span className="text-gradient">check-up</span></>} />
          <div className="mt-10"><Accordion idPrefix="pkg" items={faqs} /></div>
        </div>
      </section>

      <CtaBand title={<>Give your family the gift of <span className="text-peri-300">early detection.</span></>} lead="Book a package for yourself or a loved one — couples save 10%." badge="Couples save 10%" />
    </>
  )
}

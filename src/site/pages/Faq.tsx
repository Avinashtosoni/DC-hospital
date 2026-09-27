import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Mail, MessageCircleQuestion, Phone, Search, X } from 'lucide-react'
import { HOSPITAL, cn } from '../../lib/utils'
import { FAQ_GROUPS } from '../content'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { Accordion, PageHero, TEL } from '../ui'

export default function Faq() {
  useSeo('Frequently asked questions', 'Answers about appointments, insurance, billing, reports, visiting hours and emergency care at DC Hospital.')
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    return FAQ_GROUPS
      .filter((g) => tab === 'all' || g.id === tab)
      .map((g) => ({ ...g, items: g.items.filter((i) => !t || (i.q + i.a).toLowerCase().includes(t)) }))
      .filter((g) => g.items.length)
  }, [tab, q])
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      <PageHero center crumbs={[{ label: 'FAQ' }]} eyebrow="Help centre"
        title={<>How can we <span className="text-gradient">help you?</span></>}
        lead="Quick answers to the questions patients ask us most.">
        <div className="glass mx-auto flex max-w-xl items-center gap-3 rounded-full p-2 pl-5">
          <Search className="h-5 w-5 shrink-0 text-peri-500" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search questions…" aria-label="Search FAQs" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-peri-900 outline-none placeholder:text-slate-400" />
          {q && <button type="button" onClick={() => setQ('')} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-peri-100" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </div>
      </PageHero>

      <section className="pb-20 sm:pb-28">
        <div className="l-container grid grid-cols-1 gap-10 lg:grid-cols-[260px_1fr]">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <nav aria-label="FAQ categories" className="mask-fade-x -mx-5 overflow-x-auto px-5 lg:mx-0 lg:overflow-visible lg:px-0 lg:[mask-image:none]">
              <ul className="flex w-max gap-1.5 lg:w-auto lg:flex-col">
                {[{ id: 'all', title: 'All questions', n: FAQ_GROUPS.reduce((n, g) => n + g.items.length, 0) }, ...FAQ_GROUPS.map((g) => ({ id: g.id, title: g.title, n: g.items.length }))].map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setTab(c.id)} aria-pressed={tab === c.id}
                      className={cn('flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-2xl px-4 py-2.5 text-left text-sm font-semibold transition',
                        tab === c.id ? 'bg-peri-800 text-white shadow-glow' : 'bg-white text-slate-600 hover:bg-peri-50 hover:text-peri-800 lg:bg-transparent')}>
                      {c.title}<span className={cn('rounded-full px-2 py-0.5 text-[10px]', tab === c.id ? 'bg-white/20' : 'bg-peri-100 text-peri-700')}>{c.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="mt-6 hidden rounded-3xl bg-peri-900 p-6 text-white lg:block">
              <MessageCircleQuestion className="h-8 w-8 text-peri-300" />
              <p className="mt-4 font-display text-lg font-bold">Still need help?</p>
              <p className="mt-1 text-sm text-peri-200">Our care team is available 24×7.</p>
              <a href={TEL} className="mt-5 flex items-center justify-center gap-2 rounded-full bg-white py-2.5 text-sm font-semibold text-peri-900 transition hover:bg-peri-100"><Phone className="h-4 w-4" />Call us</a>
            </div>
          </aside>

          <div className="min-w-0">
            <p className="mb-6 text-sm text-slate-500" aria-live="polite">Showing <strong className="text-peri-900">{total}</strong> {total === 1 ? 'answer' : 'answers'}</p>
            {groups.length === 0 ? (
              <div className="animate-pop-in rounded-3xl border border-dashed border-peri-300 bg-white/70 p-10 text-center">
                <Search className="mx-auto h-8 w-8 text-peri-400" />
                <p className="mt-4 font-display text-lg font-bold text-peri-900">No answers found</p>
                <p className="mt-1 text-sm text-slate-500">Try other words — or ask us directly, we’re happy to help.</p>
                <Link to="/contact" className="btn-peri mt-6">Contact us<ArrowRight className="h-4 w-4" /></Link>
              </div>
            ) : (
              <div className="space-y-12">
                {groups.map((g) => (
                  <div key={g.id + q}>
                    <Reveal as="h2" className="mb-4 font-display text-xl font-bold text-peri-900">{g.title}</Reveal>
                    <Accordion idPrefix={`faq-${g.id}`} items={g.items} defaultOpen={q ? 0 : null} />
                  </div>
                ))}
              </div>
            )}
            <Reveal className="mt-12 flex flex-col items-start justify-between gap-4 rounded-3xl border border-peri-200 bg-white p-6 shadow-soft sm:flex-row sm:items-center">
              <div><p className="font-display text-lg font-bold text-peri-900">Didn’t find your answer?</p><p className="text-sm text-slate-500">Write to us at {HOSPITAL.email} or send a message.</p></div>
              <div className="flex gap-2"><a href={`mailto:${HOSPITAL.email}`} className="btn-ghost !py-2.5"><Mail className="h-4 w-4" />Email</a><Link to="/contact" className="btn-peri !py-2.5">Contact us</Link></div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  )
}

import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useSite } from '../cms/content'
import type { LegalDoc } from '../cms/types'
import { useActiveSection, useSeo } from '../hooks'
import { PageHero } from '../ui'

const slug = (h: string, i: number) => `${i + 1}-${h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

function LegalPage({ doc: raw }: { doc: LegalDoc }) {
  const doc = { ...raw, sections: raw.sections.map((s, i) => ({ ...s, id: slug(s.h, i) })) }
  useSeo(doc.title, doc.lead)
  const active = useActiveSection(doc.sections.map((s) => s.id))
  return (
    <>
      <PageHero crumbs={[{ label: doc.title }]} eyebrow={`Last updated · ${doc.updated}`} title={doc.title} lead={doc.lead} />
      <section className="pb-24">
        <div className="l-container grid grid-cols-1 gap-10 lg:grid-cols-[240px_1fr]">
          <nav aria-label="On this page" className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-wider text-peri-500">On this page</p>
            <ul className="mt-4 space-y-1 border-l border-peri-200">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={cn('-ml-px block border-l-2 py-1.5 pl-4 text-sm transition', active === s.id ? 'border-peri-800 font-semibold text-peri-900' : 'border-transparent text-slate-500 hover:text-peri-800')}>{s.h}</a>
                </li>
              ))}
            </ul>
          </nav>
          <article className="max-w-3xl rounded-[2rem] border border-peri-200 bg-white p-6 shadow-soft sm:p-10">
            {doc.sections.map((s, i) => (
              <section key={s.id} id={s.id} className={cn('scroll-mt-28', i > 0 && 'mt-10 border-t border-peri-100 pt-10')}>
                <h2 className="font-display text-xl font-bold text-peri-900"><span className="mr-2 text-peri-400">{String(i + 1).padStart(2, '0')}</span>{s.h}</h2>
                {s.p.map((p, j) => <p key={j} className="mt-3 text-[15px] leading-relaxed text-slate-600">{p}</p>)}
              </section>
            ))}
            <p className="mt-12 rounded-2xl bg-peri-50 p-4 text-sm text-slate-600">Questions about this document? <Link to="/contact" className="font-semibold text-peri-700 hover:underline">Contact us</Link>.</p>
          </article>
        </div>
      </section>
    </>
  )
}

export function Privacy() { return <LegalPage doc={useSite().legal.privacy} /> }
export function Terms() { return <LegalPage doc={useSite().legal.terms} /> }

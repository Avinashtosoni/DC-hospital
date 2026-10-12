import { Printer } from 'lucide-react'
import { cn } from '../lib/utils'
import { A, useSeo } from './site/ui'
import type { PlatformSite } from './site/types'

/** /legal/:slug on the platform's domain — text from the control panel's Website CMS (defaults in ./legal.ts) */
export default function LegalPage({ site, slug }: { site: PlatformSite; slug: string }) {
  const docs = site.legal.docs.filter((d) => !d.hidden)
  const doc = docs.find((d) => d.slug === slug) ?? null
  useSeo(doc ? { title: doc.title, description: doc.intro.slice(0, 160) } : undefined, doc?.title ?? 'Page not found')
  const date = doc?.updated && !Number.isNaN(Date.parse(doc.updated)) ? new Date(doc.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

  return (
    <div className="l-container grid gap-10 py-12 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Legal" className="print:hidden">
        <p className="mb-3 px-3 text-xs font-bold uppercase tracking-[.18em] text-peri-500">Legal</p>
        <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
          {docs.map((d) => (
            <li key={d.slug}>
              <A to={`/legal/${d.slug}`} aria-current={d.slug === slug ? 'page' : undefined}
                className={cn('block rounded-lg px-3 py-2 text-sm font-medium transition', d.slug === slug ? 'bg-peri-800 text-white' : 'text-peri-800 hover:bg-peri-100')}>{d.title}</A>
            </li>
          ))}
        </ul>
      </nav>
      {doc ? (
        <article className="max-w-3xl rounded-3xl border border-peri-200/60 bg-white p-6 shadow-sm sm:p-10 print:border-0 print:p-0 print:shadow-none">
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-peri-900">{doc.title}</h1>
            <button type="button" onClick={() => window.print()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-peri-800 hover:bg-peri-100 print:hidden"><Printer className="h-4 w-4" />Print / PDF</button>
          </div>
          {doc.slug !== 'contact' && date && <p className="mt-2 text-sm text-slate-500">Last updated {date}</p>}
          {doc.intro && <p className="mt-6 whitespace-pre-line leading-relaxed text-slate-700">{doc.intro}</p>}
          {doc.sections.map((s, i) => (
            <section key={s.h + i} className="mt-8">
              {s.h && <h2 className="font-display text-lg font-bold text-peri-900">{s.h}</h2>}
              {s.p.filter(Boolean).map((p, j) => <p key={j} className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{p}</p>)}
            </section>
          ))}
        </article>
      ) : (
        <div className="rounded-3xl bg-white p-10 text-center"><p className="text-lg font-semibold text-peri-900">Page not found</p><A to="/legal/terms" className="mt-3 inline-block text-peri-600 underline">See the Terms of Service</A></div>
      )}
    </div>
  )
}

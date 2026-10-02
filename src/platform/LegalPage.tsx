import { useEffect } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { platformName } from '../lib/supabase'
import { cn } from '../lib/utils'
import { LEGAL_VERSION, legalDoc, legalDocs } from './legal'

/** keeps ?platform on preview hosts so links stay on the product site */
export const platformHref = (path: string) => (typeof location !== 'undefined' && new URLSearchParams(location.search).has('platform') ? `${path}${path.includes('?') ? '&' : '?'}platform` : path)

/** /legal/:slug on the platform's domain — Terms, Privacy, Refunds, Delivery, DPA, Contact */
export default function LegalPage({ slug }: { slug: string }) {
  const doc = legalDoc(slug)
  useEffect(() => { document.title = `${doc?.title ?? 'Not found'} · ${platformName}` }, [doc])
  const date = new Date(LEGAL_VERSION).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-[#f7f7ff] text-slate-700">
      <header className="border-b border-peri-200/60 bg-white/80 backdrop-blur print:hidden">
        <div className="l-container flex h-16 items-center justify-between gap-4">
          <a href={platformHref('/')} className="inline-flex items-center gap-2 text-sm font-semibold text-peri-800 hover:text-peri-500"><ArrowLeft className="h-4 w-4" />{platformName}</a>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-peri-800 hover:bg-peri-100"><Printer className="h-4 w-4" />Print / PDF</button>
        </div>
      </header>
      <div className="l-container grid gap-10 py-12 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Legal" className="print:hidden">
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {legalDocs().map((d) => (
              <li key={d.slug}>
                <a href={platformHref(`/legal/${d.slug}`)} aria-current={d.slug === slug ? 'page' : undefined}
                  className={cn('block rounded-lg px-3 py-2 text-sm font-medium transition', d.slug === slug ? 'bg-peri-800 text-white' : 'text-peri-800 hover:bg-peri-100')}>{d.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        {doc ? (
          <article className="max-w-3xl rounded-3xl border border-peri-200/60 bg-white p-6 shadow-sm sm:p-10 print:border-0 print:p-0 print:shadow-none">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-peri-900">{doc.title}</h1>
            {doc.slug !== 'contact' && <p className="mt-2 text-sm text-slate-500">Last updated {date}</p>}
            <p className="mt-6 leading-relaxed text-slate-700">{doc.intro}</p>
            {doc.sections.map((s) => (
              <section key={s.h} className="mt-8">
                <h2 className="font-display text-lg font-bold text-peri-900">{s.h}</h2>
                {s.p.map((p, i) => <p key={i} className="mt-3 leading-relaxed text-slate-700">{p}</p>)}
              </section>
            ))}
          </article>
        ) : (
          <div className="rounded-3xl bg-white p-10 text-center"><p className="text-lg font-semibold text-peri-900">Page not found</p><a href={platformHref('/legal/terms')} className="mt-3 inline-block text-peri-600 underline">See the Terms of Service</a></div>
        )}
      </div>
    </div>
  )
}

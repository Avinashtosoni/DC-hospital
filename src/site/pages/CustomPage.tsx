import { Link, useParams } from 'react-router-dom'
import { useSite, useSeo } from '../cms/content'
import type { BuilderBlock } from '../cms/types'
import { Breadcrumbs, PageHero } from '../ui'
import { safeUrl } from '../../lib/safeUrl'
import NotFound from './NotFound'

function Block({ block }: { block: BuilderBlock }) {
  if (block.type === 'hero') {
    return (
      <section className="relative isolate overflow-hidden pb-12 pt-6 sm:pb-16">
        <div className="l-container">
          <PageHero crumbs={[{ label: block.title }]} title={block.title} lead={block.body}
            aside={block.imageUrl ? <img src={safeUrl(block.imageUrl, 'image')} alt="" className="mx-auto max-h-[420px] w-full max-w-xl rounded-[2rem] object-cover shadow-soft" /> : undefined} />
        </div>
      </section>
    )
  }
  if (block.type === 'text') return (
    <section className="py-10 sm:py-14"><div className="l-container max-w-4xl">
      {block.title && <h2 className="l-h2">{block.title}</h2>}
      <p className="mt-4 whitespace-pre-line text-base leading-8 text-slate-600">{block.body}</p>
      {block.imageUrl && <img src={safeUrl(block.imageUrl, 'image')} alt="" loading="lazy" className="mt-8 max-h-[520px] w-full rounded-3xl object-cover shadow-soft" />}
    </div></section>
  )
  if (block.type === 'features') return (
    <section className="bg-peri-50/70 py-12 sm:py-16"><div className="l-container">
      {block.title && <h2 className="l-h2 text-center">{block.title}</h2>}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((item, i) => <article key={i} className="rounded-2xl border border-peri-200 bg-white p-5 shadow-soft">
          <h3 className="font-display text-lg font-bold text-peri-900">{item.title}</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{item.body}</p>
        </article>)}
      </div>
    </div></section>
  )
  if (block.type === 'faq') return (
    <section className="py-12 sm:py-16"><div className="l-container max-w-4xl">
      {block.title && <h2 className="l-h2">{block.title}</h2>}
      <div className="mt-6 divide-y divide-peri-100 rounded-2xl border border-peri-100 bg-white px-5">
        {block.items.map((item, i) => <details key={i} className="group py-4">
          <summary className="cursor-pointer list-none font-semibold text-peri-900 marker:hidden">{item.question}<span className="float-right ml-3 text-peri-500 transition group-open:rotate-45">＋</span></summary>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{item.answer}</p>
        </details>)}
      </div>
    </div></section>
  )
  if (block.type === 'image') {
    const src = safeUrl(block.imageUrl, 'image')
    return src ? <figure className="l-container py-8"><img src={src} alt={block.alt} loading="lazy" className="mx-auto max-h-[680px] w-full rounded-3xl object-cover shadow-soft" />{block.caption && <figcaption className="mt-3 text-center text-sm text-slate-500">{block.caption}</figcaption>}</figure> : null
  }
  if (block.type !== 'cta') return null
  const href = safeUrl(block.buttonUrl, 'link')
  return (
    <section className="px-5 py-12 sm:py-16"><div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-peri-900 p-7 text-white shadow-lift sm:p-12">
      <div aria-hidden="true" className="absolute -right-12 -top-14 h-56 w-56 rounded-full bg-peri-400/30 blur-3xl" />
      <div className="relative"><h2 className="font-display text-3xl font-extrabold">{block.title}</h2><p className="mt-3 max-w-2xl whitespace-pre-line text-peri-100">{block.body}</p>
        {href && <a href={href} className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-bold text-peri-900 transition hover:bg-peri-100">{block.buttonText || 'Learn more'}</a>}
      </div>
    </div></section>
  )
}

export default function CustomPage() {
  const { slug = '' } = useParams()
  const { settings, customPages } = useSite()
  const page = customPages.items.find((p) => p.slug === slug)
  useSeo(page?.seoTitle || page?.title || settings.name, page?.seoDescription || settings.seoDescription)
  if (!page) return <NotFound />
  return (
    <>
      {!page.blocks.some((b) => b.type === 'hero') && <section className="l-container pt-28"><Breadcrumbs items={[{ label: page.title }]} /></section>}
      {page.blocks.map((b) => <Block key={b.id} block={b} />)}
      <div className="l-container pb-10 text-sm text-slate-500"><Link to="/contact" className="font-semibold text-peri-700 hover:underline">Contact {settings.brand.shortName || settings.name}</Link></div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Loader2, Newspaper, Tag, UserRound } from 'lucide-react'
import { safeUrl } from '../../lib/safeUrl'
import { cn } from '../../lib/utils'
import { fetchBlog, fetchPost, isPreview } from '../site/store'
import { A, CtaBand, Markdown, PageHero, useSeo } from '../site/ui'
import type { PlatformSite, Post, PostSummary } from '../site/types'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
const readMins = (body: string) => Math.max(1, Math.round(body.split(/\s+/).length / 200))
const PAGE = 9

export function BlogList({ site, tag }: { site: PlatformSite; tag: string | null }) {
  const c = site.blog
  useSeo(c.seo, 'Blog')
  const [rows, setRows] = useState<PostSummary[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [state, setState] = useState<'loading' | 'more' | 'idle' | 'error'>('loading')

  useEffect(() => {
    let on = true
    setState('loading')
    fetchBlog(tag, 0, PAGE).then((r) => { if (!on) return; setRows(r.rows); setTotal(r.total); setTags(r.tags); setState('idle') }).catch(() => on && setState('error'))
    return () => { on = false }
  }, [tag])
  const more = () => {
    setState('more')
    fetchBlog(tag, rows.length, PAGE).then((r) => { setRows((x) => [...x, ...r.rows]); setTotal(r.total); setState('idle') }).catch(() => setState('error'))
  }

  return (
    <>
      <PageHero h={c.heading} />
      <div className="l-container pb-16">
        {tags.length > 0 && (
          <nav aria-label="Topics" className="mb-10 flex flex-wrap justify-center gap-2">
            <A to="/blog" className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium', !tag ? 'border-peri-800 bg-peri-800 text-white' : 'border-peri-200 bg-white text-peri-800 hover:border-peri-400')}>All</A>
            {tags.map((t) => <A key={t} to={`/blog?tag=${encodeURIComponent(t)}`} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium capitalize', tag === t ? 'border-peri-800 bg-peri-800 text-white' : 'border-peri-200 bg-white text-peri-800 hover:border-peri-400')}>{t}</A>)}
          </nav>
        )}
        {state === 'loading' ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-[1.75rem] bg-white" />)}</div>
        ) : state === 'error' && !rows.length ? (
          <p className="text-center text-slate-500">Couldn’t load articles right now. Please try again later.</p>
        ) : !rows.length ? (
          <div className="mx-auto max-w-md rounded-[2rem] border border-peri-200/80 bg-white p-10 text-center shadow-soft">
            <Newspaper className="mx-auto h-10 w-10 text-peri-300" />
            <p className="mt-4 text-slate-600">{tag ? `No articles about “${tag}” yet.` : c.empty}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{rows.map((p, i) => <PostCard key={p.slug} p={p} big={i === 0 && !tag} />)}</div>
            {rows.length < total && (
              <p className="mt-10 text-center">
                <button type="button" onClick={more} disabled={state === 'more'} className="btn-ghost">{state === 'more' && <Loader2 className="h-4 w-4 animate-spin" />}Load more articles</button>
              </p>
            )}
          </>
        )}
      </div>
      <CtaBand cta={c.cta} />
    </>
  )
}

function PostCard({ p, big }: { p: PostSummary; big?: boolean }) {
  const cover = safeUrl(p.cover, 'image')
  return (
    <article className={cn('group flex flex-col overflow-hidden rounded-[1.75rem] border border-peri-200/80 bg-white shadow-soft transition hover:-translate-y-1 hover:shadow-glow', big && 'md:col-span-2 lg:col-span-3 lg:flex-row')}>
      <A to={`/blog/${p.slug}`} className={cn('block shrink-0 overflow-hidden bg-gradient-to-br from-[#CCCCFF] to-[#A3A3CC]', big ? 'aspect-[16/9] lg:aspect-auto lg:w-1/2' : 'aspect-[16/9]')}>
        {cover ? <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <span className="grid h-full w-full place-items-center"><Newspaper className="h-10 w-10 text-white/80" /></span>}
      </A>
      <div className={cn('flex flex-1 flex-col p-6', big && 'lg:p-10')}>
        {p.tags.length > 0 && <p className="text-xs font-bold uppercase tracking-wider text-peri-500">{p.tags.slice(0, 2).join(' · ')}</p>}
        <h2 className={cn('mt-2 font-display font-extrabold text-peri-900', big ? 'text-2xl sm:text-3xl' : 'text-lg')}><A to={`/blog/${p.slug}`} className="hover:text-peri-600">{p.title}</A></h2>
        {p.excerpt && <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{p.excerpt}</p>}
        <p className="mt-5 flex items-center justify-between text-xs text-slate-500">
          <span>{day(p.published_at)}{p.author ? ` · ${p.author}` : ''}</span>
          <A to={`/blog/${p.slug}`} className="inline-flex items-center gap-1 font-semibold text-peri-700">Read<ArrowRight className="h-3.5 w-3.5" /></A>
        </p>
      </div>
    </article>
  )
}

export function BlogPost({ site, slug }: { site: PlatformSite; slug: string }) {
  const [post, setPost] = useState<Post | null | undefined>(undefined)
  useEffect(() => { let on = true; setPost(undefined); fetchPost(slug).then((p) => on && setPost(p)).catch(() => on && setPost(null)); return () => { on = false } }, [slug])
  useSeo(post ? { title: post.seo?.title || post.title, description: post.seo?.description || post.excerpt, image: post.cover ?? undefined } : undefined, post === null ? 'Article not found' : 'Blog')

  if (post === undefined) return <div className="l-container grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-peri-500" /></div>
  if (!post) {
    return (
      <div className="l-container py-24 text-center">
        <p className="font-display text-2xl font-bold text-peri-900">Article not found</p>
        <A to="/blog" className="mt-4 inline-flex items-center gap-1.5 font-semibold text-peri-700"><ArrowLeft className="h-4 w-4" />All articles</A>
      </div>
    )
  }
  const cover = safeUrl(post.cover, 'image')
  return (
    <>
      <article className="l-container max-w-3xl py-12 sm:py-16">
        <A to="/blog" className="inline-flex items-center gap-1.5 text-sm font-semibold text-peri-700 hover:text-peri-500"><ArrowLeft className="h-4 w-4" />All articles</A>
        {post.status === 'draft' && isPreview() && <p className="mt-4 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Draft — not public yet</p>}
        <h1 className="mt-5 font-display text-3xl font-extrabold leading-tight tracking-tight text-peri-900 sm:text-5xl">{post.title}</h1>
        {post.excerpt && <p className="mt-4 text-lg text-slate-600">{post.excerpt}</p>}
        <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
          {post.published_at && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{day(post.published_at)}</span>}
          {post.author && <span className="inline-flex items-center gap-1.5"><UserRound className="h-4 w-4" />{post.author}</span>}
          <span>{readMins(post.body)} min read</span>
        </p>
        {cover && <img src={cover} alt="" className="mt-8 w-full rounded-[1.75rem] shadow-soft" />}
        <div className="mt-10"><Markdown text={post.body} /></div>
        {post.tags.length > 0 && (
          <p className="mt-12 flex flex-wrap items-center gap-2 border-t border-peri-200 pt-6">
            <Tag className="h-4 w-4 text-peri-500" />
            {post.tags.map((t) => <A key={t} to={`/blog?tag=${encodeURIComponent(t)}`} className="rounded-full bg-peri-50 px-3 py-1 text-sm font-medium capitalize text-peri-800 hover:bg-peri-100">{t}</A>)}
          </p>
        )}
      </article>
      <CtaBand cta={site.blog.cta} />
    </>
  )
}

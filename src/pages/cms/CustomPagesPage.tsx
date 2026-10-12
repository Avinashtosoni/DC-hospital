/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, Globe, Loader2, Plus, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { cn } from '../../lib/utils'
import { safeUrl } from '../../lib/safeUrl'
import { supabase } from '../../lib/supabase'
import { CONTENT_QK, PREVIEW_CHANNEL, PREVIEW_WINDOW, mergeRows, useContentRows } from '../../site/cms/content'
import type { BuilderBlock, BuilderBlockType, CustomPagesContent, CustomSitePage } from '../../site/cms/types'
import { cms, type ContentRows } from '../../site/cms/store'

type AiAccess = { entitled: boolean; enabled: boolean; plan: string; reason: string; providersAvailable: boolean; dailyLimit: number }
const EMPTY: CustomPagesContent = { items: [] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-+$/g, '') || 'new-page'
const id = () => crypto.randomUUID()
function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error)
  return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"><p>{message}</p><Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Retry</Button></div>
}
const blankPage = (name = 'New page'): CustomSitePage => ({
  id: id(), slug: slugify(name), title: name, seoTitle: '', seoDescription: '', status: 'draft', showInNavigation: false,
  blocks: [{ id: id(), type: 'hero', title: name, body: '' }, { id: id(), type: 'text', title: 'About this page', body: '' }],
})
const defaultBlock = (type: BuilderBlockType): BuilderBlock => {
  const key = id()
  if (type === 'features') return { id: key, type, title: 'Highlights', items: [{ title: 'New feature', body: 'Describe this service or benefit.' }] }
  if (type === 'faq') return { id: key, type, title: 'Frequently asked questions', items: [{ question: 'How can I learn more?', answer: 'Contact our team and we will be happy to help.' }] }
  if (type === 'image') return { id: key, type, imageUrl: '', alt: '', caption: '' }
  if (type === 'cta') return { id: key, type, title: 'Talk to our care team', body: 'We are here to help you find the right care.', buttonText: 'Contact us', buttonUrl: '/contact' }
  return { id: key, type, title: type === 'hero' ? 'Page heading' : 'Section heading', body: '' }
}

async function loadAiAccess(): Promise<AiAccess> {
  if (!supabase) return { entitled: false, enabled: false, plan: '', reason: 'The service is not connected.', providersAvailable: false, dailyLimit: 0 }
  const { data, error } = await supabase.rpc('my_ai_access')
  if (error) throw new Error(error.message)
  return data as AiAccess
}
async function generatePage(brief: string): Promise<CustomSitePage> {
  if (!supabase) throw new Error('The service is not connected.')
  const { data, error } = await supabase.functions.invoke('ai-page-builder', { body: { brief } })
  if (error) throw new Error(error.message)
  if (!data?.page) throw new Error(data?.error ?? 'The page could not be generated.')
  return data.page as CustomSitePage
}

export default function CustomPagesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const rows = useContentRows()
  const base = useMemo(() => mergeRows(rows.data).customPages ?? EMPTY, [rows.data])
  const [pages, setPages] = useState<CustomPagesContent>(base)
  const [selectedId, setSelectedId] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [brief, setBrief] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [preview, setPreview] = useState(true)
  const channel = useRef<BroadcastChannel | null>(null)
  const ai = useQuery({ queryKey: ['my-ai-access'], queryFn: loadAiAccess, retry: false })
  const dirty = !same(pages, base)
  const selected = pages.items.find((p) => p.id === selectedId) ?? pages.items[0]
  const leavePrompt = useUnsavedChanges(dirty, { what: 'custom website pages' })

  useEffect(() => { if (!dirty) setPages(base) }, [base, dirty])
  useEffect(() => {
    if (!selected && pages.items.length) setSelectedId(pages.items[0].id)
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId, pages.items])
  useEffect(() => { setSlugTouched(false) }, [selectedId])
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return
    const ch = new BroadcastChannel(PREVIEW_CHANNEL)
    channel.current = ch
    ch.onmessage = (e: MessageEvent<{ type?: string }>) => { if (e.data?.type === 'ready') ch.postMessage({ type: 'draft', key: 'customPages', data: pages }) }
    return () => { ch.close(); channel.current = null }
    // A channel is stable for this editor session; changes are posted by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { channel.current?.postMessage({ type: 'draft', key: 'customPages', data: pages }) }, [pages])

  const updatePage = (patch: Partial<CustomSitePage>) => {
    if (!selected) return
    setPages((v) => ({ ...v, items: v.items.map((p) => p.id === selected.id ? { ...p, ...patch } : p) }))
  }
  const updateBlock = (blockId: string, patch: Partial<BuilderBlock>) => {
    if (!selected) return
    updatePage({ blocks: selected.blocks.map((b) => b.id === blockId ? ({ ...b, ...patch } as BuilderBlock) : b) })
  }
  const save = useMutation({
    mutationFn: async () => cms.save('customPages', pages, user?.full_name),
    onSuccess: (row) => {
      qc.setQueryData<ContentRows>(CONTENT_QK, (old) => ({ ...(old ?? {}), customPages: row }))
      qc.invalidateQueries({ queryKey: CONTENT_QK })
      toast.success('Custom pages saved', { description: 'Published pages are now available on the hospital website.' })
    },
    onError: (e) => toast.error('Could not save pages', { description: (e as Error).message }),
  })
  const build = useMutation({
    mutationFn: () => generatePage(brief.trim()),
    onSuccess: (page) => {
      const pageId = id()
      setPages((v) => {
        const stem = page.slug || 'new-page'
        let slug = stem, n = 2
        while (v.items.some((p) => p.slug === slug)) slug = `${stem}-${n++}`
        const item = { ...page, id: pageId, slug, status: 'draft' as const, showInNavigation: false }
        return { ...v, items: [...v.items, item] }
      })
      setSelectedId(pageId)
      setAiOpen(false)
      setBrief('')
      toast.success('Draft page created', { description: 'Review the copy, then publish your changes.' })
    },
    onError: (e) => toast.error('AI page generation failed', { description: (e as Error).message }),
  })
  const addBlank = () => {
    const baseSlug = slugify(`new-page-${pages.items.length + 1}`)
    let slug = baseSlug, n = 2
    while (pages.items.some((p) => p.slug === slug)) slug = `${baseSlug}-${n++}`
    const page = blankPage('New page')
    page.slug = slug
    setPages((v) => ({ ...v, items: [...v.items, page] }))
    setSelectedId(page.id)
  }
  const removePage = () => {
    if (!selected || !confirm(`Remove “${selected.title}”? This will be included the next time you save pages.`)) return
    const next = pages.items.filter((p) => p.id !== selected.id)
    setPages({ ...pages, items: next })
    setSelectedId(next[0]?.id ?? '')
  }
  const moveBlock = (i: number, delta: -1 | 1) => {
    if (!selected) return
    const next = [...selected.blocks], to = i + delta
    if (to < 0 || to >= next.length) return
    ;[next[i], next[to]] = [next[to], next[i]]
    updatePage({ blocks: next })
  }
  const addBlock = (type: BuilderBlockType) => { if (selected) updatePage({ blocks: [...selected.blocks, defaultBlock(type)] }) }
  const previewPath = selected ? `/pages/${selected.slug}` : '/welcome'
  const addItem = (block: Extract<BuilderBlock, { type: 'features' | 'faq' }>) => {
    if (block.type === 'features') updateBlock(block.id, { items: [...block.items, { title: 'New item', body: '' }] } as any)
    else updateBlock(block.id, { items: [...block.items, { question: 'New question?', answer: '' }] } as any)
  }
  const updateItem = (block: Extract<BuilderBlock, { type: 'features' | 'faq' }>, index: number, patch: Record<string, string>) => {
    const items = block.items.map((item, i) => i === index ? { ...item, ...patch } : item)
    updateBlock(block.id, { items } as any)
  }
  const deleteItem = (block: Extract<BuilderBlock, { type: 'features' | 'faq' }>, index: number) => {
    updateBlock(block.id, { items: block.items.filter((_, i) => i !== index) } as any)
  }

  if (rows.error) return <div className="p-6"><ErrorBox error={rows.error} onRetry={() => rows.refetch()} /></div>
  if (rows.isPending && !rows.data) return <div className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>

  const invalidSlug = !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected?.slug ?? '')
    || pages.items.some((p) => p.id !== selected?.id && p.slug === selected?.slug)
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      {leavePrompt}
      <header className="sticky top-16 z-20 flex flex-wrap items-center gap-3 border-b border-brand-100 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <Link to="/cms" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-900"><ArrowLeft className="h-3.5 w-3.5" />CMS</Link>
        <span className="h-5 w-px bg-slate-200" />
        <h1 className="font-display text-sm font-semibold text-brand-950">Custom page builder</h1>
        <Badge tone={dirty ? 'amber' : 'green'} dot>{dirty ? 'Unpublished changes' : 'Saved'}</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addBlank} icon={<Plus className="h-4 w-4" />}>Blank page</Button>
          <Button variant="outline" size="sm" onClick={() => setAiOpen(true)} disabled={!ai.data?.enabled} title={ai.data?.reason || 'AI page builder'} icon={<Sparkles className="h-4 w-4" />}>Create with AI</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || invalidSlug} loading={save.isPending} icon={<Globe className="h-4 w-4" />}>Save pages</Button>
          <Button variant="ghost" size="sm" onClick={() => setPreview((v) => !v)} icon={<Eye className="h-4 w-4" />}>{preview ? 'Hide preview' : 'Preview'}</Button>
        </div>
      </header>
      <div className={cn('grid min-h-[calc(100vh-124px)]', preview && 'xl:grid-cols-[minmax(0,1fr)_minmax(360px,44%)]')}>
        <main className="min-w-0 space-y-5 p-4 sm:p-6 lg:p-8">
          {ai.error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">AI availability could not be checked. You can still build and save pages manually.</div>}
          {!ai.error && ai.data && !ai.data.entitled && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">AI-assisted building is not included in the {ai.data.plan || 'current'} plan. Ask your platform administrator to enable it for this hospital.</div>}
          {ai.data?.entitled && !ai.data.enabled && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">AI assistance is included for this hospital, but is not currently available: {ai.data.reason || 'ask your platform administrator to enable it.'}</div>}
          <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
            <aside className="h-fit rounded-2xl border border-brand-100 bg-white p-3">
              <div className="mb-2 flex items-center justify-between px-1"><h2 className="text-xs font-semibold uppercase tracking-wide text-brand-600">Pages · {pages.items.length}</h2><button onClick={addBlank} aria-label="Add page" className="rounded-lg p-1.5 text-brand-700 hover:bg-brand-50"><Plus className="h-4 w-4" /></button></div>
              {pages.items.length ? <ul className="space-y-1">{pages.items.map((p) => <li key={p.id}><button type="button" onClick={() => setSelectedId(p.id)} className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left', selected?.id === p.id ? 'bg-brand-900 text-white' : 'text-slate-700 hover:bg-brand-50')}>
                {p.status === 'published' ? <Globe className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0 opacity-60" />}<span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title || 'Untitled page'}</span>
              </button></li>)}</ul> : <p className="px-2 py-8 text-center text-xs text-slate-500">No custom pages yet. Start with a blank page or let AI create a draft.</p>}
            </aside>
            {selected ? <section className="min-w-0 space-y-5">
              <div className="rounded-2xl border border-brand-100 bg-white p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-display font-semibold text-brand-950">Page details</h2><p className="text-xs text-slate-500">/{`pages/${selected.slug}`}</p></div><button type="button" onClick={removePage} title="Remove page" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Page title"><Input maxLength={100} value={selected.title} onChange={(e) => { const title = e.target.value; updatePage({ title, ...(!slugTouched ? { slug: slugify(title) } : {}) }); if (selected.blocks[0]?.type === 'hero') updateBlock(selected.blocks[0].id, { title }) }} /></Field>
                  <Field label="URL slug" hint="Lowercase letters, numbers and hyphens only"><Input maxLength={50} value={selected.slug} onChange={(e) => { setSlugTouched(true); updatePage({ slug: slugify(e.target.value) }) }} /></Field>
                  <Field label="Search title"><Input maxLength={120} value={selected.seoTitle} placeholder={selected.title} onChange={(e) => updatePage({ seoTitle: e.target.value })} /></Field>
                  <Field label="Meta description"><Textarea rows={2} maxLength={250} value={selected.seoDescription} onChange={(e) => updatePage({ seoDescription: e.target.value })} /></Field>
                </div>
                {invalidSlug && <p className="mt-2 text-xs text-rose-600">This page needs a valid, unique URL slug before you can save.</p>}
                <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={selected.showInNavigation} onChange={(e) => updatePage({ showInNavigation: e.target.checked })} className="accent-brand-700" />Show in website navigation</label>
                  <Button size="sm" variant={selected.status === 'published' ? 'outline' : 'secondary'} onClick={() => updatePage({ status: selected.status === 'published' ? 'draft' : 'published' })}>{selected.status === 'published' ? 'Unpublish page' : 'Publish page'}</Button>
                  <span className="text-xs text-slate-500">Page visibility is included the next time you save pages.</span>
                </div>
              </div>
              <div className="space-y-3">
                {selected.blocks.map((block, index) => <article key={block.id} className="rounded-2xl border border-brand-100 bg-white p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">{index + 1}</span>
                    <Select aria-label="Block type" value={block.type} onChange={(e) => updateBlock(block.id, { ...defaultBlock(e.target.value as BuilderBlockType), id: block.id } as any)} className="w-40">
                      {(['hero', 'text', 'features', 'faq', 'image', 'cta'] as BuilderBlockType[]).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)} block</option>)}
                    </Select>
                    <div className="ml-auto flex items-center">
                      <IconButton label="Move block up" disabled={index === 0} onClick={() => moveBlock(index, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                      <IconButton label="Move block down" disabled={index === selected.blocks.length - 1} onClick={() => moveBlock(index, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                      <IconButton label="Remove block" onClick={() => updatePage({ blocks: selected.blocks.filter((b) => b.id !== block.id) })} danger><Trash2 className="h-4 w-4" /></IconButton>
                    </div>
                  </div>
                  {(block.type === 'hero' || block.type === 'text') && <div className="grid gap-3 sm:grid-cols-2"><Field label="Heading"><Input value={block.title} maxLength={140} onChange={(e) => updateBlock(block.id, { title: e.target.value })} /></Field><Field label="Body copy"><Textarea rows={block.type === 'hero' ? 4 : 5} maxLength={2000} value={block.body} onChange={(e) => updateBlock(block.id, { body: e.target.value })} /></Field>{block.type === 'hero' && <Field label="Hero image URL (optional)" className="sm:col-span-2"><Input type="url" value={block.imageUrl ?? ''} onChange={(e) => updateBlock(block.id, { imageUrl: e.target.value })} placeholder="https://…" /></Field>}</div>}
                  {block.type === 'features' && <><Field label="Section heading"><Input value={block.title} maxLength={140} onChange={(e) => updateBlock(block.id, { title: e.target.value })} /></Field><div className="mt-3 space-y-2">{block.items.map((item, i) => <div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1.5fr_auto]"><Input aria-label="Feature title" value={item.title} maxLength={120} onChange={(e) => updateItem(block, i, { title: e.target.value })} /><Textarea aria-label="Feature text" rows={2} value={item.body} maxLength={800} onChange={(e) => updateItem(block, i, { body: e.target.value })} /><IconButton label="Remove feature" danger onClick={() => deleteItem(block, i)}><Trash2 className="h-4 w-4" /></IconButton></div>)}</div><Button size="sm" variant="ghost" className="mt-2" onClick={() => addItem(block)} icon={<Plus className="h-3.5 w-3.5" />}>Add feature</Button></>}
                  {block.type === 'faq' && <><Field label="FAQ heading"><Input value={block.title} maxLength={140} onChange={(e) => updateBlock(block.id, { title: e.target.value })} /></Field><div className="mt-3 space-y-2">{block.items.map((item, i) => <div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1.5fr_auto]"><Input aria-label="Question" value={item.question} maxLength={200} onChange={(e) => updateItem(block, i, { question: e.target.value })} /><Textarea aria-label="Answer" rows={2} value={item.answer} maxLength={1200} onChange={(e) => updateItem(block, i, { answer: e.target.value })} /><IconButton label="Remove question" danger onClick={() => deleteItem(block, i)}><Trash2 className="h-4 w-4" /></IconButton></div>)}</div><Button size="sm" variant="ghost" className="mt-2" onClick={() => addItem(block)} icon={<Plus className="h-3.5 w-3.5" />}>Add question</Button></>}
                  {block.type === 'image' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Image URL"><Input type="url" value={block.imageUrl} onChange={(e) => updateBlock(block.id, { imageUrl: e.target.value })} placeholder="https://…" /></Field><Field label="Accessible description (alt text)"><Input value={block.alt} maxLength={200} onChange={(e) => updateBlock(block.id, { alt: e.target.value })} /></Field><Field label="Caption" className="sm:col-span-2"><Input value={block.caption} maxLength={250} onChange={(e) => updateBlock(block.id, { caption: e.target.value })} /></Field>{safeUrl(block.imageUrl, 'image') && <img src={safeUrl(block.imageUrl, 'image')} alt="" className="max-h-60 rounded-xl object-cover sm:col-span-2" />}</div>}
                  {block.type === 'cta' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Heading"><Input value={block.title} maxLength={140} onChange={(e) => updateBlock(block.id, { title: e.target.value })} /></Field><Field label="Button text"><Input value={block.buttonText} maxLength={80} onChange={(e) => updateBlock(block.id, { buttonText: e.target.value })} /></Field><Field label="Text"><Textarea rows={3} value={block.body} maxLength={1000} onChange={(e) => updateBlock(block.id, { body: e.target.value })} /></Field><Field label="Button URL" hint="Use a website link, phone number, e-mail or an internal path such as /contact"><Input value={block.buttonUrl} maxLength={400} onChange={(e) => updateBlock(block.id, { buttonUrl: e.target.value })} /></Field></div>}
                </article>)}
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-brand-200 bg-brand-50/40 p-3">
                  <span className="mr-1 text-xs font-semibold text-brand-800">Add a block</span>{(['text', 'features', 'faq', 'image', 'cta'] as BuilderBlockType[]).map((t) => <Button key={t} size="sm" variant="outline" onClick={() => addBlock(t)}>{t}</Button>)}
                </div>
              </div>
            </section> : <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center"><h2 className="font-semibold text-brand-950">No pages yet</h2><p className="mt-1 text-sm text-slate-500">Create a blank page or open AI page building.</p></div>}
          </div>
        </main>
        {preview && <aside className="hidden border-l border-brand-100 bg-slate-100 p-3 xl:block"><div className="sticky top-[130px] h-[calc(100vh-150px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft"><div className="flex h-9 items-center justify-between border-b px-3 text-xs text-slate-500"><span>Live preview</span><a href={previewPath} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">Open</a></div><iframe key={previewPath} title="Custom page preview" name={PREVIEW_WINDOW} src={previewPath} className="h-[calc(100%-36px)] w-full border-0" /></div></aside>}
      </div>
      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title="Create a page with AI" size="max-w-xl"
        footer={<><Button variant="ghost" onClick={() => setAiOpen(false)}>Cancel</Button><Button loading={build.isPending} disabled={!brief.trim() || !ai.data?.enabled} onClick={() => build.mutate()} icon={<WandSparkles className="h-4 w-4" />}>Generate draft</Button></>}>
        <p className="mb-3 text-sm text-slate-600">Describe one page in a few sentences. Do not include patient details or other confidential health information. AI output is a draft; review it before publishing.</p>
        <Textarea autoFocus rows={5} maxLength={500} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="A page about our maternity services: prenatal check-ups, delivery support, newborn care, and how to book an appointment." />
        <p className="mt-1 text-right text-[11px] text-slate-400">{brief.length}/500 · AI use is limited by the platform administrator</p>
      </Modal>
    </div>
  )
}

function IconButton({ label, disabled, danger, onClick, children }: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={cn('grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30', danger && 'hover:bg-rose-50 hover:text-rose-600')}>{children}</button>
}

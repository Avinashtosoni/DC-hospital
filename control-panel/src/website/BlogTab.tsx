import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, ExternalLink, Newspaper, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Skeleton, Tabs, Textarea } from '../../../src/components/ui'
import { FieldsForm } from '../../../src/pages/cms/fields'
import type { Ctx, FieldDef } from '../../../src/pages/cms/schema'
import type { SiteContent } from '../../../src/site/cms/types'
import { Markdown } from '../../../src/platform/site/ui'
import { cp, friendly } from '../api'
import type { CpPost, PostSave } from '../types'
import { date, ErrorBox } from '../ui'

const QK = ['cp-posts']
export const slugify = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
const toLocal = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')
const BLANK: PostSave = { slug: '', title: '', excerpt: '', cover: null, body: '', tags: [], author: '', status: 'draft', published_at: null, seo: {} }
const META: FieldDef[] = [
  { k: 'excerpt', t: 'textarea', label: 'Summary', rows: 2, full: true, hint: 'Shown on the blog list and in Google (about 160 characters).' },
  { k: 'cover', t: 'image', label: 'Cover image', hint: '16:9 works best.', full: true },
  { k: 'tags', t: 'tags', label: 'Topics', placeholder: 'e.g. billing, gst — press Enter' },
  { k: 'author', t: 'text', label: 'Author', full: true },
  { k: 'seo', t: 'group', label: 'Search engine (SEO)', collapsed: true, fields: [
    { k: 'title', t: 'text', label: 'Title for Google', hint: 'Empty = the article title.', full: true },
    { k: 'description', t: 'textarea', label: 'Description for Google', rows: 2, hint: 'Empty = the summary.', full: true },
  ] },
]
const live = (p: CpPost) => p.status === 'published' && !!p.published_at && Date.parse(p.published_at) <= Date.now()

export function BlogTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK, queryFn: () => cp.posts() })
  const [edit, setEdit] = useState<PostSave | null>(null)
  const [del, setDel] = useState<CpPost | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => cp.deletePost(id),
    onSuccess: () => { toast.success('Article deleted'); setDel(null); qc.invalidateQueries({ queryKey: QK }) },
    onError: (e) => toast.error(friendly(e)),
  })
  const open = (p: CpPost) => setEdit({ id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, cover: p.cover, body: p.body, tags: p.tags, author: p.author ?? '', status: p.status, published_at: p.published_at, seo: p.seo ?? {} })

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Articles appear at <b>/blog</b>. Drafts are private; a future publish date schedules the article.</p>
        {canEdit && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ ...BLANK })}>New article</Button>}
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Skeleton className="h-48" /> : !q.data?.length ? (
        <Card><EmptyState icon={<Newspaper className="h-6 w-6" />} title="No articles yet" description="Guides for hospital owners help people find you on Google — e.g. “How to reduce OPD no-shows” or “GST on hospital services”." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                {p.cover ? <img src={p.cover} alt="" className="hidden h-12 w-20 shrink-0 rounded-md object-cover sm:block" /> : <span className="hidden h-12 w-20 shrink-0 place-items-center rounded-md bg-brand-50 sm:grid"><Newspaper className="h-5 w-5 text-brand-300" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">{p.title}</p>
                  <p className="truncate text-xs text-slate-500">/blog/{p.slug}{p.tags.length ? ` · ${p.tags.join(', ')}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {live(p) ? <Badge tone="green" dot>Live · {date(p.published_at!)}</Badge> : p.status === 'published' ? <Badge tone="blue" dot>Scheduled · {date(p.published_at!)}</Badge> : <Badge tone="amber" dot>Draft</Badge>}
                  <Button size="icon" variant="ghost" aria-label="Preview" title="Preview" onClick={() => window.open(`${location.origin}/blog/${p.slug}?platform&preview`, '_blank', 'noopener')}><ExternalLink className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={canEdit ? 'Edit' : 'View'} title={canEdit ? 'Edit' : 'View'} onClick={() => open(p)}>{canEdit ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                  {canEdit && <Button size="icon" variant="ghost" aria-label="Delete" title="Delete" onClick={() => setDel(p)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {edit && <PostEditor initial={edit} canEdit={canEdit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending}
        title="Delete this article?" description={`“${del?.title}” will be removed from the site right away. This can’t be undone.`} />
    </>
  )
}

function PostEditor({ initial, canEdit, onClose }: { initial: PostSave; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [p, setP] = useState<PostSave>(initial)
  const [slugTouched, setSlugTouched] = useState(!!initial.id)
  const [view, setView] = useState<'write' | 'preview'>('write')
  const set = <K extends keyof PostSave>(k: K, v: PostSave[K]) => setP((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: (status: 'draft' | 'published') => cp.savePost({ ...p, status, published_at: status === 'published' ? p.published_at : p.published_at && Date.parse(p.published_at) > Date.now() ? p.published_at : null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: QK })
      toast.success(r.status === 'draft' ? 'Draft saved' : r.published_at && Date.parse(r.published_at) > Date.now() ? `Scheduled for ${new Date(r.published_at).toLocaleString('en-IN')}` : 'Published — live now')
      onClose()
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const ctx: Ctx = { site: {} as SiteContent, root: p }
  const words = p.body.trim() ? p.body.trim().split(/\s+/).length : 0

  return (
    <Modal open onClose={onClose} size="max-w-5xl" title={initial.id ? (canEdit ? 'Edit article' : 'Article') : 'New article'}
      footer={canEdit ? (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" loading={save.isPending && save.variables === 'draft'} disabled={save.isPending} onClick={() => save.mutate('draft')}>{initial.status === 'published' ? 'Unpublish (save as draft)' : 'Save draft'}</Button>
          <Button icon={<Send className="h-4 w-4" />} loading={save.isPending && save.variables === 'published'} disabled={save.isPending} onClick={() => save.mutate('published')}>
            {p.published_at && Date.parse(p.published_at) > Date.now() ? 'Schedule' : initial.status === 'published' ? 'Update' : 'Publish'}
          </Button>
        </>
      ) : <Button variant="ghost" onClick={onClose}>Close</Button>}>
      <fieldset disabled={!canEdit} className="grid min-w-0 gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <Field label="Title" required>
            <Input value={p.title} maxLength={160} placeholder="How to cut OPD waiting time in half" onChange={(e) => { const t = e.target.value; setP((x) => ({ ...x, title: t, slug: slugTouched ? x.slug : slugify(t) })) }} />
          </Field>
          <Field label="Web address" hint={<>Page: <b>/blog/{p.slug || '…'}</b> — small letters, numbers and dashes.</>}>
            <Input value={p.slug} maxLength={80} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')) }} />
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Tabs value={view} onChange={setView} tabs={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
              <span className="text-xs text-slate-400">{words} words · {Math.max(1, Math.round(words / 200))} min read</span>
            </div>
            {view === 'write' ? (
              <>
                <Textarea value={p.body} onChange={(e) => set('body', e.target.value)} rows={18} className="font-mono text-[13px] leading-relaxed" placeholder={'## A heading\n\nA paragraph with **bold** text and a [link](https://example.com).\n\n- a list item\n- another one\n\n![picture](https://…)'} />
                <p className="mt-1.5 text-[11px] text-slate-400">## Heading · **bold** · _italic_ · [link](https://…) · ![image](https://…) · - list · 1. list · &gt; quote · --- line. Copy image links from the Images tab.</p>
              </>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">{p.body.trim() ? <Markdown text={p.body} /> : <p className="text-sm text-slate-400">Nothing to preview yet.</p>}</div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <FieldsForm fields={META} value={p} onChange={(v) => setP(v as PostSave)} ctx={ctx} />
          <Field label="Publish date" hint="Empty = when you press Publish. A future date schedules it.">
            <Input type="datetime-local" value={toLocal(p.published_at)} onChange={(e) => set('published_at', e.target.value ? new Date(e.target.value).toISOString() : null)} />
          </Field>
        </div>
      </fieldset>
    </Modal>
  )
}

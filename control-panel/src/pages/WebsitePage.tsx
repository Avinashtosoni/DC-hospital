import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, History, RotateCcw, Save, Send, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, Modal, PageHeader, Skeleton, Tabs } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { FieldsForm } from '../../../src/pages/cms/fields'
import { MediaLibrary, MediaSourceContext, type MediaSource } from '../../../src/pages/cms/MediaLibrary'
import type { Ctx } from '../../../src/pages/cms/schema'
import type { SiteContent } from '../../../src/site/cms/types'
import { bucketMedia } from '../../../src/site/cms/store'
import { mergeSite } from '../../../src/platform/site/store'
import type { PageKey } from '../../../src/platform/site/types'
import { cp, friendly } from '../api'
import type { SitePageRow, SiteState } from '../types'
import { dateTime, ErrorBox } from '../ui'
import { PAGES, type PageMeta } from '../website/schema'
import { BlogTab } from '../website/BlogTab'

const media = bucketMedia('platform-media')
const PLATFORM_MEDIA: MediaSource = { key: ['cp-platform-media'], builtIn: [], list: media.list, upload: media.upload, remove: media.remove }
const SITE_QK = ['cp-site']
/** preview the product site on this same address (the panel's sign-in is shared, so drafts show) */
export const previewUrl = (path: string) => `${location.origin}${path}${path.includes('?') ? '&' : '?'}platform&preview`

/** Control panel → Website: the Hospital Comrade product site's pages, legal pages, blog and images. */
export function WebsitePage() {
  const [tab, setTab] = useState<'pages' | 'blog' | 'media'>('pages')
  const q = useQuery({ queryKey: SITE_QK, queryFn: () => cp.site() })
  return (
    <MediaSourceContext.Provider value={PLATFORM_MEDIA}>
      <PageHeader title="Website" description="The product site on your platform domain — pages, legal pages and blog. Save drafts, preview them, then publish."
        actions={<Button variant="outline" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(previewUrl('/'), '_blank', 'noopener')}>Open site (preview)</Button>} />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'pages', label: 'Pages' }, { value: 'blog', label: 'Blog' }, { value: 'media', label: 'Images' }]} /></div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {tab === 'pages' && (q.isLoading ? <Skeleton className="h-96" /> : q.data && <PagesTab state={q.data} />)}
      {tab === 'blog' && <BlogTab canEdit={!!q.data?.canEdit} />}
      {tab === 'media' && <Card className="p-5"><MediaLibrary /></Card>}
    </MediaSourceContext.Provider>
  )
}

const status = (row?: SitePageRow) => (row?.draft != null ? { label: 'Unpublished changes', tone: 'amber' as const } : row?.data != null ? { label: 'Published', tone: 'green' as const } : { label: 'Default text', tone: 'slate' as const })
/** what the editor starts from: the draft, else the published version, else the defaults — tokens left as typed */
const startValue = (key: PageKey, row?: SitePageRow) => {
  const saved = row?.draft ?? row?.data
  return structuredClone(mergeSite(saved ? { [key]: saved } : {}, false)[key]) as unknown
}

function PagesTab({ state }: { state: SiteState }) {
  const qc = useQueryClient()
  const rows = useMemo(() => new Map(state.pages.map((r) => [r.key, r])), [state.pages])
  const [key, setKey] = useState<PageKey>('home')
  const [pending, setPending] = useState<PageKey | null>(null)
  const page = PAGES.find((p) => p.key === key)!
  const row = rows.get(key)
  const savedJson = JSON.stringify(row?.draft ?? row?.data ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the content, so a refetch with the same content keeps your edits
  const base = useMemo(() => startValue(key, row), [key, savedJson])
  const [value, setValue] = useState<unknown>(base)
  useEffect(() => setValue(base), [base])
  const dirty = JSON.stringify(value) !== JSON.stringify(base)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const pick = (k: PageKey) => { if (k === key) return; if (dirty) setPending(k); else setKey(k) }
  const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: SITE_QK }) }
  const save = useMutation({
    mutationFn: (publish: boolean) => cp.siteSave(key, value, publish),
    onSuccess: (r, publish) => { qc.setQueryData<SiteState>(SITE_QK, (s) => s && { ...s, pages: [...s.pages.filter((p) => p.key !== key), r] }); done(publish ? `${page.label} published — live now` : 'Draft saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  const discard = useMutation({ mutationFn: () => cp.siteDiscard(key), onSuccess: () => done('Draft discarded'), onError: (e) => toast.error(friendly(e)) })
  const [confirmReset, setConfirmReset] = useState(false)
  const reset = useMutation({ mutationFn: () => cp.siteReset(key), onSuccess: () => { setConfirmReset(false); done('Back to the default text') }, onError: (e) => toast.error(friendly(e)) })
  const [history, setHistory] = useState(false)

  const ctx: Ctx = { site: {} as SiteContent, root: value }
  const st = status(row)
  const busy = save.isPending || discard.isPending || reset.isPending

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Pages" className="lg:sticky lg:top-4 lg:self-start">
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {PAGES.map((p) => {
            const s = status(rows.get(p.key))
            return (
              <li key={p.key} className="shrink-0">
                <button type="button" onClick={() => pick(p.key)} aria-current={p.key === key ? 'page' : undefined}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition', p.key === key ? 'bg-brand-900 text-white' : 'text-slate-700 hover:bg-brand-50')}>
                  <p.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate font-medium">{p.label}</span>
                  {s.tone !== 'slate' && <span title={s.label} className={cn('h-2 w-2 shrink-0 rounded-full', s.tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-400')} />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="min-w-0">
        <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-bold text-brand-950">{page.label}</h2>
                <Badge tone={st.tone} dot>{st.label}</Badge>
                {dirty && <Badge tone="blue">Not saved</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{page.help}</p>
              {row && <p className="mt-0.5 text-[11px] text-slate-400">{row.published_at ? `Published ${dateTime(row.published_at)} by ${row.published_by ?? '—'}` : 'Never published'}{row.draft != null ? ` · draft ${dateTime(row.updated_at)} by ${row.updated_by ?? '—'}` : ''}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(previewUrl(page.path), '_blank', 'noopener')} title="Saved drafts show in the preview">Preview</Button>
              <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => setHistory(true)}>History</Button>
              {state.canEdit && (
                <>
                  {dirty && <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setValue(base)} disabled={busy}>Undo edits</Button>}
                  {!dirty && row?.draft != null && <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} loading={discard.isPending} onClick={() => discard.mutate()} disabled={busy}>Discard draft</Button>}
                  {row?.data != null && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirmReset(true)} disabled={busy}>Reset</Button>}
                  <Button size="sm" variant="outline" icon={<Save className="h-4 w-4" />} loading={save.isPending && save.variables === false} disabled={busy || !dirty} onClick={() => save.mutate(false)}>Save draft</Button>
                  <Button size="sm" icon={<Send className="h-4 w-4" />} loading={save.isPending && save.variables === true} disabled={busy || (!dirty && row?.draft == null && row?.data != null)} onClick={() => save.mutate(true)}>Publish</Button>
                </>
              )}
            </div>
          </div>
          {!state.canEdit && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Only platform admins can change the website — you can look and preview.</p>}
        </Card>

        <Card className="p-5">
          <fieldset disabled={!state.canEdit} className="min-w-0">
            <FieldsForm key={key} fields={page.fields} value={value} saved={row?.data ?? undefined} onChange={setValue} ctx={ctx} />
          </fieldset>
        </Card>
      </div>

      <ConfirmDialog open={!!pending} onClose={() => setPending(null)} onConfirm={() => { if (pending) { setKey(pending); setPending(null) } }}
        title="Leave without saving?" description={`Your edits to ${page.label} are not saved yet. Save a draft first to keep them.`} confirmLabel="Leave" />
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={() => reset.mutate()} loading={reset.isPending}
        title={`Reset ${page.label}?`} description="The page goes back to the built-in text right away. The current version is kept in History, so you can restore it." confirmLabel="Reset" />
      {history && <HistoryModal page={page} canEdit={state.canEdit} onClose={() => setHistory(false)} onRestored={() => { setHistory(false); done('Old version loaded as a draft — check it, then publish') }} />}
    </div>
  )
}

function HistoryModal({ page, canEdit, onClose, onRestored }: { page: PageMeta; canEdit: boolean; onClose: () => void; onRestored: () => void }) {
  const q = useQuery({ queryKey: ['cp-site-history', page.key], queryFn: () => cp.siteHistory(page.key) })
  const restore = useMutation({ mutationFn: (id: string) => cp.siteRestore(id), onSuccess: onRestored, onError: (e) => toast.error(friendly(e)) })
  return (
    <Modal open onClose={onClose} title={`${page.label} — earlier versions`} size="max-w-lg">
      {q.isLoading ? <Skeleton className="h-32" /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <p className="py-6 text-center text-sm text-slate-500">No earlier versions yet. Each time you publish, the version it replaces is kept here (latest 30).</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div><p className="font-medium text-slate-800">{dateTime(r.created_at)}</p><p className="text-xs text-slate-500">{r.created_by ?? '—'}</p></div>
              {canEdit && <Button size="sm" variant="outline" loading={restore.isPending && restore.variables === r.id} onClick={() => restore.mutate(r.id)}>Restore as draft</Button>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

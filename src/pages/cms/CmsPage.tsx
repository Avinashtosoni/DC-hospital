/* eslint-disable @typescript-eslint/no-explicit-any */
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { tenantKey } from '../../tenancy/state'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronDown, CloudUpload, Database, ExternalLink, History, ImageIcon, Inbox, LayoutGrid, Loader2, Monitor, PanelRightClose,
  PanelRightOpen, Redo2, RefreshCw, RotateCcw, Smartphone, Undo, Undo2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, Skeleton } from '../../components/ui'
import { ago, cn, fmtDate } from '../../lib/utils'
import { CONTENT_QK, PREVIEW_CHANNEL, PREVIEW_WINDOW, deepMerge, defaultContent, mergeRows, useContentRows } from '../../site/cms/content'
import { cms, type ContentRows, type Revision } from '../../site/cms/store'
import type { ContentKey } from '../../site/cms/types'
import { FieldsForm } from './fields'
import { MediaLibrary } from './MediaLibrary'
import { CmsOverview } from './Overview'
import { SECTIONS, SECTION_BY_KEY, validate, type Section } from './schema'

type Drafts = Partial<Record<ContentKey, any>>
type View = ContentKey | 'media' | 'overview'
type Hist = { past: any[]; future: any[]; t: number }
const HIST_LIMIT = 50
const HIST_GAP = 600 // ms — keystrokes closer together than this become one undo step
const DRAFTS_KEY = 'dch:cms-drafts:v1'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const readDrafts = (): Drafts => { try { return JSON.parse(sessionStorage.getItem(tenantKey(DRAFTS_KEY)) ?? '{}') } catch { return {} } }

export default function CmsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const rows = useContentRows()
  const saved = useMemo(() => mergeRows(rows.data), [rows.data])
  const [params, setParams] = useSearchParams()
  const view = (params.get('s') as View) || 'overview'
  const section: Section | undefined = view === 'media' || view === 'overview' ? undefined : SECTION_BY_KEY[view]
  const [drafts, setDraftsState] = useState<Drafts>(readDrafts)
  // Side-by-side preview on wide screens; on smaller screens it opens as an overlay on demand.
  const [preview, setPreview] = useState(() => window.innerWidth >= 1280 && localStorage.getItem('dch:cms-preview') !== '0')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // ---- drafts (kept in sessionStorage so switching dashboard pages doesn't lose work)
  const setDrafts = useCallback((fn: (d: Drafts) => Drafts) => {
    setDraftsState((d) => { const n = fn(d); try { sessionStorage.setItem(tenantKey(DRAFTS_KEY), JSON.stringify(n)) } catch { /* quota */ } return n })
  }, [])
  const dirtyKeys = useMemo(() => (Object.keys(drafts) as ContentKey[]).filter((k) => !same(drafts[k], saved[k])), [drafts, saved])
  const isDirty = (k: ContentKey) => dirtyKeys.includes(k)

  // ---- live preview channel
  const channel = useRef<BroadcastChannel | null>(null)
  const draftsRef = useRef(drafts); draftsRef.current = drafts
  const savedRef = useRef(saved); savedRef.current = saved
  const post = useCallback((key: ContentKey, data: unknown) => channel.current?.postMessage({ type: 'draft', key, data }), [])
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return
    const ch = new BroadcastChannel(PREVIEW_CHANNEL)
    channel.current = ch
    ch.onmessage = (e: MessageEvent<{ type: string }>) => {
      if (e.data?.type === 'ready') for (const [k, v] of Object.entries(draftsRef.current)) ch.postMessage({ type: 'draft', key: k, data: v })
    }
    return () => { ch.close(); channel.current = null }
  }, [])

  const leavePrompt = useUnsavedChanges(dirtyKeys.length > 0, { what: 'the website content' })
  const [focusPath, setFocusPath] = useState<string | null>(null)
  useEffect(() => { setErrors([]); setFocusPath(null); window.scrollTo({ top: 0 }) }, [view])

  const go = (v: View) => setParams(v === 'overview' ? {} : { s: v })
  const togglePreview = () => setPreview((p) => { localStorage.setItem('dch:cms-preview', p ? '0' : '1'); return !p })

  const key = section?.key
  const value = key ? drafts[key] ?? saved[key] : undefined
  const setDraft = (k: ContentKey, v: any) => { setDrafts((d) => ({ ...d, [k]: v })); post(k, v) }

  // ---- undo / redo (per section, in memory)
  const hist = useRef<Partial<Record<ContentKey, Hist>>>({})
  const [, bump] = useState(0)
  const h = key ? hist.current[key] : undefined
  const change = (v: any) => {
    if (!key) return
    const hh = (hist.current[key] ??= { past: [], future: [], t: 0 })
    const now = Date.now()
    if (now - hh.t > HIST_GAP) { hh.past.push(value); if (hh.past.length > HIST_LIMIT) hh.past.shift() }
    hh.t = now; hh.future = []
    setDraft(key, v); bump((n) => n + 1)
    if (errors.length) setErrors(validate(key, v))
  }
  const undo = () => {
    if (!key || !h?.past.length) return
    h.future.push(value); h.t = 0
    setDraft(key, h.past.pop()); bump((n) => n + 1)
  }
  const redo = () => {
    if (!key || !h?.future.length) return
    h.past.push(value); h.t = 0
    setDraft(key, h.future.pop()); bump((n) => n + 1)
  }
  const clearHist = (k: ContentKey) => { delete hist.current[k]; bump((n) => n + 1) }

  const publish = useMutation({
    mutationFn: async (k: ContentKey) => cms.save(k, draftsRef.current[k] ?? savedRef.current[k], user?.full_name),
    onSuccess: (row, k) => {
      qc.setQueryData<ContentRows>(CONTENT_QK, (old) => ({ ...(old ?? {}), [k]: row }))
      qc.invalidateQueries({ queryKey: ['cms-history', k] })
      setDrafts((d) => { const n = { ...d }; delete n[k]; return n })
      toast.success(`${SECTION_BY_KEY[k].label} published`, { description: 'Your changes are live on the website.' })
    },
    onError: (e) => toast.error('Could not publish', { description: (e as Error).message }),
  })
  const doPublish = () => {
    if (!key) return
    const errs = validate(key, value)
    setErrors(errs)
    if (errs.length) { toast.error('Please fix the problems before publishing'); return }
    publish.mutate(key)
  }
  const discard = () => {
    if (!key) return
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n })
    post(key, saved[key]); setErrors([]); clearHist(key)
    toast('Changes discarded')
  }
  const reset = useMutation({
    mutationFn: (k: ContentKey) => cms.reset(k, user?.full_name),
    onSuccess: (_r, k) => {
      qc.setQueryData<ContentRows>(CONTENT_QK, (old) => { const n = { ...(old ?? {}) }; delete n[k]; return n })
      qc.invalidateQueries({ queryKey: ['cms-history', k] })
      setDrafts((d) => { const n = { ...d }; delete n[k]; return n })
      post(k, defaultContent()[k]); setResetOpen(false); clearHist(k)
      toast.success('Restored the original content', { description: 'The previous version is kept in History.' })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const restore = (rev: Revision) => {
    const data = deepMerge(defaultContent()[rev.key], rev.data)
    setDrafts((d) => ({ ...d, [rev.key]: data })); post(rev.key, data); setHistoryOpen(false)
    toast.success('Version loaded into the editor', { description: 'Review it, then press Publish to make it live.' })
  }

  // ---- publish every section with a draft
  const publishAll = useMutation({
    mutationFn: async () => {
      const keys = dirtyKeys
      const bad = keys.filter((k) => validate(k, draftsRef.current[k]).length)
      if (bad.length) throw new Error(`Fix the problems in: ${bad.map((k) => SECTION_BY_KEY[k].label).join(', ')}`)
      for (const k of keys) {
        const row = await cms.save(k, draftsRef.current[k], user?.full_name)
        qc.setQueryData<ContentRows>(CONTENT_QK, (old) => ({ ...(old ?? {}), [k]: row }))
        qc.invalidateQueries({ queryKey: ['cms-history', k] })
        setDrafts((d) => { const n = { ...d }; delete n[k]; return n })
      }
      return keys.length
    },
    onSuccess: (n) => toast.success(`${n} section${n === 1 ? '' : 's'} published`, { description: 'All your changes are live on the website.' }),
    onError: (e) => toast.error('Could not publish everything', { description: (e as Error).message }),
  })

  const row = key ? rows.data?.[key] : undefined
  const dirty = key ? isDirty(key) : false

  // ---- keyboard shortcuts: Ctrl/⌘+S publish · Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z or Ctrl+Y redo
  const keys = useRef({ doPublish, undo, redo, dirty }); keys.current = { doPublish, undo, redo, dirty }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); if (keys.current.dirty) keys.current.doPublish(); return }
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return // keep the browser's own undo inside a text box
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); keys.current.undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); keys.current.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      {leavePrompt}
      {/* ---------- header */}
      <div className="sticky top-16 z-20 border-b border-brand-100 bg-white/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <SectionSwitcher view={view} onChange={go} isDirty={isDirty} />
          <div className="hidden min-w-0 flex-1 text-xs text-slate-500 md:block">
            {view === 'overview' && (dirtyKeys.length ? <span className="inline-flex items-center gap-1.5 font-medium text-amber-600"><span className="h-2 w-2 rounded-full bg-amber-500" />{dirtyKeys.length} section{dirtyKeys.length === 1 ? '' : 's'} with unpublished changes</span> : 'Everything is published')}
            {key && (dirty
              ? <span className="inline-flex items-center gap-1.5 font-medium text-amber-600"><span className="h-2 w-2 rounded-full bg-amber-500" />Unsaved changes</span>
              : row ? <>Published {ago(row.updated_at)}{row.updated_by_name ? ` by ${row.updated_by_name}` : ''}</> : 'Showing the original content')}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {view === 'overview' && dirtyKeys.length > 0 && (
              <Button size="sm" icon={<CloudUpload className="h-4 w-4" />} onClick={() => publishAll.mutate()} loading={publishAll.isPending}>Publish all ({dirtyKeys.length})</Button>
            )}
            {key && <>
              <div className="flex items-center rounded-lg border border-brand-100 bg-white p-0.5">
                <button type="button" onClick={undo} disabled={!h?.past.length} aria-label="Undo" title="Undo (Ctrl+Z)" className="grid h-7 w-7 place-items-center rounded-md text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"><Undo className="h-4 w-4" /></button>
                <button type="button" onClick={redo} disabled={!h?.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="grid h-7 w-7 place-items-center rounded-md text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"><Redo2 className="h-4 w-4" /></button>
              </div>
              <Button variant="ghost" size="sm" icon={<History className="h-4 w-4" />} onClick={() => setHistoryOpen(true)}>History</Button>
              {row && <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setResetOpen(true)} className="hidden sm:inline-flex">Reset</Button>}
              {dirty && <Button variant="outline" size="sm" icon={<Undo2 className="h-4 w-4" />} onClick={discard}>Discard</Button>}
              <Button size="sm" icon={<CloudUpload className="h-4 w-4" />} onClick={doPublish} loading={publish.isPending} disabled={!dirty} title="Publish (Ctrl+S)">Publish</Button>
            </>}
            <Button variant="outline" size="sm" onClick={togglePreview} icon={preview ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />} aria-pressed={preview}>
              <span className="hidden sm:inline">Preview</span>
            </Button>
          </div>
        </div>
      </div>

      <div className={cn('grid grid-cols-1', preview && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
        {/* ---------- editor */}
        <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {view === 'overview' ? (
            <CmsOverview rows={rows.data} loading={rows.isPending && !rows.data} site={{ ...saved, ...drafts }} dirtyKeys={dirtyKeys}
              compact={preview && window.innerWidth >= 1280} onOpen={go} onPublishAll={() => publishAll.mutate()} publishingAll={publishAll.isPending} />
          ) : <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <button type="button" onClick={() => go('overview')} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"><LayoutGrid className="h-3.5 w-3.5" />CMS overview</button>
              <h1 className="font-display text-xl font-semibold text-brand-950">{section?.label ?? 'Media library'}</h1>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{section?.description ?? 'Images uploaded here can be used anywhere on the website.'}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="green" dot><Database className="mr-0.5 h-3 w-3" />Supabase</Badge>
              <Link to="/enquiries" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Inbox className="h-3.5 w-3.5" />Enquiries</Link>
            </div>
          </div>

          {rows.isError && (
            <div className="mb-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-semibold">Could not load saved content — showing the original texts.</p><p className="mt-0.5 text-amber-700">{(rows.error as Error).message}. If you just connected Supabase, run <code className="rounded bg-amber-100 px-1">supabase/master.sql</code> once in the SQL editor.</p></div>
            </div>
          )}
          {errors.length > 0 && (
            <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <p className="font-semibold">Fix these before publishing:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          {view === 'media' ? (
            <div className="card p-5"><MediaLibrary /></div>
          ) : !section ? (
            <EmptyState title="Unknown section" description="Pick a section from the menu." action={<Button onClick={() => go('home')}>Open Home page</Button>} />
          ) : rows.isPending && !rows.data ? (
            <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : (
            <FieldsForm key={section.key} fields={section.fields} value={value} saved={saved[section.key]} onChange={change} ctx={{ site: { ...saved, ...drafts }, root: value, focus: setFocusPath }} />
          )}

          {key && dirty && (
            <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between gap-3 rounded-2xl border border-brand-800 bg-brand-900/95 p-3 pl-4 text-white shadow-lift backdrop-blur">
              <p className="text-sm text-brand-100"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-400" />You have unpublished changes. <span className="hidden text-brand-300 sm:inline">Ctrl + S to publish.</span></p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={discard} className="text-brand-100 hover:bg-white/10 hover:text-white">Discard</Button>
                <Button size="sm" onClick={doPublish} loading={publish.isPending} icon={<CloudUpload className="h-4 w-4" />} className="bg-white text-brand-900 hover:bg-brand-50">Publish</Button>
              </div>
            </div>
          )}
          </>}
        </div>

        {/* ---------- live preview */}
        {preview && <PreviewPane path={focusPath ?? section?.preview ?? '/welcome'} onClose={togglePreview} />}
      </div>

      {key && <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} sectionKey={key} current={row} onRestore={restore} />}
      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={() => key && reset.mutate(key)} loading={reset.isPending} confirmLabel="Reset"
        title={`Reset “${section?.label}” to the original content?`} description="Your current published version is saved in History, so you can bring it back later." />
    </div>
  )
}

// ------------------------------------------------------------------ section switcher (menu)
function SectionSwitcher({ view, onChange, isDirty }: { view: View; onChange: (v: View) => void; isDirty: (k: ContentKey) => boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const cur = view === 'media' ? { label: 'Media library', icon: ImageIcon } : view === 'overview' ? { label: 'Overview', icon: LayoutGrid } : SECTION_BY_KEY[view] ?? { label: 'Choose section', icon: ImageIcon }
  const Icon = cur.icon
  const groups = ['General', 'Pages', 'Collections'] as const
  const anyDirty = SECTIONS.some((s) => isDirty(s.key))
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-xl border border-brand-100 bg-white py-1.5 pl-2 pr-3 text-sm font-medium text-brand-950 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/50">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-900 text-white"><Icon className="h-4 w-4" /></span>
        <span className="max-w-[10rem] truncate sm:max-w-none">{cur.label}</span>
        {anyDirty && <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />}
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-2 w-[min(92vw,640px)] animate-pop-in rounded-2xl border border-brand-100 bg-white p-2 shadow-lift">
          <div className="grid gap-x-2 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g} className={cn(g === 'Pages' && 'sm:row-span-2')}>
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-brand-500">{g}</p>
                {SECTIONS.filter((s) => s.group === g).map((s) => <MenuItem key={s.key} icon={s.icon} label={s.label} active={view === s.key} dirty={isDirty(s.key)} onClick={() => { onChange(s.key); setOpen(false) }} />)}
                {g === 'General' && <MenuItem icon={LayoutGrid} label="Overview" active={view === 'overview'} onClick={() => { onChange('overview'); setOpen(false) }} />}
                {g === 'General' && <MenuItem icon={ImageIcon} label="Media library" active={view === 'media'} onClick={() => { onChange('media'); setOpen(false) }} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
function MenuItem({ icon: Icon, label, active, dirty, onClick }: { icon: typeof ImageIcon; label: string; active: boolean; dirty?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition', active ? 'bg-brand-100/70 font-medium text-brand-900' : 'text-slate-700 hover:bg-brand-50')}>
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand-600' : 'text-slate-400')} /><span className="flex-1 truncate">{label}</span>
      {dirty && <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />}
    </button>
  )
}

// ------------------------------------------------------------------ preview
function PreviewPane({ path, onClose }: { path: string; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [nonce, setNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setLoading(true), [path, nonce])
  const base = device === 'desktop' ? 1280 : 390
  const scale = w ? Math.min(1, (w - (device === 'mobile' ? 32 : 0)) / base) : 0.5

  return (
    <aside aria-label="Live preview" className="fixed inset-0 z-40 flex flex-col bg-slate-100 xl:sticky xl:top-[121px] xl:z-0 xl:h-[calc(100vh-121px)] xl:border-l xl:border-brand-100 xl:bg-brand-50/60">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative h-2 w-2 rounded-full bg-emerald-500" /></span>
        <p className="text-xs font-semibold text-slate-700">Live preview</p>
        <code className="hidden truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 sm:block">{path}</code>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md bg-slate-100 p-0.5">
            {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([d, I]) => (
              <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} aria-label={`${d} preview`}
                className={cn('grid h-7 w-8 place-items-center rounded transition', device === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700')}><I className="h-4 w-4" /></button>
            ))}
          </div>
          <button type="button" onClick={() => setNonce((n) => n + 1)} aria-label="Reload preview" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100"><RefreshCw className="h-4 w-4" /></button>
          <a href={path} target="_blank" rel="noreferrer" aria-label="Open page in a new tab" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100"><ExternalLink className="h-4 w-4" /></a>
          <button type="button" onClick={onClose} aria-label="Close preview" className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div ref={box} className="relative flex-1 overflow-hidden">
        {loading && <div className="absolute inset-0 z-10 grid place-items-center bg-slate-100/70"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        <div className={cn('absolute top-0 origin-top-left', device === 'mobile' ? 'left-1/2 mt-4 overflow-hidden rounded-[28px] border-[6px] border-slate-800 bg-white shadow-2xl' : 'left-0')}
          style={{ width: base, height: `calc(${100 / scale}% - ${device === 'mobile' ? 32 / scale : 0}px)`, transform: `${device === 'mobile' ? `translateX(-${(base * scale) / 2}px) ` : ''}scale(${scale})` }}>
          <iframe key={`${path}-${nonce}`} name={PREVIEW_WINDOW} src={path} title="Website preview" onLoad={() => setLoading(false)} className="h-full w-full border-0 bg-white" />
        </div>
      </div>
    </aside>
  )
}

// ------------------------------------------------------------------ history
function HistoryDrawer({ open, onClose, sectionKey, current, onRestore }: { open: boolean; onClose: () => void; sectionKey: ContentKey; current?: { updated_at: string; updated_by_name?: string | null }; onRestore: (r: Revision) => void }) {
  const q = useQuery({ queryKey: ['cms-history', sectionKey], queryFn: () => cms.history(sectionKey), enabled: open })
  return (
    <Drawer open={open} onClose={onClose} title="Version history" subtitle={SECTION_BY_KEY[sectionKey].label} width="max-w-md">
      <ol className="relative space-y-3 border-l border-slate-200 pl-5">
        <li className="relative">
          <span className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 ring-2 ring-emerald-100" />
          <p className="text-sm font-semibold text-slate-800">Live version</p>
          <p className="text-xs text-slate-500">{current ? `${fmtDate(current.updated_at, 'dd MMM yyyy, h:mm a')}${current.updated_by_name ? ` · ${current.updated_by_name}` : ''}` : 'Original content (never edited)'}</p>
        </li>
        {q.isPending ? Array.from({ length: 3 }).map((_, i) => <li key={i}><Skeleton className="h-14 rounded-lg" /></li>)
          : q.isError ? <li className="text-sm text-rose-600">{(q.error as Error).message}</li>
            : q.data?.length === 0 ? <li className="py-4 text-sm text-slate-400">No earlier versions yet. Each time you publish, the previous version is kept here.</li>
              : q.data?.map((r) => (
                <li key={r.id} className="relative rounded-lg border border-slate-200 bg-white p-3">
                  <span className="absolute -left-[26px] top-4 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{fmtDate(r.created_at, 'dd MMM yyyy, h:mm a')}</p>
                      <p className="truncate text-xs text-slate-500">{ago(r.created_at)}{r.created_by_name ? ` · by ${r.created_by_name}` : ''}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onRestore(r)} icon={<RotateCcw className="h-3.5 w-3.5" />}>Restore</Button>
                  </div>
                </li>
              ))}
      </ol>
      <p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Each time you publish or reset, the version being replaced is kept here (most recent first). Restoring loads the version into the editor as a draft — nothing changes on the website until you publish.</p>
    </Drawer>
  )
}

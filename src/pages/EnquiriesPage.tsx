/**
 * Website enquiries — a Gmail-style inbox for everything sent from the website: the Contact page, the Patient review
 * form and any custom form built in Settings → Forms (old and new submissions alike).
 *
 *  folders (Inbox / Starred / Unread / In progress / Resolved / Spam / All) · forms · Contact topics
 *  list: checkbox, star, bold unread rows, label chip + snippet, smart time, hover actions
 *  reading pane (split view on wide screens): call / WhatsApp / email reply, status, internal notes, prev / next
 *  bulk actions with Undo, keyboard shortcuts (press ?), CSV export
 *
 * Read / starred state lives on the row (read_at, starred) and is not written to the audit log.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'

import {
  AlertOctagon, ArrowLeft, Ban, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, Download, Inbox, Keyboard,
  Mail, MailOpen, MessageCircle, Phone, PlayCircle, RefreshCw, Search, Star, StickyNote, Tag, Trash2, Undo2, X, Archive, ClipboardList, Settings2, Check as CheckIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { differenceInCalendarDays, format, isSameYear, isToday, isYesterday } from 'date-fns'
import { Avatar, Button, ConfirmDialog, EmptyState, Modal, Skeleton, Textarea } from '../components/ui'
import { qk, useCount, useRemove, useRow, useRows, useTable, useUpdate } from '../hooks/useData'
import { db, queryAll } from '../data/adapter'
import type { Filter, Query } from '../data/query'
import { useDebounced } from '../components/ResourcePage'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { useFormLists, useSiteSettings } from '../site/cms/content'
import { useModuleLocks } from '../tenancy/modules'
import { COLOR_CLASS, CONTACT_FORM_ID, type FormColor, type FormField, type FormSettings } from '../forms/schema'
import { ago, cn, downloadCsv } from '../lib/utils'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import type { EnquiryStatus, SiteEnquiry, SiteForm } from '../types'

// ------------------------------------------------------------------ model
type Folder = 'inbox' | 'starred' | 'unread' | 'in_progress' | 'resolved' | 'spam' | 'all'
const PAGE = 50

/** null = explicitly unread; undefined (older demo data) falls back to "still new". */
export const isUnread = (r: SiteEnquiry) => r.read_at === null || (r.read_at === undefined && r.status === 'new')

const FOLDERS: { id: Folder; label: string; icon: typeof Inbox; match: (r: SiteEnquiry) => boolean; empty: [string, string] }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, match: (r) => r.status === 'new' || r.status === 'in_progress', empty: ['Inbox zero', 'Every enquiry has been handled. New messages from the Contact page land here.'] },
  { id: 'starred', label: 'Starred', icon: Star, match: (r) => !!r.starred && r.status !== 'spam', empty: ['No starred enquiries', 'Star a message to keep it handy for follow-up.'] },
  { id: 'unread', label: 'Unread', icon: Mail, match: (r) => isUnread(r) && r.status !== 'spam', empty: ['All caught up', 'You have opened every enquiry.'] },
  { id: 'in_progress', label: 'In progress', icon: Clock3, match: (r) => r.status === 'in_progress', empty: ['Nothing in progress', 'Enquiries you are working on show up here.'] },
  { id: 'resolved', label: 'Resolved', icon: CheckCircle2, match: (r) => r.status === 'resolved', empty: ['Nothing resolved yet', 'Resolved enquiries are kept here for reference.'] },
  { id: 'spam', label: 'Spam', icon: AlertOctagon, match: (r) => r.status === 'spam', empty: ['No spam', 'Hooray, no junk from the Contact form.'] },
  { id: 'all', label: 'All enquiries', icon: Mail, match: (r) => r.status !== 'spam', empty: ['No enquiries yet', 'Messages from the website Contact page will appear here.'] },
]

// ------------------------------------------------------------------ labels: Contact-form topics + one per form
type Label = { name: string; dot: string; chip: string }
const DEFAULT_TOPICS = ['Book an appointment', 'Billing & insurance', 'Medical records', 'Feedback or complaint', 'Careers', 'Something else']
const PALETTE: FormColor[] = ['brand', 'amber', 'sky', 'rose', 'emerald', 'violet', 'teal']
const SLATE: Label = { name: '', ...COLOR_CLASS.slate }
/** the Contact form's topic chips: its own options, else Website CMS → Contact page topics. The last one is the catch-all. */
function topicLabels(names: string[]): Label[] {
  return names.map((name, i) => ({ name, ...(i === names.length - 1 && names.length > 1 ? COLOR_CLASS.slate : COLOR_CLASS[PALETTE[i % PALETTE.length]]) }))
}
const formColor = (f?: Pick<SiteForm, 'settings'>) => COLOR_CLASS[((f?.settings ?? {}) as FormSettings).color ?? 'brand'] ?? COLOR_CLASS.brand
interface LabelLookup { style: (r: Pick<SiteEnquiry, 'topic' | 'form_id'>) => Label; forms: Map<string, SiteForm> }
const LabelCtx = createContext<LabelLookup>({ style: () => SLATE, forms: new Map() })

// the same folders / labels as database filters — only one page of messages is ever downloaded
const FOLDER_WHERE: Record<Folder, Filter[]> = {
  inbox: [['status', 'in', ['new', 'in_progress']]],
  starred: [['starred', 'eq', true], ['status', 'neq', 'spam']],
  unread: [['read_at', 'is_null'], ['status', 'neq', 'spam']],
  in_progress: [['status', 'eq', 'in_progress']],
  resolved: [['status', 'eq', 'resolved']],
  spam: [['status', 'eq', 'spam']],
  all: [['status', 'neq', 'spam']],
}
/** this hospital's built-in Contact form (each hospital has its own copy; the first hospital's has the fixed id) */
let contactFormId = CONTACT_FORM_ID
const isContactForm = (id?: string | null) => !!id && id === contactFormId
/** a Contact-form topic; the catch-all label also holds topics that are no longer offered */
const labelWhere = (name: string, labels: Label[]): Filter[] => {
  const last = labels[labels.length - 1]?.name
  return [['status', 'neq', 'spam'], ['form_id', 'eq', contactFormId],
    name === last && labels.length > 1 ? ['topic', 'nin', labels.slice(0, -1).map((t) => t.name)] : ['topic', 'eq', name]]
}
const SEARCH_COLS = ['ref', 'name', 'phone', 'email', 'topic', 'speciality', 'message', 'notes', 'form_name']

const STATUS: Record<EnquiryStatus, { label: string; cls: string; icon: typeof Inbox }> = {
  new: { label: 'New', cls: 'bg-sky-50 text-sky-700 ring-sky-200', icon: Mail },
  in_progress: { label: 'In progress', cls: 'bg-violet-50 text-violet-700 ring-violet-200', icon: PlayCircle },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  spam: { label: 'Spam', cls: 'bg-slate-100 text-slate-600 ring-slate-200', icon: Ban },
}

/** Gmail-style time: 10:40 AM today, "Yesterday", 27 Sep, 27/09/25 */
function shortTime(v?: string | null) {
  if (!v) return ''
  const d = new Date(v)
  if (isToday(d)) return format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday'
  return isSameYear(d, new Date()) ? format(d, 'd MMM') : format(d, 'dd/MM/yy')
}
const phoneDigits = (p: string) => p.replace(/\D/g, '').slice(-10)
const prettyPhone = (p: string) => { const d = phoneDigits(p); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p }
const firstName = (n: string) => n.trim().split(/\s+/)[0]

function useNarrow(q = '(max-width: 767px)') {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [q])
  return m
}
/** relative time, but never "in 5 hours" if a clock is slightly ahead */
const agoPast = (v: string) => (new Date(v).getTime() > Date.now() ? 'just now' : ago(v))

// ------------------------------------------------------------------ small pieces
function IconBtn({ label, onClick, children, className, active, disabled, kbd }: { label: string; onClick: () => void; children: ReactNode; className?: string; active?: boolean; disabled?: boolean; kbd?: string }) {
  return (
    <button type="button" aria-label={label} title={kbd ? `${label} (${kbd})` : label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:pointer-events-none disabled:opacity-40',
        active && 'text-brand-700', className)}>{children}</button>
  )
}
function Check({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked }, [indeterminate, checked])
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-slate-200/70" onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
    </span>
  )
}
function StarBtn({ on, onClick, size = 'h-[18px] w-[18px]' }: { on: boolean; onClick: () => void; size?: string }) {
  return (
    <IconBtn label={on ? 'Unstar' : 'Star'} kbd="s" onClick={onClick} className={on ? 'text-amber-400 hover:text-amber-500' : 'text-slate-300 hover:text-slate-500'}>
      <Star className={cn(size, on && 'fill-amber-400')} />
    </IconBtn>
  )
}
function TopicChip({ r, className }: { r: Pick<SiteEnquiry, 'topic' | 'form_id'>; className?: string }) {
  const t = useContext(LabelCtx).style(r)
  return <span className={cn('inline-flex max-w-[11rem] shrink-0 items-center truncate rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset', t.chip, className)}>{r.topic}</span>
}
/** the rating answer of a review-type submission, if any */
const ratingOf = (r: SiteEnquiry) => { const a = r.data?.find((x) => x.type === 'rating'); return a ? Number(a.value) || 0 : 0 }
function RatingPill({ n, className }: { n: number; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 py-px text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200', className)} aria-label={`${n} out of 5 stars`}><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{n}</span>
}
const answerText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : String(v ?? ''))
function StatusChip({ s, className }: { s: EnquiryStatus; className?: string }) {
  const m = STATUS[s]
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] font-semibold ring-1 ring-inset', m.cls, className)}><m.icon className="h-3 w-3" />{m.label}</span>
}

// ------------------------------------------------------------------ page
export default function EnquiriesPage() {
  const { user } = useAuth()
  const site = useSiteSettings()
  const qc = useQueryClient()
  const update = useUpdate('site_enquiries', { silent: true, label: 'enquiry' })
  const remove = useRemove('site_enquiries', { silent: true, label: 'enquiry' })
  const canDelete = can(user?.role, 'site_enquiries', 'delete')

  const [params, setParams] = useSearchParams()
  // a form's submissions open on "All" (its whole history); otherwise the Inbox
  const folder = (FOLDERS.some((f) => f.id === params.get('folder')) ? params.get('folder') : params.get('form') ? 'all' : 'inbox') as Folder
  const label = params.get('label')
  const formId = params.get('form')
  const openId = params.get('id')
  const setParam = useCallback((patch: Record<string, string | null>, replace = false) => {
    setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n }, { replace })
  }, [setParams])

  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [help, setHelp] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // refresh every 30 s so new website messages show up without a reload
  useEffect(() => { const t = setInterval(() => qc.invalidateQueries({ queryKey: qk('site_enquiries') }), 30_000); return () => clearInterval(t) }, [qc])

  // forms (Settings → Forms) and the Contact form's topics
  const formsQ = useTable('site_forms')
  const forms = useMemo(() => [...(formsQ.data ?? [])].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [formsQ.data])
  const formMap = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms])
  contactFormId = forms.find((f) => f.kind === 'contact' && f.slug === 'contact')?.id ?? CONTACT_FORM_ID
  const lists = useFormLists()
  const labels = useMemo(() => {
    const topicField = (formMap.get(contactFormId)?.fields as FormField[] | undefined)?.find((f) => f.role === 'topic')
    const own = (topicField?.options ?? []).filter((o) => o.trim())
    return topicLabels(own.length ? own : lists.topics.length ? lists.topics : DEFAULT_TOPICS)
  }, [formMap, lists.topics])
  const lookup = useMemo<LabelLookup>(() => ({
    forms: formMap,
    style: (r) => {
      if (r.form_id && !isContactForm(r.form_id)) return { name: r.topic, ...formColor(formMap.get(r.form_id)) }
      return labels.find((l) => l.name === r.topic) ?? labels[labels.length - 1] ?? SLATE
    },
  }), [formMap, labels])
  const currentForm = formId ? formMap.get(formId) : undefined
  const formWhere = useMemo<Filter[]>(() => (formId ? [['form_id', 'eq', formId]] : []), [formId])

  const term = useDebounced(q.trim(), 250)
  const baseQuery = useMemo<Query>(() => ({
    where: [...(label ? labelWhere(label, labels) : FOLDER_WHERE[folder]), ...formWhere],
    search: term ? { term, columns: SEARCH_COLS } : undefined,
    order: [{ column: 'created_at', asc: false }],
  }), [folder, label, labels, formWhere, term])
  useEffect(() => { setPage(0); setSelected(new Set()); setCursor(0) }, [folder, label, formId, term])
  const list = useRows('site_enquiries', { ...baseQuery, range: [page * PAGE, page * PAGE + PAGE - 1], count: true }, { keepPrevious: true })
  const pageRows = useMemo(() => list.data?.rows ?? [], [list.data])
  const total = list.data?.count ?? pageRows.length
  const pages = Math.max(1, Math.ceil(total / PAGE))
  useEffect(() => { if (page > 0 && page >= pages) setPage(pages - 1) }, [page, pages])

  // sidebar counters — cheap head-only counts
  const cInbox = useCount('site_enquiries', [...FOLDER_WHERE.inbox, ['read_at', 'is_null'], ...formWhere])
  const cUnread = useCount('site_enquiries', [...FOLDER_WHERE.unread, ...formWhere])
  const cProgress = useCount('site_enquiries', [...FOLDER_WHERE.in_progress, ...formWhere])
  const inboxUnread = cInbox.count ?? 0
  const counts = { inbox: inboxUnread, unread: cUnread.count ?? 0, in_progress: cProgress.count ?? 0 } as Record<Folder, number>
  const labelQs = useQueries({ queries: labels.map((t) => ({ queryKey: [...qk('site_enquiries'), 'count', 'label', t.name, labels.length], queryFn: () => db.query('site_enquiries', { where: labelWhere(t.name, labels), head: true, count: true }).then((r) => r.count ?? 0) })) })
  const labelCounts = Object.fromEntries(labels.map((t, i) => [t.name, labelQs[i]?.data ?? 0])) as Record<string, number>
  // unread per form, like Gmail labels
  const formQs = useQueries({ queries: forms.map((f) => ({ queryKey: [...qk('site_enquiries'), 'count', 'form-unread', f.id], queryFn: () => db.query('site_enquiries', { where: [...FOLDER_WHERE.unread, ['form_id', 'eq', f.id]], head: true, count: true }).then((r) => r.count ?? 0) })) })
  const formUnread = Object.fromEntries(forms.map((f, i) => [f.id, formQs[i]?.data ?? 0])) as Record<string, number>

  // the open message may sit on another page (deep link) — fetch it on its own then
  const inPage = openId ? pageRows.find((r) => r.id === openId) : undefined
  const openQ = useRow('site_enquiries', openId && !inPage ? openId : undefined)
  const open = openId ? inPage ?? openQ.data ?? null : null
  const idxInPage = open ? pageRows.findIndex((r) => r.id === open.id) : -1
  const openIdx = idxInPage < 0 ? -1 : page * PAGE + idxInPage
  const rows = pageRows
  const known = useCallback((id: string) => pageRows.find((r) => r.id === id) ?? (open?.id === id ? open : undefined), [pageRows, open])

  // ---------------------------------------------------------------- actions
  const patchMany = useCallback(async (ids: string[], patch: Partial<SiteEnquiry>) => {
    await Promise.all(ids.map((id) => update.mutateAsync({ id, patch }).catch(() => null)))
  }, [update])
  /** status change with an Undo toast, like Gmail */
  const setStatus = useCallback((ids: string[], status: EnquiryStatus) => {
    if (!ids.length) return
    const prev = ids.map((id) => [id, known(id)?.status] as const).filter(([, s]) => s && s !== status)
    if (!prev.length) return
    patchMany(prev.map(([id]) => id), { status })
    setSelected(new Set())
    const n = prev.length
    toast.success(`${n === 1 ? 'Enquiry' : `${n} enquiries`} ${status === 'spam' ? 'reported as spam' : status === 'resolved' ? 'marked resolved' : status === 'in_progress' ? 'marked in progress' : 'moved to New'}`, {
      action: { label: 'Undo', onClick: () => prev.forEach(([id, s]) => update.mutate({ id, patch: { status: s! } })) },
    })
  }, [known, patchMany, update])
  const setRead = useCallback((ids: string[], read: boolean) => { patchMany(ids, { read_at: read ? new Date().toISOString() : null }); setSelected(new Set()) }, [patchMany])
  const toggleStar = useCallback((r: SiteEnquiry) => update.mutate({ id: r.id, patch: { starred: !r.starred } }), [update])
  const doDelete = async (ids: string[]) => {
    await Promise.all(ids.map((id) => remove.mutateAsync(id).catch(() => null)))
    toast.success(ids.length === 1 ? 'Enquiry deleted' : `${ids.length} enquiries deleted`)
    setSelected(new Set()); setConfirmDelete(null)
    if (openId && ids.includes(openId)) setParam({ id: null })
  }

  const openRow = useCallback((r: SiteEnquiry) => {
    setParam({ id: r.id })
    if (isUnread(r)) update.mutate({ id: r.id, patch: { read_at: new Date().toISOString() } })
  }, [setParam, update])
  const close = useCallback(() => setParam({ id: null }), [setParam])
  const step = useCallback((d: 1 | -1) => {
    if (idxInPage < 0) return
    const next = rows[idxInPage + d]
    if (next) openRow(next)
    else if (d === 1 ? page < pages - 1 : page > 0) { setPage(page + d); close() } // continue on the neighbouring page
  }, [idxInPage, rows, openRow, page, pages, close])
  /** after resolving / spamming the open message, move on to the next one (Gmail "auto-advance") */
  const actOnOpen = (fn: () => void) => {
    const next = idxInPage < 0 ? undefined : rows[idxInPage + 1] ?? rows[idxInPage - 1]
    fn()
    if (next && next.id !== open?.id && folder !== 'all') openRow(next); else if (folder !== 'all') close()
  }

  // ---------------------------------------------------------------- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role=dialog]')) {
        if (e.key === 'Escape' && el === searchRef.current) { setQ(''); searchRef.current?.blur() }
        return
      }
      const cur = open ?? pageRows[cursor]
      const k = e.key
      if (k === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (k === '?') setHelp(true)
      else if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); if (open) step(1); else setCursor((c) => Math.min(pageRows.length - 1, c + 1)) }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); if (open) step(-1); else setCursor((c) => Math.max(0, c - 1)) }
      else if ((k === 'o' || k === 'Enter') && !open && pageRows[cursor]) openRow(pageRows[cursor])
      else if ((k === 'u' || k === 'Escape') && open) close()
      else if (k === 'x' && !open && cur) setSelected((s) => { const n = new Set(s); if (n.has(cur.id)) n.delete(cur.id); else n.add(cur.id); return n })
      else if (k === 's' && cur) toggleStar(cur)
      else if (k === 'e' && cur) { if (open) actOnOpen(() => setStatus([cur.id], 'resolved')); else setStatus(selected.size ? [...selected] : [cur.id], 'resolved') }
      else if (k === '!' && cur) { if (open) actOnOpen(() => setStatus([cur.id], 'spam')); else setStatus(selected.size ? [...selected] : [cur.id], 'spam') }
      else if (k === 'I' && cur) setRead(selected.size && !open ? [...selected] : [cur.id], true)
      else if (k === 'U' && cur) { setRead(selected.size && !open ? [...selected] : [cur.id], false); if (open) close() }
      else if (k === '#' && cur && canDelete) setConfirmDelete(selected.size && !open ? [...selected] : [cur.id])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => { listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  // ---------------------------------------------------------------- selection
  const pageIds = pageRows.map((r) => r.id)
  const allSel = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const someSel = pageIds.some((id) => selected.has(id))
  const sel = [...selected]
  const selRows = pageRows.filter((r) => selected.has(r.id))
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const [exporting, setExporting] = useState(false)
  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await queryAll('site_enquiries', baseQuery, 20000)
      const base = (r: SiteEnquiry) => ({ Ref: r.ref, Received: r.created_at ? format(new Date(r.created_at), 'yyyy-MM-dd HH:mm') : '', Form: r.form_name ?? '' })
      const tail = (r: SiteEnquiry) => ({ Status: STATUS[r.status].label, Starred: r.starred ? 'yes' : '', Notes: r.notes ?? '' })
      const fields = (currentForm?.fields as FormField[] | undefined) ?? []
      const name = currentForm ? `${currentForm.slug}-submissions` : 'enquiries'
      downloadCsv(`${name}-${format(new Date(), 'yyyy-MM-dd')}.csv`, all.map((r) => currentForm
        // one form: a column per question (answers as they were sent; older messages fall back to the inbox columns)
        ? { ...base(r), ...Object.fromEntries(fields.map((f) => {
            const a = r.data?.find((x) => x.id === f.id)
            const legacy = f.role ? (r as unknown as Record<string, unknown>)[f.role] : undefined
            return [f.label, a ? answerText(a.value) : legacy != null ? String(legacy) : '']
          })), ...tail(r) }
        : { ...base(r), Name: r.name, Mobile: r.phone, Email: r.email ?? '', Topic: r.topic, Speciality: r.speciality ?? '', Message: r.message,
            Answers: (r.data ?? []).filter((a) => a.type !== 'consent').map((a) => `${a.label}: ${answerText(a.value)}`).join(' | '), ...tail(r) }))
    } catch (e) { toast.error('Export failed', { description: (e as Error).message }) } finally { setExporting(false) }
  }

  const folderLabel = FOLDERS.find((f) => f.id === folder)!.label
  const title = label ?? (formId ? `${currentForm?.name ?? 'Form'} · ${folderLabel}` : folderLabel)
  const split = !!open
  const narrow = useNarrow()

  // ---------------------------------------------------------------- render
  const isOwner = user?.role === 'owner'
  const formsLocked = useModuleLocks()('forms')
  return (
    <LabelCtx.Provider value={lookup}>
    <div className="-mx-1 sm:mx-0">
      {/* header: title + Gmail-style search */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-start justify-between gap-3 lg:contents">
        <div className="min-w-0 lg:w-60 lg:shrink-0">
          <h1 className="font-display text-xl font-bold tracking-tight text-brand-950 sm:text-2xl">Enquiries</h1>
          <p className="text-xs text-slate-500">Messages from your website forms{isOwner && !formsLocked && <> · <Link to="/settings?tab=forms" className="font-medium text-brand-700 hover:underline">Manage forms</Link></>}</p>
        </div>
        <div className="flex gap-1 lg:order-last lg:shrink-0">
          <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv} loading={exporting} disabled={!total}>Export</Button>
          <IconBtn label="Keyboard shortcuts" kbd="?" onClick={() => setHelp(true)} className="hidden sm:grid"><Keyboard className="h-[18px] w-[18px]" /></IconBtn>
        </div>
        </div>
        <label className="group relative flex flex-1 items-center">
          <Search className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-slate-400 group-focus-within:text-brand-600" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, ref, message or notes"
            aria-label="Search enquiries"
            className="h-12 w-full rounded-full border border-transparent bg-brand-100/50 pl-12 pr-24 text-sm text-slate-800 outline-none transition placeholder:text-slate-500 focus:border-brand-200 focus:bg-white focus:shadow-[0_1px_6px_rgba(41,41,102,.12)]" />
          {q ? <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-3 grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-200/70"><X className="h-4 w-4" /></button>
            : <kbd className="pointer-events-none absolute right-4 hidden rounded border border-slate-200 bg-white px-1.5 font-mono text-[11px] text-slate-400 sm:block">/</kbd>}
        </label>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* ------------------------------------------------ folders + labels */}
        <nav aria-label="Enquiry folders" className="lg:w-60 lg:shrink-0">
          <ul className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {FOLDERS.map((f) => {
              const active = !label && folder === f.id
              const n = f.id === 'inbox' ? inboxUnread : f.id === 'starred' || f.id === 'spam' || f.id === 'all' || f.id === 'resolved' ? 0 : counts[f.id]
              return (
                <li key={f.id} className="shrink-0">
                  <button type="button" onClick={() => { setParam({ folder: f.id === 'inbox' && !formId ? null : f.id, label: null, id: null }) }} aria-current={active ? 'page' : undefined}
                    className={cn('flex w-full items-center gap-3 whitespace-nowrap rounded-full py-1.5 pl-4 pr-4 text-sm transition lg:rounded-l-none lg:rounded-r-full lg:pl-5',
                      active ? 'bg-brand-200/70 font-bold text-brand-950' : 'text-slate-700 hover:bg-slate-200/60')}>
                    <f.icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-brand-800' : 'text-slate-500', f.id === 'starred' && active && 'fill-brand-800')} />
                    <span className="flex-1 text-left">{f.label}</span>
                    {n > 0 && <span className={cn('text-xs tabular-nums', f.id === 'inbox' ? 'font-bold text-brand-900' : 'text-slate-500')}>{n}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {/* forms — on phones a compact picker, on desktop Gmail-style labels */}
          {forms.length > 1 && (
            <label className="mt-2 block lg:hidden">
              <span className="sr-only">Form</span>
              <select value={formId ?? ''} onChange={(e) => setParam({ form: e.target.value || null, label: null, id: null, folder: null })}
                className="h-9 w-full rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700">
                <option value="">All forms</option>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{formUnread[f.id] ? ` (${formUnread[f.id]})` : ''}</option>)}
              </select>
            </label>
          )}
          {forms.length > 0 && (
            <div className="mt-5 hidden lg:block">
              <p className="mb-1 flex items-center gap-2 pl-5 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <ClipboardList className="h-3.5 w-3.5" /><span className="flex-1">Forms</span>
                {isOwner && <Link to="/settings?tab=forms" title="Manage forms" aria-label="Manage forms" className="grid h-6 w-6 place-items-center rounded-full normal-case text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"><Settings2 className="h-3.5 w-3.5" /></Link>}
              </p>
              <ul>
                {forms.map((f) => {
                  const active = formId === f.id
                  return (
                    <li key={f.id}>
                      <button type="button" onClick={() => setParam({ form: active ? null : f.id, label: null, id: null, folder: null })} aria-current={active ? 'page' : undefined}
                        className={cn('flex w-full items-center gap-3 rounded-r-full py-1.5 pl-5 pr-4 text-sm transition', active ? 'bg-brand-200/70 font-bold text-brand-950' : 'text-slate-700 hover:bg-slate-200/60')}>
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', formColor(f).dot, !f.enabled && 'opacity-40')} />
                        <span className={cn('flex-1 truncate text-left', !f.enabled && 'text-slate-400')} title={f.enabled ? undefined : 'Switched off — older submissions are kept'}>{f.name}</span>
                        {formUnread[f.id] > 0 && <span className="text-xs font-bold tabular-nums text-brand-900">{formUnread[f.id]}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <div className="mt-5 hidden lg:block">
            <p className="mb-1 flex items-center gap-2 pl-5 text-xs font-semibold uppercase tracking-wider text-slate-400"><Tag className="h-3.5 w-3.5" />Contact topics</p>
            <ul>
              {labels.map((t) => {
                const active = label === t.name
                return (
                  <li key={t.name}>
                    <button type="button" onClick={() => setParam({ label: active ? null : t.name, form: null, id: null })} aria-current={active ? 'page' : undefined}
                      className={cn('flex w-full items-center gap-3 rounded-r-full py-1.5 pl-5 pr-4 text-sm transition', active ? 'bg-brand-200/70 font-bold text-brand-950' : 'text-slate-700 hover:bg-slate-200/60')}>
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', t.dot)} />
                      <span className="flex-1 truncate text-left">{t.name}</span>
                      {labelCounts[t.name] > 0 && <span className="text-xs tabular-nums text-slate-400">{labelCounts[t.name]}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>

        {/* ------------------------------------------------ list + reading pane */}
        <section className="flex min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card lg:h-[calc(100vh-11.5rem)] lg:min-h-[520px]">
          {/* list */}
          <div className={cn('flex min-w-0 flex-col', split ? 'hidden xl:flex xl:w-[42%] xl:shrink-0 xl:border-r xl:border-slate-100' : 'flex-1')}>
            {/* toolbar */}
            <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-slate-100 px-2">
              <Check checked={allSel} indeterminate={someSel} label={allSel ? 'Deselect all' : 'Select all on this page'}
                onChange={() => setSelected(allSel ? new Set() : new Set(pageIds))} />
              {sel.length ? (
                <>
                  <span className="mr-1 text-xs font-semibold text-brand-800 tabular-nums">{sel.length} selected</span>
                  {folder !== 'resolved' && <IconBtn label="Mark resolved" kbd="e" onClick={() => setStatus(sel, 'resolved')}><Archive className="h-[18px] w-[18px]" /></IconBtn>}
                  {folder === 'spam' ? <IconBtn label="Not spam" onClick={() => setStatus(sel, 'new')}><Inbox className="h-[18px] w-[18px]" /></IconBtn>
                    : <IconBtn label="Report spam" kbd="!" onClick={() => setStatus(sel, 'spam')}><AlertOctagon className="h-[18px] w-[18px]" /></IconBtn>}
                  {canDelete && <IconBtn label="Delete" kbd="#" onClick={() => setConfirmDelete(sel)}><Trash2 className="h-[18px] w-[18px]" /></IconBtn>}
                  <span className="mx-1 h-5 w-px bg-slate-200" />
                  {selRows.some(isUnread) ? <IconBtn label="Mark as read" kbd="Shift+I" onClick={() => setRead(sel, true)}><MailOpen className="h-[18px] w-[18px]" /></IconBtn>
                    : <IconBtn label="Mark as unread" kbd="Shift+U" onClick={() => setRead(sel, false)}><Mail className="h-[18px] w-[18px]" /></IconBtn>}
                  <IconBtn label="Mark in progress" onClick={() => setStatus(sel, 'in_progress')}><Clock3 className="h-[18px] w-[18px]" /></IconBtn>
                  <IconBtn label={selRows.every((r) => r.starred) ? 'Unstar' : 'Star'} onClick={() => { const on = !selRows.every((r) => r.starred); patchMany(sel, { starred: on }) }}><Star className="h-[18px] w-[18px]" /></IconBtn>
                </>
              ) : (
                <>
                  <IconBtn label="Refresh" onClick={() => list.refetch()}><RefreshCw className={cn('h-[18px] w-[18px]', list.isFetching && 'animate-spin')} /></IconBtn>
                  {inboxUnread > 0 && folder === 'inbox' && !label && (
                    <IconBtn label="Mark all as read" onClick={() => setRead(rows.filter(isUnread).map((r) => r.id), true)}><CheckCheck className="h-[18px] w-[18px]" /></IconBtn>
                  )}
                  <span className="ml-2 hidden truncate text-sm font-semibold text-slate-700 sm:inline">{title}{q && <span className="font-normal text-slate-500"> · “{q}”</span>}</span>
                  {formId && <button type="button" onClick={() => setParam({ form: null, folder: null, id: null })} title="Show every form" className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 hover:bg-brand-100"><X className="h-3 w-3" />All forms</button>}
                </>
              )}
              <div className="ml-auto flex items-center gap-0.5 pl-2 text-xs text-slate-500">
                <span className="whitespace-nowrap tabular-nums">{total ? `${page * PAGE + 1}–${Math.min(total, page * PAGE + PAGE)} of ${total}` : '0 of 0'}</span>
                <IconBtn label="Newer" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-[18px] w-[18px]" /></IconBtn>
                <IconBtn label="Older" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-[18px] w-[18px]" /></IconBtn>
              </div>
            </div>

            {/* rows */}
            <div ref={listRef} className="scrollbar-thin min-h-[320px] flex-1 overflow-y-auto" role="list" aria-label={`${title} enquiries`}>
              {list.isLoading ? (
                <div className="divide-y divide-slate-100">{Array.from({ length: 7 }, (_, i) => <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="h-4 w-4" /><Skeleton className="h-4 w-32" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-12" /></div>)}</div>
              ) : list.isError ? (
                <p className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{(list.error as Error).message}</p>
              ) : !rows.length ? (
                <EmptyState className="py-20" icon={q ? <Search className="h-6 w-6" /> : folder === 'inbox' && !label ? <CheckCircle2 className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
                  title={q ? 'No matching enquiries' : label ? `No “${label}” enquiries` : formId && folder === 'all' ? `No ${currentForm?.name ?? 'form'} submissions yet` : FOLDERS.find((f) => f.id === folder)!.empty[0]}
                  description={q ? 'Try a name, mobile number or reference like DCH-482138.' : label ? 'Enquiries with this topic will appear here.' : formId && folder === 'all' ? (currentForm && !currentForm.enabled ? 'This form is switched off in Settings → Forms.' : 'Submissions from this form will appear here.') : FOLDERS.find((f) => f.id === folder)!.empty[1]}
                  action={q ? <Button variant="outline" size="sm" onClick={() => setQ('')}>Clear search</Button> : undefined} />
              ) : pageRows.map((r, i) => (
                <Row key={r.id} r={r} index={i} compact={split || narrow} active={open?.id === r.id} focused={!open && cursor === i} selected={selected.has(r.id)}
                  showStatus={folder === 'inbox' || folder === 'starred' || folder === 'unread' || folder === 'all' || !!label} showForm={!formId} canDelete={canDelete}
                  onOpen={() => { setCursor(i); openRow(r) }} onSelect={() => toggleSel(r.id)} onStar={() => toggleStar(r)}
                  onResolve={() => setStatus([r.id], 'resolved')} onSpam={() => setStatus([r.id], r.status === 'spam' ? 'new' : 'spam')}
                  onRead={() => setRead([r.id], isUnread(r))} onDelete={() => setConfirmDelete([r.id])} />
              ))}
            </div>
          </div>

          {/* reading pane */}
          {open ? (
            <Reader key={open.id} r={open} pos={openIdx} total={total} canDelete={canDelete} hospital={site.brand?.shortName || site.name}
              onClose={close} onPrev={() => step(-1)} onNext={() => step(1)} onStar={() => toggleStar(open)}
              onStatus={(s) => (s === 'resolved' || s === 'spam') && folder !== 'all' && folder !== s ? actOnOpen(() => setStatus([open.id], s)) : setStatus([open.id], s)}
              onUnread={() => { setRead([open.id], false); close() }} onDelete={() => setConfirmDelete([open.id])}
              onSaveNotes={(notes) => update.mutateAsync({ id: open.id, patch: { notes } })} />
          ) : null}
        </section>
      </div>

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} loading={remove.isPending} onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        title={confirmDelete && confirmDelete.length > 1 ? `Delete ${confirmDelete.length} enquiries?` : 'Delete this enquiry?'}
        description="This permanently removes the message and its notes. Mark it as spam or resolved instead if you may need it later." />
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} canDelete={canDelete} />
    </div>
    </LabelCtx.Provider>
  )
}

// ------------------------------------------------------------------ list row
function Row({ r, index, compact, active, focused, selected, showStatus, showForm, canDelete, onOpen, onSelect, onStar, onResolve, onSpam, onRead, onDelete }: {
  r: SiteEnquiry; index: number; compact: boolean; active: boolean; focused: boolean; selected: boolean; showStatus: boolean; showForm: boolean; canDelete: boolean
  onOpen: () => void; onSelect: () => void; onStar: () => void; onResolve: () => void; onSpam: () => void; onRead: () => void; onDelete: () => void
}) {
  const unread = isUnread(r)
  const stars = ratingOf(r)
  // a form whose topic is a question (not its own name) also shows which form it came from
  const formBadge = showForm && r.form_id && !isContactForm(r.form_id) && r.form_name && r.form_name !== r.topic
    ? <span className="hidden shrink-0 items-center gap-1 truncate rounded bg-slate-100 px-1.5 py-px text-[11px] text-slate-600 lg:inline-flex"><ClipboardList className="h-3 w-3" />{r.form_name}</span> : null
  const hover = (
    <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
      {r.status !== 'resolved' && r.status !== 'spam' && <IconBtn label="Mark resolved" onClick={onResolve}><Archive className="h-[17px] w-[17px]" /></IconBtn>}
      <IconBtn label={r.status === 'spam' ? 'Not spam' : 'Report spam'} onClick={onSpam}>{r.status === 'spam' ? <Inbox className="h-[17px] w-[17px]" /> : <AlertOctagon className="h-[17px] w-[17px]" />}</IconBtn>
      {canDelete && <IconBtn label="Delete" onClick={onDelete}><Trash2 className="h-[17px] w-[17px]" /></IconBtn>}
      <IconBtn label={unread ? 'Mark as read' : 'Mark as unread'} onClick={onRead}>{unread ? <MailOpen className="h-[17px] w-[17px]" /> : <Mail className="h-[17px] w-[17px]" />}</IconBtn>
    </div>
  )
  return (
    <div role="listitem" data-row={index} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen() }} tabIndex={0}
      aria-label={`${unread ? 'Unread. ' : ''}${r.name}, ${r.topic}: ${r.message.slice(0, 80)}`}
      className={cn('group relative flex cursor-pointer items-center border-b border-slate-100 pr-3 transition-colors focus:outline-none',
        selected ? 'bg-brand-100/70' : active ? 'bg-brand-50' : unread ? 'bg-white' : 'bg-slate-50/60',
        'hover:z-[1] hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)]',
        (focused || active) && 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-600')}>
      <div className="flex shrink-0 items-center pl-1.5">
        <Check checked={selected} onChange={onSelect} label={`Select enquiry from ${r.name}`} />
        <StarBtn on={!!r.starred} onClick={onStar} />
      </div>
      {compact ? (
        // two-line layout (split view / narrow screens)
        <div className="min-w-0 flex-1 py-2.5 pl-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-bold text-slate-900' : 'text-slate-700')}>{r.name}</span>
            <span className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-bold text-slate-900' : 'text-slate-500')}>{shortTime(r.created_at)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <TopicChip r={r} />
            {stars > 0 && <RatingPill n={stars} />}
            {showStatus && r.status !== 'new' && <StatusChip s={r.status} />}
          </div>
          <p className={cn('mt-0.5 line-clamp-1 text-[13px]', unread ? 'text-slate-700' : 'text-slate-500')}>{r.message}</p>
        </div>
      ) : (
        <>
          <span className={cn('w-36 shrink-0 truncate pl-1 text-sm sm:w-44', unread ? 'font-bold text-slate-900' : 'text-slate-700')}>{r.name}</span>
          <div className="flex min-w-0 flex-1 items-center gap-2 py-3 text-sm">
            <TopicChip r={r} className="hidden sm:inline-flex" />
            {formBadge}
            {stars > 0 && <RatingPill n={stars} />}
            {showStatus && r.status !== 'new' && <StatusChip s={r.status} className="hidden md:inline-flex" />}
            <span className="min-w-0 truncate">
              {r.speciality && <span className={cn(unread ? 'font-bold text-slate-900' : 'text-slate-700')}>{r.speciality} enquiry — </span>}
              <span className={unread ? 'text-slate-700' : 'text-slate-500'}>{r.message}</span>
            </span>
            {r.notes && <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Has notes" />}
          </div>
          <div className="flex w-[8.5rem] shrink-0 items-center justify-end">
            {hover}
            <span className={cn('whitespace-nowrap text-xs tabular-nums group-hover:hidden group-focus-within:hidden', unread ? 'font-bold text-slate-900' : 'text-slate-500')}>{shortTime(r.created_at)}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ reading pane
function Reader({ r, pos, total, canDelete, hospital, onClose, onPrev, onNext, onStar, onStatus, onUnread, onDelete, onSaveNotes }: {
  r: SiteEnquiry; pos: number; total: number; canDelete: boolean; hospital: string
  onClose: () => void; onPrev: () => void; onNext: () => void; onStar: () => void; onStatus: (s: EnquiryStatus) => void
  onUnread: () => void; onDelete: () => void; onSaveNotes: (notes: string | null) => Promise<unknown>
}) {
  const [notes, setNotes] = useState(r.notes ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = notes.trim() !== (r.notes ?? '').trim()
  const save = async () => {
    if (!dirty) return
    setSaving(true)
    try { await onSaveNotes(notes.trim() || null); toast.success('Note saved') } finally { setSaving(false) }
  }
  // switching to another message saves the note instead of losing it
  const saveRef = useRef(save); saveRef.current = save
  useEffect(() => () => { void saveRef.current() }, [])
  const prompt = useUnsavedChanges(dirty, { onSave: save, saving, what: 'the internal note' })

  const d = phoneDigits(r.phone)
  const greeting = `Hello ${firstName(r.name)}, this is ${hospital} regarding your enquiry ${r.ref}. `
  const wa = `https://wa.me/91${d}?text=${encodeURIComponent(greeting)}`
  const mail = r.email ? `mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.topic} [${r.ref}]`)}&body=${encodeURIComponent(`Dear ${firstName(r.name)},\n\n\n\nRegards,\n${hospital}\n\n--- Your message (${r.created_at ? format(new Date(r.created_at), 'd MMM yyyy, h:mm a') : ''}) ---\n${r.message}`)}` : null
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`))
  const days = r.created_at ? differenceInCalendarDays(new Date(), new Date(r.created_at)) : 0
  const waiting = (r.status === 'new' || r.status === 'in_progress') && days >= 2

  return (
    <article className="flex min-w-0 flex-1 flex-col" aria-label={`Enquiry from ${r.name}`}>
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-slate-100 px-2">
        <IconBtn label="Back to list" kbd="u" onClick={onClose}><ArrowLeft className="h-[18px] w-[18px]" /></IconBtn>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {r.status !== 'resolved' && <IconBtn label="Mark resolved" kbd="e" onClick={() => onStatus('resolved')}><Archive className="h-[18px] w-[18px]" /></IconBtn>}
        {r.status === 'spam' ? <IconBtn label="Not spam" onClick={() => onStatus('new')}><Inbox className="h-[18px] w-[18px]" /></IconBtn>
          : <IconBtn label="Report spam" kbd="!" onClick={() => onStatus('spam')}><AlertOctagon className="h-[18px] w-[18px]" /></IconBtn>}
        {canDelete && <IconBtn label="Delete" kbd="#" onClick={onDelete}><Trash2 className="h-[18px] w-[18px]" /></IconBtn>}
        <IconBtn label="Mark as unread" kbd="Shift+U" onClick={onUnread}><Mail className="h-[18px] w-[18px]" /></IconBtn>
        <div className="ml-auto flex items-center gap-0.5 text-xs text-slate-500">
          {pos >= 0 && <span className="whitespace-nowrap tabular-nums">{pos + 1} of {total}</span>}
          <IconBtn label="Newer" kbd="k" disabled={pos <= 0} onClick={onPrev}><ChevronLeft className="h-[18px] w-[18px]" /></IconBtn>
          <IconBtn label="Older" kbd="j" disabled={pos < 0 || pos >= total - 1} onClick={onNext}><ChevronRight className="h-[18px] w-[18px]" /></IconBtn>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {/* subject */}
        <div className="flex items-start gap-3 px-4 pb-2 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold sm:text-xl leading-snug text-slate-900">{r.speciality ? `${r.topic} — ${r.speciality}` : r.topic}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusChip s={r.status} /><TopicChip r={r} />{ratingOf(r) > 0 && <RatingPill n={ratingOf(r)} />}
              <button type="button" onClick={() => copy(r.ref, 'Reference')} title="Copy reference" className="rounded px-1.5 py-px font-mono text-[11px] text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">{r.ref}</button>
              {waiting && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-px text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"><Clock3 className="h-3 w-3" />Waiting {days} days</span>}
            </div>
          </div>
          <StarBtn on={!!r.starred} onClick={onStar} size="h-5 w-5" />
        </div>

        {/* sender */}
        <div className="flex items-start gap-3 px-4 py-3 sm:px-6">
          <Avatar name={r.name} size="lg" className="hidden sm:grid" /><Avatar name={r.name} className="sm:hidden" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-slate-900">{r.name}</span>
              <span className="hidden text-xs text-slate-500 sm:inline">via {r.form_name ? r.form_name.toLowerCase().includes('form') ? r.form_name : `${r.form_name} form` : 'website contact form'}</span>
              {r.created_at && <span className="text-xs text-slate-500 sm:hidden">{shortTime(r.created_at)} · {agoPast(r.created_at)}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-600">
              <button type="button" onClick={() => copy(prettyPhone(r.phone), 'Mobile number')} className="inline-flex items-center gap-1 tabular-nums hover:text-brand-700" title="Copy mobile number"><Phone className="h-3.5 w-3.5 text-slate-400" />{prettyPhone(r.phone)}<Copy className="h-3 w-3 text-slate-300" /></button>
              {r.email && <button type="button" onClick={() => copy(r.email!, 'Email')} className="inline-flex min-w-0 items-center gap-1 hover:text-brand-700" title="Copy email"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{r.email}</span></button>}
            </div>
          </div>
          <time dateTime={r.created_at ?? undefined} className="hidden shrink-0 text-right text-xs text-slate-500 sm:block">
            {r.created_at && <>{format(new Date(r.created_at), 'd MMM yyyy, h:mm a')}<br /><span className="text-slate-400">({agoPast(r.created_at)})</span></>}
          </time>
        </div>

        {/* body */}
        <div className="whitespace-pre-wrap break-words px-4 pb-2 sm:pl-[4.75rem] sm:pr-6 text-[15px] leading-relaxed text-slate-800">{r.message}</div>

        {/* every answer as it was sent (forms other than the Contact form) */}
        {r.form_id && !isContactForm(r.form_id) && !!r.data?.length && <Answers r={r} />}

        {/* reply actions */}
        <div className="flex flex-wrap gap-2 px-4 pb-6 pt-4 sm:pl-[4.75rem] sm:pr-6">
          <a href={`tel:+91${d}`} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:shadow-sm"><Phone className="h-4 w-4" />Call back</a>
          <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:shadow-sm"><MessageCircle className="h-4 w-4 text-emerald-600" />WhatsApp</a>
          {mail ? <a href={mail} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:shadow-sm"><Undo2 className="h-4 w-4" />Reply by email</a>
            : <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-slate-200 px-4 py-2 text-sm text-slate-400" title="No email address given"><Undo2 className="h-4 w-4" />No email given</span>}
        </div>

        {/* status + notes */}
        <div className="mx-4 mb-6 rounded-2xl sm:mr-6 border border-slate-200 bg-slate-50/60 sm:ml-[4.75rem]">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</span>
            <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1">
              {(Object.keys(STATUS) as EnquiryStatus[]).map((s) => {
                const on = r.status === s
                const M = STATUS[s]
                return (
                  <button key={s} type="button" role="radio" aria-checked={on} onClick={() => !on && onStatus(s)}
                    className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition', on ? M.cls : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100')}>
                    <M.icon className="h-3.5 w-3.5" />{M.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="p-4">
            <label htmlFor="enq-notes" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><StickyNote className="h-3.5 w-3.5 text-amber-500" />Internal note</label>
            <Textarea id="enq-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Call outcome, follow-up, who is handling it…"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() } }} className="bg-white" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">Only hospital staff can see this · Ctrl+Enter to save</span>
              <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>Save note</Button>
            </div>
          </div>
        </div>
      </div>
      {prompt}
    </article>
  )
}

// ------------------------------------------------------------------ form answers
function Answers({ r }: { r: SiteEnquiry }) {
  // name / mobile / email and the message are already shown above
  const shown = new Set([r.name, r.phone, r.email].filter(Boolean).map(String))
  const items = (r.data ?? []).filter((a) => !(typeof a.value === 'string' && ((shown.has(a.value) && ['text', 'phone', 'email'].includes(a.type)) || (a.type === 'textarea' && a.value.trim() === r.message.trim()))))
  if (!items.length) return null
  return (
    <section aria-label="Form answers" className="mx-4 mt-4 rounded-2xl border border-slate-200 sm:ml-[4.75rem] sm:mr-6">
      <h3 className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><ClipboardList className="h-3.5 w-3.5" />{r.form_name ?? 'Form'} answers</h3>
      <dl className="divide-y divide-slate-100">
        {items.map((a) => (
          <div key={a.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
            <dt className="text-[13px] text-slate-500">{a.label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-slate-800">
              {a.type === 'rating' ? (
                <span className="inline-flex items-center gap-0.5" aria-label={`${a.value} out of 5`}>
                  {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn('h-4 w-4', i <= Number(a.value) ? 'fill-amber-400 text-amber-400' : 'text-slate-200')} />)}
                  <span className="ml-1.5 text-xs font-semibold text-slate-600">{String(a.value)}/5</span>
                </span>
              ) : Array.isArray(a.value) ? (
                <span className="flex flex-wrap gap-1">{a.value.map((v) => <span key={v} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{v}</span>)}</span>
              ) : a.type === 'consent' ? (
                <span className="inline-flex items-center gap-1 text-emerald-700"><CheckIcon className="h-4 w-4" />Agreed</span>
              ) : answerText(a.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ------------------------------------------------------------------ shortcuts
function ShortcutsHelp({ open, onClose, canDelete }: { open: boolean; onClose: () => void; canDelete: boolean }) {
  const keys: [string, string][] = [
    ['j / k', 'Older / newer'], ['o or Enter', 'Open'], ['u or Esc', 'Back to list'], ['x', 'Select'], ['s', 'Star / unstar'],
    ['e', 'Mark resolved'], ['!', 'Report spam'], ['Shift + I', 'Mark as read'], ['Shift + U', 'Mark as unread'],
    ...(canDelete ? [['#', 'Delete'] as [string, string]] : []), ['/', 'Search'], ['?', 'This help'],
  ]
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {keys.map(([k, v]) => <div key={k} className="contents"><dt><kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700">{k}</kbd></dt><dd className="text-slate-600">{v}</dd></div>)}
      </dl>
    </Modal>
  )
}

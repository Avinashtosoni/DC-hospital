import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  AlarmClock, BellRing, CalendarClock, CheckCheck, Clock3, Eye, EyeOff, Megaphone, Pencil, Pin, PinOff, Plus, Search, Send, Siren, Trash2, Users, X,
} from 'lucide-react'
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, Input, Select, Skeleton, Textarea, type Tone } from '../components/ui'
import { useAuth } from '../auth/AuthProvider'
import { can } from '../auth/permissions'
import { useCreate, useRemove, useTable, useUpdate } from '../hooks/useData'
import { daysLeft, isFresh, noticeState, sortNotices, useNoticeReads, visibleTo, type NoticeState } from '../notices/board'
import { PushToggle } from '../components/PushToggle'
import { useAppSettings } from '../settings/AppSettingsProvider'
import { CHANNEL_LABEL, CHANNELS } from '../settings/types'
import { ago, cn, fmtDate, today } from '../lib/utils'
import type { Notice } from '../types'

type Filter = 'all' | 'unread' | 'urgent' | 'pinned'
type Draft = Pick<Notice, 'title' | 'body' | 'audience' | 'priority' | 'published_on'> & { expires_on: string; pinned: boolean }

const PRIORITY: Record<Notice['priority'], { label: string; tone: Tone; bar: string; icon: typeof Megaphone }> = {
  urgent: { label: 'Urgent', tone: 'red', bar: 'bg-rose-500', icon: Siren },
  important: { label: 'Important', tone: 'amber', bar: 'bg-amber-400', icon: AlarmClock },
  normal: { label: 'General', tone: 'violet', bar: 'bg-brand-300', icon: Megaphone },
}
const AUDIENCE: Record<Notice['audience'], string> = { all: 'Everyone', staff: 'All staff', doctors: 'Doctors', patients: 'Patients' }
const STATE: Record<NoticeState, { label: string; tone: Tone }> = { live: { label: 'Live', tone: 'green' }, scheduled: { label: 'Scheduled', tone: 'blue' }, expired: { label: 'Expired', tone: 'slate' } }
const blank = (): Draft => ({ title: '', body: '', audience: 'all', priority: 'normal', published_on: today(), expires_on: '', pinned: false })

function bucket(n: Notice, on: string) {
  const d = differenceInCalendarDays(parseISO(on), parseISO(n.published_on))
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? 'This week' : d < 31 ? 'This month' : 'Earlier'
}

export default function NoticeBoard() {
  const { user } = useAuth()
  const role = user?.role
  const manage = can(role, 'notices', 'create')
  const q = useTable('notices')
  const reads = useNoticeReads(user?.id)
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [audience, setAudience] = useState<'any' | Notice['audience']>('any')
  const [showOld, setShowOld] = useState(false)
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Notice | null>(null)
  const update = useUpdate('notices', { label: 'Notice' })
  const remove = useRemove('notices', { label: 'Notice' })
  const on = today()

  const mine = useMemo(() => (q.data ?? []).filter((n) => visibleTo(n, role)).sort(sortNotices), [q.data, role])
  const live = mine.filter((n) => noticeState(n, on) === 'live')
  const unread = live.filter((n) => isFresh(n, on) && !reads.isRead(n.id))
  const openId = params.get('open')
  const open = openId ? mine.find((n) => n.id === openId) ?? null : null
  useEffect(() => { if (open && !reads.isRead(open.id)) reads.markRead([open.id]) }, [open?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const setOpen = (id: string | null) => setParams((p) => { const x = new URLSearchParams(p); if (id) x.set('open', id); else x.delete('open'); return x }, { replace: true })

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase()
    return mine.filter((n) => {
      const st = noticeState(n, on)
      if (st !== 'live' && !(manage && showOld)) return false
      if (filter === 'unread' && (st !== 'live' || !isFresh(n, on) || reads.isRead(n.id))) return false
      if (filter === 'urgent' && n.priority === 'normal') return false
      if (filter === 'pinned' && !n.pinned) return false
      if (audience !== 'any' && n.audience !== audience) return false
      return !t || `${n.title} ${n.body} ${n.author_name ?? ''}`.toLowerCase().includes(t)
    })
  }, [mine, term, filter, audience, showOld, manage, reads, on])
  const pinned = shown.filter((n) => n.pinned)
  const rest = shown.filter((n) => !n.pinned)
  const groups = rest.reduce<[string, Notice[]][]>((acc, n) => {
    const b = noticeState(n, on) === 'scheduled' ? 'Scheduled' : bucket(n, on)
    const g = acc.find(([k]) => k === b)
    if (g) g[1].push(n); else acc.push([b, [n]])
    return acc
  }, [])

  const counts = { all: live.length, unread: unread.length, urgent: live.filter((n) => n.priority !== 'normal').length, pinned: live.filter((n) => n.pinned).length }
  const chip = (id: Filter, label: string, icon: React.ReactNode) => (
    <button type="button" key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
      className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition',
        filter === id ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-brand-50 hover:text-brand-900')}>
      {icon}{label}<span className={cn('rounded-full px-1.5 text-[10px]', filter === id ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{counts[id]}</span>
    </button>
  )

  return (
    <div className="space-y-6">
      {/* hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 p-6 text-white shadow-lift sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-brand-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-brand-200"><Megaphone className="h-4 w-4" />Notice Board</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{unread.length ? `${unread.length} new notice${unread.length === 1 ? '' : 's'} for you` : "You're all caught up"}</h1>
            <p className="mt-1 max-w-xl text-sm text-brand-100/90">Announcements, circulars and alerts from the hospital{role === 'patient' ? '' : ' for your team'}. Urgent and pinned notices stay on top.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unread.length > 0 && <button type="button" onClick={() => reads.markRead(unread.map((n) => n.id))} className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-medium text-white ring-1 ring-white/20 hover:bg-white/20"><CheckCheck className="h-4 w-4" />Mark all read</button>}
            <PushToggle variant="button" />
            {manage && <button type="button" onClick={() => setEditing('new')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-semibold text-brand-900 shadow hover:bg-brand-50"><Plus className="h-4 w-4" />Post notice</button>}
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Live notices', counts.all, Megaphone], ['Unread', counts.unread, BellRing], ['Urgent / important', counts.urgent, Siren], ['Pinned', counts.pinned, Pin]].map(([l, v, I]) => {
            const Icon = I as typeof Megaphone
            return <div key={l as string} className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15 backdrop-blur"><p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-brand-200"><Icon className="h-3.5 w-3.5" />{l as string}</p><p className="mt-1 text-2xl font-bold">{q.isPending ? '–' : v as number}</p></div>
          })}
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search notices…" className="pl-9" aria-label="Search notices" />
          {term && <button type="button" onClick={() => setTerm('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-100" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chip('all', 'All', null)}
          {chip('unread', 'Unread', <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />)}
          {chip('urgent', 'Urgent', <Siren className="h-3.5 w-3.5" />)}
          {chip('pinned', 'Pinned', <Pin className="h-3.5 w-3.5" />)}
          {role !== 'patient' && (
            <Select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className="h-8 w-auto py-0 text-xs" aria-label="Audience">
              <option value="any">Any audience</option>
              {(Object.keys(AUDIENCE) as Notice['audience'][]).filter((a) => role === 'owner' || visibleTo({ audience: a } as Notice, role)).map((a) => <option key={a} value={a}>{AUDIENCE[a]}</option>)}
            </Select>
          )}
          {manage && <button type="button" onClick={() => setShowOld((v) => !v)} aria-pressed={showOld} className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1', showOld ? 'bg-brand-50 text-brand-900 ring-brand-200' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')}>{showOld ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}Scheduled & expired</button>}
        </div>
      </div>

      {/* list */}
      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : q.isError ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{(q.error as Error).message}</p>
      ) : !shown.length ? (
        <EmptyState className="rounded-2xl border border-dashed border-brand-200 bg-white py-16" icon={<Megaphone className="h-6 w-6" />}
          title={term || filter !== 'all' || audience !== 'any' ? 'No notices match' : 'No notices yet'}
          description={term || filter !== 'all' || audience !== 'any' ? 'Try another search or filter.' : manage ? 'Post the first announcement for your team or patients.' : 'New announcements from the hospital will appear here.'}
          action={term || filter !== 'all' || audience !== 'any' ? <Button variant="outline" onClick={() => { setTerm(''); setFilter('all'); setAudience('any') }}>Clear filters</Button> : manage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Post notice</Button> : undefined} />
      ) : (
        <div className="space-y-8">
          {pinned.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-brand-700"><Pin className="h-3.5 w-3.5" />Pinned</h2>
              <div className="grid gap-4 md:grid-cols-2">{pinned.map((n) => <NoticeCard key={n.id} n={n} unread={isFresh(n, on) && !reads.isRead(n.id) && noticeState(n, on) === 'live'} manage={manage} onOpen={() => setOpen(n.id)} on={on} featured />)}</div>
            </section>
          )}
          {groups.map(([label, list]) => (
            <section key={label}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[.16em] text-slate-400">{label}</h2>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{list.map((n) => <NoticeCard key={n.id} n={n} unread={isFresh(n, on) && !reads.isRead(n.id) && noticeState(n, on) === 'live'} manage={manage} onOpen={() => setOpen(n.id)} on={on} />)}</div>
            </section>
          ))}
        </div>
      )}

      {/* reader */}
      <Drawer open={!!open} onClose={() => setOpen(null)} width="max-w-2xl"
        title={open ? <span className="flex items-center gap-2">{open.pinned && <Pin className="h-4 w-4 text-brand-600" />}{open.title}</span> : ''}
        subtitle={open ? `${AUDIENCE[open.audience]} · posted ${fmtDate(open.published_on)}${open.author_name ? ` by ${open.author_name}` : ''}` : undefined}
        footer={open ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" icon={<EyeOff className="h-4 w-4" />} onClick={() => { reads.markUnread(open.id); setOpen(null) }}>Mark as unread</Button>
            {manage && <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon={open.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} loading={update.isPending} onClick={() => update.mutate({ id: open.id, patch: { pinned: !open.pinned } })}>{open.pinned ? 'Unpin' : 'Pin to top'}</Button>
              <Button variant="outline" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(open)}>Edit</Button>
              <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(open)}>Delete</Button>
            </div>}
          </div>
        ) : undefined}>
        {open && <NoticeReader n={open} on={on} />}
      </Drawer>

      {manage && <NoticeEditor key={editing === 'new' ? 'new' : editing?.id ?? 'none'} notice={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); if (id) setOpen(id) }} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} loading={remove.isPending} title="Delete this notice?"
        description={deleting ? `“${deleting.title}” will be removed from everyone's notice board.` : ''}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => { setDeleting(null); setOpen(null) } })} />
    </div>
  )
}

function NoticeCard({ n, unread, manage, onOpen, on, featured }: { n: Notice; unread: boolean; manage: boolean; onOpen: () => void; on: string; featured?: boolean }) {
  const p = PRIORITY[n.priority]
  const st = noticeState(n, on)
  const left = daysLeft(n, on)
  return (
    <button type="button" onClick={onOpen}
      className={cn('group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white p-5 pl-6 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        featured ? 'ring-brand-200 bg-gradient-to-br from-white to-brand-50/60' : 'ring-slate-200/80', st !== 'live' && 'opacity-70')}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1.5', p.bar)} />
      <div className="flex items-start gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', n.priority === 'urgent' ? 'bg-rose-50 text-rose-600' : n.priority === 'important' ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-700')}><p.icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className={cn('line-clamp-2 flex-1 text-[15px] leading-snug text-slate-900', unread ? 'font-bold' : 'font-semibold')}>{n.title}</h3>
            {unread && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600 ring-4 ring-brand-100" aria-label="Unread" />}
            {n.pinned && !unread && <Pin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-label="Pinned" />}
          </div>
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{n.body}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4 text-[11px] text-slate-500">
        {n.priority !== 'normal' && <Badge tone={p.tone}>{p.label}</Badge>}
        <Badge tone="slate"><Users className="h-3 w-3" />{AUDIENCE[n.audience]}</Badge>
        {manage && st !== 'live' && <Badge tone={STATE[st].tone}>{STATE[st].label}</Badge>}
        {st === 'live' && left != null && left <= 7 && <Badge tone="amber"><Clock3 className="h-3 w-3" />{left === 0 ? 'Ends today' : `Ends in ${left}d`}</Badge>}
        <span className="ml-auto whitespace-nowrap">{n.author_name ? `${n.author_name} · ` : ''}{st === 'scheduled' ? `Goes live ${fmtDate(n.published_on)}` : ago(n.published_on)}</span>
      </div>
    </button>
  )
}

function NoticeReader({ n, on }: { n: Notice; on: string }) {
  const p = PRIORITY[n.priority]
  const st = noticeState(n, on)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone={p.tone} dot>{p.label}</Badge>
        <Badge tone="slate"><Users className="h-3 w-3" />{AUDIENCE[n.audience]}</Badge>
        <Badge tone={STATE[st].tone}>{STATE[st].label}</Badge>
        {n.expires_on && <Badge tone="slate"><CalendarClock className="h-3 w-3" />Until {fmtDate(n.expires_on)}</Badge>}
      </div>
      <article className="whitespace-pre-line break-words rounded-2xl bg-slate-50 p-5 text-[15px] leading-relaxed text-slate-800 ring-1 ring-slate-100">{n.body}</article>
      <p className="text-xs text-slate-400">Posted {fmtDate(n.published_on)}{n.author_name ? ` by ${n.author_name}` : ''}{n.updated_at && n.updated_at !== n.created_at ? ` · edited ${ago(n.updated_at)}` : ''}</p>
    </div>
  )
}

function NoticeEditor({ notice, onClose, onSaved }: { notice: Notice | 'new' | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const isNew = notice === 'new'
  const src = notice && notice !== 'new' ? notice : null
  const [d, setD] = useState<Draft>(() => src ? { title: src.title, body: src.body, audience: src.audience, priority: src.priority, published_on: src.published_on, expires_on: src.expires_on ?? '', pinned: !!src.pinned } : blank())
  const [touched, setTouched] = useState(false)
  const create = useCreate('notices', { label: 'Notice' })
  const update = useUpdate('notices', { label: 'Notice' })
  const { settings } = useAppSettings()
  const n = settings.notifications
  const via = CHANNELS.filter((c) => n.events.notice_published?.[c] && n[c]?.enabled)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const errors = {
    title: d.title.trim().length < 3 ? 'Give the notice a short title (3+ characters)' : d.title.length > 140 ? 'Keep the title under 140 characters' : '',
    body: d.body.trim().length < 5 ? 'Write the message' : d.body.length > 4000 ? 'Keep it under 4,000 characters' : '',
    expires_on: d.expires_on && d.expires_on < d.published_on ? 'Must be on or after the publish date' : '',
  }
  const bad = Object.values(errors).some(Boolean)
  const save = () => {
    setTouched(true)
    if (bad) return
    const row = { title: d.title.trim(), body: d.body.trim(), audience: d.audience, priority: d.priority, published_on: d.published_on, expires_on: d.expires_on || null, pinned: d.pinned }
    if (isNew) create.mutate(row, { onSuccess: (r) => onSaved(r.id) })
    else if (src) update.mutate({ id: src.id, patch: row }, { onSuccess: () => onSaved(src.id) })
  }
  const quick = (days: number) => set('expires_on', format(addDays(parseISO(d.published_on), days), 'yyyy-MM-dd'))
  const preview: Notice = { id: 'preview', created_at: '', title: d.title || 'Notice title', body: d.body || 'Your message appears here.', audience: d.audience, priority: d.priority, published_on: d.published_on, expires_on: d.expires_on || null, pinned: d.pinned }
  return (
    <Drawer open={!!notice} onClose={onClose} width="max-w-3xl" title={isNew ? 'Post a notice' : 'Edit notice'} subtitle={isNew ? 'Shown on the notice board of everyone in the audience.' : undefined}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<Send className="h-4 w-4" />} loading={create.isPending || update.isPending} onClick={save}>{isNew ? (d.published_on > today() ? 'Schedule notice' : 'Publish notice') : 'Save changes'}</Button></div>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Field label="Title" required error={touched ? errors.title : ''}><Input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={160} placeholder="e.g. OPD timings change from Monday" autoFocus /></Field>
          <Field label="Message" required error={touched ? errors.body : ''} hint={`${d.body.length.toLocaleString('en-IN')} / 4,000`}>
            <Textarea rows={8} value={d.body} onChange={(e) => set('body', e.target.value)} placeholder="Write the full announcement. Line breaks are kept." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audience"><Select value={d.audience} onChange={(e) => set('audience', e.target.value as Notice['audience'])}>{(Object.keys(AUDIENCE) as Notice['audience'][]).map((a) => <option key={a} value={a}>{AUDIENCE[a]}</option>)}</Select></Field>
            <Field label="Priority">
              <div className="flex gap-1.5">{(['normal', 'important', 'urgent'] as const).map((p) => (
                <button type="button" key={p} onClick={() => set('priority', p)} aria-pressed={d.priority === p}
                  className={cn('flex-1 rounded-lg px-2 py-2 text-xs font-semibold ring-1 transition', d.priority === p ? (p === 'urgent' ? 'bg-rose-600 text-white ring-rose-600' : p === 'important' ? 'bg-amber-500 text-white ring-amber-500' : 'bg-brand-700 text-white ring-brand-700') : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{PRIORITY[p].label}</button>
              ))}</div>
            </Field>
            <Field label="Publish on" hint="A future date schedules it"><Input type="date" value={d.published_on} onChange={(e) => set('published_on', e.target.value || today())} /></Field>
            <Field label="Remove after" error={touched ? errors.expires_on : ''} hint={<span className="flex gap-2">{[7, 14, 30].map((x) => <button type="button" key={x} onClick={() => quick(x)} className="font-medium text-brand-700 hover:underline">{x} days</button>)}{d.expires_on && <button type="button" onClick={() => set('expires_on', '')} className="text-slate-500 hover:underline">never</button>}</span>}>
              <Input type="date" value={d.expires_on} min={d.published_on} onChange={(e) => set('expires_on', e.target.value)} />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-100">
            <input type="checkbox" checked={d.pinned} onChange={(e) => set('pinned', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            <span><b className="font-semibold text-slate-800">Pin to the top</b><span className="block text-xs text-slate-500">Stays above newer notices until you unpin it.</span></span>
          </label>
        </div>
        <div className="space-y-3">
          <p className="label">Preview</p>
          <div className="pointer-events-none"><NoticeCard n={preview} unread manage={false} onOpen={() => {}} on={today()} featured={d.pinned} /></div>
          <div className="rounded-xl bg-brand-50/70 p-3 text-xs text-brand-900 ring-1 ring-brand-100">
            <p className="flex items-center gap-1.5 font-semibold"><BellRing className="h-3.5 w-3.5" />Who gets alerted</p>
            {isNew ? (
              via.length ? <p className="mt-1">On publish, {AUDIENCE[d.audience].toLowerCase()} also get it by <b>{via.map((c) => CHANNEL_LABEL[c]).join(', ')}</b>.</p>
                : <p className="mt-1">Only shown on the board. Turn on <b>New notice</b> under Settings → Notifications to also send push / SMS / WhatsApp / e-mail.</p>
            ) : <p className="mt-1">Edits update the board only — no new alert is sent.</p>}
          </div>
        </div>
      </div>
    </Drawer>
  )
}

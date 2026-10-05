/**
 * Broadcasts (admin): one message to many hospitals on in-app banner, e-mail, WhatsApp, SMS and push. Paid channels
 * go out on the shared accounts at the platform's cost (never a hospital's wallet). Preview → send now or schedule →
 * delivery report.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CalendarClock, Megaphone, Pencil, Plus, Send, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea, type Tone } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { PLANS } from '../../../src/platform/plans'
import { BILLING_DEFAULTS } from '../../../src/platform/billing'
import { cp, friendly } from '../api'
import type { Broadcast, BroadcastChannel, BroadcastPreview, BroadcastSave } from '../types'
import { dateTime, ErrorBox, inr, STATUS } from '../ui'

export const CHANNELS: { id: BroadcastChannel; label: string; hint: string }[] = [
  { id: 'inapp', label: 'In-app banner', hint: 'Free · shows for 14 days' },
  { id: 'email', label: 'E-mail', hint: 'Shared e-mail account' },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Needs the "Broadcast" template' },
  { id: 'sms', label: 'SMS', hint: 'Needs a DLT template' },
  { id: 'push', label: 'Push', hint: 'Free · hospital’s own Firebase' },
]
const ROLES = [['owner', 'Owners'], ['doctor', 'Doctors'], ['receptionist', 'Receptionists'], ['accountant', 'Accountants'], ['staff', 'Staff']] as const
const STATUS_TONE: Record<Broadcast['status'], Tone> = { draft: 'slate', scheduled: 'blue', sent: 'green', cancelled: 'amber' }
const BLANK: BroadcastSave = { title: '', body: '', link: '', level: 'info', channels: ['inapp', 'email'], audience: { hospitals: null, plans: [], statuses: [], roles: ['owner'] } }
const toLocal = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')

/** what the paid channels would cost at the per-message rates (platform pays) */
export function broadcastCost(p: Pick<BroadcastPreview, 'email' | 'sms' | 'whatsapp'>, channels: BroadcastChannel[], rates = BILLING_DEFAULTS.ratesPaise) {
  return (['email', 'sms', 'whatsapp'] as const).reduce((sum, c) => sum + (channels.includes(c) ? p[c] * rates[c] : 0), 0) / 100
}

export function BroadcastsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-broadcasts'], queryFn: () => cp.broadcasts(), refetchInterval: (query) => (query.state.data?.some((b) => b.status === 'sent' && Object.values(b.delivery).some((d) => d && d.pending > 0)) ? 15_000 : false) })
  const [edit, setEdit] = useState<BroadcastSave | null>(null)
  const [cancel, setCancel] = useState<Broadcast | null>(null)
  const doCancel = useMutation({
    mutationFn: (id: string) => cp.cancelBroadcast(id),
    onSuccess: (r) => { toast.success(r ? 'Broadcast cancelled' : 'Draft deleted'); setCancel(null); qc.invalidateQueries({ queryKey: ['cp-broadcasts'] }) },
    onError: (e) => toast.error(friendly(e)),
  })
  return (
    <>
      <PageHeader title="Broadcasts" description="Tell many hospitals at once — banner, e-mail, WhatsApp, SMS and push. Paid messages use the shared accounts at the platform’s cost."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(structuredClone(BLANK))}>New broadcast</Button>} />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? (
        <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No broadcasts yet" description="Announce a new feature, planned maintenance or a price change to every hospital owner." /></Card>
      ) : (
        <div className="space-y-3">
          {q.data.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-brand-950">{b.title}</p>
                    <Badge tone={STATUS_TONE[b.status]}>{b.status === 'scheduled' ? `Scheduled · ${dateTime(b.scheduled_at)}` : b.status}</Badge>
                    {b.level !== 'info' && <Badge tone={b.level === 'critical' ? 'red' : 'amber'}>{b.level}</Badge>}
                  </div>
                  {b.body && <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-slate-600">{b.body}</p>}
                  <p className="mt-2 text-xs text-slate-500">{audienceLine(b.audience)} · {b.channels.map((c) => CHANNELS.find((x) => x.id === c)?.label ?? c).join(', ')}
                    {b.sent_at ? ` · sent ${dateTime(b.sent_at)}` : ''}{b.created_by_name ? ` · by ${b.created_by_name}` : ''}</p>
                  {b.status === 'sent' && <DeliveryReport b={b} />}
                </div>
                {(b.status === 'draft' || b.status === 'scheduled') && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit({ id: b.id, title: b.title, body: b.body, link: b.link ?? '', level: b.level, channels: b.channels, audience: b.audience })}>Open</Button>
                    <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5 text-rose-600" />} onClick={() => setCancel(b)}>{b.status === 'draft' ? 'Delete' : 'Cancel'}</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <BroadcastModal value={edit} onClose={() => setEdit(null)} scheduledAt={q.data?.find((b) => b.id === edit.id)?.scheduled_at ?? null} />}
      <ConfirmDialog open={!!cancel} onClose={() => setCancel(null)} loading={doCancel.isPending} title={cancel?.status === 'draft' ? `Delete draft “${cancel?.title}”?` : `Cancel “${cancel?.title}”?`}
        description={cancel?.status === 'draft' ? 'The draft is removed.' : 'It will not be sent. You can still see it here.'} onConfirm={() => cancel && doCancel.mutate(cancel.id)} />
    </>
  )
}

function audienceLine(a: Broadcast['audience']) {
  const who = a.roles.map((r) => ROLES.find(([id]) => id === r)?.[1] ?? r).join(', ')
  const where = a.hospitals?.length ? `${a.hospitals.length} chosen hospital${a.hospitals.length > 1 ? 's' : ''}`
    : [a.plans.length ? a.plans.map((p) => PLANS.find((x) => x.id === p)?.name ?? p).join('/') : '', a.statuses.length ? a.statuses.map((s) => STATUS[s]?.label ?? s).join('/') : ''].filter(Boolean).join(' · ') || 'All hospitals'
  return `${where} → ${who}`
}

function DeliveryReport({ b }: { b: Broadcast }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {b.channels.map((c) => {
        const d = b.delivery[c]
        const queued = b.stats[c] ?? 0
        return (
          <div key={c} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs">
            <p className="font-medium text-brand-950">{CHANNELS.find((x) => x.id === c)?.label}</p>
            {c === 'inapp' ? <p className="text-slate-600">{queued} hospital{queued === 1 ? '' : 's'}</p> : !d ? <p className="text-slate-500">{queued ? `${queued} queued` : 'nobody reachable'}</p> : (
              <p className="space-x-2"><span className="text-emerald-700">{d.sent} sent</span>{d.pending > 0 && <span className="text-amber-700">{d.pending} pending</span>}{d.failed > 0 && <span className="text-rose-700">{d.failed} failed</span>}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

function BroadcastModal({ value, onClose, scheduledAt }: { value: BroadcastSave; onClose: () => void; scheduledAt: string | null }) {
  const qc = useQueryClient()
  const [f, setF] = useState(value)
  const [when, setWhen] = useState<'now' | 'later'>(scheduledAt ? 'later' : 'now')
  const [at, setAt] = useState(toLocal(scheduledAt))
  const [confirm, setConfirm] = useState(false)
  const hospitals = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const settings = useQuery({ queryKey: ['cp-settings'], queryFn: () => cp.settings(), staleTime: 300_000 })
  const audience = useDebounced(useMemo(() => ({ ...f.audience, hospitals: f.audience.hospitals?.length ? f.audience.hospitals : null }), [f.audience]))
  const preview = useQuery({ queryKey: ['cp-broadcast-preview', audience, f.channels], queryFn: () => cp.broadcastPreview(audience, f.channels), enabled: f.audience.roles.length > 0 })
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const p = preview.data
  const cost = p ? broadcastCost(p, f.channels, settings.data?.billing.ratesPaise) : 0
  const linkOk = !f.link || /^https:\/\/\S+$/.test(f.link)
  const valid = f.title.trim().length >= 3 && f.channels.length > 0 && f.audience.roles.length > 0 && linkOk
  const atIso = at ? new Date(at).toISOString() : null
  const schedOk = when === 'now' || (!!atIso && Date.parse(atIso) > Date.now() + 60_000)
  const payload = (): BroadcastSave => ({ ...f, title: f.title.trim(), body: f.body.trim(), link: f.link.trim(), audience: { ...f.audience, hospitals: f.audience.hospitals?.length ? f.audience.hospitals : null } })

  const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: ['cp-broadcasts'] }); onClose() }
  const draft = useMutation({ mutationFn: () => cp.saveBroadcast(payload()), onSuccess: () => done('Draft saved'), onError: (e) => toast.error(friendly(e)) })
  const send = useMutation({
    mutationFn: async () => { const b = await cp.saveBroadcast(payload()); return cp.sendBroadcast(b.id, when === 'later' ? atIso : null) },
    onSuccess: (b) => done(b.status === 'scheduled' ? `Scheduled for ${dateTime(b.scheduled_at)}` : 'Broadcast sent — delivery report updates below'),
    onError: (e) => { setConfirm(false); toast.error(friendly(e)) },
  })
  const n = (c: BroadcastChannel) => (!p ? '…' : c === 'inapp' ? `${p.hospitals} hospitals` : `${p[c]} people`)

  return (
    <Modal open onClose={onClose} size="max-w-3xl" title={f.id ? 'Broadcast' : 'New broadcast'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" disabled={!valid} loading={draft.isPending} onClick={() => draft.mutate()}>Save draft</Button>
        <Button disabled={!valid || !schedOk || !p?.people} icon={when === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />} onClick={() => setConfirm(true)}>{when === 'later' ? 'Schedule' : 'Send now'}</Button>
      </>}>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="grid content-start gap-3">
          <Field label="Title"><Input value={f.title} maxLength={120} placeholder="New: online appointment reminders on WhatsApp" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Message"><Textarea rows={4} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Link (optional)" error={linkOk ? undefined : 'Must start with https://'}><Input value={f.link} placeholder="https://…" onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
            <Field label="Level"><Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as BroadcastSave['level'] })}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select></Field>
          </div>
          <Field label="Channels">
            <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
              {CHANNELS.map((c) => (
                <label key={c.id} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm', f.channels.includes(c.id) ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200')}>
                  <input type="checkbox" className="mt-0.5 accent-brand-700" checked={f.channels.includes(c.id)} onChange={() => setF({ ...f, channels: toggle(f.channels, c.id) })} />
                  <span><span className="font-medium text-brand-950">{c.label}</span> <span className="text-xs text-slate-500">· {n(c.id)}</span><br /><span className="text-xs text-slate-500">{c.hint}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Who receives it">
            <div className="flex flex-wrap gap-3 pt-1 text-sm">
              {ROLES.map(([r, l]) => <label key={r} className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-brand-700" checked={f.audience.roles.includes(r)} onChange={() => setF({ ...f, audience: { ...f.audience, roles: toggle(f.audience.roles, r) } })} />{l}</label>)}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plans" hint="None ticked = every plan">
              <div className="flex flex-wrap gap-3 pt-1 text-sm">{PLANS.map((pl) => <label key={pl.id} className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-brand-700" checked={f.audience.plans.includes(pl.id)} onChange={() => setF({ ...f, audience: { ...f.audience, plans: toggle(f.audience.plans, pl.id) } })} />{pl.name}</label>)}</div>
            </Field>
            <Field label="Status" hint="None ticked = any status">
              <div className="flex flex-wrap gap-3 pt-1 text-sm">{Object.entries(STATUS).map(([s, v]) => <label key={s} className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-brand-700" checked={f.audience.statuses.includes(s)} onChange={() => setF({ ...f, audience: { ...f.audience, statuses: toggle(f.audience.statuses, s) } })} />{v.label}</label>)}</div>
            </Field>
          </div>
          <Field label="Only these hospitals" hint="None ticked = every hospital matching the plan / status">
            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
              {(hospitals.data ?? []).map((h) => (
                <label key={h.id} className="flex items-center gap-2 py-0.5"><input type="checkbox" className="accent-brand-700" checked={!!f.audience.hospitals?.includes(h.id)} onChange={() => setF({ ...f, audience: { ...f.audience, hospitals: toggle(f.audience.hospitals ?? [], h.id) } })} />{h.name}</label>
              ))}
            </div>
          </Field>
        </div>
        <aside className="space-y-3">
          <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700"><Users className="h-3.5 w-3.5" />Preview</p>
            {preview.error ? <p className="mt-2 text-xs text-rose-600">{friendly(preview.error)}</p> : !p ? <Skeleton className="mt-2 h-16" /> : (
              <>
                <p className="mt-2 font-display text-2xl font-bold text-brand-950">{p.people} <span className="text-sm font-medium text-slate-500">people</span></p>
                <p className="text-xs text-slate-600">in {p.hospitals} hospital{p.hospitals === 1 ? '' : 's'}</p>
                <dl className="mt-3 space-y-1 text-xs">
                  {f.channels.filter((c) => c !== 'inapp').map((c) => <div key={c} className="flex justify-between"><dt className="text-slate-500">{CHANNELS.find((x) => x.id === c)?.label}</dt><dd className="font-medium text-brand-950">{p[c]}</dd></div>)}
                  <div className="flex justify-between border-t border-brand-100 pt-1"><dt className="text-slate-500">Est. cost (platform pays)</dt><dd className="font-semibold text-brand-950">{inr(cost)}</dd></div>
                </dl>
                {p.sample.length > 0 && <p className="mt-3 text-[11px] text-slate-500">{p.sample.slice(0, 6).join(', ')}{p.sample.length > 6 ? ` +${p.sample.length - 6} more` : ''}</p>}
              </>
            )}
          </div>
          <div className="rounded-2xl border border-slate-100 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">When</p>
            <label className="flex items-center gap-2"><input type="radio" className="accent-brand-700" checked={when === 'now'} onChange={() => setWhen('now')} />Send now</label>
            <label className="mt-1 flex items-center gap-2"><input type="radio" className="accent-brand-700" checked={when === 'later'} onChange={() => setWhen('later')} />Schedule</label>
            {when === 'later' && <Input className="mt-2" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}
            {when === 'later' && !schedOk && <p className="mt-1 text-xs text-rose-600">Pick a time in the future.</p>}
          </div>
        </aside>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={send.isPending}
        title={when === 'later' ? `Schedule for ${at ? new Date(at).toLocaleString() : ''}?` : `Send to ${p?.people ?? 0} people now?`}
        description={`${f.channels.map((c) => `${CHANNELS.find((x) => x.id === c)?.label} (${n(c)})`).join(', ')}. Estimated cost ${inr(cost)}, paid by the platform. This cannot be undone once sent.`}
        onConfirm={() => send.mutate()} />
    </Modal>
  )
}

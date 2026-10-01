import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarClock, Copy, MessagesSquare, Pencil, Plus, Search, Send, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea } from '../../../components/ui'
import { qk, useCreate, useRemove, useTable, useUpdate } from '../../../hooks/useData'
import { cn, ago } from '../../../lib/utils'
import { sendTemplate, templateAudience } from '../../../settings/messaging'
import { AUDIENCE_LABEL, describeAudience, describeSchedule, nextRun, SCHEDULE_LABEL, WEEKDAYS } from '../../../settings/schedule'
import { CHANNEL_LABEL, CHANNELS, type Channel } from '../../../settings/types'
import { ROLE_LABEL, type NotificationTemplate, type Role, type TemplateAudience, type TemplateSchedule } from '../../../types'
import { CHANNEL_META } from './channelMeta'
import { Section, type TabCtx } from '../shared'

type Draft = Omit<NotificationTemplate, 'id' | 'created_at' | 'updated_at' | 'last_run_at' | 'last_run_count' | 'next_run_at' | 'created_by_name'>
const TOKENS = ['name', 'full_name', 'hospital', 'hospital_phone', 'address', 'site_url']
const ROLES: Role[] = ['owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient']
const blank = (): Draft => ({ name: '', description: '', channels: ['sms'], subject: '', text: '', wa_text: '', wa_template: '', wa_params: '', sms_template_id: '', audience: 'patients', roles: [], schedule: 'manual', send_at: null, time_of_day: '10:00', weekday: 1, month_day: 1, enabled: false })
const toDraft = (t: NotificationTemplate): Draft => ({ name: t.name, description: t.description ?? '', channels: t.channels, subject: t.subject ?? '', text: t.text, wa_text: t.wa_text ?? '', wa_template: t.wa_template ?? '', wa_params: t.wa_params ?? '', sms_template_id: t.sms_template_id ?? '', audience: t.audience, roles: t.roles ?? [], schedule: t.schedule, send_at: t.send_at ?? null, time_of_day: t.time_of_day || '10:00', weekday: t.weekday ?? 1, month_day: t.month_day ?? 1, enabled: t.enabled })
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m)
const localInput = (iso?: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')

export function CustomMessages({ ctx }: { ctx: TabCtx }) {
  const q = useTable('notification_templates')
  const update = useUpdate('notification_templates', { label: 'Message', silent: true })
  const remove = useRemove('notification_templates', { label: 'Message' })
  const create = useCreate('notification_templates', { label: 'Message', silent: true })
  const [editing, setEditing] = useState<NotificationTemplate | 'new' | null>(null)
  const [sending, setSending] = useState<NotificationTemplate | null>(null)
  const [deleting, setDeleting] = useState<NotificationTemplate | null>(null)
  const [term, setTerm] = useState('')
  const rows = useMemo(() => (q.data ?? []).filter((t) => !term.trim() || `${t.name} ${t.description ?? ''} ${t.text}`.toLowerCase().includes(term.trim().toLowerCase()))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)), [q.data, term])
  const n = ctx.app.notifications

  return (
    <Section title="Custom & scheduled messages" icon={<MessagesSquare className="h-4 w-4" />}
      description="Write your own SMS / WhatsApp / e-mail / push messages — health tips, camp invitations, birthday wishes, staff reminders. Send now or on a schedule (needs automatic delivery below)."
      action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>New message</Button>}>
      {(q.data?.length ?? 0) > 4 && (
        <div className="relative mb-3 max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search messages…" className="h-9 pl-9" aria-label="Search custom messages" /></div>
      )}
      {q.isPending ? <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        : q.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{(q.error as Error).message}</p>
          : !rows.length ? <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title={term ? 'No messages match' : 'No custom messages yet'} description={term ? 'Try another search.' : 'Create one to greet patients on their birthday, announce a health camp or remind staff of a meeting.'}
            action={!term ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>New message</Button> : undefined} />
            : (
              <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-100">
                {rows.map((t) => {
                  const off = t.channels.filter((c) => !n[c]?.enabled)
                  return (
                    <li key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-800">{t.name}</p>
                          {t.schedule !== 'manual' && <Badge tone={t.enabled ? 'green' : 'slate'} dot>{t.enabled ? 'Scheduled' : 'Paused'}</Badge>}
                          {t.channels.map((c) => <span key={c} title={CHANNEL_LABEL[c]} className={cn('inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600', !n[c]?.enabled && 'line-through opacity-60')}>{CHANNEL_META[c].icon}{CHANNEL_LABEL[c].replace(' (FCM)', '')}</span>)}
                        </div>
                        <p className="mt-1 line-clamp-1 text-sm text-slate-500">{t.description || t.text}</p>
                        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{describeAudience(t, (r) => ROLE_LABEL[r])}</span>
                          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />{describeSchedule(t)}</span>
                          {t.enabled && t.next_run_at && <span>next {new Date(t.next_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                          {t.last_run_at && <span>last sent {ago(t.last_run_at)} · {t.last_run_count ?? 0} messages</span>}
                        </p>
                        {off.length > 0 && <p className="mt-1 text-xs text-amber-700">{off.map((c) => CHANNEL_LABEL[c]).join(', ')} {off.length === 1 ? 'is' : 'are'} switched off above — those copies are skipped.</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {t.schedule !== 'manual' && (
                          <button type="button" role="switch" aria-checked={t.enabled} aria-label={`${t.enabled ? 'Pause' : 'Start'} ${t.name}`}
                            onClick={() => update.mutate({ id: t.id, patch: { enabled: !t.enabled } }, { onSuccess: () => toast.success(t.enabled ? 'Paused' : 'Schedule started') })}
                            className={cn('relative mr-1 h-6 w-11 rounded-full transition', t.enabled ? 'bg-brand-600' : 'bg-slate-300')}>
                            <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', t.enabled ? 'left-[22px]' : 'left-0.5')} />
                          </button>
                        )}
                        <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setSending(t)}>Send now</Button>
                        <Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Duplicate ${t.name}`} onClick={() => create.mutate({ ...toDraft(t), name: `${t.name} (copy)`.slice(0, 80), enabled: false }, { onSuccess: () => toast.success('Copy created') })}><Copy className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
      <p className="mt-3 text-xs text-slate-400">Tokens: {TOKENS.map((t) => <code key={t} className="mr-1.5">{`{${t}}`}</code>)}— filled for each person. Messages go to people with a valid mobile / e-mail / registered device; duplicates (same number) get one copy.</p>
      <TemplateEditor key={editing === 'new' ? 'new' : editing?.id ?? 'none'} tpl={editing} ctx={ctx} onClose={() => setEditing(null)} />
      <SendDialog tpl={sending} ctx={ctx} onClose={() => setSending(null)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} loading={remove.isPending} title="Delete this message?" description={deleting ? `“${deleting.name}” and its schedule will be removed. Messages already sent stay in the delivery log.` : ''}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })} />
    </Section>
  )
}

function SendDialog({ tpl, ctx, onClose }: { tpl: NotificationTemplate | null; ctx: TabCtx; onClose: () => void }) {
  const qc = useQueryClient()
  const preview = useQuery({ queryKey: ['tpl-audience', tpl?.id, tpl?.updated_at], queryFn: () => templateAudience(tpl!), enabled: !!tpl })
  const n = ctx.app.notifications
  const on = CHANNELS.filter((c) => n[c]?.enabled)
  const send = useMutation({
    mutationFn: () => sendTemplate(tpl!, on),
    onSuccess: (count) => {
      toast.success(count ? `Queued ${count} message${count === 1 ? '' : 's'}` : 'Nobody to send to', { description: count ? 'They are delivered within a minute when automatic delivery is on — or press “Process queue” in the delivery log.' : 'No one in the audience has a matching mobile / e-mail / device.' })
      qc.invalidateQueries({ queryKey: qk('notification_templates') }); qc.invalidateQueries({ queryKey: ['notify-log'] }); qc.invalidateQueries({ queryKey: ['notify-usage'] })
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const a = preview.data
  const usable = tpl ? tpl.channels.filter((c) => on.includes(c)) : []
  const reach = (c: Channel) => (!a ? 0 : c === 'email' ? a.email : c === 'push' ? a.push : a.phone)
  return (
    <Modal open={!!tpl} onClose={onClose} title={tpl ? `Send “${tpl.name}” now?` : ''} size="max-w-lg"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!usable.length || preview.isPending || !a?.total} onClick={() => send.mutate()}>Send to {a?.total ?? '…'} people</Button></div>}>
      {tpl && <div className="space-y-4 text-sm">
        <p className="text-slate-600">{describeAudience(tpl, (r) => ROLE_LABEL[r])}{tpl.schedule === 'birthday' ? ' (today)' : ''}.</p>
        {preview.isPending ? <Skeleton className="h-16" /> : preview.isError ? <p className="text-rose-600">{(preview.error as Error).message}</p> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tpl.channels.map((c) => (
              <div key={c} className={cn('rounded-xl p-3 ring-1', on.includes(c) ? 'bg-brand-50/60 ring-brand-100' : 'bg-slate-50 opacity-60 ring-slate-100')}>
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{CHANNEL_META[c].icon}{CHANNEL_LABEL[c].replace(' (FCM)', '')}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{on.includes(c) ? reach(c) : 'off'}</p>
              </div>
            ))}
          </div>
        )}
        {!usable.length && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">None of this message’s channels are switched on. Turn one on in the cards above first.</p>}
        <p className="text-xs text-slate-400">Estimated cost: ₹{(tpl.channels.filter((c) => on.includes(c)).reduce((s, c) => s + reach(c) * (n.rates?.[c] ?? 0), 0)).toLocaleString('en-IN', { maximumFractionDigits: 2 })} at your per-message rates.</p>
      </div>}
    </Modal>
  )
}

function TemplateEditor({ tpl, ctx, onClose }: { tpl: NotificationTemplate | 'new' | null; ctx: TabCtx; onClose: () => void }) {
  const isNew = tpl === 'new'
  const cur = tpl === 'new' ? null : tpl
  const [d, setD] = useState<Draft>(() => (tpl && tpl !== 'new' ? toDraft(tpl) : blank()))
  const [touched, setTouched] = useState(false)
  const create = useCreate('notification_templates', { label: 'Message' })
  const update = useUpdate('notification_templates', { label: 'Message' })
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const n = ctx.app.notifications
  const vars = { name: 'Rohan', full_name: 'Rohan Das', hospital: ctx.site.brand.shortName || ctx.site.name, hospital_phone: ctx.site.appointmentsPhone || ctx.site.phone, address: ctx.site.address, site_url: ctx.site.siteUrl ?? '' } as Record<string, string>
  const errors = {
    name: d.name.trim().length < 2 ? 'Give it a name' : '',
    channels: !d.channels.length ? 'Pick at least one channel' : '',
    text: !d.text.trim() ? 'Write the message' : d.text.length > 2000 ? 'Keep it under 2,000 characters' : '',
    roles: d.audience === 'roles' && !d.roles.length && d.schedule !== 'birthday' ? 'Pick at least one role' : '',
    send_at: d.schedule === 'once' && !d.send_at ? 'Pick a date and time' : d.schedule === 'once' && d.send_at && new Date(d.send_at) <= new Date() && d.enabled ? 'Pick a time in the future' : '',
  }
  const bad = Object.values(errors).some(Boolean)
  const next = nextRun(d)
  const save = () => {
    setTouched(true)
    if (bad) return
    const row = { ...d, name: d.name.trim(), description: d.description?.trim() || null, subject: d.subject?.trim() || null, wa_text: d.wa_text?.trim() || null, wa_template: d.wa_template?.trim() || null, wa_params: d.wa_params?.replace(/\s/g, '') || null, sms_template_id: d.sms_template_id?.trim() || null,
      roles: d.audience === 'roles' ? d.roles : [], weekday: d.schedule === 'weekly' ? d.weekday : null, month_day: d.schedule === 'monthly' ? d.month_day : null, send_at: d.schedule === 'once' ? d.send_at : null, enabled: d.schedule === 'manual' ? false : d.enabled }
    if (isNew) create.mutate(row, { onSuccess: onClose })
    else if (cur) update.mutate({ id: cur.id, patch: row }, { onSuccess: onClose })
  }
  const toggleCh = (c: Channel) => set('channels', d.channels.includes(c) ? d.channels.filter((x) => x !== c) : [...d.channels, c])
  return (
    <Drawer open={!!tpl} onClose={onClose} width="max-w-3xl" title={isNew ? 'New custom message' : `Edit “${cur?.name ?? ''}”`}
      subtitle="Saved right away — separate from the Save button at the bottom of Settings."
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending || update.isPending} onClick={save}>{isNew ? 'Create message' : 'Save message'}</Button></div>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={touched ? errors.name : ''}><Input value={d.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Diwali health camp" autoFocus /></Field>
          <Field label="Note (only you see this)"><Input value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="What it is for" /></Field>
        </div>
        <Field label="Send by" error={touched ? errors.channels : ''}>
          <div className="flex flex-wrap gap-2">{CHANNELS.map((c) => (
            <label key={c} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 transition', d.channels.includes(c) ? 'bg-brand-50 text-brand-900 ring-brand-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
              <input type="checkbox" checked={d.channels.includes(c)} onChange={() => toggleCh(c)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />{CHANNEL_META[c].icon}{CHANNEL_LABEL[c]}
              {!n[c]?.enabled && <Badge tone="amber">off</Badge>}
            </label>
          ))}</div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who gets it" error={touched ? errors.roles : ''}>
            <Select value={d.audience} disabled={d.schedule === 'birthday'} onChange={(e) => set('audience', e.target.value as TemplateAudience)}>
              {(Object.keys(AUDIENCE_LABEL) as TemplateAudience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </Select>
            {d.schedule === 'birthday' && <p className="mt-1 text-xs text-slate-400">Birthday messages go to patients born on that day.</p>}
            {d.audience === 'roles' && d.schedule !== 'birthday' && <div className="mt-2 flex flex-wrap gap-1.5">{ROLES.map((r) => (
              <button type="button" key={r} onClick={() => set('roles', d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r])} aria-pressed={d.roles.includes(r)}
                className={cn('rounded-full px-2.5 py-1 text-xs font-medium ring-1', d.roles.includes(r) ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{ROLE_LABEL[r]}</button>
            ))}</div>}
          </Field>
          <Field label="When">
            <Select value={d.schedule} onChange={(e) => { const s = e.target.value as TemplateSchedule; setD((x) => ({ ...x, schedule: s, enabled: s === 'manual' ? false : x.enabled || isNew })) }}>
              {(Object.keys(SCHEDULE_LABEL) as TemplateSchedule[]).map((s) => <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        {d.schedule !== 'manual' && (
          <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
            {d.schedule === 'once' ? (
              <Field label="Date & time (India)" className="sm:col-span-2" error={touched ? errors.send_at : ''}><Input type="datetime-local" value={localInput(d.send_at)} onChange={(e) => set('send_at', e.target.value ? new Date(e.target.value).toISOString() : null)} /></Field>
            ) : <>
              <Field label="Time (India)"><Input type="time" value={d.time_of_day} onChange={(e) => set('time_of_day', e.target.value || '10:00')} /></Field>
              {d.schedule === 'weekly' && <Field label="Day"><Select value={d.weekday ?? 1} onChange={(e) => set('weekday', Number(e.target.value))}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</Select></Field>}
              {d.schedule === 'monthly' && <Field label="Day of month" hint="1–28 so every month has it"><Input type="number" min={1} max={28} value={d.month_day ?? 1} onChange={(e) => set('month_day', Math.min(28, Math.max(1, Number(e.target.value) || 1)))} /></Field>}
            </>}
            <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={d.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />Schedule is on
            </label>
            <p className="text-xs text-slate-500 sm:col-span-3">{d.enabled ? (next ? <>Next send: <b>{next.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</b> IST. </> : 'Nothing left to send. ') : 'Paused — nothing is sent until you switch it on. '}Scheduled messages need <b>Automatic delivery</b> (below) to be on.</p>
          </div>
        )}
        {(d.channels.includes('email') || d.channels.includes('push')) && <Field label={d.channels.includes('push') && !d.channels.includes('email') ? 'Push title' : 'E-mail subject / push title'}><Input value={d.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder="{hospital}: free health camp this Sunday" maxLength={200} /></Field>}
        <Field label="Message" required error={touched ? errors.text : ''} hint={<span className="flex flex-wrap gap-1">{TOKENS.map((t) => <button type="button" key={t} onClick={() => set('text', `${d.text}{${t}}`)} className="rounded bg-brand-50 px-1.5 font-mono text-[11px] text-brand-800 ring-1 ring-brand-100 hover:bg-brand-100">{`{${t}}`}</button>)}<span className="ml-auto">{d.text.length} chars</span></span>}>
          <Textarea rows={5} value={d.text} onChange={(e) => set('text', e.target.value)} placeholder="Hi {name}, {hospital} is holding a free diabetes screening camp this Sunday, 9 AM–1 PM. Call {hospital_phone} to register." />
        </Field>
        {d.channels.includes('whatsapp') && <Field label="WhatsApp text (optional)" hint="*bold*, _italic_, emoji and line breaks. Empty = the message above."><Textarea rows={4} value={d.wa_text ?? ''} onChange={(e) => set('wa_text', e.target.value)} placeholder={d.text} /></Field>}
        <details className="rounded-xl ring-1 ring-slate-100">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">Provider template IDs (MSG91 / Meta / Interakt)</summary>
          <div className="grid gap-4 p-4 pt-1 sm:grid-cols-2">
            <Field label="DLT / MSG91 template ID"><Input value={d.sms_template_id ?? ''} onChange={(e) => set('sms_template_id', e.target.value)} className="font-mono text-xs" /></Field>
            <Field label="WhatsApp template name"><Input value={d.wa_template ?? ''} onChange={(e) => set('wa_template', e.target.value)} className="font-mono text-xs" placeholder="health_camp_invite" /></Field>
            <Field label="Template variables, in order" className="sm:col-span-2"><Input value={d.wa_params ?? ''} onChange={(e) => set('wa_params', e.target.value)} className="font-mono text-xs" placeholder="name,hospital" /></Field>
          </div>
        </details>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="label mb-2">Preview</p>
          <div className="space-y-2">
            <div className="max-w-md rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-100">{fill(d.text || '…', vars)}</div>
            {d.channels.includes('whatsapp') && <div className="max-w-md whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 text-sm text-slate-800 shadow-sm">{fill(d.wa_text || d.text || '…', vars)}</div>}
          </div>
        </div>
      </div>
    </Drawer>
  )
}


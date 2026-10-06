/**
 * Messaging → Templates: the whole template library (src/notify, scripts/sql/notify_catalog.sql) with full control —
 * switch any message off for every hospital, turn single channels off, reword it (hospitals keep their own wording
 * unless it is locked), record the WhatsApp / DLT registration on the shared accounts, add custom templates, and
 * export the WhatsApp submission sheet. Admins edit; support can look.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Lock, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, Field, Input, Select, Skeleton, Textarea, type Tone } from '../../../../src/components/ui'
import { Toggle } from '../../../../src/pages/cms/fields'
import { cn } from '../../../../src/lib/utils'
import {
  AUDIENCE_LABEL, CATALOG, EV_CHANNEL_LABEL, GROUP_LABEL, SAMPLE_VARS, effectiveCopy, renderTokens, toCsv, waSubmission,
  type Audience, type CatalogEntry, type EvChannel, type PlatformTemplate,
} from '../../../../src/notify'
import { cp, friendly } from '../../api'
import { dateTime, ErrorBox, isAdmin, useMe } from '../../ui'
import type { CpTemplates, MessagingSetup, PlatformTemplateIds } from '../../types'

/**
 * Platform messages whose wording is written when they are sent (alerts, broadcasts, the team's sign-in code): only
 * their registration on the shared WhatsApp / SMS accounts is set here.
 */
export const DELIVERY_TEMPLATES: { id: string; label: string; hint: string; tokens: string[] }[] = [
  { id: 'platform_alert', label: 'Team alert', hint: 'Alerts to your own team (WhatsApp / SMS)', tokens: ['title', 'body', 'link'] },
  { id: 'platform_broadcast', label: 'Broadcast', hint: 'Broadcasts to hospital owners and staff', tokens: ['name', 'hospital', 'title', 'link'] },
  { id: 'platform_otp', label: 'Team sign-in code', hint: 'Control-panel sign-in OTP (Platform settings → Security)', tokens: ['code', 'name'] },
]

const QK = ['cp-templates'] as const
type Scope = 'hospital' | 'platform_owner' | 'platform' | 'custom'
const SCOPE_LABEL: Record<Scope, string> = { hospital: 'Hospital messages', platform_owner: 'To hospital owners', platform: 'Team alerts', custom: 'Custom' }
const SCOPE_TONE: Record<Scope, Tone> = { hospital: 'blue', platform_owner: 'violet', platform: 'amber', custom: 'teal' }
const WORDING = ['subject', 'text', 'waText', 'pushText'] as const
type Wording = (typeof WORDING)[number]
const WA_STATUS: Record<string, Tone> = { draft: 'slate', submitted: 'amber', approved: 'green', rejected: 'red' }

/** one row: a catalog entry or a custom template */
interface Row { key: string; entry?: CatalogEntry; saved?: PlatformTemplate & { updated_by_name?: string | null }; scope: Scope; label: string; hint: string; code: string; group: string; channels: EvChannel[]; audience: string; tokens: string[] }

const blank = (key: string, ids?: MessagingSetup['templates'][string]): PlatformTemplate => ({ key, enabled: true, locked: false, channels: {}, tpl: { ...(ids ?? {}) } })

export function TemplateManager({ setup }: { setup: MessagingSetup }) {
  const { me } = useMe()
  const admin = isAdmin(me.role)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK, queryFn: () => cp.templates() })
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<Scope | 'all'>('all')
  const [status, setStatus] = useState<'all' | 'on' | 'off' | 'edited' | 'locked'>('all')
  const [open, setOpen] = useState<{ row: Row; isNew?: boolean } | null>(null)
  const [del, setDel] = useState<Row | null>(null)

  const rows = useMemo<Row[]>(() => {
    const saved = q.data?.saved ?? {}
    const built: Row[] = CATALOG.map((e) => ({ key: e.id, entry: e, saved: saved[e.id], scope: e.scope, label: e.label, hint: e.hint, code: e.code,
      group: GROUP_LABEL[e.group], channels: e.channels, audience: AUDIENCE_LABEL[e.audience], tokens: e.tokens }))
    const custom: Row[] = Object.values(saved).filter((t) => t.custom).map((t) => ({ key: t.key, saved: t, scope: 'custom' as const, label: t.meta?.label || t.key,
      hint: t.meta?.hint || '', code: 'CUSTOM', group: t.meta?.group || 'Custom', audience: AUDIENCE_LABEL[t.meta?.audience as Audience] ?? t.meta?.audience ?? '',
      channels: (Object.keys(t.channels ?? {}) as EvChannel[]).filter((c) => t.channels[c]), tokens: Object.keys(SAMPLE_VARS) }))
    return [...built, ...custom]
  }, [q.data])

  const needle = search.trim().toLowerCase()
  const visible = rows.filter((r) => (scope === 'all' || r.scope === scope)
    && (status === 'all' || (status === 'on' ? r.saved?.enabled !== false : status === 'off' ? r.saved?.enabled === false
      : status === 'locked' ? !!r.saved?.locked : !!r.saved && (Object.keys(r.saved.tpl ?? {}).length > 0 || Object.keys(r.saved.channels ?? {}).length > 0)))
    && (!needle || `${r.code} ${r.key} ${r.label} ${r.hint} ${r.group}`.toLowerCase().includes(needle)))

  const save = useMutation({
    mutationFn: ({ key, p }: { key: string; p: Partial<PlatformTemplate> }) => cp.saveTemplate(key, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
    onError: (e) => toast.error(friendly(e)),
  })
  const remove = useMutation({
    mutationFn: (key: string) => cp.deleteTemplate(key),
    onSuccess: (_d, key) => { qc.invalidateQueries({ queryKey: QK }); toast.success(rows.find((r) => r.key === key)?.scope === 'custom' ? 'Template deleted' : 'Back to the standard version'); setDel(null) },
    onError: (e) => toast.error(friendly(e)),
  })
  const current = (r: Row): PlatformTemplate => r.saved ?? blank(r.key, setup.templates?.[r.key])
  // optimistic on/off: the switch flips at once
  const flip = (r: Row) => {
    const next = { ...current(r), enabled: !(r.saved?.enabled ?? true) }
    qc.setQueryData<CpTemplates>(QK, (d) => d && { ...d, saved: { ...d.saved, [r.key]: { ...next, updated_by_name: me.email ?? null } } })
    save.mutate({ key: r.key, p: next }, { onSuccess: () => toast.success(`${r.label} ${next.enabled ? 'switched on' : 'switched off for every hospital'}`) })
  }

  const exportCsv = () => {
    const list = rows.filter((r) => r.channels.includes('whatsapp') && r.saved?.enabled !== false)
    const csv = toCsv(list.map((r) => ({ ...waSubmission(r.entry, r.saved ?? blank(r.key, setup.templates?.[r.key]), r.key) })),
      ['code', 'label', 'name', 'category', 'language', 'body', 'params', 'samples', 'status'])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `whatsapp-templates-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast.success(`Exported ${list.length} WhatsApp templates`, { description: 'Submit them in Meta Business Manager / your WhatsApp provider, then paste the approved names here.' })
  }

  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const counts = { total: rows.length, off: rows.filter((r) => r.saved?.enabled === false).length, locked: rows.filter((r) => r.saved?.locked).length }
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, ID (APT-002) or key" className="pl-9" />
        </div>
        <Select value={scope} onChange={(e) => setScope(e.target.value as Scope | 'all')} className="w-auto" aria-label="Kind">
          <option value="all">All kinds</option>
          {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-auto" aria-label="Status">
          <option value="all">Any status</option><option value="on">On</option><option value="off">Off</option><option value="edited">Edited</option><option value="locked">Locked</option>
        </Select>
        <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={!q.data}>WhatsApp sheet (CSV)</Button>
        {admin && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen({ isNew: true, row: { key: 'custom_', scope: 'custom', label: '', hint: '', code: 'CUSTOM', group: 'Custom', channels: ['email', 'inapp'], audience: 'owner', tokens: Object.keys(SAMPLE_VARS) } })}>New template</Button>}
      </div>
      <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">
        {counts.total} templates · {counts.off} switched off · {counts.locked} locked. Off = never sent, for every hospital. Hospitals keep their own wording unless a template is locked.
      </p>
      {!q.data ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div> : visible.length === 0 ? (
        <EmptyState title="No template matches" description="Try another search or filter." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2.5">ID</th><th className="px-3 py-2.5">Message</th><th className="px-3 py-2.5">Channels</th><th className="px-3 py-2.5">Usage</th><th className="px-3 py-2.5 text-center">On</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => {
                const s = r.saved
                const on = s?.enabled !== false
                const edited = !!s && !s.custom && (Object.keys(s.tpl ?? {}).some((k) => !['waTemplate', 'waParams', 'smsTemplateId', 'waCategory', 'waStatus'].includes(k)) || Object.keys(s.channels ?? {}).length > 0)
                return (
                  <tr key={r.key} className={cn('align-top', !on && 'bg-slate-50/70')}>
                    <td className="whitespace-nowrap px-4 py-3"><span className="font-mono text-xs text-slate-600">{r.code}</span><div className="mt-1"><Badge tone={SCOPE_TONE[r.scope]}>{SCOPE_LABEL[r.scope]}</Badge></div></td>
                    <td className={cn('px-3 py-3', !on && 'opacity-60')}>
                      <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-800">
                        {r.label}
                        {s?.locked && <span title="Locked: hospitals can't reword it"><Lock className="h-3.5 w-3.5 text-amber-600" /></span>}
                        {edited && <Badge tone="violet">Edited</Badge>}
                        {s?.tpl?.waStatus && <Badge tone={WA_STATUS[s.tpl.waStatus] ?? 'slate'}>WA {s.tpl.waStatus}</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">{r.hint}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{r.group}{r.audience && ` · to ${r.audience}`} · <code>{r.key}</code></p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {r.channels.map((c) => {
                          const off = !on || s?.channels?.[c] === false
                          return <span key={c} className={cn('rounded px-1.5 py-0.5 text-[11px] ring-1', off ? 'bg-white text-slate-400 line-through ring-slate-200' : 'bg-brand-50 text-brand-800 ring-brand-100')}>{EV_CHANNEL_LABEL[c]}</span>
                        })}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">
                      <div>{(q.data.sent30[r.key] ?? 0).toLocaleString('en-IN')} sent · 30 d</div>
                      {r.scope === 'hospital' && (q.data.overrides[r.key] ?? 0) > 0 && <div className="text-slate-400">{q.data.overrides[r.key]} hospital{q.data.overrides[r.key] === 1 ? '' : 's'} reworded</div>}
                      {s?.updated_at && <div className="text-slate-400" title={s.updated_by_name ?? undefined}>edited {dateTime(s.updated_at)}</div>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button type="button" role="switch" aria-checked={on} aria-label={`${r.label} on`} disabled={!admin || save.isPending} onClick={() => flip(r)}
                        className={cn('relative inline-block h-5 w-9 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60', on ? 'bg-brand-600' : 'bg-slate-300')}>
                        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen({ row: r })}>{admin ? 'Edit' : 'View'}</Button>
                        {admin && s && <Button size="icon" variant="ghost" aria-label={r.scope === 'custom' ? 'Delete' : 'Reset to standard'} title={r.scope === 'custom' ? 'Delete' : 'Reset to standard'} onClick={() => setDel(r)}>
                          {r.scope === 'custom' ? <Trash2 className="h-4 w-4 text-rose-600" /> : <RotateCcw className="h-4 w-4" />}
                        </Button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <DeliveryIds setup={setup} admin={admin} />
      {open && <TemplateDrawer key={open.row.key + (open.isNew ? ':new' : '')} row={open.row} isNew={open.isNew} admin={admin} initial={current(open.row)}
        saving={save.isPending} onClose={() => setOpen(null)}
        onSave={(key, p) => save.mutate({ key, p }, { onSuccess: () => { toast.success('Template saved'); setOpen(null) } })} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={remove.isPending} onConfirm={() => del && remove.mutate(del.key)}
        title={del?.scope === 'custom' ? `Delete “${del?.label}”?` : `Reset “${del?.label}”?`} confirmLabel={del?.scope === 'custom' ? 'Delete' : 'Reset'}
        description={del?.scope === 'custom' ? 'It is removed for good.' : 'It goes back to the standard wording, switched on, with every channel allowed and no WhatsApp / DLT IDs.'} />
    </Card>
  )
}

// ------------------------------------------------------------------ editor
function TemplateDrawer({ row, isNew, admin, initial, saving, onClose, onSave }: {
  row: Row; isNew?: boolean; admin: boolean; initial: PlatformTemplate; saving: boolean
  onClose: () => void; onSave: (key: string, p: Partial<PlatformTemplate>) => void
}) {
  const e = row.entry
  const def = effectiveCopy(e, null)
  const eff = effectiveCopy(e, initial)
  const [key, setKey] = useState(row.key)
  const [d, setD] = useState<PlatformTemplate>(() => ({
    ...initial, channels: { ...(initial.channels ?? {}) }, meta: { ...(initial.meta ?? {}) },
    tpl: { ...initial.tpl, ...(e ? Object.fromEntries(WORDING.map((f) => [f, eff[f] ?? ''])) : {}) },
  }))
  const tpl = d.tpl as Record<string, string | undefined>
  const setTpl = (f: string, v: string) => setD({ ...d, tpl: { ...d.tpl, [f]: v } })
  const channels: EvChannel[] = row.scope === 'custom' ? ['email', 'push', 'inapp', 'whatsapp', 'sms'] : row.channels
  const chanOn = (c: EvChannel) => row.scope === 'custom' ? !!d.channels[c] : d.channels[c] ?? (row.scope === 'hospital' ? true : e?.defaults[c] ?? false)
  const vars = { ...SAMPLE_VARS, hospital: SAMPLE_VARS.hospital }
  const tokens = row.scope === 'custom' ? ['name', 'hospital', 'platform', 'link', 'date', 'plan'] : row.tokens
  const freeText = !!e?.freeText
  const ro = !admin

  const submit = () => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(d.tpl)) {
      if (typeof v !== 'string' || !v.trim()) continue
      // the same as the standard wording → not an edit (stays in step with future default improvements)
      if (e && (WORDING as readonly string[]).includes(k) && v === (def[k as Wording] ?? '')) continue
      out[k] = v
    }
    onSave(isNew ? key.trim() : row.key, { enabled: d.enabled, locked: d.locked, channels: d.channels, tpl: out, meta: d.meta })
  }
  const insert = (f: Wording, t: string) => setTpl(f, `${tpl[f] ?? ''}{${t}}`)
  const scopeNote = row.scope === 'hospital'
    ? 'Hospitals choose their channels in Settings → Notifications. A channel off here stays off for all of them.'
    : row.scope === 'platform' ? 'Each team member still picks their own alert channels; a channel off here is off for everyone.'
      : 'Sent on the platform’s shared accounts.'

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={isNew ? 'New custom template' : row.label} subtitle={isNew ? 'Used for broadcasts and one-off platform messages' : `${row.code} · ${row.hint}`}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{ro ? 'Close' : 'Cancel'}</Button>{!ro && <Button loading={saving} onClick={submit}>Save template</Button>}</div>}>
      <fieldset disabled={ro} className="space-y-5">
        {isNew && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Key" hint="custom_ + lower-case letters, digits, _"><Input value={key} onChange={(ev) => setKey(ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} className="font-mono text-xs" /></Field>
            <Field label="Name"><Input value={d.meta?.label ?? ''} onChange={(ev) => setD({ ...d, meta: { ...d.meta, label: ev.target.value } })} placeholder="Diwali offer" /></Field>
            <Field label="Group"><Input value={d.meta?.group ?? ''} onChange={(ev) => setD({ ...d, meta: { ...d.meta, group: ev.target.value } })} placeholder="Custom" /></Field>
            <Field label="Goes to"><Select value={d.meta?.audience ?? 'owner'} onChange={(ev) => setD({ ...d, meta: { ...d.meta, audience: ev.target.value } })}>
              {(['owner', 'staff', 'patient', 'team', 'any'] as Audience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </Select></Field>
            <Field label="Description" className="sm:col-span-2"><Input value={d.meta?.hint ?? ''} onChange={(ev) => setD({ ...d, meta: { ...d.meta, hint: ev.target.value } })} placeholder="When it is used" /></Field>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle label="On" hint={d.enabled ? 'Sent as usual' : 'Never sent — for every hospital'} checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} />
          {row.scope === 'hospital' && <Toggle label={d.locked ? 'Locked' : 'Hospitals can reword it'} hint={d.locked ? 'Everyone gets this exact wording (registered templates)' : 'A hospital’s own wording wins'} checked={!!d.locked} onChange={(v) => setD({ ...d, locked: v })} />}
        </div>
        <div>
          <span className="label">Channels</span>
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => (
              <label key={c} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', chanOn(c) ? 'border-brand-200 bg-brand-50/60 text-brand-900' : 'border-slate-200 text-slate-500')}>
                <input type="checkbox" checked={chanOn(c)} onChange={() => setD({ ...d, channels: { ...d.channels, [c]: !chanOn(c) } })} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                {EV_CHANNEL_LABEL[c]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">{scopeNote}</p>
        </div>

        {freeText && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">The message body is written when it is sent (for example, a security notice), so only the subject can be changed.</p>}
        <Field label={channels.includes('email') ? 'Subject / title' : 'Title'} hint="Email subject, push and in-app title"><Input value={tpl.subject ?? ''} onChange={(ev) => setTpl('subject', ev.target.value)} placeholder={def.subject} /></Field>
        {!freeText && <>
          <WordingField label="Message text" hint="SMS text and email body" value={tpl.text ?? ''} placeholder={def.text} rows={5} tokens={tokens} onChange={(v) => setTpl('text', v)} onToken={(t) => insert('text', t)} />
          {channels.includes('whatsapp') && <WordingField label="WhatsApp text" hint="*bold*, _italic_, emoji. Empty = the message text" value={tpl.waText ?? ''} placeholder={def.waText || def.text} rows={6} tokens={tokens} onChange={(v) => setTpl('waText', v)} onToken={(t) => insert('waText', t)} />}
          {(channels.includes('push') || channels.includes('inapp')) && <WordingField label="Push / in-app line" hint="Short. Empty = the message text" value={tpl.pushText ?? ''} placeholder={def.pushText || def.text} rows={2} tokens={tokens} onChange={(v) => setTpl('pushText', v)} onToken={(t) => insert('pushText', t)} />}
        </>}

        {(channels.includes('whatsapp') || channels.includes('sms')) && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="label mb-2">Registration on the shared accounts</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {channels.includes('whatsapp') && <>
                <Field label="WhatsApp template name" hint="As approved by Meta / your provider"><Input value={tpl.waTemplate ?? ''} onChange={(ev) => setTpl('waTemplate', ev.target.value.trim())} className="font-mono text-xs" placeholder={row.key} /></Field>
                <Field label="Parameters, in order" hint="{{1}}, {{2}}… e.g. name,doctor,date"><Input value={tpl.waParams ?? ''} onChange={(ev) => setTpl('waParams', ev.target.value.replace(/\s/g, ''))} className="font-mono text-xs" placeholder={def.waParams} /></Field>
                <Field label="Category"><Select value={tpl.waCategory ?? e?.waCategory ?? 'UTILITY'} onChange={(ev) => setTpl('waCategory', ev.target.value)}>
                  <option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication</option><option value="MARKETING">Marketing</option>
                </Select></Field>
                <Field label="Approval status"><Select value={tpl.waStatus ?? 'draft'} onChange={(ev) => setTpl('waStatus', ev.target.value)}>
                  <option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
                </Select></Field>
              </>}
              {channels.includes('sms') && <Field label="SMS DLT template ID" className="sm:col-span-2"><Input value={tpl.smsTemplateId ?? ''} onChange={(ev) => setTpl('smsTemplateId', ev.target.value.trim())} className="font-mono text-xs" placeholder="1107…" /></Field>}
            </div>
          </div>
        )}
      </fieldset>

      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <p className="label mb-2">Preview with sample data</p>
        <div className="space-y-3">
          <div className="max-w-sm rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-100">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email / SMS</span>
            <b className="block text-slate-900">{renderTokens(tpl.subject || def.subject, vars)}</b>
            <span className="whitespace-pre-wrap">{renderTokens(tpl.text || def.text || '(written when sent)', vars)}</span>
          </div>
          {channels.includes('whatsapp') && !freeText && <div className="max-w-sm whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 text-sm text-slate-800 shadow-sm"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">WhatsApp</span>{renderTokens(tpl.waText || def.waText || tpl.text || def.text, vars)}</div>}
          {channels.includes('whatsapp') && !freeText && <p className="text-xs text-slate-500"><b>For submission:</b> <span className="font-mono">{waSubmission(e, { ...d, tpl: d.tpl }, key).body.slice(0, 300)}</span></p>}
        </div>
      </div>
    </Drawer>
  )
}

function WordingField({ label, hint, value, placeholder, rows, tokens, onChange, onToken }: {
  label: string; hint: string; value: string; placeholder?: string; rows: number; tokens: string[]; onChange: (v: string) => void; onToken: (t: string) => void
}) {
  return (
    <div>
      <span className="label">{label} <span className="font-normal normal-case text-slate-400">— {hint}</span></span>
      <Textarea rows={rows} value={value} placeholder={placeholder} onChange={(ev) => onChange(ev.target.value)} />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {tokens.map((t) => <button key={t} type="button" onClick={() => onToken(t)} className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] text-brand-800 ring-1 ring-brand-100 hover:bg-brand-100">{`{${t}}`}</button>)}
      </div>
    </div>
  )
}


// ------------------------------------------------------------------ alerts / broadcasts / team code: IDs only
function DeliveryIds({ setup, admin }: { setup: MessagingSetup; admin: boolean }) {
  const qc = useQueryClient()
  const pick = (t: MessagingSetup['templates']) => Object.fromEntries(DELIVERY_TEMPLATES.map((d) => [d.id, { ...(t?.[d.id] ?? {}) }])) as Record<string, PlatformTemplateIds>
  const [ids, setIds] = useState(() => pick(setup.templates))
  const dirty = JSON.stringify(ids) !== JSON.stringify(pick(setup.templates))
  const save = useMutation({
    // the same map also holds the IDs saved with each template above — start from the latest copy
    mutationFn: async () => { const cur = await cp.messagingSetup(); return cp.saveTemplates({ ...(cur.templates ?? {}), ...ids }) },
    onSuccess: (templates) => { qc.setQueryData(['cp-messaging-setup'], { ...setup, templates }); setIds(pick(templates)); toast.success('Saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  const set = (id: string, k: keyof PlatformTemplateIds, v: string) => setIds({ ...ids, [id]: { ...ids[id], [k]: v } })
  return (
    <div className="border-t border-slate-200 bg-slate-50/50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Alerts, broadcasts and the team's sign-in code</p>
          <p className="text-xs text-slate-500">Their text is written when they are sent; set only their approved WhatsApp template and DLT ID on the shared accounts.</p>
        </div>
        {admin && <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save IDs</Button>}
      </div>
      <div className="grid gap-3">
        {DELIVERY_TEMPLATES.map((d) => (
          <div key={d.id} className="grid gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:items-center">
            <div><p className="text-sm font-medium text-slate-800">{d.label}</p><p className="text-[11px] text-slate-400">{d.hint} · {d.tokens.map((t) => `{${t}}`).join(' ')}</p></div>
            <Input disabled={!admin} aria-label={`${d.label} WhatsApp template`} value={ids[d.id]?.waTemplate ?? ''} onChange={(e) => set(d.id, 'waTemplate', e.target.value.trim())} placeholder="WhatsApp template" className="font-mono text-xs" />
            <Input disabled={!admin} aria-label={`${d.label} parameters`} value={ids[d.id]?.waParams ?? ''} onChange={(e) => set(d.id, 'waParams', e.target.value.replace(/\s/g, ''))} placeholder={d.tokens.join(',')} className="font-mono text-xs" />
            <Input disabled={!admin} aria-label={`${d.label} DLT ID`} value={ids[d.id]?.smsTemplateId ?? ''} onChange={(e) => set(d.id, 'smsTemplateId', e.target.value.trim())} placeholder="SMS DLT ID" className="font-mono text-xs" />
          </div>
        ))}
      </div>
    </div>
  )
}

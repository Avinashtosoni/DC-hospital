/**
 * Team alerts: the inbox, each member's own choices (within what an admin switched on) and, for admins, the
 * platform-wide switches — channels, events with severity, limits and the health-check address.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, BellRing, CheckCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Tabs } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp, friendly } from '../api'
import type { AlertChannel, OpsSettings, AlertSeverity } from '../types'
import { dateTime, ErrorBox, isAdmin, Section, useMe } from '../ui'
import { internal, SEVERITY_ICON } from '../AlertBell'
import { disablePush, enablePush, pushPermission, pushSupported, savedPushToken } from '../push'

export const ALERT_CHANNELS: { id: AlertChannel; label: string; hint: string }[] = [
  { id: 'bell', label: 'Bell', hint: 'In the control panel' },
  { id: 'email', label: 'E-mail', hint: 'Shared e-mail account' },
  { id: 'push', label: 'Browser push', hint: 'Firebase, on browsers you allow' },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Shared WhatsApp account (template “Team alert”)' },
]
const SEV_TONE = { info: 'blue', warning: 'amber', critical: 'red' } as const
type Tab = 'inbox' | 'mine' | 'settings'

export function AlertsPage() {
  const { me } = useMe()
  const admin = isAdmin(me.role)
  const [sp, setSp] = useSearchParams()
  const tabs: { value: Tab; label: string }[] = [{ value: 'inbox', label: 'Inbox' }, { value: 'mine', label: 'My notifications' }, ...(admin ? [{ value: 'settings' as Tab, label: 'Settings (all team)' }] : [])]
  const tab = (tabs.find((t) => t.value === sp.get('tab'))?.value ?? 'inbox') as Tab
  return (
    <>
      <PageHeader title="Alerts" description="Sign-ups, payments, incidents and system problems — on the bell, e-mail, browser push or WhatsApp." />
      <div className="mb-5"><Tabs tabs={tabs} value={tab} onChange={(v) => setSp(v === 'inbox' ? {} : { tab: v }, { replace: true })} /></div>
      {tab === 'inbox' && <Inbox />}
      {tab === 'mine' && <MyPrefs />}
      {tab === 'settings' && admin && <OpsSettingsTab />}
    </>
  )
}

function Inbox() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const q = useQuery({ queryKey: ['cp-alerts-all', unreadOnly], queryFn: () => cp.alerts(unreadOnly, 200) })
  const read = useMutation({ mutationFn: (ids?: string[]) => cp.readAlerts(ids), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cp-alerts'] }); qc.invalidateQueries({ queryKey: ['cp-alerts-all'] }) } })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label>
        <span className="flex-1 text-xs text-slate-500">{q.data ? `${q.data.unread} unread` : ''}</span>
        <Button size="sm" variant="outline" disabled={!q.data?.unread} loading={read.isPending} icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => read.mutate(undefined)}>Mark all read</Button>
      </div>
      {q.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !q.data?.items.length ? (
        <EmptyState icon={<BellOff className="h-6 w-6" />} title={unreadOnly ? 'All caught up' : 'No alerts yet'} description="Alerts appear here when something needs the team’s attention." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data.items.map((a) => (
            <li key={a.id} className={cn('flex gap-3 px-4 py-3', !a.read_at && 'bg-brand-50/40')}>
              <span className="mt-0.5">{SEVERITY_ICON[a.severity]}</span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', a.read_at ? 'text-slate-700' : 'font-semibold text-brand-950')}>{a.title}</p>
                {a.body && <p className="whitespace-pre-line text-sm text-slate-600">{a.body}</p>}
                <p className="mt-1 text-xs text-slate-400">{dateTime(a.created_at)} · {a.event.replace(/_/g, ' ')}</p>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                {a.link && <Button size="sm" variant="ghost" onClick={() => { if (!a.read_at) read.mutate([a.id]); if (internal(a.link)) { nav(a.link!) } else { window.open(a.link!, '_blank', 'noopener') } }}>Open</Button>}
                {!a.read_at && <Button size="sm" variant="ghost" onClick={() => read.mutate([a.id])}>Mark read</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function MyPrefs() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-alert-prefs'], queryFn: () => cp.alertPrefs() })
  const [ev, setEv] = useState<Record<string, AlertChannel[]>>({})
  const [wa, setWa] = useState('')
  useEffect(() => { if (q.data) { setEv(Object.fromEntries(q.data.events.map((e) => [e.key, e.mine]))); setWa(q.data.whatsapp ?? '') } }, [q.data])
  const save = useMutation({
    mutationFn: () => cp.saveAlertPrefs({ events: ev, whatsapp: wa.trim() || null }),
    onSuccess: (d) => { qc.setQueryData(['cp-alert-prefs'], d); toast.success('Your notification choices are saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-72" />
  const p = q.data
  const on = ALERT_CHANNELS.filter((c) => p.channels[c.id])
  const toggle = (k: string, c: AlertChannel) => setEv({ ...ev, [k]: (ev[k] ?? []).includes(c) ? ev[k].filter((x) => x !== c) : [...(ev[k] ?? []), c] })
  const dirty = JSON.stringify(ev) !== JSON.stringify(Object.fromEntries(p.events.map((e) => [e.key, e.mine]))) || wa !== (p.whatsapp ?? '')
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <p className="flex-1 text-sm text-slate-600">Choose how each alert reaches you. Only channels an admin switched on are shown.</p>
          <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2.5">Alert</th>{on.map((c) => <th key={c.id} className="px-3 py-2.5 text-center">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.events.map((e) => (
                <tr key={e.key} className={cn(!e.enabled && 'opacity-50')}>
                  <td className="px-4 py-2.5"><p className="font-medium text-brand-950">{e.label} <Badge tone={SEV_TONE[e.severity]} className="ml-1">{e.severity}</Badge></p><p className="text-xs text-slate-500">{e.group}{!e.enabled ? ' · switched off by an admin' : ''}</p></td>
                  {on.map((c) => (
                    <td key={c.id} className="px-3 py-2.5 text-center">
                      <input type="checkbox" aria-label={`${e.label} by ${c.label}`} className="h-4 w-4 accent-brand-700" disabled={!e.enabled} checked={(ev[e.key] ?? []).includes(c.id)} onChange={() => toggle(e.key, c.id)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="space-y-4">
        {p.channels.push && <PushCard devices={p.devices} />}
        {p.channels.whatsapp && (
          <Card className="p-4">
            <h3 className="font-display text-sm font-semibold text-brand-950">WhatsApp number</h3>
            <p className="mb-2 text-xs text-slate-500">Alerts you tick under WhatsApp go here.</p>
            <Input inputMode="tel" value={wa} placeholder="98xxxxxxxx" onChange={(e) => setWa(e.target.value)} />
          </Card>
        )}
        {!on.length && <Card className="p-4 text-sm text-slate-600">No alert channels are switched on yet — ask an admin (Alerts → Settings).</Card>}
      </div>
    </div>
  )
}

function PushCard({ devices }: { devices: number }) {
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['cp-push-config'], queryFn: () => cp.pushConfig(), staleTime: 600_000 })
  const [here, setHere] = useState(() => !!savedPushToken() && pushPermission() === 'granted')
  const run = useMutation({
    mutationFn: () => (here ? disablePush(cfg.data ?? null) : enablePush(cfg.data ?? null)),
    onSuccess: () => { setHere(!here); qc.invalidateQueries({ queryKey: ['cp-alert-prefs'] }); qc.invalidateQueries({ queryKey: ['cp-push-config'] }); toast.success(here ? 'Notifications turned off on this browser' : 'Notifications on — send yourself a test from Messaging → Test send') },
    onError: (e) => toast.error(friendly(e)),
  })
  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-brand-950"><Smartphone className="h-4 w-4" />Browser push</h3>
      <p className="mb-3 text-xs text-slate-500">{devices ? `On for ${devices} browser${devices > 1 ? 's' : ''} of yours.` : 'Not on for any of your browsers yet.'}</p>
      {!pushSupported() ? <p className="text-xs text-amber-700">This browser does not support push notifications.</p>
        : cfg.isSuccess && !cfg.data ? <p className="text-xs text-amber-700">Not set up yet — an admin adds the Firebase web config in Messaging → Shared accounts.</p>
          : <Button size="sm" variant={here ? 'outline' : 'primary'} loading={run.isPending} icon={here ? <BellOff className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />} onClick={() => run.mutate()}>{here ? 'Turn off on this browser' : 'Turn on for this browser'}</Button>}
    </Card>
  )
}

const THRESHOLDS: { key: keyof OpsSettings['thresholds']; label: string; unit: string; hint?: string }[] = [
  { key: 'queueBacklog', label: 'Message queue backlog', unit: 'messages', hint: 'Waiting to be sent' },
  { key: 'failurePct', label: 'Delivery failures (last hour)', unit: '%' },
  { key: 'dbPct', label: 'Database size warning', unit: '% of limit' },
  { key: 'dbLimitMb', label: 'Database size limit', unit: 'MB', hint: 'Your Supabase plan (Pro: 8192)' },
  { key: 'latencyMs', label: 'Slow response', unit: 'ms' },
  { key: 'walletLowPaise', label: 'Hospital wallet low below', unit: 'paise', hint: '20000 = ₹200' },
  { key: 'trialDays', label: 'Trial ending alert', unit: 'days before' },
]

function OpsSettingsTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-ops-settings'], queryFn: () => cp.opsSettings() })
  const [f, setF] = useState<OpsSettings | null>(null)
  useEffect(() => { if (q.data) setF(structuredClone(q.data)) }, [q.data])
  const save = useMutation({
    mutationFn: () => { const { catalog: _c, ...rest } = f!; return cp.saveOpsSettings(rest) },
    onSuccess: (d) => { qc.setQueryData(['cp-ops-settings'], d); qc.invalidateQueries({ queryKey: ['cp-alert-prefs'] }); qc.invalidateQueries({ queryKey: ['cp-push-config'] }); toast.success('Alert settings saved for the whole team') },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!f || !q.data) return <Skeleton className="h-72" />
  const dirty = JSON.stringify(f) !== JSON.stringify(q.data)
  const evOf = (k: string, d: AlertSeverity) => f.events[k] ?? { enabled: true, severity: d }
  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 -mx-1 flex items-center justify-end gap-2 bg-[#f7f7fc]/90 px-1 py-2 backdrop-blur">
        {dirty && <Button variant="ghost" size="sm" onClick={() => setF(structuredClone(q.data!))}>Undo</Button>}
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
      </div>
      <Section title="Channels" subtitle="Switch a channel off and nobody receives alerts on it; members choose among the ones left on.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ALERT_CHANNELS.map((c) => (
            <label key={c.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', f.channels[c.id] ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200')}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={!!f.channels[c.id]} onChange={(e) => setF({ ...f, channels: { ...f.channels, [c.id]: e.target.checked } })} />
              <span><span className="block text-sm font-medium text-brand-950">{c.label}</span><span className="text-xs text-slate-500">{c.hint}</span></span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Events" subtitle="Turn an alert off for everyone or change how loud it is. Critical alerts default to every channel; info to the bell only.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-3">Alert</th><th className="px-3 py-2">Goes to</th><th className="px-3 py-2">On</th><th className="px-3 py-2">AlertSeverity</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {f.catalog.map((e) => {
                const v = evOf(e.key, e.severity)
                return (
                  <tr key={e.key}>
                    <td className="py-2 pr-3"><p className="font-medium text-brand-950">{e.label}</p><p className="text-xs text-slate-500">{e.group}</p></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{e.roles.join(', ')}</td>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`${e.label} on`} className="h-4 w-4 accent-brand-700" checked={v.enabled} onChange={(x) => setF({ ...f, events: { ...f.events, [e.key]: { ...v, enabled: x.target.checked } } })} /></td>
                    <td className="px-3 py-2"><Select className="h-8 py-0 text-xs" value={v.severity} onChange={(x) => setF({ ...f, events: { ...f.events, [e.key]: { ...v, severity: x.target.value as AlertSeverity } } })}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Limits" subtitle="Crossing one raises a “Limit crossed” alert (checked every 5 minutes).">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THRESHOLDS.map((t) => (
            <Field key={t.key} label={`${t.label} (${t.unit})`} hint={t.hint}>
              <Input type="number" min={0} value={f.thresholds[t.key]} onChange={(e) => setF({ ...f, thresholds: { ...f.thresholds, [t.key]: Number(e.target.value) } })} />
            </Field>
          ))}
        </div>
      </Section>
      <Section title="Health checks" subtitle="Every 5 minutes the ops Edge Function checks the site, Supabase, every function and the shared accounts.">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          <label className="inline-flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.health.enabled} onChange={(e) => setF({ ...f, health: { ...f.health, enabled: e.target.checked } })} />Run automatic checks</label>
          <Field label="Platform address" hint="Used for the website check and for links in e-mails / push (https://…)">
            <Input value={f.health.siteUrl} placeholder={`https://${location.host}`} onChange={(e) => setF({ ...f, health: { ...f.health, siteUrl: e.target.value.trim() } })} />
          </Field>
        </div>
      </Section>
    </div>
  )
}

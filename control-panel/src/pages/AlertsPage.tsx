/**
 * Team alerts: the inbox, each member's own choices (within what an admin switched on) and, for admins, the
 * platform-wide switches — channels, events with severity, limits and the health-check address.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, BellRing, Check, CheckCheck, ExternalLink, Eye, Search, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, Tabs } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { cp, friendly } from '../api'
import type { AlertChannel, CpAlert, OpsSettings, AlertSeverity } from '../types'
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
      <div className="mb-5"><Tabs tabs={tabs} value={tab} onChange={(v) => {
        const next = new URLSearchParams(sp)
        if (v === 'inbox') next.delete('tab')
        else { next.set('tab', v); next.delete('alert') }
        setSp(next, { replace: true })
      }} /></div>
      {tab === 'inbox' && <Inbox />}
      {tab === 'mine' && <MyPrefs />}
      {tab === 'settings' && admin && <OpsSettingsTab />}
    </>
  )
}

type InboxFilter = 'all' | 'unread' | 'attention'

function Inbox() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const alertId = searchParams.get('alert')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CpAlert | null>(null)
  const openedByUser = useRef<string | null>(null)
  const unreadOnly = filter === 'unread'
  const q = useQuery({ queryKey: ['cp-alerts-all', unreadOnly], queryFn: () => cp.alerts(unreadOnly, 200) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cp-alerts'] }); qc.invalidateQueries({ queryKey: ['cp-alerts-all'] }) }
  const read = useMutation({
    mutationFn: (ids?: string[]) => cp.readAlerts(ids),
    onSuccess: refresh,
    onError: (e) => toast.error(friendly(e)),
  })
  const unread = useMutation({
    mutationFn: (ids: string[]) => cp.unreadAlerts(ids),
    onSuccess: refresh,
    onError: (e) => toast.error(friendly(e)),
  })
  const routeAlert = q.data?.items.find((item) => item.id === alertId)
  const alertsLoaded = !!q.data
  const markRead = read.mutate

  // Bell clicks link to /alerts?alert=…; open that alert in this drawer, never its destination.
  useEffect(() => {
    if (!alertId) {
      setSelected(null)
      openedByUser.current = null
      return
    }
    if (!routeAlert) {
      if (alertsLoaded && selected?.id !== alertId) setSelected(null)
      return
    }
    if (!routeAlert.read_at) {
      if (openedByUser.current !== routeAlert.id) {
        openedByUser.current = routeAlert.id
        setSelected({ ...routeAlert, read_at: new Date().toISOString() })
        markRead([routeAlert.id])
      }
      return
    }
    setSelected(routeAlert)
  }, [alertId, routeAlert, alertsLoaded, markRead, selected?.id])

  const openDetails = (alert: CpAlert) => {
    openedByUser.current = alert.id
    setSelected(alert.read_at ? alert : { ...alert, read_at: new Date().toISOString() })
    if (!alert.read_at) read.mutate([alert.id])
    const next = new URLSearchParams(searchParams)
    next.set('alert', alert.id)
    setSearchParams(next)
  }
  const closeDetails = () => {
    setSelected(null)
    openedByUser.current = null
    if (!alertId) return
    const next = new URLSearchParams(searchParams)
    next.delete('alert')
    setSearchParams(next, { replace: true })
  }
  const toggleSelectedRead = () => {
    if (!selected) return
    if (selected.read_at) {
      setSelected({ ...selected, read_at: null })
      unread.mutate([selected.id])
    } else {
      setSelected({ ...selected, read_at: new Date().toISOString() })
      read.mutate([selected.id])
    }
  }
  const openDestination = (link: string) => {
    if (internal(link)) {
      nav(link)
      return
    }
    if (/^https?:\/\//i.test(link)) {
      window.open(link, '_blank', 'noopener,noreferrer')
      closeDetails()
    }
  }

  const term = search.trim().toLowerCase()
  const items = useMemo(() => (q.data?.items ?? []).filter((alert) => {
    if (filter === 'attention' && alert.severity === 'info') return false
    if (!term) return true
    return `${alert.title} ${alert.body} ${alert.event}`.toLowerCase().includes(term)
  }), [q.data?.items, filter, term])
  const canOpenDestination = (link: string | null): link is string => !!link && (internal(link) || /^https?:\/\//i.test(link))
  const destinationAction = (link: string) => link === '/' ? 'Go to dashboard' : 'Open related page'
  const destinationName = (link: string) => {
    const path = link.split(/[?#]/, 1)[0]
    if (path === '/') return 'Dashboard overview'
    if (path.startsWith('/hospitals/')) return 'Hospital details'
    const pages: Record<string, string> = {
      '/signups': 'Sign-ups', '/leads': 'Leads', '/payments': 'Payments', '/health': 'System health',
      '/incidents': 'Incidents', '/onboarding': 'Onboarding', '/alerts': 'Alerts',
    }
    return pages[path] ?? 'Related page'
  }

  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const filters: { id: InboxFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread', count: q.data?.unread },
    { id: 'attention', label: 'Needs attention' },
  ]
  const noAlerts = !!q.data && q.data.items.length === 0
  const noMatches = !!q.data?.items.length && items.length === 0

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <div role="group" aria-label="Filter alerts" className="flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1">
            {filters.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition', filter === item.id ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-600 hover:text-brand-900')}>
                {item.label}{item.count !== undefined && <span className={cn('ml-1.5', filter === item.id ? 'text-brand-700' : 'text-slate-400')}>{item.count}</span>}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:justify-end">
            <label className="relative min-w-[190px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search alerts…" aria-label="Search alerts" className="pl-9" />
            </label>
            <span className="whitespace-nowrap text-xs text-slate-500">{q.data ? `${items.length} alerts · ${q.data.unread} unread` : ''}</span>
            <Button size="sm" variant="outline" disabled={!q.data?.unread} loading={read.isPending} icon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => {
              if (selected) setSelected({ ...selected, read_at: selected.read_at ?? new Date().toISOString() })
              read.mutate(undefined)
            }}>Mark all read</Button>
          </div>
        </div>
        {q.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : noAlerts ? (
          <EmptyState icon={<BellOff className="h-6 w-6" />} title={filter === 'unread' ? 'All caught up' : 'No alerts yet'} description="Alerts appear here when something needs the team’s attention." />
        ) : noMatches ? (
          <EmptyState icon={<Search className="h-6 w-6" />} title={search ? 'No matching alerts' : 'No alerts need attention'}
            description={search ? 'Try a different search or clear the current filters.' : 'Warnings and critical alerts will appear in this view.'}
            action={<Button size="sm" variant="outline" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((alert) => {
              const accent = alert.severity === 'critical' ? 'border-l-rose-500' : alert.severity === 'warning' ? 'border-l-amber-400' : 'border-l-sky-400'
              const iconBg = alert.severity === 'critical' ? 'bg-rose-50' : alert.severity === 'warning' ? 'bg-amber-50' : 'bg-sky-50'
              return (
                <li key={alert.id} className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 border-l-4 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center', accent, !alert.read_at && 'bg-brand-50/35')}>
                  <span className={cn('row-span-2 grid h-10 w-10 place-items-center rounded-xl sm:row-span-1', iconBg)}>{SEVERITY_ICON[alert.severity]}</span>
                  <button type="button" onClick={() => openDetails(alert)} aria-label={`Open details for ${alert.title}`} className="min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300/60">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-sm', alert.read_at ? 'font-medium text-slate-800' : 'font-semibold text-brand-950')}>{alert.title}</span>
                      <Badge tone={SEV_TONE[alert.severity]}>{alert.severity}</Badge>
                      {!alert.read_at && <Badge tone="teal" dot>New</Badge>}
                    </span>
                    {alert.body && <span className="mt-1 line-clamp-2 whitespace-pre-line text-sm leading-5 text-slate-600">{alert.body}</span>}
                    <span className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                      <span>{dateTime(alert.created_at)}</span><span aria-hidden="true">·</span><span className="capitalize">{alert.event.replace(/_/g, ' ')}</span>
                    </span>
                  </button>
                  <div className="col-start-2 flex items-center gap-1 sm:col-start-3 sm:row-start-1">
                    <Button size="sm" variant="outline" aria-label={`Open alert details: ${alert.title}`} icon={<Eye className="h-3.5 w-3.5" />} onClick={() => openDetails(alert)}>Open</Button>
                    {!alert.read_at ? (
                      <Button size="icon" variant="ghost" aria-label={`Mark ${alert.title} as read`} title="Mark read" disabled={read.isPending} onClick={() => read.mutate([alert.id])}>
                        <Check className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button size="icon" variant="ghost" aria-label={`Mark ${alert.title} as unread`} title="Mark unread" disabled={unread.isPending} onClick={() => unread.mutate([alert.id])}>
                        <BellRing className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Drawer
        open={!!selected}
        onClose={closeDetails}
        width="max-w-xl"
        title={<span className="line-clamp-2">{selected?.title ?? 'Alert details'}</span>}
        subtitle={selected ? `${dateTime(selected.created_at)} · ${selected.event.replace(/_/g, ' ')}` : undefined}
        footer={<>
          <Button variant="ghost" onClick={closeDetails}>Close</Button>
          {selected?.link && canOpenDestination(selected.link) && <Button icon={<ExternalLink className="h-4 w-4" />} onClick={() => openDestination(selected.link!)}>{destinationAction(selected.link)}</Button>}
        </>}
      >
        {selected && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEV_TONE[selected.severity]}>{selected.severity}</Badge>
                <Badge tone={selected.read_at ? 'slate' : 'teal'} dot>{selected.read_at ? 'Read' : 'Unread'}</Badge>
              </div>
              <div className="mt-4 flex items-start gap-3">
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', selected.severity === 'critical' ? 'bg-rose-50' : selected.severity === 'warning' ? 'bg-amber-50' : 'bg-sky-50')}>
                  {SEVERITY_ICON[selected.severity]}
                </span>
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold leading-snug text-brand-950">{selected.title}</p>
                  <p className="mt-1 text-xs capitalize text-slate-500">{selected.event.replace(/_/g, ' ')}</p>
                </div>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-brand-950">Details</h3>
                <Button size="sm" variant="ghost" disabled={read.isPending || unread.isPending} icon={selected.read_at ? <BellRing className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  onClick={toggleSelectedRead}>
                  {selected.read_at ? 'Mark unread' : 'Mark read'}
                </Button>
              </div>
              <p className="whitespace-pre-line break-words rounded-xl border border-slate-100 bg-white p-4 text-sm leading-6 text-slate-700 shadow-sm">
                {selected.body.trim() || 'No additional information was provided with this alert.'}
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-brand-950">Alert information</h3>
              <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Created</dt><dd className="mt-1 font-medium text-slate-800">{dateTime(selected.created_at)}</dd></div>
                <div><dt className="text-xs text-slate-500">Type</dt><dd className="mt-1 font-medium capitalize text-slate-800">{selected.event.replace(/_/g, ' ')}</dd></div>
                <div><dt className="text-xs text-slate-500">Severity</dt><dd className="mt-1 font-medium capitalize text-slate-800">{selected.severity}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd className="mt-1 font-medium text-slate-800">{selected.read_at ? 'Read' : 'Unread'}</dd></div>
              </dl>
            </section>

            {selected.link && canOpenDestination(selected.link) && (
              <section className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                <h3 className="text-sm font-semibold text-brand-950">Related destination</h3>
                <p className="mt-1 text-sm text-slate-700">{destinationName(selected.link)}</p>
                {selected.link === '/' && <p className="mt-2 text-xs leading-5 text-slate-500">This alert links to the dashboard. The alert details are shown here; use “Go to dashboard” only if you want to leave this view.</p>}
                {selected.link !== '/' && <p className="mt-2 break-all font-mono text-xs text-slate-500">{selected.link}</p>}
              </section>
            )}
          </div>
        )}
      </Drawer>
    </>
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
    onSuccess: () => { setHere(!here); qc.invalidateQueries({ queryKey: ['cp-alert-prefs'] }); qc.invalidateQueries({ queryKey: ['cp-push-config'] }); toast.success(here ? 'Notifications turned off on this browser' : 'Notifications on — send yourself a test from Platform settings → Integrations') },
    onError: (e) => toast.error(friendly(e)),
  })
  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-brand-950"><Smartphone className="h-4 w-4" />Browser push</h3>
      <p className="mb-3 text-xs text-slate-500">{devices ? `On for ${devices} browser${devices > 1 ? 's' : ''} of yours.` : 'Not on for any of your browsers yet.'}</p>
      {!pushSupported() ? <p className="text-xs text-amber-700">This browser does not support push notifications.</p>
        : cfg.isSuccess && !cfg.data ? <p className="text-xs text-amber-700">Not set up yet — an admin adds the Firebase web config in Platform settings → Integrations.</p>
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
  { key: 'connPct', label: 'Database connections warning', unit: '% of max' },
  { key: 'storagePct', label: 'File storage warning', unit: '% of limit' },
  { key: 'storageLimitMb', label: 'File storage limit', unit: 'MB', hint: 'Your Supabase plan (Pro: 102400 = 100 GB)' },
  { key: 'webhookHours', label: 'Razorpay webhook missing after', unit: 'hours', hint: 'Only when online payments came in' },
  { key: 'sslDays', label: 'SSL certificate expiry warning', unit: 'days before' },
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

/**
 * Plans & billing — every plan (add, edit, duplicate, hide, archive, reorder, delete), the billing rules (GST, trial,
 * grace, yearly price, message rates, wallet limits), the seller on invoices and the change history.
 * Plans live in the database: the product site, sign-up, the hospitals' Billing page and invoices update as soon as you save.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Building2, ChevronDown, Copy, ExternalLink, Eye, EyeOff, IndianRupee, Layers, MoreHorizontal, Pencil, Plus, Save, Sparkles, Trash2, TrendingUp, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, PageHeader, Skeleton, Tabs } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { loadPlans } from '../../../src/platform/planStore'
import { planList, type Plan } from '../../../src/platform/plans'
import { cp, friendly } from '../api'
import type { BillingConfig } from '../types'
import { ErrorBox, inr } from '../ui'
import { EMPTY_STATS, fieldsOf, planStats, totals, type PlanStats } from './plans/model'
import { PlanEditor, type SaveRequest } from './plans/PlanEditor'
import { HistoryTab, InvoicesTab, RulesTab, type RulesForm } from './plans/RulesTabs'

type Tab = 'plans' | 'rules' | 'invoices' | 'history'
const TABS: { value: Tab; label: string }[] = [{ value: 'plans', label: 'Plans' }, { value: 'rules', label: 'Billing rules' }, { value: 'invoices', label: 'Invoices' }, { value: 'history', label: 'History' }]
const rulesOf = (b: BillingConfig): RulesForm => { const { plans: _p, ...rest } = b; void _p; return structuredClone(rest) }

export function PlansPage() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const tab: Tab = TABS.find((t) => t.value === sp.get('tab'))?.value ?? 'plans'
  const settings = useQuery({ queryKey: ['cp-settings'], queryFn: () => cp.settings() })
  const hospitals = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const history = useQuery({ queryKey: ['cp-plan-history'], queryFn: () => cp.planHistory(), enabled: tab === 'history' })

  const billing = settings.data?.billing
  const plans = useMemo(() => planList(billing?.plans as Record<string, Partial<Plan>> | undefined), [billing])
  const stats = useMemo(() => planStats(hospitals.data ?? []), [hospitals.data])
  const all = totals(stats)

  // ---- after any change: new config in the cache, everyone's plan list refreshed (labels, pickers, previews)
  const applied = (b: BillingConfig) => {
    qc.setQueryData(['cp-settings'], { billing: b })
    qc.invalidateQueries({ queryKey: ['cp-plan-history'] })
    qc.invalidateQueries({ queryKey: ['cp-hospitals'] })
    void loadPlans(true)
  }

  // ---- plans
  const [editing, setEditing] = useState<{ plan: Plan | null; start: ReturnType<typeof fieldsOf> | null } | null>(null)
  const [deleting, setDeleting] = useState<Plan | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const savePlan = useMutation({
    mutationFn: (r: SaveRequest) => cp.savePlan(r.id, r.fields, r.existing, r.notify),
    onSuccess: (res, r) => {
      applied(res.billing); setEditing(null)
      toast.success(`${r.fields.name} saved`, { description: [res.kept ? `${res.kept} hospital(s) keep their old price` : '', res.notified ? `${res.notified} owner(s) told` : '', 'The website shows it now.'].filter(Boolean).join(' · ') })
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const quick = useMutation({
    mutationFn: (v: { p: Plan; patch: Partial<ReturnType<typeof fieldsOf>>; done: string }) => cp.savePlan(v.p.id, v.patch, 'apply', true),
    onSuccess: (res, v) => { applied(res.billing); toast.success(v.done) },
    onError: (e) => toast.error(friendly(e)),
  })
  const reorder = useMutation({
    mutationFn: (ids: string[]) => cp.reorderPlans(ids),
    onMutate: (ids) => {   // optimistic: move the card at once
      const prev = qc.getQueryData<{ billing: BillingConfig }>(['cp-settings'])
      if (prev) qc.setQueryData(['cp-settings'], { billing: { ...prev.billing, plans: Object.fromEntries(Object.entries(prev.billing.plans).map(([k, v]) => [k, { ...v, order: ids.indexOf(k) }])) } })
      return { prev }
    },
    onSuccess: (res) => applied(res.billing),
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['cp-settings'], ctx.prev); toast.error(friendly(e)) },
  })
  const del = useMutation({
    mutationFn: (p: Plan) => cp.deletePlan(p.id),
    onSuccess: (res, p) => { applied(res.billing); setDeleting(null); toast.success(`${p.name} deleted`) },
    onError: (e) => toast.error(friendly(e)),
  })
  const move = (p: Plan, d: -1 | 1) => {
    const ids = plans.map((x) => x.id), i = ids.indexOf(p.id), j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder.mutate(ids)
  }

  // ---- rules + invoices (one form, one save bar)
  const [rules, setRules] = useState<RulesForm | null>(null)
  useEffect(() => { if (billing) setRules((r) => r ?? rulesOf(billing)) }, [billing])
  const savedRules = billing ? rulesOf(billing) : null
  const rulesDirty = !!rules && !!savedRules && JSON.stringify(rules) !== JSON.stringify(savedRules)
  const saveRules = useMutation({
    mutationFn: (r: RulesForm) => cp.saveBillingSettings({
      gstPercent: Number(r.gstPercent), trialDays: Number(r.trialDays), graceDays: Number(r.graceDays), yearlyMonths: Number(r.yearlyMonths),
      minTopup: Number(r.minTopup), maxTopup: Number(r.maxTopup),
      ratesPaise: { sms: Number(r.ratesPaise.sms), whatsapp: Number(r.ratesPaise.whatsapp), email: Number(r.ratesPaise.email) }, seller: r.seller,
    }),
    onSuccess: (b) => { applied(b); setRules(rulesOf(b)); toast.success('Billing rules saved — they apply right away (existing invoices don’t change)') },
    onError: (e) => toast.error(friendly(e)),
  })
  useEffect(() => {   // don't lose unsaved rules by closing the tab
    if (!rulesDirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [rulesDirty])

  if (settings.error) return <><PageHeader title="Plans & billing" /><ErrorBox error={settings.error} onRetry={() => settings.refetch()} /></>
  const live = plans.filter((p) => !p.archived)
  const archived = plans.filter((p) => p.archived)
  const offered = live.filter((p) => p.public !== false)

  return (
    <div className={cn(rulesDirty && 'pb-24')}>
      <PageHeader title="Plans & billing" description="Your plans, prices and billing rules. Changes show on the website, the sign-up page and every hospital’s Billing page as soon as you save."
        actions={<div className="flex flex-wrap gap-2">
          <a href="/pricing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-800 ring-1 ring-slate-200 hover:bg-white"><ExternalLink className="h-4 w-4" />Pricing page</a>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setSp({}, { replace: true }); setEditing({ plan: null, start: null }) }} disabled={!billing}>New plan</Button>
        </div>} />

      {/* numbers */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Layers className="h-4 w-4" />} label="Plans on the website" value={billing ? `${offered.length}` : null} hint={billing ? `${plans.length} in total${archived.length ? ` · ${archived.length} archived` : ''}` : ''} />
        <Kpi icon={<Building2 className="h-4 w-4" />} label="Hospitals on a plan" value={hospitals.data ? `${all.hospitals}` : null} hint={hospitals.data ? `${all.paying} paying · ${all.trial} on trial` : ''} />
        <Kpi icon={<IndianRupee className="h-4 w-4" />} label="Monthly revenue (MRR)" value={hospitals.data ? inr(all.mrr) : null} hint="Active hospitals, before GST" />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Average per paying hospital" value={hospitals.data ? (all.paying ? inr(Math.round(all.mrr / all.paying)) : '—') : null} hint={all.ownPrice ? `${all.ownPrice} on an agreed price` : 'a month'} />
      </div>

      <div className="mb-5"><Tabs tabs={TABS} value={tab} onChange={(v) => setSp(v === 'plans' ? {} : { tab: v }, { replace: true })} /></div>

      {tab === 'plans' && (!billing ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 min-[1800px]:grid-cols-4">
            {live.map((p, i) => (
              <PlanAdminCard key={p.id} p={p} s={stats[p.id] ?? EMPTY_STATS} yearlyMonths={billing.yearlyMonths} gst={billing.gstPercent}
                first={i === 0} last={i === live.length - 1} busy={quick.isPending && quick.variables?.p.id === p.id}
                onEdit={() => setEditing({ plan: p, start: fieldsOf(p) })}
                onDuplicate={() => setEditing({ plan: null, start: { ...fieldsOf(p), name: `${p.name} copy`.slice(0, 40), highlight: false } })}
                onMove={(d) => move(p, d)}
                onToggle={(patch, done) => quick.mutate({ p, patch, done })}
                onDelete={() => setDeleting(p)} />
            ))}
            <button type="button" onClick={() => setEditing({ plan: null, start: null })}
              className="grid min-h-[220px] place-items-center rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-slate-500 transition hover:border-brand-300 hover:bg-white hover:text-brand-800">
              <span><Plus className="mx-auto h-6 w-6" /><span className="mt-2 block text-sm font-medium">Add a plan</span><span className="block text-xs text-slate-400">or duplicate one from its menu</span></span>
            </button>
          </div>

          {archived.length > 0 && (
            <div className="mt-8">
              <button type="button" onClick={() => setShowArchived((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-brand-900" aria-expanded={showArchived}>
                <ChevronDown className={cn('h-4 w-4 transition', showArchived && 'rotate-180')} />Archived plans ({archived.length})
                <span className="font-normal text-slate-400">— not offered any more; hospitals already on them keep them</span>
              </button>
              {showArchived && (
                <div className="mt-3 grid gap-4 md:grid-cols-2 2xl:grid-cols-3 min-[1800px]:grid-cols-4">
                  {archived.map((p) => (
                    <PlanAdminCard key={p.id} p={p} s={stats[p.id] ?? EMPTY_STATS} yearlyMonths={billing.yearlyMonths} gst={billing.gstPercent} first last
                      busy={quick.isPending && quick.variables?.p.id === p.id}
                      onEdit={() => setEditing({ plan: p, start: fieldsOf(p) })}
                      onDuplicate={() => setEditing({ plan: null, start: { ...fieldsOf(p), name: `${p.name} copy`.slice(0, 40), archived: false, highlight: false } })}
                      onMove={() => undefined} onToggle={(patch, done) => quick.mutate({ p, patch, done })} onDelete={() => setDeleting(p)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ))}

      {tab === 'rules' && (rules ? <RulesTab f={rules} set={(patch) => setRules({ ...rules, ...patch })} plans={plans} /> : <Skeleton className="h-80" />)}
      {tab === 'invoices' && (rules ? <InvoicesTab f={rules} set={(patch) => setRules({ ...rules, ...patch })} /> : <Skeleton className="h-80" />)}
      {tab === 'history' && <HistoryTab rows={history.data} error={history.error} onRetry={() => history.refetch()} />}

      {/* unsaved billing rules */}
      {rulesDirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] lg:pl-64">
          <div role="region" aria-label="Unsaved changes" className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl bg-brand-950 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10">
            <Sparkles className="h-4 w-4 text-brand-200" />
            <p className="min-w-0 flex-1 text-sm">Unsaved billing changes{tab !== 'rules' && tab !== 'invoices' ? ' (Billing rules / Invoices)' : ''}</p>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" icon={<Undo2 className="h-4 w-4" />} onClick={() => savedRules && setRules(savedRules)}>Discard</Button>
            <Button size="sm" variant="secondary" icon={<Save className="h-4 w-4" />} loading={saveRules.isPending} disabled={!!rules && rules.minTopup > rules.maxTopup} onClick={() => rules && saveRules.mutate(rules)}>Save</Button>
          </div>
        </div>
      )}

      {editing && billing && (
        <PlanEditor plan={editing.plan} start={editing.start} taken={plans.map((p) => p.id)} stats={editing.plan ? stats[editing.plan.id] ?? EMPTY_STATS : EMPTY_STATS}
          saving={savePlan.isPending} onSave={(r) => savePlan.mutate(r)} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting)}
        title={`Delete the ${deleting?.name} plan?`} confirmLabel="Delete plan"
        description="It disappears from the website and the plan lists. Only possible while no hospital or waiting sign-up uses it — otherwise archive it." />
    </div>
  )
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string | null; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>{label}</p>
      {value == null ? <Skeleton className="mt-2 h-7 w-24" /> : <p className="mt-2 truncate font-display text-2xl font-bold tabular-nums text-brand-950">{value}</p>}
      {hint && <p className="mt-0.5 truncate text-[11px] text-slate-400">{hint}</p>}
    </Card>
  )
}

const CH = [['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['email', 'E-mail']] as const

function PlanAdminCard({ p, s, yearlyMonths, gst, first, last, busy, onEdit, onDuplicate, onMove, onToggle, onDelete }: {
  p: Plan; s: PlanStats; yearlyMonths: number; gst: number; first: boolean; last: boolean; busy: boolean
  onEdit: () => void; onDuplicate: () => void; onMove: (d: -1 | 1) => void
  onToggle: (patch: Partial<ReturnType<typeof fieldsOf>>, done: string) => void; onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const inUse = s.hospitals > 0
  return (
    <Card className={cn('relative flex flex-col overflow-visible p-5 transition', p.highlight && 'ring-2 ring-brand-300', p.archived && 'opacity-80', busy && 'opacity-60')}>
      {p.highlight && <span className="absolute -top-2.5 left-5 rounded-full bg-brand-900 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Most popular</span>}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-brand-950">{p.name}</p>
          <p className="font-mono text-[11px] text-slate-400">{p.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!p.archived && <>
            <button type="button" aria-label={`Move ${p.name} left`} title="Move earlier" disabled={first} onClick={() => onMove(-1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-900 disabled:opacity-25"><ArrowUp className="h-4 w-4 md:-rotate-90" /></button>
            <button type="button" aria-label={`Move ${p.name} right`} title="Move later" disabled={last} onClick={() => onMove(1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-900 disabled:opacity-25"><ArrowDown className="h-4 w-4 md:-rotate-90" /></button>
          </>}
          <div className="relative">
            <button type="button" aria-label={`More for ${p.name}`} aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-900"><MoreHorizontal className="h-4 w-4" /></button>
            {menu && <>
              <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl bg-white py-1 text-sm shadow-xl ring-1 ring-slate-200">
                {([
                  [<Copy key="i" className="h-4 w-4" />, 'Duplicate', onDuplicate, false, ''],
                  !p.archived && [p.public !== false ? <EyeOff key="i" className="h-4 w-4" /> : <Eye key="i" className="h-4 w-4" />, p.public !== false ? 'Hide from website' : 'Show on website',
                    () => onToggle({ public: p.public === false }, p.public !== false ? `${p.name} hidden from the website` : `${p.name} is on the website`), false, ''],
                  !p.archived && !p.highlight && [<Sparkles key="i" className="h-4 w-4" />, 'Mark most popular', () => onToggle({ highlight: true }, `${p.name} is now “most popular”`), false, ''],
                  [p.archived ? <ArchiveRestore key="i" className="h-4 w-4" /> : <Archive key="i" className="h-4 w-4" />, p.archived ? 'Restore (offer again)' : 'Archive',
                    () => onToggle({ archived: !p.archived }, p.archived ? `${p.name} is offered again` : `${p.name} archived — hospitals on it keep it`), false, ''],
                  [<Trash2 key="i" className="h-4 w-4" />, 'Delete', onDelete, inUse, inUse ? `${s.hospitals} hospital(s) on it — archive instead` : ''],
                ].filter(Boolean) as [React.ReactNode, string, () => void, boolean, string][]).map(([ic, label, run, disabled, why]) => (
                  <button key={label} type="button" role="menuitem" disabled={disabled} title={why || undefined} onClick={() => { setMenu(false); run() }}
                    className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40', label === 'Delete' ? 'text-rose-700' : 'text-slate-700')}>
                    {ic}<span className="min-w-0"><span className="block">{label}</span>{why && <span className="block text-[10px] text-slate-400">{why}</span>}</span>
                  </button>
                ))}
              </div>
            </>}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {p.archived ? <Badge tone="slate">Archived</Badge> : p.public === false ? <Badge tone="amber">Hidden</Badge> : <Badge tone="green" dot>On website</Badge>}
        {p.signup && p.price != null && !p.archived && <Badge tone="blue">Free-trial sign-up</Badge>}
      </div>
      {p.tagline && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{p.tagline}</p>}

      <div className="mt-3">
        {p.price == null ? <p className="font-display text-2xl font-bold text-brand-950">Let’s talk</p> : (
          <>
            <p className="font-display text-3xl font-bold tabular-nums text-brand-950">{inr(p.price)}{p.suffix}<span className="ml-1 text-sm font-normal text-slate-500">/ month</span></p>
            <p className="text-xs text-slate-500 tabular-nums">Yearly {inr(p.price * yearlyMonths)} (pay {yearlyMonths} months) · + {gst}% GST</p>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        {CH.map(([k, l]) => (
          <div key={k} className="rounded-lg bg-slate-50 px-1.5 py-1.5">
            <p className="text-sm font-semibold tabular-nums text-brand-950">{p.included[k].toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-slate-500">{l} / mo</p>
          </div>
        ))}
      </div>

      <ul className="mt-3 flex-1 space-y-1 text-xs text-slate-600">
        {p.features.slice(0, 4).map((f) => <li key={f} className="flex gap-1.5"><span className="text-brand-500">•</span><span className="min-w-0">{f}</span></li>)}
        {p.features.length > 4 && <li className="text-slate-400">+ {p.features.length - 4} more</li>}
        {!p.features.length && <li className="text-slate-400">No features listed yet</li>}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-brand-50/50 px-3 py-2 text-xs">
        <span className="text-slate-600"><b className="text-brand-950">{s.hospitals}</b> hospital{s.hospitals === 1 ? '' : 's'}{s.hospitals ? ` · ${s.paying} paying · ${s.trial} trial` : ''}</span>
        <span className="whitespace-nowrap font-semibold tabular-nums text-brand-950" title="Monthly revenue from this plan">{inr(s.mrr)}/mo</span>
      </div>
      <Button className="mt-3 w-full" variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Edit plan</Button>
    </Card>
  )
}

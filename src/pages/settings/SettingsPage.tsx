import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useModuleLocks, type ModuleKey } from '../../tenancy/modules'
import { isPrimaryTenant, tenancyEnabled } from '../../tenancy/state'
import { platformName } from '../../lib/supabase'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Building2, ClipboardList, CircleUserRound, Database, Globe, LayoutDashboard, Loader2, Palette, Receipt, Save, ShieldCheck, Undo2, UserCog, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { Button, PageHeader, Skeleton } from '../../components/ui'
import { cn } from '../../lib/utils'
import { CONTENT_QK, mergeRows, useContentRows } from '../../site/cms/content'
import { cms, type ContentRows } from '../../site/cms/store'
import type { SiteSettings } from '../../site/cms/types'
import { useAppSettings } from '../../settings/AppSettingsProvider'
import type { AppSettings } from '../../settings/types'
import { AccountTab } from './AccountTab'
import { AppearanceTab, LOCKED_MODULES } from './AppearanceTab'
import { BillingTab } from './BillingTab'
import { DashboardTab } from './DashboardTab'
import { DataTab } from './DataTab'
import { DomainTab } from './DomainTab'
import { FormsTab } from './FormsTab'
import { GeneralTab } from './GeneralTab'
import { NotificationsTab } from './NotificationsTab'
import { PlanTab } from './PlanTab'
import { SecurityTab } from './SecurityTab'
import { UsersTab } from './UsersTab'
import { Segmented, type TabCtx } from './shared'

type TabId = 'general' | 'appearance' | 'dashboard' | 'users' | 'notifications' | 'billing' | 'forms' | 'security' | 'data' | 'domain' | 'plan' | 'account'
const TABS: { id: TabId; label: string; hint: string; icon: ComponentType<{ className?: string }>; ownerOnly: boolean; module?: ModuleKey }[] = [
  { id: 'general', label: 'General & brand', hint: 'Logo, name, contacts, formats', icon: Building2, ownerOnly: true, module: 'general' },
  { id: 'appearance', label: 'Appearance', hint: 'Theme, layout, modules, banner', icon: Palette, ownerOnly: true, module: 'appearance' },
  { id: 'dashboard', label: 'Dashboard', hint: 'Widgets for each role', icon: LayoutDashboard, ownerOnly: true, module: 'dashboard' },
  { id: 'users', label: 'Users & accounts', hint: 'Create, edit, disable sign-ins', icon: UserCog, ownerOnly: true },
  { id: 'notifications', label: 'Notifications & APIs', hint: 'SMS, WhatsApp, email, push, cron', icon: BellRing, ownerOnly: true, module: 'notifications' },
  { id: 'billing', label: 'Billing & booking', hint: 'GST letterhead, online booking', icon: Receipt, ownerOnly: true },
  { id: 'forms', label: 'Website forms', hint: 'Contact, reviews, custom forms', icon: ClipboardList, ownerOnly: true, module: 'forms' },
  { id: 'security', label: 'Security & access', hint: 'Timeout, sign-in, roles', icon: ShieldCheck, ownerOnly: true, module: 'security' },
  { id: 'data', label: 'Data & backup', hint: 'Export, import, system', icon: Database, ownerOnly: true, module: 'data' },
  { id: 'domain', label: 'Domain', hint: 'Website address & SSL', icon: Globe, ownerOnly: true },
  { id: 'plan', label: 'Plan & wallet', hint: `${platformName} plan, wallet, invoices`, icon: Wallet, ownerOnly: true },
  { id: 'account', label: 'My account', hint: 'Profile and your access', icon: CircleUserRound, ownerOnly: false },
]

const clone = <T,>(v: T): T => structuredClone(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Paint the draft appearance on the whole dashboard while editing; restore the saved one on leave. */
/** Show the unsaved appearance / modules / announcement across the whole dashboard (sidebar included) while editing. */
function useLivePreview(draft: AppSettings | null | undefined, dirty: boolean) {
  const { setPreview } = useAppSettings()
  useEffect(() => {
    setPreview(draft && dirty ? { appearance: draft.appearance, modules: draft.modules, announcement: draft.announcement } : null)
  }, [draft, dirty, setPreview])
  useEffect(() => () => setPreview(null), [setPreview])
}

export default function SettingsPage() {
  const { user, context } = useAuth()
  const isOwner = user?.role === 'owner'
  // Plan & wallet: hospitals on Hospital Comrade (not the platform's own) — owner, and the platform team incl. finance
  const planTab = tenancyEnabled() && !isPrimaryTenant() && (isOwner || !!context?.provider_role)
  const locked = useModuleLocks()
  // locked modules are managed by the platform team and hidden from the hospital
  // Domain: multi-hospital installs only (a single-hospital install's address is set where it is deployed)
  const tabs = TABS.filter((t) => (t.id === 'plan' ? planTab : (isOwner || !t.ownerOnly) && !locked(t.module) && (t.id !== 'domain' || tenancyEnabled())))
  const [params, setParams] = useSearchParams()
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0].id) as TabId
  const qc = useQueryClient()
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => { activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [tab])

  // ---------------------------------------------------------------- saved values
  const rows = useContentRows({ enabled: isOwner })
  const { savedSettings: savedApp, loading: appLoading, save: saveApp } = useAppSettings()
  const savedSite = useMemo(() => mergeRows(rows.data).settings, [rows.data])

  // ---------------------------------------------------------------- drafts (re-synced when saved data changes and there are no local edits)
  const [site, setSite] = useState<SiteSettings | null>(null)
  const [app, setApp] = useState<AppSettings | null>(null)
  const baseSite = useRef<SiteSettings | null>(null)
  const baseApp = useRef<AppSettings | null>(null)
  useEffect(() => {
    if (!isOwner || rows.isPending) return
    setSite((d) => (d === null || same(d, baseSite.current) ? clone(savedSite) : d))
    baseSite.current = savedSite
  }, [savedSite, rows.isPending, isOwner])
  useEffect(() => {
    if (!isOwner || appLoading) return
    setApp((d) => (d === null || same(d, baseApp.current) ? clone(savedApp) : d))
    baseApp.current = savedApp
  }, [savedApp, appLoading, isOwner])

  const siteDirty = !!site && !same(site, savedSite)
  const appDirty = !!app && !same(app, savedApp)
  const dirty = siteDirty || appDirty
  useLivePreview(isOwner ? app : null, appDirty)

  const editSite = useCallback((fn: (d: SiteSettings) => void) => setSite((p) => { if (!p) return p; const n = clone(p); fn(n); return n }), [])
  const editApp = useCallback((fn: (d: AppSettings) => void) => setApp((p) => { if (!p) return p; const n = clone(p); fn(n); return n }), [])

  // ---------------------------------------------------------------- save / discard
  const save = useMutation({
    mutationFn: async () => {
      if (site && siteDirty) {
        if (!site.name.trim()) throw new Error('Hospital name cannot be empty')
        // links in messages (feedback, invites) need an absolute address — default to the site the owner is using
        const toSave = site.siteUrl ? site : { ...site, siteUrl: window.location.origin }
        const row = await cms.save('settings', toSave, user?.full_name)
        qc.setQueryData<ContentRows>(CONTENT_QK, (old) => ({ ...(old ?? {}), settings: row }))
      }
      if (app && appDirty) {
        const next = clone(app)
        next.modules.hidden = next.modules.hidden.filter((p) => !LOCKED_MODULES.includes(p))
        await saveApp(next)
      }
    },
    onSuccess: () => toast.success('Settings saved', { description: 'Changes apply to every user on their next page load.' }),
    onError: (e) => toast.error('Could not save settings', { description: (e as Error).message }),
  })
  const discard = () => { setSite(clone(savedSite)); setApp(clone(savedApp)); toast.info('Changes discarded') }

  useEffect(() => {
    if (!dirty) return
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!save.isPending) save.mutate() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [dirty, save])
  // the form editor (Forms tab) saves on its own; it only reports unsaved edits here so leaving the page asks first
  const [formsDirty, setFormsDirty] = useState(false)
  const leavePrompt = useUnsavedChanges(dirty || formsDirty, { onSave: dirty && !formsDirty ? () => save.mutateAsync() : undefined, saving: save.isPending, what: formsDirty ? 'this form' : 'settings' })
  const goTab = (id: TabId) => {
    if (formsDirty && tab === 'forms' && id !== 'forms' && !window.confirm('Discard your unsaved changes to this form?')) return
    setParams(id === tabs[0].id ? {} : { tab: id }, { replace: true })
  }

  // ---------------------------------------------------------------- render
  if (!isOwner) {
    // the platform's finance team (accountant access) also gets Plan & wallet
    const showPlan = planTab && params.get('tab') === 'plan'
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Settings" description="Your account and access. Hospital-wide settings are managed by the owner." />
        {planTab && (
          <div className="mb-5"><Segmented value={showPlan ? 'plan' : 'account'} onChange={(v) => setParams(v === 'plan' ? { tab: 'plan' } : {}, { replace: true })}
            options={[{ value: 'account', label: 'My account' }, { value: 'plan', label: 'Plan & wallet' }]} /></div>
        )}
        {showPlan ? <PlanTab /> : <AccountTab />}
      </div>
    )
  }

  const ready = !!site && !!app
  const ctx: TabCtx | null = ready ? { site: site!, app: app!, savedApp, editSite, editApp, dirty } : null
  const current = tabs.find((t) => t.id === tab)!
  return (
    <div className="w-full">
      {leavePrompt}
      <PageHeader title="Settings" description={TABS.some((t) => t.module && locked(t.module))
        ? `Hospital-wide preferences. Some settings (brand, website, messaging…) are managed for you by ${platformName}.`
        : 'Brand, appearance, dashboards, messaging credentials and hospital-wide preferences.'} />
      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => goTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} ref={tab === t.id ? activeTab : undefined}
              className={cn('group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition lg:py-2.5',
                tab === t.id ? 'bg-white text-brand-900 shadow-sm ring-1 ring-brand-100' : 'text-slate-600 hover:bg-white/70 hover:text-brand-900')}>
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg transition', tab === t.id ? 'bg-brand-900 text-white' : 'bg-brand-50 text-brand-700 group-hover:bg-brand-100')}><t.icon className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-sm font-medium">{t.label}</span>
                <span className="hidden truncate text-[11px] text-slate-400 lg:block">{t.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 pb-24">
          <h2 className="sr-only">{current.label}</h2>
          {tab === 'forms' ? <FormsTab onDirty={setFormsDirty} /> : tab === 'users' ? <UsersTab /> : tab === 'domain' ? <DomainTab /> : tab === 'plan' ? <PlanTab /> : !ctx && tab !== 'account' ? (
            <div className="space-y-4" aria-busy="true"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>
          ) : (
            <>
              {tab === 'general' && <GeneralTab ctx={ctx!} />}
              {tab === 'appearance' && <AppearanceTab ctx={ctx!} />}
              {tab === 'dashboard' && <DashboardTab ctx={ctx!} />}
              {tab === 'notifications' && <NotificationsTab ctx={ctx!} />}
              {tab === 'billing' && <BillingTab ctx={ctx!} />}
              {tab === 'security' && <SecurityTab ctx={ctx!} />}
              {tab === 'data' && <DataTab ctx={ctx!} />}
              {tab === 'account' && <AccountTab />}
            </>
          )}
        </div>
      </div>

      {/* sticky save bar */}
      <div className={cn('pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 transition-all duration-300 lg:pl-64', dirty ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-6 opacity-0')} aria-hidden={!dirty}>
        <div role="region" aria-label="Unsaved changes" className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl bg-brand-950 px-4 py-3 text-white shadow-2xl ring-1 ring-white/10">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" /></span>
          <p className="min-w-0 flex-1 text-sm">Unsaved changes<span className="hidden text-white/50 sm:inline"> · {[siteDirty && 'brand & site', appDirty && 'app settings'].filter(Boolean).join(' + ')} · Ctrl+S</span></p>
          <Button variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" icon={<Undo2 className="h-4 w-4" />} onClick={discard} disabled={save.isPending} tabIndex={dirty ? 0 : -1}>Discard</Button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} tabIndex={dirty ? 0 : -1}
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3.5 text-xs font-semibold text-brand-950 shadow-sm transition hover:bg-brand-50 active:scale-[.98] disabled:opacity-60">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save changes</button>
        </div>
      </div>
    </div>
  )
}

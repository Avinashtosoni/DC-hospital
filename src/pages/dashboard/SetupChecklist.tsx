import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Circle, HelpCircle, PartyPopper, Rocket, Send, X } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { Button, Card, Field, Modal, Textarea } from '../../components/ui'
import { useCount } from '../../hooks/useData'
import { cn } from '../../lib/utils'
import { useSiteSettings } from '../../site/cms/content'
import { isPrimaryTenant, siteTenant, tenancyEnabled } from '../../tenancy/state'
import { ONBOARDING_QK, loadOnboardingProgress, requestOnboardingHelp, saveOnboardingProgress, type OnboardingProgress } from './onboarding'

/** setup steps are derived from real tenant records, except for the two explicitly reviewed by the owner */
export interface SetupStep { id: string; title: string; hint: string; to: string; done: boolean; manual?: boolean; optional?: boolean }

export function setupSteps(x: { details: boolean; doctors: number; team: number; appointments: number; plan: boolean; ticked: Record<string, boolean> }): SetupStep[] {
  return [
    { id: 'details', title: 'Add your hospital’s address and phone', hint: 'Shown on the website, prescriptions, bills and messages.', to: '/settings', done: x.details },
    { id: 'doctors', title: 'Add your doctors', hint: 'With their departments, fees and consultation hours.', to: '/doctors', done: x.doctors > 0 },
    { id: 'team', title: 'Invite your team', hint: 'Reception, accounts and staff get their own sign-in with the right access.', to: '/users', done: x.team > 0 },
    { id: 'appointment', title: 'Book a first appointment', hint: 'Try the flow end to end — the patient gets a confirmation.', to: '/appointments', done: x.appointments > 0 },
    { id: 'website', title: 'Review your hospital website', hint: 'Edit your brand, text, photos, services and custom pages.', to: '/cms', done: !!x.ticked.website, manual: true },
    { id: 'domain', title: 'Connect your own domain (optional)', hint: 'For example, www.yourhospital.in — SSL is included.', to: '/settings?tab=domain', done: !!x.ticked.domain, manual: true, optional: true },
    { id: 'plan', title: 'Choose a plan before the trial ends', hint: 'UPI, cards or net banking with a GST invoice. Nothing is deleted if you wait.', to: '/billing', done: x.plan },
  ]
}

const EMPTY_STEPS: string[] = []
type ProgressPatch = { completed: string[]; consent?: boolean }
const sameSteps = (a: string[], b: string[]) => [...a].sort().join('|') === [...b].sort().join('|')
const CURRENT_TITLE: Record<string, string> = {
  account: 'Create your owner account', details: 'Add hospital details', doctors: 'Add your doctors', team: 'Invite your team',
  appointment: 'Book a first appointment', website: 'Review your website', domain: 'Connect a domain (optional)', plan: 'Choose a plan', complete: 'All required setup steps are complete',
}

/** Tenant-owned dashboard checklist with backend-persisted steps, optional follow-up consent and an admin-help request. */
export function SetupChecklist() {
  const { user, context } = useAuth()
  const qc = useQueryClient()
  const site = useSiteSettings()
  const tenantId = siteTenant()?.id ?? context?.tenant?.id ?? ''
  const show = tenancyEnabled() && !isPrimaryTenant() && user?.role === 'owner'
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(`dch:setup:hidden:${tenantId}`) === '1' } catch { return false } })
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpText, setHelpText] = useState('')
  const [saveRetry, setSaveRetry] = useState<ProgressPatch | null>(null)
  const syncKey = useRef('')
  const progress = useQuery({ queryKey: [...ONBOARDING_QK, tenantId], queryFn: loadOnboardingProgress, enabled: show && !!tenantId, staleTime: 30_000 })
  const doctors = useCount('doctors', [], { enabled: show })
  const team = useCount('profiles', [['role', 'nin', ['owner', 'patient']]], { enabled: show })
  const invites = useCount('staff_invites', [], { enabled: show })
  const appointments = useCount('appointments', [], { enabled: show })
  const { mutate: updateProgress, isPending: updatePending } = useMutation({
    mutationFn: ({ completed, consent }: ProgressPatch) => saveOnboardingProgress(completed, consent),
    onSuccess: (v) => {
      qc.setQueryData<OnboardingProgress>([...ONBOARDING_QK, tenantId], v)
      setSaveRetry(null)
    },
    onError: (e, patch) => {
      setSaveRetry(patch)
      toast.error('Could not save setup progress', { description: (e as Error).message })
    },
  })
  const help = useMutation({
    mutationFn: () => requestOnboardingHelp(helpText.trim()),
    onSuccess: () => { setHelpOpen(false); setHelpText(''); toast.success('Your help request was sent to the Hospital Comrade team.') },
    onError: (e) => toast.error('Could not contact support', { description: (e as Error).message }),
  })
  const completed = progress.data?.completed_steps ?? EMPTY_STEPS
  const steps = useMemo(() => setupSteps({
    details: !!site.address?.trim() && !!site.phone?.trim(), doctors: doctors.count ?? 0, team: (team.count ?? 0) + (invites.count ?? 0),
    appointments: appointments.count ?? 0, plan: context?.license?.status === 'active',
    ticked: { website: completed.includes('website'), domain: completed.includes('domain') },
  }), [site.address, site.phone, doctors.count, team.count, invites.count, appointments.count, context?.license?.status, completed])
  const observed = useMemo(() => ['account', ...steps.filter((s) => s.done).map((s) => s.id)], [steps])

  // Persist facts automatically as the owner fills in the hospital. Manual website/domain acknowledgements
  // use the same RPC; consent is not changed by this background sync.
  useEffect(() => {
    if (!show || !progress.data || updatePending || sameSteps(observed, progress.data.completed_steps)) return
    const signature = `${tenantId}:${observed.slice().sort().join('|')}`
    if (syncKey.current === signature) return
    syncKey.current = signature
    updateProgress({ completed: observed })
  }, [show, tenantId, progress.data, updatePending, updateProgress, observed])

  if (!show || hidden || !progress.data || progress.isLoading || [doctors, team, invites, appointments].some((c) => c.isLoading)) return null
  const required = steps.filter((s) => !s.optional)
  const doneCount = required.filter((s) => s.done).length
  const all = doneCount === required.length
  const pct = Math.round((doneCount / required.length) * 100)
  const nextTitle = CURRENT_TITLE[progress.data.current_step] ?? 'Continue setup'

  const toggleManual = (step: SetupStep) => {
    const next = new Set(completed)
    if (step.done) next.delete(step.id); else next.add(step.id)
    if (!next.has('account')) next.add('account')
    updateProgress({ completed: [...next] })
  }
  const setConsent = (value: boolean) => updateProgress({ completed, consent: value })
  const dismiss = () => {
    setHidden(true)
    try { localStorage.setItem(`dch:setup:hidden:${tenantId}`, '1') } catch { /* private mode */ }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#CCCCFF]/50 to-white px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-900 text-white">{all ? <PartyPopper className="h-5 w-5" /> : <Rocket className="h-5 w-5" />}</span>
            <div>
              <h2 className="font-display text-base font-semibold text-brand-950">{all ? 'Your hospital is all set up' : 'Set up your hospital'}</h2>
              <p className="text-xs text-slate-600">{doneCount} of {required.length} required steps done · Next: {nextTitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-white ring-1 ring-brand-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
              <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <button type="button" onClick={dismiss} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800" aria-label="Hide the setup checklist" title="Hide"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <ul className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-5 py-3 md:border-b md:border-slate-100">
              <button type="button" disabled={!s.manual || updatePending} onClick={() => toggleManual(s)}
                aria-label={s.manual ? (s.done ? `Mark “${s.title}” as not done` : `Mark “${s.title}” as done`) : undefined} className={cn('mt-0.5 shrink-0', s.manual && !updatePending && 'cursor-pointer')}>
                {s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', s.done ? 'text-slate-400 line-through' : 'text-brand-950')}>{s.title}{s.optional && <span className="ml-1 text-[10px] font-normal text-slate-400">optional</span>}</p>
                <p className="text-xs text-slate-500">{s.hint}</p>
              </div>
              {!s.done && <Link to={s.to} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">Open<ArrowRight className="h-3 w-3" /></Link>}
            </li>
          ))}
        </ul>
        {saveRetry && <div role="alert" className="flex flex-col gap-3 border-t border-rose-100 bg-rose-50/70 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-rose-800">Setup progress could not be saved. Your hospital records are safe; retry to sync the checklist.</p>
          <Button size="sm" variant="outline" loading={updatePending} onClick={() => updateProgress(saveRetry)}>Retry save</Button>
        </div>}
        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex max-w-3xl cursor-pointer items-start gap-2.5 text-xs text-slate-600">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#5C5C99]" checked={progress.data.followup_consent} disabled={updatePending} onChange={(e) => setConsent(e.target.checked)} />
            <span><b className="text-brand-900">Optional setup follow-ups.</b> I agree to receive setup help via WhatsApp, e-mail or browser push where the channel and contact are available. You can withdraw consent here at any time; in-app setup reminders may still appear.</span>
          </label>
          <Button size="sm" variant="outline" icon={<HelpCircle className="h-4 w-4" />} onClick={() => setHelpOpen(true)}>Contact an admin</Button>
        </div>
      </Card>
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Ask the Hospital Comrade team for help"
        footer={<><Button variant="ghost" onClick={() => setHelpOpen(false)}>Cancel</Button><Button icon={<Send className="h-4 w-4" />} loading={help.isPending} disabled={helpText.trim().length < 5} onClick={() => help.mutate()}>Send request</Button></>}>
        <p className="text-sm text-slate-600">Tell us which setup step is blocked. Your request is sent to a platform admin; this does not opt you into WhatsApp, e-mail or push reminders.</p>
        <Field label="What do you need help with?" className="mt-3"><Textarea rows={5} maxLength={2000} value={helpText} onChange={(e) => setHelpText(e.target.value)} placeholder="For example, I need help adding our doctors and setting consultation hours." /></Field>
        <p className="mt-1 text-right text-xs text-slate-400">{helpText.length}/2,000</p>
      </Modal>
    </>
  )
}

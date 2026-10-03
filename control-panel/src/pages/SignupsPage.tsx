import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Mail, MapPin, Phone, Save, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Tabs, Textarea } from '../../../src/components/ui'
import { platformDomain } from '../../../src/lib/supabase'
import { cn } from '../../../src/lib/utils'
import { cp, friendly } from '../api'
import type { CpSignup, SignupSettings, SignupStatus } from '../types'
import { appUrl, dateTime, ErrorBox, planLabel, Section } from '../ui'

const TONE: Record<SignupStatus, 'amber' | 'green' | 'slate' | 'red'> = { pending: 'amber', created: 'green', rejected: 'red', expired: 'slate' }
const LABEL: Record<SignupStatus, string> = { pending: 'Waiting', created: 'Hospital created', rejected: 'Rejected', expired: 'Expired' }

/** phase 8.2 — free-trial requests from the product site's /signup, and how sign-up works */
export function SignupsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'all' | SignupStatus>('pending')
  const [rejecting, setRejecting] = useState<CpSignup | null>(null)
  const [reason, setReason] = useState('')
  const q = useQuery({ queryKey: ['cp-signups'], queryFn: () => cp.signups() })
  const decide = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) => cp.decideSignup(id, action, reason),
    onSuccess: (r, v) => {
      qc.setQueryData<CpSignup[]>(['cp-signups'], (l) => l?.map((x) => (x.id === r.id ? { ...x, ...r } : x)))
      qc.invalidateQueries({ queryKey: ['cp-signups'] })
      qc.invalidateQueries({ queryKey: ['cp-signup-settings'] })
      if (v.action === 'approve') { qc.invalidateQueries({ queryKey: ['cp-hospitals'] }); qc.invalidateQueries({ queryKey: ['cp-overview'] }) }
      toast.success(v.action === 'approve' ? `${r.organisation} is ready — the welcome e-mail is on its way` : 'Request rejected')
      setRejecting(null); setReason('')
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const all = q.data ?? []
  const rows = tab === 'all' ? all : all.filter((x) => x.status === tab)
  const count = (s: SignupStatus) => all.filter((x) => x.status === s).length

  return (
    <>
      <PageHeader title="Free-trial sign-ups" description="Hospitals that started a free trial on the product website — approve them here when sign-up is set to “Review first”." />
      <SignupSettingsCard />
      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'pending', label: 'Waiting', count: count('pending') }, { value: 'created', label: 'Created', count: count('created') },
          { value: 'rejected', label: 'Rejected', count: count('rejected') }, { value: 'expired', label: 'Expired', count: count('expired') }, { value: 'all', label: 'All', count: all.length }]} />
      </div>
      <div className="mt-4">
        {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
        {q.isLoading ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
          : !rows.length ? <Card><EmptyState icon={<UserPlus className="h-6 w-6" />} title={tab === 'pending' ? 'Nothing waiting' : 'No sign-ups here'} description="New free-trial requests from the product website’s /signup page appear in “Waiting”." /></Card>
          : (
            <div className="grid gap-4 md:grid-cols-2">
              {rows.map((s) => (
                <Card key={s.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-brand-950">{s.organisation}</p>
                      <p className="text-sm text-slate-600">{s.contact_name} · <span className="font-medium">{planLabel(s.plan)}</span> trial, {s.trial_days} days</p>
                    </div>
                    <Badge tone={TONE[s.status]}>{LABEL[s.status]}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-800"><Mail className="h-3.5 w-3.5" />{s.email}</a>
                    <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-800"><Phone className="h-3.5 w-3.5" />{s.phone}</a>
                    {s.city && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{s.city}</span>}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Short name <span className="font-mono">{s.hospital_slug ?? s.slug}</span> · prefix <span className="font-mono">{s.code}</span> · accepted Terms {s.terms_version}</p>
                  {s.reason && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{s.reason}</p>}
                  {s.status === 'pending' ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button icon={<Check className="h-4 w-4" />} loading={decide.isPending && decide.variables?.id === s.id && decide.variables.action === 'approve'} disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: s.id, action: 'approve' })}>Approve &amp; create</Button>
                      <Button variant="ghost" icon={<X className="h-4 w-4" />} disabled={decide.isPending} onClick={() => { setRejecting(s); setReason('') }}>Reject</Button>
                    </div>
                  ) : s.status === 'created' && s.hospital_id ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                      <Link to={`/hospitals/${s.hospital_id}`} className="font-semibold text-brand-700 hover:underline">Open in the panel</Link>
                      <a href={appUrl({ slug: s.hospital_slug ?? s.slug, domain: null })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-600 hover:text-brand-800">Hospital app<ExternalLink className="h-3.5 w-3.5" /></a>
                      <Badge tone={s.owner_joined ? 'green' : 'amber'}>{s.owner_joined ? 'Owner signed up' : 'Owner not signed up yet'}</Badge>
                    </div>
                  ) : null}
                  <p className="mt-3 text-xs text-slate-400">{dateTime(s.created_at)}{s.decided_at && ` · ${s.status === 'rejected' ? 'rejected' : 'decided'} ${dateTime(s.decided_at)}${s.decided_by_name ? ` by ${s.decided_by_name}` : ''}`}</p>
                </Card>
              ))}
            </div>
          )}
      </div>
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.organisation ?? ''}?`}
        footer={<><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" loading={decide.isPending} onClick={() => rejecting && decide.mutate({ id: rejecting.id, action: 'reject', reason })}>Reject</Button></>}>
        <p className="text-sm text-slate-600">No hospital is created and no e-mail is sent. The note is only for your team.</p>
        <Field label="Note (optional)" className="mt-3"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Not a hospital, duplicate, spam" /></Field>
      </Modal>
    </>
  )
}

function SignupSettingsCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-signup-settings'], queryFn: () => cp.signupSettings() })
  const [f, setF] = useState<SignupSettings | null>(null)
  useEffect(() => {
    if (q.data) setF({ ...q.data, platformUrl: q.data.platformUrl || (platformDomain ? `https://${platformDomain}` : '') })
  }, [q.data])
  const save = useMutation({
    mutationFn: (s: SignupSettings) => cp.saveSignupSettings({ enabled: s.enabled, mode: s.mode, trialDays: Number(s.trialDays), plan: s.plan,
      maxPerDay: Number(s.maxPerDay), unclaimedDays: Number(s.unclaimedDays), platformUrl: s.platformUrl.trim().replace(/\/+$/, '') }),
    onSuccess: (s) => { qc.setQueryData(['cp-signup-settings'], s); toast.success('Sign-up settings saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!f) return <Skeleton className="h-48" />
  const set = <K extends keyof SignupSettings>(k: K, v: SignupSettings[K]) => setF((x) => (x ? { ...x, [k]: v } : x))
  const signupUrl = `${f.platformUrl || (platformDomain ? `https://${platformDomain}` : location.origin)}/signup`
  return (
    <Section title="How sign-up works" subtitle={<>The form lives at <a href={signupUrl} target="_blank" rel="noreferrer" className="font-mono text-brand-700 hover:underline">{signupUrl}</a></>}
      action={<Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate(f)}>Save</Button>}>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Online sign-up</p>
          <Choice active={f.enabled} onClick={() => set('enabled', true)} title="Open" text="Anyone can start a free trial." />
          <Choice active={!f.enabled} onClick={() => set('enabled', false)} title="Closed" text="The page asks people to use the contact form." />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">New requests</p>
          <Choice active={f.mode === 'approve'} onClick={() => set('mode', 'approve')} title="Review first" text="You approve each one here; then the hospital is created and e-mailed." />
          <Choice active={f.mode === 'instant'} onClick={() => set('mode', 'instant')} title="Create instantly" text="The hospital is created the moment the form is sent." />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <Field label="Free trial (days)" hint="1–90 · existing trials keep their date; extend one from its Plan & billing"><Input type="number" min={1} max={90} value={f.trialDays} onChange={(e) => set('trialDays', Number(e.target.value))} /></Field>
          <Field label="Plan picked by default"><Select value={f.plan} onChange={(e) => set('plan', e.target.value)}>{['clinic', 'hospital', 'enterprise'].map((p) => <option key={p} value={p}>{planLabel(p)}</option>)}</Select></Field>
        </div>
      </div>
      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
        <Field label="Sign-ups per day (all visitors)" hint="Spam brake · 1–1000"><Input type="number" min={1} max={1000} value={f.maxPerDay} onChange={(e) => set('maxPerDay', Number(e.target.value))} /></Field>
        <Field label="Close unclaimed trials after (days)" hint="If the owner never signs up · 3–90, then the normal 7-day notice"><Input type="number" min={3} max={90} value={f.unclaimedDays} onChange={(e) => set('unclaimedDays', Number(e.target.value))} /></Field>
        <Field label="Product website address" hint="Used for the link in the welcome e-mail"><Input value={f.platformUrl} onChange={(e) => set('platformUrl', e.target.value)} placeholder={`https://${platformDomain || 'your-domain.in'}`} /></Field>
      </div>
    </Section>
  )
}

function Choice({ active, onClick, title, text }: { active: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('block w-full rounded-xl border px-3 py-2.5 text-left transition', active ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-brand-300')}>
      <span className="block text-sm font-semibold text-brand-950">{title}</span>
      <span className="block text-xs text-slate-500">{text}</span>
    </button>
  )
}

import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eraser, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, PageHeader, Skeleton, Tabs } from '../../../src/components/ui'
import { cp, friendly } from '../api'
import { RETENTION_KEYS, RETENTION_MIN, type RetentionKey } from '../types'
import { dateTime, ErrorBox, Section } from '../ui'
import { IntegrationsTab } from './settings/IntegrationsTab'
import { SecurityTab } from './settings/SecurityTab'
import { DemoTab } from './settings/DemoTab'

type SettingsTab = 'integrations' | 'security' | 'demo' | 'retention'
const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [{ value: 'integrations', label: 'Integrations' }, { value: 'security', label: 'Security' }, { value: 'demo', label: 'Demo hospital' }, { value: 'retention', label: 'Data retention' }]

/** Platform settings: the platform's own accounts, team sign-in, the demo hospital and data retention.
 *  Plans, prices and billing rules have their own page: Plans & billing (/plans). */
export function SettingsPage() {
  const [sp, setSp] = useSearchParams()
  // old links (Plans & billing used to be the first tab here)
  if (sp.get('tab') === 'billing') return <Navigate to="/plans" replace />
  const tab: SettingsTab = (['integrations', 'security', 'demo', 'retention'] as const).find((x) => x === sp.get('tab')) ?? 'integrations'
  const tabs = <div className="mb-5"><Tabs tabs={SETTINGS_TABS} value={tab} onChange={(v) => setSp(v === 'integrations' ? {} : { tab: v }, { replace: true })} /></div>
  if (tab === 'demo') return (
    <>
      <PageHeader title="Platform settings" description="The public demo hospital: codes, messages, one-click sign-ins and the nightly reset." />
      {tabs}
      <DemoTab />
    </>
  )
  if (tab === 'security') return (
    <>
      <PageHeader title="Platform settings" description="Sign-in protection for your own team." />
      {tabs}
      <SecurityTab />
    </>
  )
  if (tab === 'retention') return (
    <>
      <PageHeader title="Platform settings" description="How long logs and leftovers are kept before the nightly clean-up deletes them." />
      {tabs}
      <RetentionSection />
    </>
  )
  return (
    <>
      <PageHeader title="Platform settings" description="Your own accounts: Razorpay for hospital payments, and the shared SMS, WhatsApp, e-mail and push accounts. Status, checks, test sends and keys."
        actions={<Link to="/plans" className="text-sm font-medium text-brand-700 hover:underline">Plans, prices & billing rules →</Link>} />
      {tabs}
      <IntegrationsTab />
    </>
  )
}

const RETENTION_LABEL: Record<RetentionKey, [string, string]> = {
  auditDays: ['Hospital audit logs', 'Who changed what in each hospital'],
  providerAuditDays: ['Control panel log', 'What your team did'],
  outboxDays: ['Sent messages', 'SMS / WhatsApp / e-mail delivery records'],
  otpDays: ['One-time codes', 'Booking and password-reset codes'],
  enquiryDays: ['Website enquiries', 'Only resolved or spam ones'],
  leadDays: ['Sales leads', 'Only won or lost ones'],
  privacyDays: ['Answered privacy requests', 'Kept as proof you answered'],
  waSessionDays: ['WhatsApp bot chats', 'Unfinished booking conversations'],
}

/** phase 7.6: how long logs and leftovers are kept; the dch-retention job deletes older rows every night (03:00 IST) */
function RetentionSection() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-retention'], queryFn: () => cp.retention() })
  const [f, setF] = useState<Record<RetentionKey, number> | null>(null)
  useEffect(() => { if (q.data) setF(Object.fromEntries(RETENTION_KEYS.map((k) => [k, q.data[k] ?? RETENTION_MIN[k]])) as Record<RetentionKey, number>) }, [q.data])
  const save = useMutation({
    mutationFn: () => cp.saveRetention(f!),
    onSuccess: (c) => { qc.setQueryData(['cp-retention'], c); toast.success('Retention saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  const run = useMutation({
    mutationFn: () => cp.runRetention(),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['cp-retention'] }); qc.invalidateQueries({ queryKey: ['cp-health'] }); toast.success(`Clean-up done — ${Object.values(r).reduce((a, b) => a + b, 0)} old rows deleted`) },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <div><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
  const dirty = !!f && !!q.data && RETENTION_KEYS.some((k) => f[k] !== q.data[k])
  const last = q.data?.last_run
  return (
    <Section title="Data retention" subtitle="Older rows are deleted every night. Patient records, bills and prescriptions are never deleted by this — only logs and leftovers."
      action={<div className="flex gap-2">
        <Button size="sm" variant="outline" icon={<Eraser className="h-3.5 w-3.5" />} loading={run.isPending} onClick={() => run.mutate()}>Run now</Button>
        <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>}>
      {!f ? <Skeleton className="h-32" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {RETENTION_KEYS.map((k) => (
              <Field key={k} label={`${RETENTION_LABEL[k][0]} (days)`} hint={`${RETENTION_LABEL[k][1]} · min ${RETENTION_MIN[k]}`}>
                <Input type="number" min={RETENTION_MIN[k]} max={3650} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">{last ? <>Last run {dateTime(last.at)}: {Object.entries(last.deleted).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`).join(', ') || 'nothing to delete'}.</> : 'Not run yet.'}</p>
        </>
      )}
    </Section>
  )
}

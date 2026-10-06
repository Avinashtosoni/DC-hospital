import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, CalendarPlus, DoorClosed, ExternalLink, Globe, IndianRupee, LogIn, Play, Receipt, RotateCcw, Save, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, Tabs, Textarea } from '../../../src/components/ui'
import { PLANS } from '../../../src/platform/plans'
import { cp, friendly } from '../api'
import type { BillingAction, CpHospitalDetail, ModuleMap } from '../types'
import { appUrl, canBill, date, dateTime, ErrorBox, inr, isAdmin, LicenseBadge, licenseLine, paise, planLabel, ROLE_LABEL, ROLE_TONE, Section, useMe } from '../ui'
import { ModuleGrid } from './HospitalsPage'
import { AuditList } from './AuditPage'
import { DetailsTab } from './hospital/DetailsTab'
import { UsersTab } from './hospital/UsersTab'
import { DataTab, openAsAdmin } from './hospital/DataTab'
import { MessagingTab } from './hospital/MessagingTab'
import { DomainsTab } from './hospital/DomainsTab'
import { SecurityTab } from './hospital/SecurityTab'
import { CreditNoteModal, CreditNotesSection, InvoiceActions, WalletLedgerSection } from './hospital/BillingExtras'

type Tab = 'overview' | 'details' | 'users' | 'data' | 'messaging' | 'security' | 'domains' | 'billing' | 'settings' | 'activity'

export function HospitalPage() {
  const { id = '' } = useParams()
  const { me } = useMe()
  const [tab, setTab] = useState<Tab>('overview')
  const q = useQuery({ queryKey: ['cp-hospital', id], queryFn: () => cp.hospital(id) })
  const h = q.data

  const tabs: { value: Tab; label: string }[] = [{ value: 'overview', label: 'Overview' }, { value: 'details', label: 'Details' }]
  if (me.role !== 'finance') tabs.push({ value: 'users', label: 'Users' })
  tabs.push({ value: 'data', label: 'Data' }, { value: 'messaging', label: 'Messaging' })
  if (me.role === 'admin' || me.role === 'support') tabs.push({ value: 'security', label: 'Security' })
  if (isAdmin(me.role)) tabs.push({ value: 'domains', label: 'Domains' })
  if (canBill(me.role) || me.role === 'support') tabs.push({ value: 'billing', label: canBill(me.role) ? 'Plan & billing' : 'Plan' })
  if (isAdmin(me.role)) tabs.push({ value: 'settings', label: 'Settings' }, { value: 'activity', label: 'Activity' })

  return (
    <>
      <Link to="/hospitals" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-900"><ArrowLeft className="h-4 w-4" /> Hospitals</Link>
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !h ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-64" /></div> : (
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight text-brand-950">{h.name}</h1>
                <LicenseBadge status={h.license.status} />
                {h.is_primary && <Badge tone="violet">Original install</Badge>}
                {h.closing_at && <Badge tone="red" dot>Closing</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{planLabel(h.plan)} · {licenseLine(h.license)} · prefix {h.code} · short name {h.slug}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {h.domain && <a href={appUrl(h)} target="_blank" rel="noreferrer"><Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Website</Button></a>}
              {me.role !== 'finance' && <a href={openAsAdmin(h)} target="_blank" rel="noopener" title="The hospital app with owner access, as you (logged)">
                <Button variant="outline" icon={<LogIn className="h-4 w-4" />}>Open as admin</Button></a>}
            </div>
          </div>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
          <div className="mt-5">
            {tab === 'overview' && <OverviewTab h={h} />}
            {tab === 'details' && <DetailsTab h={h} />}
            {tab === 'users' && <UsersTab h={h} />}
            {tab === 'data' && <DataTab h={h} />}
            {tab === 'messaging' && <MessagingTab h={h} />}
            {tab === 'security' && <SecurityTab h={h} />}
            {tab === 'domains' && <DomainsTab h={h} />}
            {tab === 'billing' && <BillingTab h={h} />}
            {tab === 'settings' && <SettingsTab h={h} />}
            {tab === 'activity' && <AuditList tenantId={h.id} />}
          </div>
        </>
      )}
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-4 py-2 text-sm"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-slate-800">{children}</span></div>
}

function OverviewTab({ h }: { h: CpHospitalDetail }) {
  const usage = (c: string) => Object.entries(h.usage).filter(([k]) => k.startsWith(`${c}:`)).reduce((a, [, n]) => a + n, 0)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Licence & plan">
        <div className="divide-y divide-slate-100">
          <Row label="Status"><LicenseBadge status={h.license.status} /></Row>
          <Row label="Plan">{planLabel(h.plan)} · {h.price ? `${inr(h.price)}/month` : 'custom price'}</Row>
          {h.license.trial_ends_at && <Row label="Trial ends">{date(h.license.trial_ends_at)}</Row>}
          {h.license.paid_until && <Row label="Paid until">{date(h.license.paid_until)}</Row>}
          {h.license.read_only_from && <Row label="Read-only from">{date(h.license.read_only_from)}</Row>}
          <Row label="Wallet">{paise(h.wallet_paise)}</Row>
          <Row label="Added">{date(h.created_at)}</Row>
        </div>
      </Section>
      <Section title="People">
        <div className="divide-y divide-slate-100">
          <Row label="Owner">{h.owner_email ?? '—'}</Row>
          <Row label="Owner signed up">{h.owner_joined ? 'Yes' : <span className="text-amber-700">Not yet</span>}</Row>
          <Row label="Staff accounts">{h.staff}</Row>
          <Row label="Patients">{h.patients.toLocaleString('en-IN')}</Row>
        </div>
        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Your team with access</p>
        <div className="flex flex-wrap gap-2">
          {h.team.map((m) => <Badge key={m.user_id} tone={ROLE_TONE[m.role]}>{m.name} · {ROLE_LABEL[m.role]}</Badge>)}
        </div>
      </Section>
      <Section title="Website addresses" subtitle="Add, verify and remove addresses in the hospital app → Settings → Domain (automatic SSL).">
        {!h.domains.length ? <p className="text-sm text-slate-500">No custom address yet — it opens at <code className="rounded bg-slate-100 px-1">?hospital={h.slug}</code>.</p> : (
          <ul className="space-y-2">
            {h.domains.map((d) => (
              <li key={d.domain} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <Globe className="h-4 w-4 text-brand-600" />
                <span className="flex-1 font-medium text-slate-800">{d.domain}</span>
                {d.is_primary && <Badge tone="violet">primary</Badge>}
                <Badge tone={d.status === 'active' ? 'green' : 'amber'}>{d.status ?? 'pending'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Messages this month" subtitle="Platform accounts count against the plan; extra messages are paid from the wallet.">
        <div className="grid grid-cols-3 gap-2 text-center">
          {(['whatsapp', 'sms', 'email'] as const).map((c) => (
            <div key={c} className="rounded-lg bg-brand-50/70 py-3">
              <p className="font-display text-xl font-bold text-brand-950">{usage(c).toLocaleString('en-IN')}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'E-mail'}</p>
            </div>
          ))}
        </div>
        {h.notes && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">Note:</span> {h.notes}</p>}
      </Section>
    </div>
  )
}

function useBilling(h: CpHospitalDetail) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ action, args }: { action: BillingAction; args: Record<string, unknown>; ok: string }) => cp.billing(h.id, action, args),
    onSuccess: (r, v) => {
      const inv = (r as { invoice_no?: string } | null)?.invoice_no
      toast.success(v.ok, inv ? { description: `Invoice ${inv}` } : undefined)
      for (const k of ['cp-hospital', 'cp-hospitals', 'cp-overview', 'cp-payments']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(friendly(e)),
  })
}

function BillingTab({ h }: { h: CpHospitalDetail }) {
  const { me } = useMe()
  const bill = useBilling(h)
  const [pay, setPay] = useState({ kind: 'plan', months: 1, amount: 1000, method: 'upi', reference: '' })
  const [adj, setAdj] = useState({ amount: '', note: '' })
  const [days, setDays] = useState(7)
  const [plan, setPlan] = useState({ plan: h.plan, price: h.billing && 'price' in h.billing ? String(h.billing.price ?? '') : '' })
  const [confirm, setConfirm] = useState<null | 'suspend' | 'resume'>(null)
  const busy = (a: BillingAction) => bill.isPending && bill.variables?.action === a
  useEffect(() => { setPlan({ plan: h.plan, price: h.billing && 'price' in h.billing ? String(h.billing.price ?? '') : '' }) }, [h.plan, h.billing])

  if (h.is_primary) return <EmptyState icon={<IndianRupee className="h-6 w-6" />} title="The original install is always active" description="It has no plan, trial or wallet." />
  if (!canBill(me.role)) {
    return <Section title="Plan">
      <div className="divide-y divide-slate-100"><Row label="Plan">{planLabel(h.plan)}</Row><Row label="Licence">{licenseLine(h.license)}</Row></div>
      <p className="mt-3 text-xs text-slate-500">Payments and wallet changes are handled by admins and finance.</p>
    </Section>
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Record a payment" subtitle="Paid by bank transfer, UPI, cash or cheque — creates a tax invoice and extends the plan / tops up the wallet.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="For"><Select value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value })}><option value="plan">Plan</option><option value="wallet">Wallet top-up</option></Select></Field>
            {pay.kind === 'plan'
              ? <Field label="Period"><Select value={pay.months} onChange={(e) => setPay({ ...pay, months: Number(e.target.value) })}><option value={1}>1 month</option><option value={12}>12 months (yearly price)</option></Select></Field>
              : <Field label="Amount (₹, before GST)"><Input type="number" min={1} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></Field>}
            <Field label="Paid by"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option></Select></Field>
            <Field label="Reference"><Input value={pay.reference} placeholder="UTR / cheque no." onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          </div>
          <Button className="mt-4" icon={<Receipt className="h-4 w-4" />} loading={busy('manual_payment')}
            onClick={() => bill.mutate({ action: 'manual_payment', args: pay.kind === 'plan' ? { kind: 'plan', months: pay.months, method: pay.method, reference: pay.reference } : { kind: 'wallet', amount: pay.amount, method: pay.method, reference: pay.reference }, ok: 'Payment recorded' })}>
            Record payment
          </Button>
        </Section>
        <Section title="Adjust wallet" subtitle={`Balance ${paise(h.wallet_paise)}. Goodwill credit or a correction — no invoice. Use a minus sign to deduct.`}>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Field label="Amount (₹)"><Input type="number" value={adj.amount} placeholder="e.g. 200 or -50" onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label="Why"><Input value={adj.note} placeholder="Shown in the hospital’s wallet history" onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
          </div>
          <Button className="mt-4" variant="secondary" icon={<Wallet className="h-4 w-4" />} loading={busy('wallet_adjust')} disabled={!adj.amount || !adj.note.trim()}
            onClick={() => bill.mutate({ action: 'wallet_adjust', args: { amount: Number(adj.amount), note: adj.note }, ok: 'Wallet adjusted' }, { onSuccess: () => setAdj({ amount: '', note: '' }) })}>
            Adjust wallet
          </Button>
        </Section>
      </div>

      {isAdmin(me.role) && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Plan & price">
            <Field label="Plan"><Select value={plan.plan} onChange={(e) => setPlan({ ...plan, plan: e.target.value })}>{PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Special price (₹/month)" hint="Blank = the plan’s normal price" className="mt-3"><Input type="number" min={0} value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} /></Field>
            <Button className="mt-4" variant="outline" icon={<Save className="h-4 w-4" />} loading={busy('set_plan')}
              onClick={() => bill.mutate({ action: 'set_plan', args: { plan: plan.plan, price: plan.price === '' ? null : Number(plan.price) }, ok: 'Plan saved' })}>Save plan</Button>
          </Section>
          <Section title="Extend trial" subtitle={h.license.trial_ends_at ? `Ends ${date(h.license.trial_ends_at)}` : 'No trial running'}>
            <Field label="Extra days"><Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
            <Button className="mt-4" variant="outline" icon={<CalendarPlus className="h-4 w-4" />} loading={busy('extend_trial')}
              onClick={() => bill.mutate({ action: 'extend_trial', args: { days }, ok: `Trial extended by ${days} days` })}>Extend trial</Button>
          </Section>
          <Section title={h.license.status === 'suspended' ? 'Suspended' : 'Suspend'} subtitle={h.license.status === 'suspended' ? 'The hospital can only read its data.' : 'Makes the hospital read-only right away, whatever it has paid.'}>
            {h.license.status === 'suspended'
              ? <Button icon={<Play className="h-4 w-4" />} loading={busy('resume')} onClick={() => setConfirm('resume')}>Resume hospital</Button>
              : <Button variant="danger" icon={<Ban className="h-4 w-4" />} loading={busy('suspend')} onClick={() => setConfirm('suspend')}>Suspend hospital</Button>}
          </Section>
        </div>
      )}

      <Section title="Payments" subtitle="Latest 20 · download the tax invoice or issue a credit note from the row">
        {!h.payments.length ? <p className="text-sm text-slate-500">No payments yet.</p> : <PaymentsTable rows={h.payments} />}
      </Section>
      <div className="grid gap-6 xl:grid-cols-2">
        <WalletLedgerSection tenantId={h.id} />
        <CreditNotesSection tenantId={h.id} />
      </div>

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} loading={bill.isPending}
        title={confirm === 'suspend' ? `Suspend ${h.name}?` : `Resume ${h.name}?`}
        description={confirm === 'suspend' ? 'Everyone at the hospital can still sign in and read, but nothing can be added or changed until you resume it.' : 'The hospital goes back to its normal licence (trial / paid dates).'}
        confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Resume'}
        onConfirm={() => bill.mutate({ action: confirm!, args: {}, ok: confirm === 'suspend' ? 'Hospital suspended' : 'Hospital resumed' }, { onSettled: () => setConfirm(null) })} />
    </div>
  )
}

type PaymentLine = CpHospitalDetail['payments'][number] & { hospital?: string; tenant_id?: string }
export function PaymentsTable({ rows, showHospital }: { rows: PaymentLine[]; showHospital?: boolean }) {
  const { me } = useMe()
  const [credit, setCredit] = useState<PaymentLine | null>(null)
  const actions = canBill(me.role)
  return (
    <div className="-mx-5 overflow-x-auto">
      <CreditNoteModal p={credit} onClose={() => setCredit(null)} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-5 py-2">Date</th>{showHospital && <th className="px-5 py-2">Hospital</th>}<th className="px-5 py-2">For</th><th className="px-5 py-2">Invoice</th><th className="px-5 py-2">Via</th><th className="px-5 py-2 text-right">Amount</th><th className="px-5 py-2">Status</th>{actions && <th className="px-5 py-2" />}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{dateTime(p.paid_at ?? p.created_at)}</td>
              {showHospital && <td className="px-5 py-2.5">{p.tenant_id ? <Link to={`/hospitals/${p.tenant_id}`} className="font-medium text-brand-900 hover:underline">{p.hospital}</Link> : p.hospital}</td>}
              <td className="px-5 py-2.5 text-slate-700">{p.kind === 'plan' ? `${planLabel(p.plan)} · ${p.months} mo` : 'Wallet top-up'}</td>
              <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-slate-600">{p.invoice_no ?? '—'}</td>
              <td className="px-5 py-2.5 text-slate-600">{p.provider === 'manual' ? `Manual · ${p.method ?? ''}` : `Razorpay${p.method ? ` · ${p.method}` : ''}`}</td>
              <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums font-medium text-slate-800">{paise(p.total_paise)}<p className="text-[11px] font-normal text-slate-400">incl. GST {paise(p.gst_paise)}</p></td>
              <td className="px-5 py-2.5"><Badge tone={p.status === 'paid' ? 'green' : p.status === 'failed' ? 'red' : 'slate'}>{p.status}</Badge></td>
              {actions && <td className="px-5 py-2.5"><InvoiceActions p={p} onCredit={setCredit} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SettingsTab({ h }: { h: CpHospitalDetail }) {
  const qc = useQueryClient()
  const [mods, setMods] = useState<ModuleMap>(h.modules ?? {})
  const [d, setD] = useState({ name: h.name, code: h.code, notes: h.notes ?? '', owner_email: h.owner_email ?? '' })
  useEffect(() => { setMods(h.modules ?? {}); setD({ name: h.name, code: h.code, notes: h.notes ?? '', owner_email: h.owner_email ?? '' }) }, [h])
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof cp.updateHospital>[1]) => cp.updateHospital(h.id, patch),
    onSuccess: () => { toast.success('Saved'); for (const k of ['cp-hospital', 'cp-hospitals']) qc.invalidateQueries({ queryKey: [k] }) },
    onError: (e) => toast.error(friendly(e)),
  })
  const modsDirty = JSON.stringify(mods) !== JSON.stringify(h.modules ?? {})

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="What the hospital may change" subtitle="Ticked settings are the hospital’s; the rest are managed by your team and hidden from them."
        action={<Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!modsDirty} loading={save.isPending && !!save.variables?.modules} onClick={() => save.mutate({ modules: mods })}>Save</Button>}>
        <ModuleGrid value={mods} onChange={setMods} />
      </Section>
      <Section title="Details">
        <div className="grid gap-3">
          <Field label="Hospital name"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Record prefix" hint="New patient numbers only — existing records keep theirs."><Input value={d.code} maxLength={6} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></Field>
          <Field label="Owner’s e-mail" hint={h.owner_joined ? 'The owner has signed up — change owners in the hospital app (Users & accounts).' : 'The first sign-up with this e-mail becomes the owner.'}>
            <Input type="email" value={d.owner_email} disabled={h.owner_joined} onChange={(e) => setD({ ...d, owner_email: e.target.value })} />
          </Field>
          <Field label="Internal notes"><Textarea rows={3} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        </div>
        <Button className="mt-4" icon={<Save className="h-4 w-4" />} loading={save.isPending && !save.variables?.modules}
          onClick={() => save.mutate({ name: d.name, code: d.code, notes: d.notes, ...(!h.owner_joined && d.owner_email !== (h.owner_email ?? '') ? { owner_email: d.owner_email } : {}) })}>Save details</Button>
      </Section>
      {!h.is_primary && <CloseSection h={h} />}
    </div>
  )
}

/**
 * Offboarding (phase 7.3): close → the hospital is read-only and the owner is e-mailed a notice period (7–90 days)
 * to download their data; reopen undoes it. After the notice period an admin can delete everything — typing the
 * short name and re-entering their password. GST invoices are kept (tombstone) as the law requires.
 */
function CloseSection({ h }: { h: CpHospitalDetail }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(30)
  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null)
  const [purge, setPurge] = useState<{ slug: string; password: string } | null>(null)
  const refresh = () => { for (const k of ['cp-hospital', 'cp-hospitals', 'cp-health', 'cp-overview']) qc.invalidateQueries({ queryKey: [k] }) }
  const act = useMutation({
    mutationFn: async (what: 'close' | 'reopen') => (what === 'close' ? cp.closeHospital(h.id, reason, days) : cp.reopenHospital(h.id)),
    onSuccess: (_r, what) => {
      setConfirm(null); refresh()
      toast.success(what === 'close' ? 'Hospital closed — the owner has been e-mailed' : 'Hospital reopened')
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const doPurge = useMutation({
    mutationFn: () => cp.purgeHospital(h.id, purge!.slug, purge!.password),
    onSuccess: (r) => {
      toast.success(`${h.name} was deleted`, { description: `${Object.values(r.counts).reduce((a, b) => a + b, 0).toLocaleString('en-IN')} records removed; GST invoices kept.` })
      qc.removeQueries({ queryKey: ['cp-hospital', h.id] }); refresh()
      nav('/hospitals', { replace: true })
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const canPurge = !!h.closing_at && !!h.purge_after && Date.parse(h.purge_after) <= Date.now()

  return (
    <Section className="lg:col-span-2 border-rose-100" title={<span className="flex items-center gap-2 text-rose-800"><DoorClosed className="h-4 w-4" />Close this hospital</span>}
      subtitle="For a hospital that is leaving. Nothing is deleted until the notice period is over.">
      {!h.closing_at ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <Field label="Reason (sent to the owner)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner asked to close the account" /></Field>
          <Field label="Days to download data"><Input type="number" min={7} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
          <Button variant="danger" icon={<DoorClosed className="h-4 w-4" />} disabled={reason.trim().length < 3 || days < 7 || days > 90} onClick={() => setConfirm('close')}>Close hospital</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
            Closed on <b>{dateTime(h.closing_at)}</b>{h.close_reason ? <> — “{h.close_reason}”</> : null}. The hospital is read-only; its owner can download everything
            from Settings → Data & backup until <b>{date(h.purge_after)}</b>.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('reopen')}>Reopen</Button>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} disabled={!canPurge} onClick={() => setPurge({ slug: '', password: '' })}>
              {canPurge ? 'Delete all data…' : `Delete possible from ${date(h.purge_after)}`}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} loading={act.isPending}
        title={confirm === 'close' ? `Close ${h.name}?` : `Reopen ${h.name}?`}
        description={confirm === 'close'
          ? `Everyone can still sign in and read, but nothing can be added or changed and online booking stops. The owner is e-mailed that all data will be deleted after ${days} days.`
          : 'The hospital goes back to its normal licence (trial / paid dates). Nothing was deleted.'}
        confirmLabel={confirm === 'close' ? 'Close hospital' : 'Reopen'}
        onConfirm={() => act.mutate(confirm!)} />

      <Modal open={!!purge} onClose={() => setPurge(null)} title={`Delete ${h.name} permanently?`}
        footer={<>
          <Button variant="ghost" onClick={() => setPurge(null)}>Cancel</Button>
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={doPurge.isPending} disabled={purge?.slug.trim().toLowerCase() !== h.slug || !purge?.password}
            onClick={() => doPurge.mutate()}>Delete everything</Button>
        </>}>
        <div className="space-y-3 text-sm text-slate-600">
          <p>Every patient, record, bill, message, user login and setting of this hospital is deleted. Only a tombstone (name, counts) and its paid Hospital Comrade invoices are kept for tax records. <b>This cannot be undone.</b></p>
          <Field label={`Type the short name: ${h.slug}`}><Input value={purge?.slug ?? ''} autoComplete="off" onChange={(e) => setPurge((p) => p && { ...p, slug: e.target.value })} /></Field>
          <Field label="Your password" hint="Confirms it is really you."><Input type="password" autoComplete="current-password" value={purge?.password ?? ''} onChange={(e) => setPurge((p) => p && { ...p, password: e.target.value })} /></Field>
        </div>
      </Modal>
    </Section>
  )
}

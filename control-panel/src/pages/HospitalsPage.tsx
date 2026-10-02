import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '../../../src/components/ui'
import { cn } from '../../../src/lib/utils'
import { PLANS } from '../../../src/platform/plans'
import { LOCKABLE_MODULES, MODULE_LABEL } from '../../../src/tenancy/moduleList'
import { cp, friendly } from '../api'
import type { ModuleMap, NewHospital } from '../types'
import { ErrorBox, isAdmin, LicenseBadge, licenseLine, paise, planLabel, STATUS, useMe } from '../ui'

export function HospitalsPage() {
  const { me } = useMe()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [adding, setAdding] = useState(false)
  const q = useQuery({ queryKey: ['cp-hospitals'], queryFn: () => cp.hospitals() })
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((h) => (!status || h.license.status === status)
      && (!s || [h.name, h.slug, h.domain, h.owner_email].some((v) => v?.toLowerCase().includes(s))))
  }, [q.data, search, status])

  return (
    <>
      <PageHeader title="Hospitals" description={isAdmin(me.role) ? 'Every hospital on the platform.' : 'Hospitals assigned to you.'}
        actions={isAdmin(me.role) && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add hospital</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, short name, domain or owner e-mail" className="pl-9" aria-label="Search hospitals" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48" aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <Card className="overflow-hidden">
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !rows.length ? <EmptyState icon={<Building2 className="h-6 w-6" />} title={q.data?.length ? 'No hospital matches' : 'No hospitals yet'}
              description={q.data?.length ? 'Try another search or status.' : 'Add the first hospital to get started.'} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">Hospital</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Licence</th><th className="px-4 py-3 text-right">Wallet</th><th className="hidden px-4 py-3 text-right md:table-cell">Staff · Patients</th><th className="hidden px-4 py-3 lg:table-cell">Owner</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((h) => (
                    <tr key={h.id} className="hover:bg-brand-50/40">
                      <td className="px-4 py-3">
                        <Link to={`/hospitals/${h.id}`} className="font-medium text-brand-900 hover:underline">{h.name}</Link>
                        <p className="text-xs text-slate-500">{h.domain ?? `?hospital=${h.slug}`}{h.is_primary && ' · original install'}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{planLabel(h.plan)}<p className="text-xs text-slate-500">{h.price ? `₹${h.price.toLocaleString('en-IN')}/mo` : 'custom price'}</p></td>
                      <td className="px-4 py-3"><LicenseBadge status={h.license.status} /><p className="mt-1 text-xs text-slate-500">{licenseLine(h.license)}</p></td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{paise(h.wallet_paise)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 md:table-cell">{h.staff} · {h.patients}</td>
                      <td className="hidden px-4 py-3 lg:table-cell"><p className="truncate text-slate-700">{h.owner_email ?? '—'}</p><p className="text-xs text-slate-500">{h.owner_joined ? 'signed up' : 'not signed up yet'}</p></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      <NewHospitalModal open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

const DEFAULT_MODULES: ModuleMap = { dashboard: 'hospital', forms: 'hospital', notifications: 'hospital', security: 'hospital' }
const blank = (): NewHospital => ({ slug: '', name: '', code: '', plan: 'clinic', owner_email: '', domain: '', status: 'trial', trial_days: 14, months: 12, modules: { ...DEFAULT_MODULES }, notes: '' })
const slugify = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
const codeFrom = (s: string) => (s.match(/[A-Za-z]+/g) ?? []).map((w) => w[0]).join('').toUpperCase().slice(0, 4).padEnd(2, 'X')

function NewHospitalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [f, setF] = useState<NewHospital>(blank)
  const [touched, setTouched] = useState({ slug: false, code: false })
  const set = <K extends keyof NewHospital>(k: K, v: NewHospital[K]) => setF((x) => ({ ...x, [k]: v }))
  const settings = useQuery({ queryKey: ['cp-settings'], queryFn: () => cp.settings(), enabled: open })
  const trialDefault = settings.data?.billing.trialDays

  const create = useMutation({
    mutationFn: () => cp.createHospital({ ...f, trial_days: f.trial_days || trialDefault || 14 }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cp-hospitals'] }); qc.invalidateQueries({ queryKey: ['cp-overview'] })
      toast.success(`${f.name} added`, { description: `The owner signs up with ${r.owner_email} on ${r.domain ?? `?hospital=${r.slug}`} and becomes its owner.` })
      setF(blank()); setTouched({ slug: false, code: false }); onClose()
      nav(`/hospitals/${r.id}`)
    },
    onError: (e) => toast.error(friendly(e)),
  })

  return (
    <Modal open={open} onClose={onClose} title="Add a hospital" size="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()} disabled={!f.name || !f.slug || !f.owner_email}>Create hospital</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hospital name" required className="sm:col-span-2">
          <Input id="nh-name" value={f.name} placeholder="e.g. Sunrise Multispeciality Hospital" onChange={(e) => {
            const name = e.target.value
            setF((x) => ({ ...x, name, slug: touched.slug ? x.slug : slugify(name), code: touched.code ? x.code : codeFrom(name) }))
          }} />
        </Field>
        <Field label="Short name" required hint="Used in ?hospital= links and internally. a-z, 0-9, -">
          <Input id="nh-slug" value={f.slug} onChange={(e) => { setTouched((t) => ({ ...t, slug: true })); set('slug', e.target.value.toLowerCase()) }} />
        </Field>
        <Field label="Record prefix" required hint="Patient numbers look like CCC-100001">
          <Input id="nh-code" value={f.code} maxLength={6} onChange={(e) => { setTouched((t) => ({ ...t, code: true })); set('code', e.target.value.toUpperCase().replace(/[^A-Z]/g, '')) }} />
        </Field>
        <Field label="Owner’s e-mail" required hint="The first sign-up with this e-mail on the hospital’s website becomes its owner.">
          <Input id="nh-owner" type="email" value={f.owner_email} onChange={(e) => set('owner_email', e.target.value)} />
        </Field>
        <Field label="Website address" hint="Optional. Their domain, e.g. sunrisehospital.in — point it here later (Domain settings in the app).">
          <Input id="nh-domain" value={f.domain} placeholder="sunrisehospital.in" onChange={(e) => set('domain', e.target.value)} />
        </Field>
        <Field label="Plan">
          <Select id="nh-plan" value={f.plan} onChange={(e) => set('plan', e.target.value)}>
            {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ₹${(settings.data?.billing.plans[p.id]?.price ?? p.price).toLocaleString('en-IN')}/mo` : ' — custom price'}</option>)}
          </Select>
        </Field>
        <Field label="Start with">
          <div className="flex gap-2">
            <Select id="nh-status" value={f.status} onChange={(e) => set('status', e.target.value as NewHospital['status'])} className="flex-1">
              <option value="trial">Free trial</option><option value="active">Paid (outside the app)</option>
            </Select>
            {f.status === 'trial'
              ? <Input aria-label="Trial days" type="number" min={1} max={90} value={f.trial_days} onChange={(e) => set('trial_days', Number(e.target.value))} className="w-24" />
              : <Select aria-label="Months paid" value={f.months} onChange={(e) => set('months', Number(e.target.value))} className="w-32">{[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}</Select>}
          </div>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium text-slate-700">Settings the hospital may change itself</p>
          <p className="mb-3 text-xs text-slate-500">Unticked = managed by your team and hidden from the hospital. Users, billing, booking and enquiries always stay with the owner.</p>
          <ModuleGrid value={f.modules} onChange={(m) => set('modules', m)} />
        </div>
        <Field label="Internal notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Only your team sees this" /></Field>
      </div>
    </Modal>
  )
}

export function ModuleGrid({ value, onChange, disabled }: { value: ModuleMap; onChange: (m: ModuleMap) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {LOCKABLE_MODULES.map((m) => {
        const on = value[m] === 'hospital'
        return (
          <label key={m} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition', on ? 'border-brand-300 bg-brand-50/70 text-brand-950' : 'border-slate-200 text-slate-600', disabled && 'cursor-not-allowed opacity-60')}>
            <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={on} disabled={disabled}
              onChange={() => onChange({ ...value, [m]: on ? 'provider' : 'hospital' })} />
            <span className="flex-1">{MODULE_LABEL[m]}</span>
            <span className="text-[11px] text-slate-400">{on ? 'hospital' : 'your team'}</span>
          </label>
        )
      })}
    </div>
  )
}

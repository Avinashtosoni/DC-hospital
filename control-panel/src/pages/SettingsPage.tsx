import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, PageHeader, Skeleton } from '../../../src/components/ui'
import { platformDomain, platformName } from '../../../src/lib/supabase'
import { PLANS } from '../../../src/platform/plans'
import { cp, friendly, isDemo } from '../api'
import type { BillingConfig } from '../types'
import { ErrorBox, Section } from '../ui'

type PlanId = keyof BillingConfig['plans']

export function SettingsPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-settings'], queryFn: () => cp.settings() })
  const [f, setF] = useState<BillingConfig | null>(null)
  useEffect(() => { if (q.data) setF(structuredClone(q.data.billing)) }, [q.data])
  const save = useMutation({
    mutationFn: (c: BillingConfig) => cp.saveBillingSettings({
      gstPercent: Number(c.gstPercent), trialDays: Number(c.trialDays), graceDays: Number(c.graceDays), yearlyMonths: Number(c.yearlyMonths),
      minTopup: Number(c.minTopup), maxTopup: Number(c.maxTopup),
      ratesPaise: { sms: Number(c.ratesPaise.sms), whatsapp: Number(c.ratesPaise.whatsapp), email: Number(c.ratesPaise.email) },
      plans: Object.fromEntries(Object.entries(c.plans).map(([k, v]) => [k, { price: v.price === null || String(v.price) === '' ? null : Number(v.price),
        included: { sms: Number(v.included.sms), whatsapp: Number(v.included.whatsapp), email: Number(v.included.email) } }])) as BillingConfig['plans'],
      seller: c.seller,
    }),
    onSuccess: (cfg) => { qc.setQueryData(['cp-settings'], { billing: cfg }); qc.invalidateQueries({ queryKey: ['cp-hospitals'] }); toast.success('Platform settings saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  const dirty = !!f && !!q.data && JSON.stringify(f) !== JSON.stringify(q.data.billing)

  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!f) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>
  const num = (v: number | string | null) => (v === null ? '' : String(v))
  const set = (patch: Partial<BillingConfig>) => setF({ ...f, ...patch })
  const setPlan = (id: PlanId, patch: Partial<BillingConfig['plans'][PlanId]>) => setF({ ...f, plans: { ...f.plans, [id]: { ...f.plans[id], ...patch } } })

  return (
    <>
      <PageHeader title="Platform settings" description="Prices and billing rules for every hospital. Changes apply right away (existing invoices don’t change)."
        actions={<Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(f)}>Save changes</Button>} />
      {isDemo && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Demo: saved in this browser for the control panel only — the demo hospitals keep the default prices.</p>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Plans" subtitle="Monthly price before GST, and messages included per month on the platform’s accounts.">
          <div className="space-y-4">
            {PLANS.map((p) => {
              const c = f.plans[p.id]
              return (
                <div key={p.id} className="rounded-xl border border-slate-100 p-3">
                  <p className="mb-2 text-sm font-semibold text-brand-950">{p.name}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="₹ / month"><Input type="number" min={0} placeholder="custom" value={num(c.price)} onChange={(e) => setPlan(p.id, { price: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
                    <Field label="WhatsApp"><Input type="number" min={0} value={c.included.whatsapp} onChange={(e) => setPlan(p.id, { included: { ...c.included, whatsapp: Number(e.target.value) } })} /></Field>
                    <Field label="SMS"><Input type="number" min={0} value={c.included.sms} onChange={(e) => setPlan(p.id, { included: { ...c.included, sms: Number(e.target.value) } })} /></Field>
                    <Field label="E-mail"><Input type="number" min={0} value={c.included.email} onChange={(e) => setPlan(p.id, { included: { ...c.included, email: Number(e.target.value) } })} /></Field>
                  </div>
                </div>
              )
            })}
            <p className="text-xs text-slate-500">The product website’s pricing section reads src/platform/plans.ts — keep it in step when you change prices.</p>
          </div>
        </Section>
        <div className="space-y-6">
          <Section title="Rules">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="GST %"><Input type="number" min={0} max={40} value={f.gstPercent} onChange={(e) => set({ gstPercent: Number(e.target.value) })} /></Field>
              <Field label="Free trial (days)"><Input type="number" min={0} max={90} value={f.trialDays} onChange={(e) => set({ trialDays: Number(e.target.value) })} /></Field>
              <Field label="Grace period (days)"><Input type="number" min={0} max={90} value={f.graceDays} onChange={(e) => set({ graceDays: Number(e.target.value) })} /></Field>
              <Field label="Yearly = months" hint="12 months cost this many"><Input type="number" min={1} max={12} value={f.yearlyMonths} onChange={(e) => set({ yearlyMonths: Number(e.target.value) })} /></Field>
              <Field label="Min top-up ₹"><Input type="number" min={0} value={f.minTopup} onChange={(e) => set({ minTopup: Number(e.target.value) })} /></Field>
              <Field label="Max top-up ₹"><Input type="number" min={0} value={f.maxTopup} onChange={(e) => set({ maxTopup: Number(e.target.value) })} /></Field>
            </div>
          </Section>
          <Section title="Extra messages" subtitle="Paise per message beyond the plan, taken from the hospital’s wallet.">
            <div className="grid grid-cols-3 gap-3">
              {(['whatsapp', 'sms', 'email'] as const).map((c) => (
                <Field key={c} label={c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'E-mail'}>
                  <Input type="number" min={0} max={1000} value={f.ratesPaise[c]} onChange={(e) => set({ ratesPaise: { ...f.ratesPaise, [c]: Number(e.target.value) } })} />
                </Field>
              ))}
            </div>
          </Section>
          <Section title="On your invoices" subtitle="The seller printed on every tax invoice.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name"><Input value={f.seller.name} onChange={(e) => set({ seller: { ...f.seller, name: e.target.value } })} /></Field>
              <Field label="GSTIN"><Input value={f.seller.gstin} onChange={(e) => set({ seller: { ...f.seller, gstin: e.target.value.toUpperCase() } })} /></Field>
              <Field label="Address" className="sm:col-span-2"><Input value={f.seller.address} onChange={(e) => set({ seller: { ...f.seller, address: e.target.value } })} /></Field>
              <Field label="State"><Input value={f.seller.state} onChange={(e) => set({ seller: { ...f.seller, state: e.target.value } })} /></Field>
              <Field label="Billing e-mail"><Input type="email" value={f.seller.email} onChange={(e) => set({ seller: { ...f.seller, email: e.target.value } })} /></Field>
            </div>
          </Section>
          <Section title="Brand & domain" subtitle="Set on the server (PLATFORM_NAME / PLATFORM_DOMAIN environment variables).">
            <p className="text-sm text-slate-700"><span className="font-medium">{platformName}</span> · {platformDomain}</p>
            <p className="mt-2 text-xs text-slate-500">Platform messaging accounts (SMS, WhatsApp, e-mail) are set as Edge Function secrets — see docs/MULTI_TENANCY.md.</p>
          </Section>
        </div>
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CheckCircle2, CircleAlert, Gauge, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Field, Input } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import { platformName } from '../../../lib/supabase'
import { EVENTS, type Channel } from '../../../settings/types'
import {
  PLATFORM_CHANNELS, PLATFORM_INFO_QK, PLATFORM_TEMPLATES_QK, PROVIDER_LABEL, allowanceText, platformMessaging,
  type PlatformChannel, type PlatformInfo, type PlatformMessaging, type TenantMessaging,
} from '../../../settings/platformMessaging'
import { Section, Segmented, type TabCtx } from '../shared'

const CH_LABEL: Record<PlatformChannel, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'E-mail' }
const brand = () => platformName || 'Hospital Comrade'

export function usePlatformInfo(enabled = true) {
  return useQuery({ queryKey: PLATFORM_INFO_QK, queryFn: platformMessaging.info, enabled, staleTime: 60_000, retry: 0 })
}
export const isPlatformChannel = (c: Channel): c is PlatformChannel => c === 'sms' || c === 'whatsapp' || c === 'email'

/** "Hospital Comrade (included)" vs "Your own account" — shown at the top of the SMS / WhatsApp / e-mail cards. */
export function SourcePicker({ channel, ctx }: { channel: PlatformChannel; ctx: TabCtx }) {
  const source = ctx.app.notifications[channel].source ?? 'own'
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Send through</span>
      <Segmented size="sm" value={source} onChange={(v) => ctx.editApp((d) => { d.notifications[channel].source = v })}
        options={[{ value: 'platform', label: `${brand()} (included)` }, { value: 'own', label: 'Your own account' }]} />
    </div>
  )
}

/** What a hospital on the shared account sees instead of the provider form. */
export function PlatformPanel({ channel, info }: { channel: PlatformChannel; info: ReturnType<typeof usePlatformInfo> }) {
  const d = info.data
  const provider = d?.accounts?.[channel] ?? null
  const unknown = !info.isPending && !d?.accounts
  const limit = d?.identity.limits?.[channel]
  const used = d?.used[channel] ?? 0
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="space-y-3">
      <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        info.isPending ? 'border-slate-200 bg-slate-50 text-slate-600' : provider ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
        {provider ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 space-y-1">
          {info.isPending ? <p>Checking {brand()} messaging…</p>
            : provider ? <p><b>{brand()} {CH_LABEL[channel]}</b> is active — sent from our verified {PROVIDER_LABEL[provider] ?? provider} account in <b>your hospital’s name</b>. No keys or provider account needed.</p>
              : unknown ? <p>Could not reach the <b>notify</b> function to check {brand()} messaging. Messages are still queued and sent once it is deployed.</p>
                : <p><b>{brand()} {CH_LABEL[channel]}</b> is not available yet — messages on this channel will fail. Ask {brand()} support, or switch to <b>Your own account</b>.</p>}
          {channel === 'sms' && <p className="text-xs opacity-80">Sender ID <b className="font-mono">{d?.identity.smsSenderId || d?.details.smsSenderId || '—'}</b>{d?.identity.smsSenderId ? ' (registered for your hospital)' : ''} · DLT-approved templates · your hospital’s name is in every message.</p>}
          {channel === 'whatsapp' && <p className="text-xs opacity-80">From {d?.details.whatsappNumber ? <b>{d.details.whatsappNumber}</b> : `${brand()}’s verified number`} with approved templates that carry your hospital’s name. The booking chatbot needs your own WhatsApp number.</p>}
          {channel === 'email' && <p className="text-xs opacity-80">From <b>{d?.details.emailFrom || `${brand()}’s address`}</b> in your hospital’s name. Replies go to the hospital e-mail in Settings → General.</p>}
        </div>
      </div>
      <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
        <p className="flex items-center justify-between gap-2 text-xs text-slate-500"><span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide"><Gauge className="h-3.5 w-3.5" />This month</span>
          <span className="tabular-nums">{info.isPending ? '…' : allowanceText(used, limit)}</span></p>
        {limit != null && <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${CH_LABEL[channel]} allowance used`}>
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
        </div>}
        {limit != null && used >= limit && <p className="mt-2 text-xs text-rose-700">The allowance is used up: only OTPs still go out until the 1st. Ask {brand()} to raise it, or use your own account.</p>}
      </div>
    </div>
  )
}

/** status badge for a channel on the shared account */
export function platformStatus(info: PlatformInfo | undefined, channel: PlatformChannel, enabled: boolean) {
  if (!enabled) return { tone: 'slate' as const, label: 'Off' }
  if (!info?.accounts) return { tone: 'blue' as const, label: brand() }
  return info.accounts[channel] ? { tone: 'green' as const, label: `Ready · ${brand()}` } : { tone: 'amber' as const, label: 'Not available' }
}

// ------------------------------------------------------------------ Hospital Comrade admins only
/** Sender identity + allowance for this hospital, and the shared template IDs for every hospital. */
export function PlatformAdminCard() {
  const qc = useQueryClient()
  const info = usePlatformInfo()
  const tpl = useQuery({ queryKey: PLATFORM_TEMPLATES_QK, queryFn: platformMessaging.templates, retry: 0 })
  const [identity, setIdentity] = useState<TenantMessaging>({})
  const [templates, setTemplates] = useState<PlatformMessaging>({ templates: {} })
  useEffect(() => { if (info.data) setIdentity(info.data.identity ?? {}) }, [info.data])
  useEffect(() => { if (tpl.data) setTemplates(tpl.data) }, [tpl.data])

  const saveIdentity = useMutation({
    mutationFn: () => platformMessaging.saveIdentity(clean(identity)),
    onSuccess: () => { toast.success('Saved for this hospital'); qc.invalidateQueries({ queryKey: PLATFORM_INFO_QK }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const saveTemplates = useMutation({
    mutationFn: () => platformMessaging.saveTemplates(templates),
    onSuccess: () => { toast.success('Shared template IDs saved for every hospital'); qc.invalidateQueries({ queryKey: PLATFORM_TEMPLATES_QK }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const setLimit = (c: PlatformChannel, v: string) => setIdentity((x) => ({ ...x, limits: { ...(x.limits ?? {}), [c]: v === '' ? null : Math.max(0, Math.floor(Number(v) || 0)) } }))
  const setTpl = (ev: string, k: 'waTemplate' | 'waParams' | 'smsTemplateId', v: string) =>
    setTemplates((x) => ({ templates: { ...(x.templates ?? {}), [ev]: { ...(x.templates?.[ev] ?? {}), [k]: v.trim() } } }))
  const accounts = info.data?.accounts

  return (
    <Section title={<span className="flex items-center gap-2">{brand()} messaging<Badge tone="violet">platform admin</Badge></span>} icon={<ShieldCheck className="h-4 w-4" />}
      description={`Only ${brand()} admins see this card. The shared accounts’ keys are Edge Function secrets (PLATFORM_*), never stored here.`}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 text-xs">
          {PLATFORM_CHANNELS.map((c) => <Badge key={c} tone={accounts?.[c] ? 'green' : 'amber'} dot>{CH_LABEL[c]}: {accounts ? (accounts[c] ? PROVIDER_LABEL[accounts[c]!] ?? accounts[c] : 'not set up') : 'unknown'}</Badge>)}
        </div>

        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Building2 className="h-4 w-4 text-brand-600" />This hospital</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Own DLT sender ID" hint="Registered under the platform's DLT entity. Empty = shared header">
              <Input value={identity.smsSenderId ?? ''} maxLength={6} placeholder={info.data?.details.smsSenderId ?? 'HSPCMR'} onChange={(e) => setIdentity((x) => ({ ...x, smsSenderId: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} />
            </Field>
            {PLATFORM_CHANNELS.map((c) => (
              <Field key={c} label={`${CH_LABEL[c]} / month`} hint="Empty = no limit">
                <Input type="number" min={0} value={identity.limits?.[c] ?? ''} placeholder="No limit" onChange={(e) => setLimit(c, e.target.value)} />
              </Field>
            ))}
          </div>
          {identity.smsSenderId && <p className="text-xs text-slate-500">A hospital header needs its own DLT templates — enter them per message below under “This hospital’s DLT ID”.</p>}
          <Button size="sm" loading={saveIdentity.isPending} onClick={() => saveIdentity.mutate()}>Save for this hospital</Button>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">Approved template IDs — shared by every hospital</p>
          <p className="text-xs text-slate-500">WhatsApp: approved template name (Meta / MSG91) or AiSensy API campaign name, and the variables in order (e.g. <code>hospital,name,date,time</code>). SMS: DLT template / flow ID. Wording for free-text providers stays each hospital’s own.</p>
          {tpl.isError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{(tpl.error as Error).message}</p>}
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-5 pb-2 font-semibold">Message</th><th className="px-2 pb-2 font-semibold">WhatsApp template / campaign</th><th className="px-2 pb-2 font-semibold">Variables</th>
                <th className="px-2 pb-2 font-semibold">DLT template ID</th>{identity.smsSenderId && <th className="px-5 pb-2 font-semibold">This hospital’s DLT ID</th>}
              </tr></thead>
              <tbody>
                {EVENTS.filter((e) => e.channels.some((c) => c === 'sms' || c === 'whatsapp')).map((ev) => {
                  const t = templates.templates?.[ev.id] ?? {}
                  return (
                    <tr key={ev.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-2"><p className="font-medium text-slate-800">{ev.label}</p><p className="text-[11px] text-slate-400">{ev.tokens.join(', ')}</p></td>
                      <td className="px-2 py-2"><Input aria-label={`${ev.label} WhatsApp template`} value={t.waTemplate ?? ''} onChange={(e) => setTpl(ev.id, 'waTemplate', e.target.value)} className="h-8 font-mono text-xs" /></td>
                      <td className="px-2 py-2"><Input aria-label={`${ev.label} variables`} value={t.waParams ?? ''} onChange={(e) => setTpl(ev.id, 'waParams', e.target.value)} className="h-8 font-mono text-xs" placeholder="hospital,name" /></td>
                      <td className="px-2 py-2"><Input aria-label={`${ev.label} DLT template ID`} value={t.smsTemplateId ?? ''} onChange={(e) => setTpl(ev.id, 'smsTemplateId', e.target.value)} className="h-8 font-mono text-xs" /></td>
                      {identity.smsSenderId && <td className="px-5 py-2"><Input aria-label={`${ev.label} hospital DLT template ID`} value={identity.templates?.[ev.id]?.smsTemplateId ?? ''} className="h-8 font-mono text-xs"
                        onChange={(e) => setIdentity((x) => ({ ...x, templates: { ...(x.templates ?? {}), [ev.id]: { ...(x.templates?.[ev.id] ?? {}), smsTemplateId: e.target.value.trim() } } }))} /></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Button size="sm" variant="outline" loading={saveTemplates.isPending} disabled={tpl.isPending} onClick={() => saveTemplates.mutate()}>Save shared template IDs</Button>
        </div>
      </div>
    </Section>
  )
}

/** drop empty values so the stored JSON stays small and "empty = default" holds */
function clean(x: TenantMessaging): TenantMessaging {
  const limits = Object.fromEntries(Object.entries(x.limits ?? {}).filter(([, v]) => v != null))
  const templates = Object.fromEntries(Object.entries(x.templates ?? {}).filter(([, v]) => v?.smsTemplateId))
  return { ...(x.smsSenderId ? { smsSenderId: x.smsSenderId } : {}), ...(Object.keys(limits).length ? { limits } : {}), ...(Object.keys(templates).length ? { templates } : {}) }
}

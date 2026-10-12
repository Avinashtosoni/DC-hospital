import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, KeyRound, Save, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, PageHeader, Skeleton } from '../../../src/components/ui'
import { cp, friendly } from '../api'
import type { AiBuilderSettings, AiProviderSetting } from '../types'
import { ErrorBox, Section } from '../ui'

const PROVIDER = [
  { id: 'openai', name: 'OpenAI', key: 'PLATFORM_AI_OPENAI_API_KEY', placeholder: 'sk-…' },
  { id: 'anthropic', name: 'Anthropic', key: 'PLATFORM_AI_ANTHROPIC_API_KEY', placeholder: 'sk-ant-…' },
  { id: 'gemini', name: 'Google Gemini', key: 'PLATFORM_AI_GEMINI_API_KEY', placeholder: 'AIza…' },
] as const

type ProviderId = (typeof PROVIDER)[number]['id']
type SettingsForm = Pick<AiBuilderSettings, 'enabled' | 'dailyLimit' | 'maxOutputTokens' | 'providers'>
const secretInitial = (): Record<ProviderId, string> => ({ openai: '', anthropic: '', gemini: '' })

export function AiBuilderPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-ai-builder'], queryFn: () => cp.aiBuilderSettings() })
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [secretValues, setSecretValues] = useState(secretInitial)
  const [removeSecrets, setRemoveSecrets] = useState<Record<ProviderId, boolean>>({ openai: false, anthropic: false, gemini: false })
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (q.data) setForm({ enabled: q.data.enabled, dailyLimit: q.data.dailyLimit, maxOutputTokens: q.data.maxOutputTokens, providers: q.data.providers.map((p) => ({ ...p })) })
  }, [q.data])

  const save = useMutation({
    mutationFn: () => cp.saveAiBuilderSettings(form!),
    onSuccess: (v) => { qc.setQueryData(['cp-ai-builder'], v); toast.success('AI page-builder settings saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  const saveKeys = useMutation({
    mutationFn: async () => {
      const changes: Record<string, string> = {}
      for (const p of PROVIDER) {
        const value = secretValues[p.id].trim()
        if (value) changes[p.key] = value
        else if (removeSecrets[p.id]) changes[p.key] = ''
      }
      if (!Object.keys(changes).length) return q.data!
      await cp.saveMessagingSetup({}, changes, password)
      return cp.aiBuilderSettings()
    },
    onSuccess: (v) => {
      qc.setQueryData(['cp-ai-builder'], v)
      setSecretValues(secretInitial()); setRemoveSecrets({ openai: false, anthropic: false, gemini: false }); setPassword('')
      toast.success('Provider credentials saved securely')
    },
    onError: (e) => toast.error(friendly(e)),
  })

  const changed = useMemo(() => !!form && !!q.data && JSON.stringify(form) !== JSON.stringify({
    enabled: q.data.enabled, dailyLimit: q.data.dailyLimit, maxOutputTokens: q.data.maxOutputTokens, providers: q.data.providers,
  }), [form, q.data])
  const pendingSecrets = PROVIDER.some((p) => !!secretValues[p.id].trim() || removeSecrets[p.id])
  const secretInfo = q.data?.secrets ?? []
  const configured = (id: ProviderId) => secretInfo.some((s) => s.key === PROVIDER.find((p) => p.id === id)!.key)
  const hint = (id: ProviderId) => secretInfo.find((s) => s.key === PROVIDER.find((p) => p.id === id)!.key)?.hint

  const updateProvider = (id: ProviderId, patch: Partial<AiProviderSetting>) => setForm((f) => f ? ({ ...f, providers: f.providers.map((p) => p.id === id ? { ...p, ...patch } : p) }) : f)
  const moveProvider = (id: ProviderId, delta: -1 | 1) => setForm((f) => {
    if (!f) return f
    const providers = [...f.providers], from = providers.findIndex((p) => p.id === id), to = from + delta
    if (from < 0 || to < 0 || to >= providers.length) return f
    ;[providers[from], providers[to]] = [providers[to], providers[from]]
    return { ...f, providers }
  })

  if (q.error) return <><PageHeader title="AI page builder" /><ErrorBox error={q.error} onRetry={() => q.refetch()} /></>
  if (!form || !q.data) return <><PageHeader title="AI page builder" description="Configure secure provider failover and fair usage limits." /><Skeleton className="h-80" /></>

  return (
    <>
      <PageHeader title="AI page builder" description="Configure provider priority, credentials, per-hospital entitlement and conservative token limits." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Requests · last 30 days" value={q.data.usage.requests.toLocaleString('en-IN')} />
        <Metric label="Tokens · last 30 days" value={q.data.usage.tokens.toLocaleString('en-IN')} />
        <Metric label="Failed requests · last 30 days" value={q.data.usage.failures.toLocaleString('en-IN')} />
      </div>
      <Section title="Provider failover" subtitle="Enabled providers are tried from top to bottom. An unavailable or rate-limited provider is skipped; page prompts and patient data are not retained.">
        <div className="space-y-3">
          {form.providers.map((p, i) => {
            const meta = PROVIDER.find((x) => x.id === p.id)!
            return <div key={p.id} className="grid gap-3 rounded-xl border border-slate-100 p-4 md:grid-cols-[minmax(170px,1fr)_minmax(220px,2fr)_auto] md:items-center">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-800"><span className="text-xs font-bold">{i + 1}</span></span>
                <div><p className="font-semibold text-slate-800">{meta.name}</p><p className="text-xs text-slate-500">{configured(p.id) ? `Key saved ${hint(p.id) ?? ''}` : 'No API key saved'}</p></div>
              </div>
              <Field label="Model name"><Input value={p.model} maxLength={120} onChange={(e) => updateProvider(p.id, { model: e.target.value })} /></Field>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
                  <input type="checkbox" className="accent-brand-700" checked={p.enabled} onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })} />Enabled
                </label>
                <Button size="icon" variant="outline" aria-label={`Move ${meta.name} up`} disabled={i === 0} onClick={() => moveProvider(p.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" aria-label={`Move ${meta.name} down`} disabled={i === form.providers.length - 1} onClick={() => moveProvider(p.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
              </div>
            </div>
          })}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="AI assistance master switch" hint="Hospital plan entitlement and any per-hospital override still apply.">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Allow eligible hospitals to generate drafts</label>
          </Field>
          <Field label="Requests per hospital / 24 hours" hint="A second per-owner cap is enforced by the database."><Input type="number" min={1} max={100} value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })} /></Field>
          <Field label="Maximum generated output tokens" hint="The server applies this cap to every provider request."><Input type="number" min={200} max={2000} step={100} value={form.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-5 flex justify-end"><Button icon={<Save className="h-4 w-4" />} disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Save AI settings</Button></div>
      </Section>

      <Section title="Provider credentials" subtitle="Write-only keys are stored in platform_secrets and Supabase Vault when enabled. The browser never receives a saved key; confirm your password before changing credentials." className="mt-6">
        <div className="grid gap-4 lg:grid-cols-3">
          {PROVIDER.map((p) => <Field key={p.id} label={`${p.name} API key`} hint={configured(p.id) ? `Saved ${hint(p.id) ?? ''} — enter a replacement or select Remove.` : 'Not configured.'}>
            <Input type="password" autoComplete="new-password" value={secretValues[p.id]} placeholder={p.placeholder} onChange={(e) => setSecretValues((x) => ({ ...x, [p.id]: e.target.value }))} />
            {configured(p.id) && <label className="mt-2 flex items-center gap-2 text-xs text-rose-700"><input type="checkbox" className="accent-rose-700" checked={removeSecrets[p.id]} onChange={(e) => setRemoveSecrets((x) => ({ ...x, [p.id]: e.target.checked }))} />Remove saved key</label>}
          </Field>)}
        </div>
        {pendingSecrets && <div className="mt-4 grid gap-3 rounded-xl bg-amber-50 p-4 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Confirm your platform-admin password" hint="The session is refreshed before the encrypted credentials are written."><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button icon={<KeyRound className="h-4 w-4" />} disabled={!password} loading={saveKeys.isPending} onClick={() => saveKeys.mutate()}>Save credentials</Button>
        </div>}
        {!pendingSecrets && <div className="mt-4 flex justify-end"><Button variant="outline" disabled>Enter a new key or choose Remove</Button></div>}
        <p className="mt-4 flex items-start gap-2 text-xs text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />API keys are write-only to this interface. Edge Functions retrieve them at runtime through platform_env(); keys are not included in generated prompts or AI usage logs.</p>
      </Section>
      <Card className="mt-6 flex items-start gap-3 bg-brand-50/40 p-4 text-sm text-slate-600"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" /><p><b className="text-brand-950">Hospital entitlement.</b> Enterprise includes AI Assistance by default. Onboarding &amp; setup lets an admin enable or disable the feature for an individual hospital without changing its plan.</p></Card>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-2xl font-bold text-brand-950">{value}</p></Card>
}

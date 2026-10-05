/**
 * Platform settings → Integrations: the platform's own accounts in one place — Razorpay (hospitals pay the platform)
 * and the shared SMS / WhatsApp / e-mail / Firebase push accounts. Per card: live status (System health checks),
 * where the keys come from (panel / Edge secret fallback), "Check connection", a test send, and the keys themselves.
 * Keys are write-only (Vault): after saving only ••••1234 + who/when is shown; changing one asks for the password.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, ChevronDown, Copy, CreditCard, KeyRound, Lock, Mail, MessageCircle, RefreshCw, ShieldCheck, Smartphone, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, Select, Skeleton, Textarea, type Tone } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { supabaseUrl } from '../../../../src/lib/supabase'
import { cp, friendly } from '../../api'
import type { HealthStatus, LiveService, MessagingSetup } from '../../types'
import { dateTime, ErrorBox, useMe } from '../../ui'
import { ago } from '../../AlertBell'
import { ACCOUNTS, diffAccount, fieldsFor, isSetUp, keyMode, keysOf, providerOf, type AccountSpec, type IntegrationId } from '../messaging/accounts'
import { TestSend } from '../messaging/TestTab'

const ICON: Record<IntegrationId, JSX.Element> = {
  razorpay: <CreditCard className="h-5 w-5" />, sms: <Smartphone className="h-5 w-5" />, whatsapp: <MessageCircle className="h-5 w-5" />,
  email: <Mail className="h-5 w-5" />, push: <BellRing className="h-5 w-5" />,
}
const STATE: Record<HealthStatus, { label: string; tone: Tone }> = {
  ok: { label: 'Connected', tone: 'green' }, warn: { label: 'Needs attention', tone: 'amber' }, fail: { label: 'Error', tone: 'red' }, off: { label: 'Not set up', tone: 'slate' },
}
export const RAZORPAY_EVENTS = ['payment.captured', 'payment.failed', 'order.paid']
export const webhookUrl = (base: string) => `${base.replace(/\/$/, '')}/functions/v1/billing?webhook=razorpay`

type Sources = Record<string, { panel: boolean; edge: boolean }>

/** where a card's keys come from: the panel, the Edge-secret fallback, both, or nowhere */
export function keySource(spec: AccountSpec, setup: Pick<MessagingSetup, 'settings' | 'secrets'>, src: Sources | undefined): 'panel' | 'edge' | 'both' | 'none' {
  const panel = spec.channel === 'razorpay'
    ? !!setup.settings.PLATFORM_RAZORPAY_KEY_ID && setup.secrets.some((s) => s.key === 'PLATFORM_RAZORPAY_KEY_SECRET')
    : isSetUp(spec, setup.settings)
  const edge = keysOf(spec).some((k) => src?.[k]?.edge)
  return panel && edge ? 'both' : panel ? 'panel' : edge ? 'edge' : 'none'
}

export function IntegrationsTab() {
  const setup = useQuery({ queryKey: ['cp-messaging-setup'], queryFn: () => cp.messagingSetup() })
  const live = useQuery({ queryKey: ['cp-health-live'], queryFn: () => cp.liveHealth(), refetchInterval: 60_000, retry: false })
  const sources = useQuery({ queryKey: ['cp-key-sources'], queryFn: () => cp.keySources(ACCOUNTS.flatMap(keysOf)), retry: false, staleTime: 60_000 })
  if (setup.error) return <ErrorBox error={setup.error} onRetry={() => setup.refetch()} />
  if (!setup.data) return <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
  const s = setup.data
  return (
    <div className="space-y-4">
      <div className={cn('flex flex-wrap items-start gap-3 rounded-2xl border p-4 text-sm', s.vault ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
        {s.vault ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /> : <Lock className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.vault ? 'Keys are encrypted with Supabase Vault.' : 'Supabase Vault is not enabled — keys are kept in a locked table only the Edge Functions can read.'}</p>
          <p className="mt-0.5 text-xs opacity-80">
            {s.vault ? 'Nobody can read a key back — not even admins. Changing one asks for your password and is recorded in the audit log.'
              : 'Turn on Vault (Database → Extensions → supabase_vault) and save the keys again to encrypt them.'}
            {' '}Keys set as Edge Function secrets keep working as a fallback until you save them here.
          </p>
        </div>
        {sources.error && <Badge tone="amber">ops function not reachable — key sources and checks need it deployed</Badge>}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {ACCOUNTS.map((spec) => (
          <IntegrationCard key={spec.channel} spec={spec} setup={s} sources={sources.data?.sources}
            health={live.data?.services.find((x) => x.service === `provider:${spec.channel}`)}
            webhook={spec.channel === 'razorpay' ? live.data?.services.find((x) => x.service === 'webhook:razorpay') : undefined} />
        ))}
      </div>
    </div>
  )
}

function IntegrationCard({ spec, setup, sources, health, webhook }: { spec: AccountSpec; setup: MessagingSetup; sources?: Sources; health?: LiveService; webhook?: LiveService }) {
  const qc = useQueryClient()
  const { me } = useMe()
  const saved = setup.settings
  const source = keySource(spec, setup, sources)
  const [open, setOpen] = useState(source === 'none')
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...saved }))
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [remove, setRemove] = useState<string[]>([])
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState('')
  const provider = providerOf(spec, draft)
  const fields = fieldsFor(spec, provider)
  const secretOf = (k: string) => setup.secrets.find((x) => x.key === k)
  const diff = diffAccount(spec, saved, draft, keys, remove)
  const dirty = Object.keys(diff.settings).length + Object.keys(diff.secrets).length > 0
  const needsPassword = Object.keys(diff.secrets).length > 0
  const state = health ? STATE[health.status] : source === 'none' ? STATE.off : { label: 'Not checked yet', tone: 'blue' as Tone }
  const mode = spec.channel === 'razorpay' ? (keyMode(saved.PLATFORM_RAZORPAY_KEY_ID ?? '') ?? (health?.detail?.match(/\b(live|test) mode/)?.[1] as 'live' | 'test' | undefined) ?? null) : null

  const check = useMutation({
    mutationFn: () => cp.checkIntegration(spec.channel),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cp-health-live'] })
      const msg = `${spec.title}: ${r.check.detail ?? STATE[r.check.status].label}`
      if (r.check.status === 'ok') toast.success(msg); else if (r.check.status === 'fail') toast.error(msg); else toast(msg)
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const save = useMutation({
    mutationFn: () => cp.saveMessagingSetup(diff.settings, diff.secrets, password),
    onSuccess: (data) => {
      qc.setQueryData(['cp-messaging-setup'], data)
      qc.invalidateQueries({ queryKey: ['cp-key-sources'] })
      qc.invalidateQueries({ queryKey: ['cp-platform-status'] })
      setKeys({}); setRemove([]); setPassword(''); setAskPassword(false); setDraft({ ...data.settings })
      toast.success(`${spec.title} saved — checking the connection…`)
      check.mutate()
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const submit = () => (needsPassword ? setAskPassword(true) : save.mutate())
  const reset = () => { setDraft({ ...saved }); setKeys({}); setRemove([]) }
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Copied'), () => toast.error('Could not copy — select and copy it by hand'))

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 p-5 pb-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-800">{ICON[spec.channel]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display font-semibold text-brand-950">{spec.title}</h3>
            <Badge tone={state.tone} dot>{state.label}</Badge>
            {mode && <Badge tone={mode === 'live' ? 'violet' : 'amber'}>{mode === 'live' ? 'Live mode' : 'Test mode'}</Badge>}
          </div>
          <p className="text-xs text-slate-500">{spec.blurb}</p>
        </div>
      </div>

      {/* status */}
      <div className="mx-5 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn('break-words', health?.status === 'fail' ? 'text-rose-700' : 'text-slate-700')}>
              {health?.detail ?? (source === 'none' ? 'No keys yet — add them below.' : 'Press “Check connection” to test the keys.')}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {health?.last_checked_at ? `Checked ${ago(health.last_checked_at)}` : 'Never checked'}
              {' · '}{source === 'panel' ? 'Keys saved here' : source === 'both' ? 'Keys saved here (Edge secrets as fallback)' : source === 'edge' ? 'Using Edge Function secrets — save keys here to manage them from the panel' : sources ? 'No keys anywhere' : 'Key source unknown'}
            </p>
          </div>
          <Button size="sm" variant="outline" loading={check.isPending} disabled={source === 'none' && !!sources} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => check.mutate()}>Check connection</Button>
        </div>
      </div>

      {/* Razorpay: the webhook */}
      {spec.channel === 'razorpay' && (
        <div className="mx-5 mt-3 rounded-xl border border-slate-100 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-brand-950">Webhook</p>
            {webhook && <Badge tone={STATE[webhook.status].tone}>{webhook.status === 'off' ? 'Never received' : webhook.status === 'ok' ? 'Receiving' : STATE[webhook.status].label}</Badge>}
          </div>
          {webhook?.detail && <p className="mt-0.5 text-xs text-slate-500">{webhook.detail}</p>}
          <p className="mt-2 text-xs text-slate-500">Razorpay Dashboard → Account & Settings → Webhooks → Add new webhook:</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-2 py-1.5 font-mono text-xs text-slate-700" title={webhookUrl(supabaseUrl)}>{supabaseUrl ? webhookUrl(supabaseUrl) : 'https://<project>.supabase.co/functions/v1/billing?webhook=razorpay'}</code>
            <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} disabled={!supabaseUrl} onClick={() => copy(webhookUrl(supabaseUrl))}><span className="sr-only">Copy webhook URL</span></Button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">Events: {RAZORPAY_EVENTS.map((e) => <code key={e} className="mr-1 rounded bg-slate-100 px-1">{e}</code>)} · secret = the “Webhook secret” below.</p>
        </div>
      )}

      {/* test send */}
      {spec.channel !== 'razorpay' && source !== 'none' && (
        <div className="mx-5 mt-3">
          <TestSend channel={spec.channel} initial={spec.channel === 'email' ? me.email : ''}
            hint={spec.channel === 'push' ? 'Turn on notifications for this browser first (Alerts → My notifications).' : spec.channel === 'whatsapp' ? 'Template providers need the test template / campaign set below.' : undefined} />
        </div>
      )}

      {/* keys */}
      <div className="mt-4 border-t border-slate-100">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-brand-800 hover:bg-brand-50/50">
          <KeyRound className="h-4 w-4" /><span className="flex-1">{source === 'none' ? 'Set up' : 'Manage keys'}{dirty && <span className="ml-2 text-xs font-normal text-amber-700">· unsaved changes</span>}</span>
          <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="px-5 pb-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {spec.providerKey && (
                <Field label="Provider" className="sm:col-span-2" hint={isSetUp(spec, saved) ? 'Choose “Not used” to switch this channel off' : undefined}>
                  <Select value={provider} onChange={(e) => setDraft({ ...draft, [spec.providerKey!]: e.target.value })}>
                    <option value="">— Not used —</option>
                    {Object.entries(spec.providers).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                  </Select>
                </Field>
              )}
              {provider && spec.providers[provider]?.help && <p className="text-xs text-slate-500 sm:col-span-2">{spec.providers[provider].help}</p>}
              {fields.map((f) => {
                const edgeOnly = !!sources?.[f.key]?.edge && !sources?.[f.key]?.panel
                if (!f.secret) return (
                  <Field key={f.key} label={f.label} hint={edgeOnly && !draft[f.key] ? 'Empty here — the Edge secret is used' : f.hint}>
                    <Input value={draft[f.key] ?? ''} placeholder={f.placeholder} maxLength={500} onChange={(e) => setDraft({ ...draft, [f.key]: f.upper ? e.target.value.toUpperCase() : e.target.value })} />
                  </Field>
                )
                const s = secretOf(f.key)
                const removing = remove.includes(f.key)
                const Input2 = f.multiline ? Textarea : Input
                return (
                  <Field key={f.key} label={f.label} className={f.multiline ? 'sm:col-span-2' : undefined}
                    hint={s ? <span className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-mono"><KeyRound className="h-3 w-3" />{s.hint || '••••'}</span>
                      <span>saved {dateTime(s.updated_at)}{s.updated_by_name ? ` by ${s.updated_by_name}` : ''}</span>
                      {removing ? <button type="button" className="inline-flex items-center gap-1 text-brand-700 hover:underline" onClick={() => setRemove(remove.filter((k) => k !== f.key))}><Undo2 className="h-3 w-3" />Keep</button>
                        : <button type="button" className="inline-flex items-center gap-1 text-rose-600 hover:underline" onClick={() => { setRemove([...remove, f.key]); setKeys({ ...keys, [f.key]: '' }) }}><Trash2 className="h-3 w-3" />Remove</button>}
                    </span> : edgeOnly ? 'Not saved here — the Edge secret is used' : f.hint ?? 'Not saved yet'}>
                    <Input2 type={f.multiline ? undefined : 'password'} autoComplete="new-password" spellCheck={false} rows={f.multiline ? 3 : undefined}
                      disabled={removing} value={keys[f.key] ?? ''} placeholder={removing ? 'Will be removed when you save' : s ? 'Leave empty to keep the saved key' : f.placeholder}
                      onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setKeys({ ...keys, [f.key]: e.target.value })} className="font-mono text-xs" />
                  </Field>
                )
              })}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {dirty && <Button variant="ghost" size="sm" onClick={reset}>Undo</Button>}
              <Button size="sm" disabled={!dirty} loading={save.isPending && !askPassword} onClick={submit} icon={needsPassword ? <Lock className="h-3.5 w-3.5" /> : undefined}>Save {spec.title}</Button>
            </div>
          </div>
        )}
      </div>

      <Modal open={askPassword} onClose={() => setAskPassword(false)} title="Confirm it’s you"
        footer={<><Button variant="ghost" onClick={() => setAskPassword(false)}>Cancel</Button><Button loading={save.isPending} disabled={!password} onClick={() => save.mutate()}>Save keys</Button></>}>
        <p className="mb-3 text-sm text-slate-600">You are changing {Object.keys(diff.secrets).length === 1 ? 'a key' : `${Object.keys(diff.secrets).length} keys`} for {spec.title}. Enter your password — the change is recorded in the audit log.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (password) save.mutate() }}>
          <Field label="Your password"><Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </form>
      </Modal>
    </Card>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp, friendly } from '../../api'
import type { MessagingSetup } from '../../types'
import { dateTime } from '../../ui'
import { ACCOUNTS, diffAccount, fieldsFor, providerOf, type AccountSpec } from './accounts'

/** Shared SMS / WhatsApp / e-mail / push accounts. Keys are write-only: after saving only ••••1234 + who/when is shown. */
export function AccountsTab({ setup }: { setup: MessagingSetup }) {
  const status = useQuery({ queryKey: ['cp-platform-status'], queryFn: () => cp.platformStatus(), retry: false, staleTime: 60_000 })
  return (
    <div className="space-y-4">
      <div className={cn('flex flex-wrap items-start gap-3 rounded-2xl border p-4 text-sm', setup.vault ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
        {setup.vault ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /> : <Lock className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{setup.vault ? 'API keys are encrypted with Supabase Vault.' : 'Supabase Vault is not enabled — keys are kept in a locked table only the Edge Functions can read.'}</p>
          <p className="mt-0.5 text-xs opacity-80">
            {setup.vault ? 'Nobody can read a key back — not even admins. Changing one asks for your password and is recorded in the audit log.'
              : 'Turn on Vault (Database → Extensions → supabase_vault) and save the keys again to encrypt them.'}
            {' '}Edge Function secrets with the same PLATFORM_* names still work as a fallback.
          </p>
        </div>
        <div className="text-xs">
          {status.isLoading ? 'Checking notify…' : status.error ? <Badge tone="amber">notify function not reachable</Badge> : (
            <span className="flex flex-wrap gap-1">{Object.entries(status.data?.platform ?? {}).map(([ch, p]) => <Badge key={ch} tone={p ? 'green' : 'slate'}>{ch}: {p ?? 'off'}</Badge>)}</span>
          )}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {ACCOUNTS.map((spec) => <AccountCard key={spec.channel} spec={spec} setup={setup} />)}
      </div>
    </div>
  )
}

function AccountCard({ spec, setup }: { spec: AccountSpec; setup: MessagingSetup }) {
  const qc = useQueryClient()
  const saved = setup.settings
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...saved }))
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [remove, setRemove] = useState<string[]>([])
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState('')
  const provider = providerOf(spec, draft)
  const fields = fieldsFor(spec, provider)
  const secretOf = (k: string) => setup.secrets.find((s) => s.key === k)
  const diff = diffAccount(spec, saved, draft, keys, remove)
  const dirty = Object.keys(diff.settings).length + Object.keys(diff.secrets).length > 0
  const needsPassword = Object.keys(diff.secrets).length > 0
  const configured = spec.providerKey ? !!providerOf(spec, saved) : !!saved.PLATFORM_FCM_PROJECT_ID

  const save = useMutation({
    mutationFn: () => cp.saveMessagingSetup(diff.settings, diff.secrets, password),
    onSuccess: (data) => {
      qc.setQueryData(['cp-messaging-setup'], data)
      qc.invalidateQueries({ queryKey: ['cp-platform-status'] })
      setKeys({}); setRemove([]); setPassword(''); setAskPassword(false); setDraft({ ...data.settings })
      toast.success(`${spec.title} account saved`)
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const submit = () => (needsPassword ? setAskPassword(true) : save.mutate())
  const reset = () => { setDraft({ ...saved }); setKeys({}); setRemove([]) }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h3 className="font-display font-semibold text-brand-950">{spec.title}</h3>{configured ? <Badge tone="green" dot>Set up</Badge> : <Badge>Not set up</Badge>}</div>
          <p className="text-xs text-slate-500">{spec.blurb}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.providerKey && (
          <Field label="Provider" className="sm:col-span-2">
            <Select value={provider} onChange={(e) => setDraft({ ...draft, [spec.providerKey!]: e.target.value })}>
              <option value="">— Not used —</option>
              {Object.entries(spec.providers).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
            </Select>
          </Field>
        )}
        {provider && spec.providers[provider]?.help && <p className="text-xs text-slate-500 sm:col-span-2">{spec.providers[provider].help}</p>}
        {fields.map((f) => {
          if (!f.secret) return (
            <Field key={f.key} label={f.label} hint={f.hint}>
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
              </span> : 'Not saved yet'}>
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
      <Modal open={askPassword} onClose={() => setAskPassword(false)} title="Confirm it’s you"
        footer={<><Button variant="ghost" onClick={() => setAskPassword(false)}>Cancel</Button><Button loading={save.isPending} disabled={!password} onClick={() => save.mutate()}>Save keys</Button></>}>
        <p className="mb-3 text-sm text-slate-600">You are changing {Object.keys(diff.secrets).length === 1 ? 'an API key' : `${Object.keys(diff.secrets).length} API keys`}. Enter your password — the change is recorded in the audit log.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (password) save.mutate() }}>
          <Field label="Your password"><Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </form>
      </Modal>
    </Card>
  )
}

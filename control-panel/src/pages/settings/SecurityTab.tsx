/**
 * Platform settings → Security: the team's own sign-in OTP. After the password, every new control-panel sign-in needs a
 * 6-digit code sent on the shared accounts (Integrations) to the member's own mobile / e-mail. Switching it on needs a
 * verified session (the database checks). See scripts/sql/otp_verify.sql.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Fingerprint, Mail, MessageCircle, MessageSquareText, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Skeleton } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { Toggle } from '../../../../src/pages/cms/fields'
import { OtpSelfCheck } from '../../../../src/components/auth/OtpSelfCheck'
import { loginOtpStatus } from '../../../../src/auth/loginOtp'
import { cp, friendly } from '../../api'
import type { CpSecurity, OtpChannelId } from '../../types'
import { ErrorBox } from '../../ui'

export const OTP_CH: { id: OtpChannelId; label: string; icon: typeof Mail }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }, { id: 'sms', label: 'SMS', icon: MessageSquareText }, { id: 'email', label: 'E-mail', icon: Mail },
]

/** any number of channels, at least one, kept in the order WhatsApp → SMS → E-mail */
export function ChannelChips({ value, onChange, live, disabled }: { value: OtpChannelId[]; onChange: (v: OtpChannelId[]) => void; live?: Partial<Record<OtpChannelId, boolean>>; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {OTP_CH.map(({ id, label, icon: I }) => {
        const on = value.includes(id)
        return (
          <button key={id} type="button" aria-pressed={on} disabled={disabled}
            onClick={() => { const next = on ? value.filter((x) => x !== id) : OTP_CH.map((c) => c.id).filter((x) => x === id || value.includes(x)); if (next.length) onChange(next) }}
            className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50', on ? 'border-brand-400 bg-brand-50 font-medium text-brand-900 ring-1 ring-brand-200' : 'border-slate-200 text-slate-600 hover:border-brand-200')}>
            <I className="h-4 w-4" />{label}
            {live && !live[id] && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">off</span>}
          </button>
        )
      })}
    </div>
  )
}

export function SecurityTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['cp-security'], queryFn: () => cp.security() })
  const status = useQuery({ queryKey: ['cp-otp-status'], queryFn: loginOtpStatus })
  const [draft, setDraft] = useState<CpSecurity['loginOtp'] | null>(null)
  useEffect(() => { if (q.data && !draft) setDraft(q.data.loginOtp) }, [q.data, draft])
  const save = useMutation({
    mutationFn: () => cp.saveSecurity({ loginOtp: draft! }),
    onSuccess: (s) => { qc.setQueryData(['cp-security'], s); setDraft(s.loginOtp); toast.success('Security settings saved') },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !draft) return <Skeleton className="h-64" />
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data.loginOtp)
  const turningOn = draft.enabled && !q.data.loginOtp.enabled
  const unreachable = q.data.team.filter((m) => !m.channels.some((c) => draft.channels.includes(c)))

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 p-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Fingerprint className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-brand-950">Team sign-in verification (OTP)</h2>
          <p className="text-sm text-slate-500">After the password, a 6-digit code to the member’s own mobile / e-mail — once per device sign-in. Sent on the shared accounts in <Link to="/settings?tab=integrations" className="text-brand-700 hover:underline">Integrations</Link>.</p>
        </div>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      <div className="space-y-5 p-5">
        <Toggle label="Ask the team for a one-time code at sign-in" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })}
          hint="Also applies when a team member signs in to a hospital app. Hospitals have their own switch (Hospital → Security, or the hospital's Settings → Security)." />
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-600">Send the code by</p>
          <ChannelChips value={draft.channels} onChange={(v) => setDraft({ ...draft, channels: v })} />
        </div>

        <div className={cn('rounded-xl border p-4', turningOn && !status.data?.verified ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100 bg-slate-50/60')}>
          <p className="mb-2 text-sm font-medium text-slate-700">{turningOn && !status.data?.verified ? 'Before you switch it on: check that your own code arrives' : 'Your own code'}</p>
          <OtpSelfCheck status={status.data} loading={status.isLoading} onRequest={(c) => cp.requestOtp(c)}
            onVerify={(code) => cp.verifyOtp(code)} onVerified={() => { qc.invalidateQueries({ queryKey: ['cp-otp-status'] }); qc.invalidateQueries({ queryKey: ['cp-security'] }) }} />
          <p className="mt-2 text-xs text-slate-500">Uses the channels saved last time. Your mobile comes from your profile, the e-mail from your account.</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Team · where a code reaches</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {q.data.team.map((m) => {
              const ok = m.channels.filter((c) => draft.channels.includes(c))
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-700">{m.email}</span>
                  <Badge tone="slate">{m.role}</Badge>
                  {ok.length ? ok.map((c) => <Badge key={c} tone="green">{OTP_CH.find((x) => x.id === c)?.label}</Badge>) : <Badge tone="amber">no code possible</Badge>}
                </li>
              )
            })}
          </ul>
          {draft.enabled && unreachable.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{unreachable.length} member{unreachable.length > 1 ? 's' : ''} can’t receive a code on these channels and will be let in with the password only. Add a mobile number or pick E-mail.</p>
          )}
        </div>
      </div>
    </Card>
  )
}

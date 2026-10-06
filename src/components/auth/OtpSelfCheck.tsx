import { useState } from 'react'
import { BadgeCheck, Send } from 'lucide-react'
import { Button } from '../ui'
import { cn } from '../../lib/utils'
import type { OtpChannelId, OtpStatus } from '../../data/errors'

const LABEL: Record<OtpChannelId, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' }

/**
 * "Send me a code" — proves your own code arrives before sign-in OTP is switched on (the database refuses to switch it
 * on otherwise). Verifying also marks this session as verified. Hospital Settings → Security and control-panel
 * Platform settings → Security.
 */
export function OtpSelfCheck({ status, loading, onRequest, onVerify, onVerified }: {
  status: OtpStatus | null | undefined
  loading?: boolean
  onRequest: (channel: OtpChannelId) => Promise<{ to: string; channel: OtpChannelId }>
  onVerify: (code: string) => Promise<unknown>
  onVerified: () => void
}) {
  const [channel, setChannel] = useState<OtpChannelId | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [err, setErr] = useState('')

  if (loading) return <p className="text-sm text-slate-400">Checking this session…</p>
  if (!status) return <p className="text-sm text-amber-700">Sign-in OTP needs the latest database update (supabase/upgrade-2026-10.sql).</p>
  if (status.verified) {
    return <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><BadgeCheck className="h-4 w-4" />This session is verified — your codes arrive.</p>
  }
  const list = status.channels
  const pick = channel ?? list[0]?.channel ?? null
  if (!list.length) {
    return <p className="text-sm text-amber-700">No code can reach you yet: add your mobile number / e-mail to your profile and connect at least one of the selected channels.</p>
  }

  const send = async () => {
    if (!pick) return
    setBusy('send'); setErr('')
    try { const r = await onRequest(pick); setSentTo(`${LABEL[r.channel]} ${r.to}`); setCode('') } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const verify = async () => {
    setBusy('verify'); setErr('')
    try { await onVerify(code); onVerified() } catch (e) { setErr((e as Error).message); setCode('') } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((c) => (
          <button key={c.channel} type="button" onClick={() => setChannel(c.channel)} aria-pressed={pick === c.channel}
            className={cn('rounded-lg border px-3 py-1.5 text-left text-xs transition', pick === c.channel ? 'border-brand-400 bg-brand-50 text-brand-900 ring-1 ring-brand-200' : 'border-slate-200 text-slate-600 hover:border-brand-200')}>
            <span className="font-semibold">{LABEL[c.channel]}</span> <span className="text-slate-500">{c.to}</span>
          </button>
        ))}
        <Button size="sm" variant="outline" icon={<Send className="h-3.5 w-3.5" />} loading={busy === 'send'} onClick={send}>{sentTo ? 'Send again' : 'Send me a code'}</Button>
      </div>
      {sentTo && (
        <div className="flex flex-wrap items-center gap-2">
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="input h-9 w-36 text-center font-mono tracking-[0.4em]" placeholder="••••••" aria-label="6-digit code" />
          <Button size="sm" disabled={code.length !== 6} loading={busy === 'verify'} onClick={verify}>Verify</Button>
          <span className="text-xs text-slate-500">Sent to {sentTo}</span>
        </div>
      )}
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, Mail, MessageCircle, MessageSquareText, RotateCw, ShieldCheck } from 'lucide-react'
import { Button } from '../ui'
import { cn } from '../../lib/utils'
import type { OtpChannelId, OtpStatus } from '../../data/errors'

const ICON: Record<OtpChannelId, typeof Mail> = { whatsapp: MessageCircle, sms: MessageSquareText, email: Mail }
const LABEL: Record<OtpChannelId, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' }
const RESEND_AFTER = 30

/**
 * "Enter your sign-in code" — after the password, when sign-in OTP is on (hospital Settings → Security,
 * control panel Platform settings → Security). Used by the hospital Login page and the control panel.
 */
export function OtpStep({ status, onRequest, onVerify, onCancel, title = 'Verify it\'s you' }: {
  status: OtpStatus
  onRequest: (channel: OtpChannelId) => Promise<{ to: string; channel: OtpChannelId }>
  onVerify: (code: string) => Promise<unknown>
  onCancel: () => void
  title?: string
}) {
  const [channel, setChannel] = useState<OtpChannelId | null>(status.channels[0]?.channel ?? null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  const send = async () => {
    if (!channel) return
    setSending(true); setError('')
    try {
      const r = await onRequest(channel)
      setSentTo(`${LABEL[r.channel] ?? r.channel} ${r.to}`)
      setWait(RESEND_AFTER); setCode('')
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (e) {
      const m = (e as Error).message
      const secs = Number(/wait (\d+) seconds/i.exec(m)?.[1] ?? 0)
      if (secs) setWait(secs)
      setError(m)
    } finally { setSending(false) }
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return setError('Enter the 6-digit code.')
    setChecking(true); setError('')
    try { await onVerify(code) } catch (err) { setError((err as Error).message); setCode('') } finally { setChecking(false) }
  }

  return (
    <div>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><ShieldCheck className="h-6 w-6" /></span>
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-950">{title}</h2>
      <p className="mt-1.5 text-sm text-slate-500">
        {sentTo ? <>We sent a 6-digit code to <b className="font-semibold text-slate-700">{sentTo}</b>. It is valid for 10 minutes.</>
          : 'Your account needs a one-time code for every new sign-in. Choose where to receive it.'}
      </p>

      {!sentTo && (
        <div className="mt-6 space-y-2" role="radiogroup" aria-label="Where to send the code">
          {status.channels.map((c) => {
            const I = ICON[c.channel] ?? KeyRound
            const on = channel === c.channel
            return (
              <button key={c.channel} type="button" role="radio" aria-checked={on} onClick={() => setChannel(c.channel)}
                className={cn('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition',
                  on ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-brand-200')}>
                <I className={cn('h-5 w-5', on ? 'text-brand-700' : 'text-slate-400')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">{LABEL[c.channel] ?? c.channel}</span>
                  <span className="block truncate text-xs text-slate-500">{c.to}</span>
                </span>
                <span className={cn('h-4 w-4 rounded-full border-2', on ? 'border-brand-600 bg-brand-600 shadow-[inset_0_0_0_2px_white]' : 'border-slate-300')} />
              </button>
            )
          })}
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
          <Button className="mt-2 h-11 w-full" loading={sending} disabled={!channel || wait > 0} onClick={send}>
            {wait > 0 ? `Send code (${wait}s)` : 'Send code'}
          </Button>
        </div>
      )}

      {sentTo && (
        <form onSubmit={verify} className="mt-6 space-y-4">
          <label className="block">
            <span className="label">Verification code</span>
            <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="input h-12 text-center font-mono text-2xl tracking-[0.5em]" placeholder="••••••" aria-label="6-digit code" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
          <Button type="submit" className="h-11 w-full" loading={checking} disabled={code.length !== 6}>Verify and continue</Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" disabled={wait > 0 || sending} onClick={send}
              className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
              <RotateCw className={cn('h-3.5 w-3.5', sending && 'animate-spin')} />{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
            </button>
            {status.channels.length > 1 && (
              <button type="button" onClick={() => { setSentTo(null); setError('') }} className="font-medium text-slate-500 hover:text-slate-800">Use another method</button>
            )}
          </div>
        </form>
      )}

      <button type="button" onClick={onCancel} className="mt-8 w-full text-center text-sm text-slate-500 hover:text-slate-800">
        Not you? Sign out and use another account
      </button>
    </div>
  )
}

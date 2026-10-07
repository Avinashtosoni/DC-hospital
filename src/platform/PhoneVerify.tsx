/**
 * /signup — "Mobile number" with a WhatsApp (or SMS) code check. The number field gets a Verify button; the code box
 * opens under it; once verified the number is locked with a tick (Change unlocks it and drops the check).
 */
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, MessageCircle, MessageSquareText, Pencil, RotateCw } from 'lucide-react'
import { cn } from '../lib/utils'
import { requestSignupOtp, verifySignupOtp, type OtpChannel, type SignupOtpSent } from './api'

export const validMobile = (v: string) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '').slice(-10))
const CH_LABEL: Record<OtpChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS' }

export interface Verified { phone: string; token: string; channel: OtpChannel }

/** seconds left until `at` (re-renders every second while > 0) */
function useCountdown(at: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [at])
  return Math.max(0, Math.ceil((at - now) / 1000))
}

export function PhoneField({ phone, onPhone, channels, verified, onVerified, highlight }: {
  phone: string
  onPhone: (v: string) => void
  channels: OtpChannel[]
  verified: Verified | null
  onVerified: (v: Verified | null) => void
  /** the form was sent without verifying: draw attention */
  highlight?: boolean
}) {
  const [sent, setSent] = useState<SignupOtpSent | null>(null)
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const left = useCountdown(resendAt)
  const codeRef = useRef<HTMLInputElement>(null)
  const ok = validMobile(phone)
  const isVerified = !!verified && verified.phone === phone.replace(/\D/g, '').slice(-10)

  const send = async (channel: OtpChannel) => {
    if (!ok) { setError('Enter a 10-digit Indian mobile number first.'); return }
    setBusy('send'); setError('')
    try {
      const r = await requestSignupOtp(phone, channel)
      setSent(r); setCode('')
      setResendAt(Date.now() + (r.resend_in ?? 30) * 1000)
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not send the code.'
      const other = channels.find((c) => c !== channel)
      setError(other && /could not send/i.test(msg) ? `${msg}. Try ${CH_LABEL[other]} instead.` : msg)
    } finally { setBusy(null) }
  }
  const check = async (value: string) => {
    if (!/^\d{6}$/.test(value) || busy) return
    setBusy('verify'); setError('')
    try {
      const token = await verifySignupOtp(phone, value)
      onVerified({ phone: phone.replace(/\D/g, '').slice(-10), token, channel: sent?.channel ?? 'whatsapp' })
      setSent(null); setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code is not correct.')
      setCode('')
      setTimeout(() => codeRef.current?.focus(), 50)
    } finally { setBusy(null) }
  }
  const change = () => { onVerified(null); setSent(null); setCode(''); setError('') }
  const first = channels[0] ?? 'whatsapp'

  return (
    <>
      <label className="block text-sm font-medium text-peri-900">
        <span className="mb-1.5 block">Mobile number *</span>
        <div className="relative">
          <input className={cn('input pr-[6.5rem]', isVerified && '!border-emerald-300 !bg-emerald-50/50', highlight && !isVerified && '!border-amber-400 ring-2 ring-amber-100')}
            value={phone} onChange={(e) => { onPhone(e.target.value); if (verified || sent) { onVerified(null); setSent(null); setError('') } }}
            readOnly={isVerified} type="tel" inputMode="tel" autoComplete="tel" maxLength={16} placeholder="98765 43210" required aria-describedby="signup-otp-help" />
          <div className="absolute inset-y-0 right-1.5 flex items-center">
            {isVerified ? (
              <button type="button" onClick={change} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-peri-700 hover:bg-peri-50"><Pencil className="h-3 w-3" />Change</button>
            ) : !sent && (
              <button type="button" onClick={() => send(first)} disabled={busy === 'send'}
                className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-60',
                  first === 'whatsapp' ? 'bg-[#1f9d55] hover:bg-[#178a49]' : 'bg-peri-800 hover:bg-peri-900', !ok && 'opacity-70')}>
                {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : first === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}
                Verify
              </button>
            )}
          </div>
        </div>
        {isVerified && <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Verified on {CH_LABEL[verified!.channel]}</span>}
      </label>

      {(sent || (!isVerified && (error || highlight))) && (
        <div id="signup-otp-help" className={cn('rounded-2xl p-4 sm:col-span-2', sent ? 'bg-peri-50/80 ring-1 ring-peri-200' : 'bg-amber-50 ring-1 ring-amber-200')} aria-live="polite">
          {sent ? (
            <>
              <p className="text-sm text-peri-900">
                We sent a 6-digit code on <b>{CH_LABEL[sent.channel]}</b> to <b className="whitespace-nowrap">{sent.to}</b>.
                <button type="button" onClick={change} className="ml-1.5 text-xs font-semibold text-peri-600 underline underline-offset-2 hover:text-peri-800">Wrong number?</button>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input ref={codeRef} value={code} aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
                  onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) void check(v) }}
                  className="input w-44 text-center font-mono text-xl tracking-[.5em] placeholder:tracking-[.3em]" />
                <button type="button" onClick={() => check(code)} disabled={code.length !== 6 || busy === 'verify'}
                  className="inline-flex items-center gap-1.5 rounded-full bg-peri-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-peri-900 disabled:opacity-50">
                  {busy === 'verify' && <Loader2 className="h-4 w-4 animate-spin" />}Confirm
                </button>
              </div>
              {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                {left > 0 ? <span>Resend in {left}s</span> : (
                  <button type="button" onClick={() => send(sent.channel)} disabled={busy === 'send'} className="inline-flex items-center gap-1 font-semibold text-peri-700 hover:text-peri-900">
                    <RotateCw className={cn('h-3.5 w-3.5', busy === 'send' && 'animate-spin')} />Resend on {CH_LABEL[sent.channel]}
                  </button>
                )}
                {channels.filter((c) => c !== sent.channel).map((c) => (
                  <button key={c} type="button" disabled={left > 0 || busy === 'send'} onClick={() => send(c)} className="font-semibold text-peri-700 hover:text-peri-900 disabled:cursor-not-allowed disabled:text-slate-400">
                    Send by {CH_LABEL[c]} instead
                  </button>
                ))}
                <span className="text-slate-400">Valid for 10 minutes</span>
              </div>
            </>
          ) : (
            <div className="text-sm text-amber-900">
              <p>{error || `Please verify your mobile number — tap Verify and enter the code we send on ${CH_LABEL[first]}.`}</p>
              {error && channels.length > 1 && ok && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                  {channels.map((c) => <button key={c} type="button" disabled={busy === 'send'} onClick={() => send(c)} className="text-peri-700 underline underline-offset-2 hover:text-peri-900">Send on {CH_LABEL[c]}</button>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

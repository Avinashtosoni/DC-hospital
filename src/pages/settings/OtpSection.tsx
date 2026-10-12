import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Fingerprint, Mail, MessageCircle, MessageSquareText, TriangleAlert } from 'lucide-react'
import { cn } from '../../lib/utils'
import { OTP_CHANNELS, otpOf, type AppSettings, type OtpChannel, type OtpSettings } from '../../settings/types'
import { loginOtpStatus, requestLoginOtp, verifyLoginOtp } from '../../auth/loginOtp'
import { flushNotificationsSoon } from '../../settings/store'
import { OtpSelfCheck } from '../../components/auth/OtpSelfCheck'
import { Section, Segmented, Toggle, type TabCtx } from './shared'

const CH: Record<OtpChannel, { label: string; icon: typeof Mail }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle }, sms: { label: 'SMS', icon: MessageSquareText }, email: { label: 'E-mail', icon: Mail },
}

/** pick any number of channels (at least one), in the fixed preference order WhatsApp → SMS → E-mail */
function ChannelPicker({ value, onChange, app }: { value: OtpChannel[]; onChange: (v: OtpChannel[]) => void; app: AppSettings }) {
  return (
    <div className="flex flex-wrap gap-2">
      {OTP_CHANNELS.map((c) => {
        const on = value.includes(c)
        const live = app.notifications[c]?.enabled
        const I = CH[c].icon
        return (
          <button key={c} type="button" aria-pressed={on}
            onClick={() => { const next = on ? value.filter((x) => x !== c) : OTP_CHANNELS.filter((x) => x === c || value.includes(x)); if (next.length) onChange(next) }}
            className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition', on ? 'border-brand-400 bg-brand-50 font-medium text-brand-900 ring-1 ring-brand-200' : 'border-slate-200 text-slate-600 hover:border-brand-200')}>
            <I className="h-4 w-4" />{CH[c].label}
            {!live && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200" title="Switch it on in Settings → Notifications">off</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Settings → Security: one-time codes at sign-in and for online bookings (scripts/sql/otp_verify.sql, booking.sql) */
export function OtpSection({ ctx }: { ctx: TabCtx }) {
  const { app, savedApp, editApp } = ctx
  const otp = otpOf(app.security)
  const saved = otpOf(savedApp.security)
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['login-otp-status'], queryFn: loginOtpStatus, staleTime: 30_000 })
  const set = (fn: (o: OtpSettings) => void) => editApp((d) => { const o = otpOf(d.security); fn(o); d.security.otp = o })
  const noneLive = (list: OtpChannel[]) => !list.some((c) => app.notifications[c]?.enabled)
  // switching it on (or narrowing the channels) is checked by the database: your own code must have arrived first
  const needsProof = otp.login.enabled && (!saved.login.enabled || otp.login.channels.some((c) => !saved.login.channels.includes(c)) || otp.login.roles !== saved.login.roles)
    && !status.data?.verified

  return (
    <>
      <Section title="Sign-in verification (OTP)" icon={<Fingerprint className="h-4 w-4" />}
        description="After the password, ask for a 6-digit code sent to the person's own mobile or e-mail — once per device sign-in.">
        <div className="space-y-4">
          <Toggle label="Ask for a one-time code at sign-in" checked={otp.login.enabled} onChange={(v) => set((o) => { o.login.enabled = v })}
            hint="Someone who has no reachable mobile / e-mail on the selected channels is let in without a code, so nobody is locked out." />
          <div className={cn('space-y-4', !otp.login.enabled && 'pointer-events-none opacity-50')}>
            <div>
              <p className="label">Who</p>
              <Segmented value={otp.login.roles} onChange={(v) => set((o) => { o.login.roles = v })}
                options={[{ value: 'staff', label: 'Staff only', hint: 'Everyone except patients' }, { value: 'all', label: 'Staff and patients' }]} />
            </div>
            <div>
              <p className="label">Send the code by</p>
              <ChannelPicker value={otp.login.channels} app={app} onChange={(v) => set((o) => { o.login.channels = v })} />
              {noneLive(otp.login.channels) && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><TriangleAlert className="h-3.5 w-3.5" />None of these is switched on in Settings → Notifications yet — codes can't go out.</p>}
            </div>
          </div>
          <div className={cn('rounded-xl border p-4', needsProof ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100 bg-slate-50/60')}>
            <p className="mb-2 text-sm font-medium text-slate-700">{needsProof ? 'Before you save: check that your own code arrives' : 'Your own code'}</p>
            <OtpSelfCheck status={status.data} loading={status.isLoading}
              onRequest={async (c) => { const r = await requestLoginOtp(c); flushNotificationsSoon(0, [r.ref]); return r }}
              onVerify={verifyLoginOtp} onVerified={() => qc.invalidateQueries({ queryKey: ['login-otp-status'] })} />
            <p className="mt-2 text-xs text-slate-500">Uses the channels saved last time. Your mobile number and e-mail come from your profile.</p>
          </div>
        </div>
      </Section>

      <Section title="Online booking verification" icon={<CalendarCheck className="h-4 w-4" />}
        description="Visitors booking on your website confirm their mobile number with a one-time code.">
        <div className="space-y-4">
          <Toggle label="Ask for a one-time code before an online booking" checked={otp.booking.enabled} onChange={(v) => set((o) => { o.booking.enabled = v })}
            hint="Off: the booking is confirmed straight away (still limited to 5 bookings per number per hour). Fewer fake bookings with it on." />
          <div className={cn(!otp.booking.enabled && 'pointer-events-none opacity-50')}>
            <p className="label">Send the code by</p>
            <Segmented value={otp.booking.channels ? 'custom' : 'auto'} size="sm"
              onChange={(v) => set((o) => { o.booking.channels = v === 'auto' ? null : ['whatsapp', 'sms'] })}
              options={[{ value: 'auto', label: 'As in Notifications', hint: 'The “Booking code” row of Settings → Notifications → Events' }, { value: 'custom', label: 'Choose here' }]} />
            {otp.booking.channels && (
              <div className="mt-3">
                <ChannelPicker value={otp.booking.channels} app={app} onChange={(v) => set((o) => { o.booking.channels = v })} />
                <p className="mt-2 text-xs text-slate-500">The visitor picks one. E-mail is offered only when they entered an e-mail address.</p>
                {noneLive(otp.booking.channels) && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><TriangleAlert className="h-3.5 w-3.5" />None of these is switched on in Settings → Notifications — visitors can't get a code.</p>}
              </div>
            )}
          </div>
        </div>
      </Section>
    </>
  )
}

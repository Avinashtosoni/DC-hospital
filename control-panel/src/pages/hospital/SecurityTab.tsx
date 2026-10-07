/**
 * Hospital → Security: that hospital's one-time-code switches (the same ones as its Settings → Security), for the team —
 * admin, or support assigned to it. Sign-in OTP for its staff (or everyone) and the code before online bookings.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Skeleton } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { Toggle } from '../../../../src/pages/cms/fields'
import { cp, friendly } from '../../api'
import type { CpHospitalDetail, CpHospitalOtp } from '../../types'
import { ErrorBox, Section } from '../../ui'
import { ChannelChips } from '../settings/SecurityTab'

type Otp = CpHospitalOtp['otp']

export function SecurityTab({ h }: { h: CpHospitalDetail }) {
  const qc = useQueryClient()
  const key = ['cp-hospital-otp', h.id]
  const q = useQuery({ queryKey: key, queryFn: () => cp.hospitalOtp(h.id) })
  const [d, setD] = useState<Otp | null>(null)
  useEffect(() => { if (q.data && !d) setD(structuredClone(q.data.otp)) }, [q.data, d])
  const save = useMutation({
    mutationFn: () => cp.setHospitalOtp(h.id, d!),
    onSuccess: (r) => { qc.setQueryData(key, r); setD(structuredClone(r.otp)); toast.success('Saved — applies from the next sign-in / booking') },
    onError: (e) => toast.error(friendly(e)),
  })
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!q.data || !d) return <Skeleton className="h-64" />
  const live = q.data.channels_on
  const dirty = JSON.stringify(d) !== JSON.stringify(q.data.otp)
  const set = (fn: (o: Otp) => void) => { const o = structuredClone(d); fn(o); setD(o) }
  const noneLive = (list: string[]) => !list.some((c) => live[c as keyof typeof live])

  return (
    <div className="space-y-5">
      <Section title="Sign-in verification (OTP)" subtitle="A 6-digit code after the password, once per device sign-in. People with no reachable mobile / e-mail are let in without one."
        action={<Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        <div className="space-y-4">
          <Toggle label="Ask for a one-time code at sign-in" checked={d.login.enabled} onChange={(v) => set((o) => { o.login.enabled = v })} />
          <div className={cn('space-y-4', !d.login.enabled && 'pointer-events-none opacity-50')}>
            <div className="flex flex-wrap gap-2">
              {(['staff', 'all'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={d.login.roles === r} onClick={() => set((o) => { o.login.roles = r })}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm', d.login.roles === r ? 'border-brand-400 bg-brand-50 font-medium text-brand-900' : 'border-slate-200 text-slate-600')}>
                  {r === 'staff' ? 'Staff only' : 'Staff and patients'}
                </button>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Send the code by</p>
              <ChannelChips value={d.login.channels} live={live} onChange={(v) => set((o) => { o.login.channels = v })} />
            </div>
            <p className="text-xs text-slate-500">{q.data.reachable} of {q.data.people} account{q.data.people === 1 ? '' : 's'} can receive a code with the saved settings.</p>
            {noneLive(d.login.channels) && <p className="flex items-center gap-1.5 text-xs text-amber-700"><TriangleAlert className="h-3.5 w-3.5" />None of these channels is switched on in the hospital’s Notifications — nobody would get a code (and so nobody is asked).</p>}
          </div>
        </div>
      </Section>

      <Section title="Online booking verification" subtitle="Visitors booking on the hospital website confirm their mobile number with a code."
        action={<Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        <div className="space-y-4">
          <Toggle label="Ask for a one-time code before an online booking" checked={d.booking.enabled} onChange={(v) => set((o) => { o.booking.enabled = v })}
            hint="Off: bookings are confirmed straight away (max 5 per number per hour)." />
          <div className={cn('space-y-3', !d.booking.enabled && 'pointer-events-none opacity-50')}>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={d.booking.channels === null} onChange={(e) => set((o) => { o.booking.channels = e.target.checked ? null : ['whatsapp', 'sms'] })} className="h-4 w-4 rounded border-slate-300" />
              Channels as in the hospital’s Notifications (Booking code event)
            </label>
            {d.booking.channels && <ChannelChips value={d.booking.channels} live={live} onChange={(v) => set((o) => { o.booking.channels = v })} />}
          </div>
        </div>
      </Section>
    </div>
  )
}

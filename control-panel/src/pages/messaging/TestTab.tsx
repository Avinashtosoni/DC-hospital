import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Send, XCircle } from 'lucide-react'
import { Button, Card, Field, Input, Select } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp, friendly } from '../../api'
import { useMe } from '../../ui'

type Ch = 'email' | 'sms' | 'whatsapp' | 'push'
const LABEL: Record<Ch, string> = { email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp', push: 'Browser push (my browsers)' }

/** One real message on a shared account through the ops Edge Function — logged in the delivery log as "test". */
export function TestTab() {
  const { me } = useMe()
  const [channel, setChannel] = useState<Ch>('email')
  const [to, setTo] = useState(me.email)
  const [log, setLog] = useState<{ at: Date; channel: Ch; to: string; ok: boolean; message: string }[]>([])
  const send = useMutation({
    mutationFn: () => cp.testMessage(channel, to),
    onSuccess: (r) => setLog((l) => [{ at: new Date(), channel, to: channel === 'push' ? 'my browsers' : to, ok: r.ok, message: r.message }, ...l].slice(0, 10)),
    onError: (e) => setLog((l) => [{ at: new Date(), channel, to, ok: false, message: friendly(e) }, ...l].slice(0, 10)),
  })
  const pick = (c: Ch) => { setChannel(c); setTo(c === 'email' ? me.email : c === 'push' ? '' : '') }
  const valid = channel === 'push' || (channel === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) : to.replace(/\D/g, '').length >= 10)
  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card className="p-5">
        <h3 className="font-display font-semibold text-brand-950">Send a test</h3>
        <p className="mb-4 text-xs text-slate-500">Uses the saved shared account. WhatsApp tests need a test template / campaign on template providers.</p>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) send.mutate() }}>
          <Field label="Channel"><Select value={channel} onChange={(e) => pick(e.target.value as Ch)}>{(Object.keys(LABEL) as Ch[]).map((c) => <option key={c} value={c}>{LABEL[c]}</option>)}</Select></Field>
          {channel === 'push'
            ? <p className="rounded-lg bg-brand-50 p-3 text-xs text-brand-900">Goes to every browser where you turned on notifications (Alerts → My notifications).</p>
            : <Field label={channel === 'email' ? 'E-mail address' : 'Mobile number'}><Input value={to} inputMode={channel === 'email' ? 'email' : 'tel'} placeholder={channel === 'email' ? 'you@example.com' : '98xxxxxxxx'} onChange={(e) => setTo(e.target.value)} /></Field>}
          <Button type="submit" disabled={!valid} loading={send.isPending} icon={<Send className="h-4 w-4" />}>Send test</Button>
        </form>
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 font-display font-semibold text-brand-950">Results</h3>
        {!log.length ? <p className="text-sm text-slate-500">Nothing sent yet in this session. Every test is also kept in the Delivery log.</p> : (
          <ul className="space-y-2">
            {log.map((r, i) => (
              <li key={i} className={cn('flex items-start gap-3 rounded-xl border p-3 text-sm', r.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50')}>
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                <div className="min-w-0">
                  <p className="font-medium text-brand-950">{LABEL[r.channel]} → {r.to} <span className="font-normal text-slate-500">· {r.at.toLocaleTimeString()}</span></p>
                  <p className="break-words text-slate-600">{r.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

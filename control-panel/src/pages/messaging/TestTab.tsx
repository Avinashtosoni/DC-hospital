import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Send, XCircle } from 'lucide-react'
import { Button, Input } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp, friendly } from '../../api'

export type TestChannel = 'email' | 'sms' | 'whatsapp' | 'push'
const PLACEHOLDER: Record<TestChannel, string> = { email: 'you@example.com', sms: '98xxxxxxxx', whatsapp: '98xxxxxxxx', push: '' }
export const validTo = (c: TestChannel, to: string) => c === 'push' || (c === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()) : to.replace(/\D/g, '').length >= 10)

/**
 * One real message on a shared account through the ops Edge Function (kept in the delivery log). Push goes to every
 * browser where the signed-in member turned notifications on.
 */
export function TestSend({ channel, initial = '', hint }: { channel: TestChannel; initial?: string; hint?: string }) {
  const [to, setTo] = useState(initial)
  const [result, setResult] = useState<{ ok: boolean; message: string; at: Date } | null>(null)
  const send = useMutation({
    mutationFn: () => cp.testMessage(channel, to.trim()),
    onSuccess: (r) => setResult({ ok: r.ok, message: r.message, at: new Date() }),
    onError: (e) => setResult({ ok: false, message: friendly(e), at: new Date() }),
  })
  const valid = validTo(channel, to)
  return (
    <div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) send.mutate() }}>
        {channel !== 'push' && <Input aria-label="Send a test to" value={to} inputMode={channel === 'email' ? 'email' : 'tel'} placeholder={PLACEHOLDER[channel]} onChange={(e) => setTo(e.target.value)} />}
        <Button type="submit" size="sm" variant="outline" className={channel === 'push' ? '' : 'shrink-0'} disabled={!valid} loading={send.isPending} icon={<Send className="h-3.5 w-3.5" />}>
          {channel === 'push' ? 'Send a test to my browsers' : 'Send test'}
        </Button>
      </form>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {result && (
        <div className={cn('mt-2 flex items-start gap-2 rounded-xl border p-2.5 text-sm', result.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50')}>
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
          <p className="min-w-0 break-words text-slate-700">{result.message} <span className="text-xs text-slate-400">· {result.at.toLocaleTimeString()}</span></p>
        </div>
      )}
    </div>
  )
}

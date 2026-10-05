import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BellRing, CheckCircle2, Mail, MessageCircle, Send, Smartphone, XCircle } from 'lucide-react'
import { Button, Card, Input } from '../../../../src/components/ui'
import { cn } from '../../../../src/lib/utils'
import { cp, friendly } from '../../api'
import { useMe } from '../../ui'

type Ch = 'email' | 'sms' | 'whatsapp' | 'push'
const CARDS: { id: Ch; label: string; icon: JSX.Element; hint: string; placeholder?: string }[] = [
  { id: 'email', label: 'E-mail', icon: <Mail className="h-4 w-4" />, hint: 'Shared e-mail account', placeholder: 'you@example.com' },
  { id: 'sms', label: 'SMS', icon: <Smartphone className="h-4 w-4" />, hint: 'Shared SMS account (DLT)', placeholder: '98xxxxxxxx' },
  { id: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4" />, hint: 'Template providers need a test template / campaign', placeholder: '98xxxxxxxx' },
  { id: 'push', label: 'Browser push', icon: <BellRing className="h-4 w-4" />, hint: 'Every browser where you turned notifications on (Alerts → My notifications)' },
]
export const validTo = (c: Ch, to: string) => c === 'push' || (c === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()) : to.replace(/\D/g, '').length >= 10)

/** One real message per channel on the shared accounts, through the ops Edge Function — also kept in the delivery log. */
export function TestTab() {
  const { me } = useMe()
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {CARDS.map((c) => <TestCard key={c.id} card={c} initial={c.id === 'email' ? me.email : ''} />)}
    </div>
  )
}

function TestCard({ card, initial }: { card: (typeof CARDS)[number]; initial: string }) {
  const [to, setTo] = useState(initial)
  const [result, setResult] = useState<{ ok: boolean; message: string; at: Date } | null>(null)
  const send = useMutation({
    mutationFn: () => cp.testMessage(card.id, to.trim()),
    onSuccess: (r) => setResult({ ok: r.ok, message: r.message, at: new Date() }),
    onError: (e) => setResult({ ok: false, message: friendly(e), at: new Date() }),
  })
  const valid = validTo(card.id, to)
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-800">{card.icon}</span>
        <div><h3 className="font-display text-sm font-semibold text-brand-950">{card.label}</h3><p className="text-xs text-slate-500">{card.hint}</p></div>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) send.mutate() }}>
        {card.id !== 'push' && <Input aria-label={`${card.label} recipient`} value={to} inputMode={card.id === 'email' ? 'email' : 'tel'} placeholder={card.placeholder} onChange={(e) => setTo(e.target.value)} />}
        <Button type="submit" className={card.id === 'push' ? 'w-full' : 'shrink-0'} disabled={!valid} loading={send.isPending} icon={<Send className="h-4 w-4" />}>
          {card.id === 'push' ? 'Send to my browsers' : 'Send test'}
        </Button>
      </form>
      {result && (
        <div className={cn('mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm', result.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50')}>
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
          <p className="min-w-0 break-words text-slate-700">{result.message} <span className="text-xs text-slate-400">· {result.at.toLocaleTimeString()}</span></p>
        </div>
      )}
    </Card>
  )
}

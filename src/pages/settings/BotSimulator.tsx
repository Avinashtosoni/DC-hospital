import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bot, RotateCcw, SendHorizontal } from 'lucide-react'
import { simulateBot, type BotState } from '../../booking/bot'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useSiteSettings } from '../../site/cms/content'
import { cn } from '../../lib/utils'

interface Line { from: 'me' | 'bot'; text: string; at: string }
const now = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** WhatsApp *bold* / _italic_ → HTML-free React nodes. */
function waFormat(text: string) {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block min-h-[1em]">
      {line.split(/(\*[^*]+\*|_[^_]+_)/g).map((part, j) => part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <b key={j}>{part.slice(1, -1)}</b>
        : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? <i key={j} className="text-slate-500">{part.slice(1, -1)}</i> : part)}
    </span>
  ))
}

/** Chat with the booking bot exactly as a patient would on WhatsApp. */
export function BotSimulator() {
  const site = useSiteSettings()
  const qc = useQueryClient()
  const [phone, setPhone] = useState('98300 12345')
  const [lines, setLines] = useState<Line[]>([])
  const [state, setState] = useState<BotState | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [lines, busy])

  const send = async (msg = text) => {
    const m = msg.trim()
    if (!m || busy) return
    setText(''); setBusy(true)
    setLines((l) => [...l, { from: 'me', text: m, at: now() }])
    try {
      const r = await simulateBot(phone, m, state, site)
      setState(r.state)
      setLines((l) => [...l, ...r.replies.map((t) => ({ from: 'bot' as const, text: t, at: now() }))])
      if (r.replies.some((t) => /confirmed|पक्का|Cancelled|रद्द/.test(t))) qc.invalidateQueries({ queryKey: ['table'] })
    } catch (e) {
      setLines((l) => [...l, { from: 'bot', text: `⚠️ ${(e as Error).message}`, at: now() }])
    } finally { setBusy(false) }
  }
  const reset = () => { setLines([]); setState(null) }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 bg-[#075e54] px-3 py-2 text-white">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15"><Bot className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-sm font-semibold">{site.name}</p><p className="text-[11px] text-white/70">Chatbot preview</p></div>
        <label className="flex items-center gap-1.5 text-[11px] text-white/80">Patient no.
          <input value={phone} onChange={(e) => { setPhone(e.target.value); reset() }} className="w-28 rounded-md bg-white/15 px-2 py-1 text-xs text-white outline-none placeholder:text-white/50" aria-label="Simulated patient WhatsApp number" />
        </label>
        <button type="button" onClick={reset} className="rounded-md p-1.5 hover:bg-white/15" aria-label="Restart chat" title="Restart chat"><RotateCcw className="h-4 w-4" /></button>
      </div>
      <div ref={box} className="h-80 space-y-2 overflow-y-auto bg-[#ece5dd] px-3 py-3 text-[13px]" aria-live="polite">
        {!lines.length && (
          <div className="mx-auto max-w-xs rounded-lg bg-[#fff5c4] px-3 py-2 text-center text-xs text-slate-700 shadow-sm">
            Say <b>hi</b> to start. Try <b>1</b> to book, <b>2</b> for your appointments, or <b>hindi</b>.
            {isSupabaseConfigured ? ' This runs the deployed bot — bookings made here are real.' : ' Demo mode: bookings go into the local demo data.'}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={cn('flex', l.from === 'me' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-lg px-2.5 py-1.5 shadow-sm', l.from === 'me' ? 'rounded-tr-none bg-[#dcf8c6]' : 'rounded-tl-none bg-white')}>
              <div className="whitespace-pre-wrap break-words text-slate-800">{waFormat(l.text)}</div>
              <p className="mt-0.5 text-right text-[10px] text-slate-400">{l.at}</p>
            </div>
          </div>
        ))}
        {busy && <div className="flex"><div className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-slate-400 shadow-sm">typing…</div></div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-center gap-2 border-t border-slate-200 bg-[#f0f0f0] p-2">
        {!lines.length && <button type="button" onClick={() => send('hi')} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">hi</button>}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-sm outline-none ring-1 ring-slate-200 focus:ring-[#075e54]" aria-label="Message" />
        <button type="submit" disabled={!text.trim() || busy} className="grid h-9 w-9 place-items-center rounded-full bg-[#075e54] text-white disabled:opacity-50" aria-label="Send"><SendHorizontal className="h-4 w-4" /></button>
      </form>
    </div>
  )
}

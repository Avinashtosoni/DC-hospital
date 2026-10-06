import { useState } from 'react'
import { FlaskConical, X } from 'lucide-react'
import { isDemoSite, useDemoInfo } from './demo'

const KEY = 'dch:demo-bar:closed'

/** a small reminder on every page of the demo hospital: try anything, it is erased every night */
export function DemoBar() {
  const info = useDemoInfo()
  const [closed, setClosed] = useState(() => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } })
  if (!isDemoSite() || closed) return null
  const nightly = info.data?.nightly !== false
  return (
    <div role="note" className="fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full bg-brand-950/90 py-1.5 pl-3 pr-1.5 text-xs text-white shadow-lg backdrop-blur print:hidden">
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-brand-200" />
      <span className="truncate"><b>Demo hospital</b> — try anything{nightly ? `; it is reset every night at ${info.data?.resets_at ?? '03:00 IST'}` : ''}.</span>
      <button type="button" aria-label="Hide" onClick={() => { setClosed(true); try { sessionStorage.setItem(KEY, '1') } catch { /* ignore */ } }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-white/15"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

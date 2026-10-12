import { useState } from 'react'
import { ClipboardPaste, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Field, Input, Textarea } from '../../../components/ui'
import type { SecretStatus } from '../../../settings/store'
import type { AppSettings } from '../../../settings/types'
import { SecretInput, type TabCtx } from '../shared'

type Push = AppSettings['notifications']['push']
const FIELDS: [keyof Omit<Push, 'enabled'>, string, string][] = [
  ['apiKey', 'Web API key', 'AIzaSy…'],
  ['projectId', 'Project ID', 'dc-hospital-12345'],
  ['messagingSenderId', 'Messaging sender ID', '1234567890'],
  ['appId', 'App ID', '1:1234567890:web:abc123…'],
  ['authDomain', 'Auth domain (optional)', 'dc-hospital-12345.firebaseapp.com'],
]

/** Pull the values out of the `const firebaseConfig = { … }` snippet Firebase shows for a web app. */
export function parseFirebaseSnippet(text: string): Partial<Push> {
  const out: Partial<Push> = {}
  for (const k of ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'] as const) {
    const m = text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`))
    if (m) out[k] = m[1].trim()
  }
  return out
}

export function PushForm({ ctx, secrets }: { ctx: TabCtx; secrets: SecretStatus[] | undefined }) {
  const cfg = ctx.app.notifications.push
  const set = (fn: (p: Push) => void) => ctx.editApp((d) => fn(d.notifications.push))
  const [snippet, setSnippet] = useState('')
  const apply = () => {
    const v = parseFirebaseSnippet(snippet)
    if (!Object.keys(v).length) { toast.error('Could not find a firebaseConfig in the pasted text'); return }
    set((p) => Object.assign(p, v)); setSnippet('')
    toast.success(`Filled ${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'} from the Firebase snippet`)
  }
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
        <li>In the <a className="font-medium text-brand-700 hover:underline" href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">Firebase console <ExternalLink className="inline h-3 w-3" /></a>, create a project and add a <b>Web app</b>.</li>
        <li>Paste its <code>firebaseConfig</code> below (or fill the fields).</li>
        <li>Project settings → Cloud Messaging → <b>Web Push certificates</b> → generate a key pair and paste the public key as the VAPID key.</li>
        <li>Project settings → Service accounts → <b>Generate new private key</b>, and save the whole JSON file below (kept server-side only).</li>
      </ol>
      <div>
        <span className="label">Paste firebaseConfig (optional)</span>
        <div className="flex gap-2">
          <Textarea rows={2} value={snippet} onChange={(e) => setSnippet(e.target.value)} placeholder={'const firebaseConfig = { apiKey: "…", projectId: "…", … }'} className="min-h-0 flex-1 font-mono text-xs" />
          <button type="button" onClick={apply} disabled={!snippet.trim()} className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><ClipboardPaste className="h-3.5 w-3.5" />Fill</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label, ph]) => (
          <Field key={k} label={label}><Input value={cfg[k]} onChange={(e) => set((p) => { p[k] = e.target.value.trim() })} placeholder={ph} className="font-mono text-xs" spellCheck={false} /></Field>
        ))}
        <Field label="Web push certificate (VAPID public key)" className="sm:col-span-2"><Input value={cfg.vapidKey} onChange={(e) => set((p) => { p.vapidKey = e.target.value.trim() })} placeholder="BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" className="font-mono text-xs" spellCheck={false} /></Field>
      </div>
      <SecretInput name="fcm_service_account" secrets={secrets} />
      <p className="text-xs text-slate-500">The web config above is public (it ships to browsers). The service-account JSON lets the <b>notify</b> function send — it is write-only and never shown again. People turn notifications on per device from their profile menu or the Notice Board; on iPhone the app must be added to the Home Screen first. Push messages are free.</p>
    </div>
  )
}

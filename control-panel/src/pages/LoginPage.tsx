import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button, Field, Input } from '../../../src/components/ui'
import { platformName } from '../../../src/lib/supabase'
import { cp, friendly, isDemo } from '../api'
import type { CpMe } from '../types'

const DEMO = [
  { email: 'admin@hospitalcomrade.demo', label: 'Admin', hint: 'everything' },
  { email: 'finance@hospitalcomrade.demo', label: 'Finance', hint: 'payments & wallets' },
  { email: 'support@hospitalcomrade.demo', label: 'Support', hint: 'City Care, read-only' },
]

export function LoginPage({ onSignedIn, error }: { onSignedIn: (m: CpMe) => void; error?: unknown }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(error ? friendly(error) : null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setProblem(null)
    try { onSignedIn(await cp.signIn(email, password)) } catch (err) { setProblem(friendly(err)) } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm animate-pop-in">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25"><ShieldCheck className="h-6 w-6" /></span>
          <h1 className="font-display text-2xl font-bold">{platformName}</h1>
          <p className="text-sm text-brand-200">Control panel · platform team only</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-lift">
          <Field label="Work e-mail" required>
            <Input id="cp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" required>
            <Input id="cp-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {problem && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{problem}</p>}
          <Button type="submit" loading={busy} className="w-full">Sign in</Button>
          <p className="text-center text-xs text-slate-500">Hospital staff? Sign in on your hospital’s own website.</p>
        </form>
        {isDemo && (
          <div className="mt-4 rounded-2xl bg-white/10 p-4 text-white ring-1 ring-white/15">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-200">Demo accounts · password Demo@123</p>
            <div className="grid gap-1.5">
              {DEMO.map((d) => (
                <button key={d.email} type="button" onClick={() => { setEmail(d.email); setPassword('Demo@123'); setProblem(null) }}
                  className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2 text-left text-sm hover:bg-white/20">
                  <span className="font-medium">{d.label}</span><span className="text-xs text-brand-200">{d.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

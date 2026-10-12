import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button, Field, Input } from '../../../src/components/ui'
import { platformName } from '../../../src/lib/supabase'
import { backendMissing, cp, friendly } from '../api'
import type { CpMe, OtpStatus } from '../types'
import { OtpStep } from '../../../src/components/auth/OtpStep'

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
    <Frame>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-lift">
          <Field label="Work e-mail" required>
            <Input id="cp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" required>
            <Input id="cp-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {problem && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{problem}</p>}
          {backendMissing && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Database not connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on the server, then redeploy.</p>}
          <Button type="submit" loading={busy} disabled={backendMissing} className="w-full">Sign in</Button>
          <p className="text-center text-xs text-slate-500">Hospital staff? Sign in on your hospital’s own website.</p>
        </form>
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm animate-pop-in">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25"><ShieldCheck className="h-6 w-6" /></span>
          <h1 className="font-display text-2xl font-bold">{platformName}</h1>
          <p className="text-sm text-brand-200">Control panel · platform team only</p>
        </div>
        {children}
      </div>
    </div>
  )
}

/** the team's sign-in code (Platform settings → Security) after the password */
export function OtpScreen({ status, onVerified, onCancel }: { status: OtpStatus; onVerified: (m: CpMe | null) => void; onCancel: () => void }) {
  return (
    <Frame>
      <div className="rounded-2xl bg-white p-6 shadow-lift">
        <OtpStep status={status} title="Enter your sign-in code" onCancel={onCancel}
          onRequest={async (c) => { try { return await cp.requestOtp(c) } catch (e) { throw new Error(friendly(e)) } }}
          onVerify={async (code) => { const m = await cp.verifyOtp(code); onVerified(m) }} />
      </div>
    </Frame>
  )
}

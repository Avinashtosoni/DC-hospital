import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field, Input } from '../components/ui'
import { AuthShell } from './Login'

export default function Register() {
  const { user, signUp } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  if (user) return <Navigate to="/" replace />
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('Password must be at least 6 characters')
    if (form.password !== form.confirm) return setError('Passwords do not match')
    setLoading(true)
    try {
      await signUp({ full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password })
      toast.success('Account created — welcome to DC Hospital!')
      nav('/', { replace: true })
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Create your patient account</h2>
      <p className="mt-1 text-sm text-slate-500">Book appointments, view prescriptions, lab reports and bills online.</p>
      <form onSubmit={submit} className="mt-8 grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2"><Input required value={form.full_name} onChange={set('full_name')} placeholder="Anita Sharma" /></Field>
        <Field label="Email" required><Input type="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" /></Field>
        <Field label="Phone"><Input type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" /></Field>
        <Field label="Password" required><Input type="password" required value={form.password} onChange={set('password')} /></Field>
        <Field label="Confirm password" required><Input type="password" required value={form.confirm} onChange={set('confirm')} /></Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200 sm:col-span-2">{error}</p>}
        <Button type="submit" className="sm:col-span-2" loading={loading}>Create account</Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">Already registered? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></p>
      <p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 ring-1 ring-slate-200">Staff accounts (doctors, receptionists, accountants…) are created by signing up and then being promoted by the Hospital Owner under <b>Users &amp; Roles</b>.</p>
    </AuthShell>
  )
}

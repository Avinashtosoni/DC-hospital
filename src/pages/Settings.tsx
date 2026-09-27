import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Database, KeyRound, RefreshCw, Save, ShieldCheck, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../data/adapter'
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, PageHeader } from '../components/ui'
import { ROLE_LABEL } from '../types'
import { PERMISSIONS } from '../auth/permissions'
import { isSupabaseConfigured } from '../lib/supabase'
import { titleCase } from '../lib/utils'

export default function Settings() {
  const { user, refresh } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState({ full_name: user!.full_name, phone: user!.phone ?? '' })
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const save = async () => {
    if (!form.full_name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      await db.update('profiles', user!.id, { full_name: form.full_name.trim(), phone: form.phone || null })
      await refresh()
      qc.invalidateQueries({ queryKey: ['table', 'profiles'] })
      toast.success('Profile updated')
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }
  const reset = async () => {
    setResetOpen(false)
    await db.reset?.()
    qc.clear()
    await refresh()
    toast.success('Demo data restored')
  }
  const modules = Object.entries(PERMISSIONS).filter(([, m]) => m[user!.role]?.length)

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Manage your profile and application preferences." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Your profile" icon={<UserRound className="h-4 w-4" />} />
          <div className="flex flex-col gap-6 p-5 sm:flex-row">
            <div className="flex flex-col items-center gap-2 sm:w-40">
              <Avatar name={form.full_name} size="xl" />
              <Badge tone="teal">{ROLE_LABEL[user!.role]}</Badge>
            </div>
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" required><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Email" hint="Email is tied to your login and can't be changed here" className="sm:col-span-2"><Input value={user!.email} disabled /></Field>
              <div className="sm:col-span-2"><Button onClick={save} loading={saving} icon={<Save className="h-4 w-4" />}>Save changes</Button></div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your access" subtitle="Modules available to your role" icon={<ShieldCheck className="h-4 w-4" />} />
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {modules.map(([table, m]) => (
              <div key={table} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{titleCase(table)}</span>
                <span className="flex gap-1">{m[user!.role]!.map((a) => <Badge key={a} tone={a === 'delete' ? 'red' : a === 'read' ? 'slate' : 'teal'}>{a}</Badge>)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Data storage" icon={<Database className="h-4 w-4" />} />
          <div className="space-y-4 p-5 text-sm">
            {isSupabaseConfigured ? (
              <p className="flex items-center gap-2 text-slate-600"><Badge tone="green" dot>Connected</Badge>Data is stored in your Supabase Postgres database and protected with Row Level Security.</p>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2 text-slate-600"><Badge tone="amber" dot>Demo mode</Badge>Data is persisted in this browser (localStorage). Connect Supabase to share data across devices and users.</p>
                <ol className="list-decimal space-y-1 pl-5 text-slate-600">
                  <li>Create a project at supabase.com and open the <b>SQL editor</b>.</li>
                  <li>Run the whole <code className="rounded bg-slate-100 px-1">supabase/master.sql</code> file (schema, RLS, triggers and demo data).</li>
                  <li>Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to <code className="rounded bg-slate-100 px-1">.env</code> and set <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> / <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_ANON_KEY</code>.</li>
                  <li>Restart the dev server and sign in with any demo account (<KeyRound className="inline h-3 w-3" /> Demo@123).</li>
                </ol>
                <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setResetOpen(true)}>Reset demo data</Button>
              </>
            )}
          </div>
        </Card>
      </div>
      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={reset} confirmLabel="Reset data" title="Reset all demo data?" description="Every change you made in this browser will be discarded and the original demo data restored. Accounts you registered will be removed." />
    </div>
  )
}

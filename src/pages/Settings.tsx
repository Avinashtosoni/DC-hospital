import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Database, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../data/adapter'
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, PageHeader } from '../components/ui'
import { ROLE_LABEL } from '../types'
import { PERMISSIONS } from '../auth/permissions'
import { isSupabaseConfigured } from '../lib/supabase'
import { titleCase } from '../lib/utils'

export default function Settings() {
  const { user, refresh } = useAuth()
  const qc = useQueryClient()
  const [resetOpen, setResetOpen] = useState(false)

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
      <PageHeader title="Settings" description="Your access and application data." />
      <div className="space-y-6">
        <Link to="/profile" className="card flex items-center gap-4 p-5 transition hover:shadow-md">
          <Avatar name={user!.full_name} src={user!.avatar_url} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-brand-950">{user!.full_name} <Badge tone="violet" className="ml-1">{ROLE_LABEL[user!.role]}</Badge></p>
            <p className="text-sm text-slate-500">Photo, personal details, password and preferences now live on your profile page.</p>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">My profile<ArrowRight className="h-4 w-4" /></span>
        </Link>

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

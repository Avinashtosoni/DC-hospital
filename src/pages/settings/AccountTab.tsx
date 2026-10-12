import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { PERMISSIONS } from '../../auth/permissions'
import { Avatar, Badge } from '../../components/ui'
import { titleCase } from '../../lib/utils'
import { ROLE_LABEL } from '../../types'
import { Section } from './shared'

export function AccountTab() {
  const { user } = useAuth()
  const modules = Object.entries(PERMISSIONS).filter(([, m]) => m[user!.role]?.length)
  return (
    <div className="space-y-6">
      <Link to="/profile" className="card flex items-center gap-4 p-5 transition hover:shadow-md">
        <Avatar name={user!.full_name} src={user!.avatar_url} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-brand-950">{user!.full_name} <Badge tone="violet" className="ml-1">{ROLE_LABEL[user!.role]}</Badge></p>
          <p className="text-sm text-slate-500">Photo, personal details, password and preferences live on your profile page.</p>
        </div>
        <span className="hidden items-center gap-1 text-sm font-medium text-brand-700 sm:inline-flex">My profile<ArrowRight className="h-4 w-4" /></span>
      </Link>
      <Section title="Your access" description="What your role can do in each module" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-2">
          {modules.map(([table, m]) => (
            <div key={table} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-700">{titleCase(table)}</span>
              <span className="flex gap-1">{m[user!.role]!.map((a) => <Badge key={a} tone={a === 'delete' ? 'red' : a === 'read' ? 'slate' : 'teal'}>{a}</Badge>)}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, BellRing, ChevronLeft, ChevronRight, CircleCheck, Download, Eye, EyeOff, KeyRound, MoreHorizontal, Pencil, Plus, Search, Trash2, UserCog, Users, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { validEmail } from '../../auth/passwordReset'
import { Avatar, Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, Field, Input, Modal, Select, Skeleton } from '../../components/ui'
import { useDebounced } from '../../components/ResourcePage'
import { qk, useCount, useRows } from '../../hooks/useData'
import { usersApi, type UserInput, type UserStatus } from '../../settings/messaging'
import { ago, cn, downloadCsv, fmtDate } from '../../lib/utils'
import { ROLE_LABEL, ROLES, type Profile, type Role } from '../../types'

const PAGE = 15
const ROLE_TONE: Record<Role, 'violet' | 'blue' | 'teal' | 'amber' | 'green' | 'slate'> = { owner: 'violet', doctor: 'blue', receptionist: 'teal', accountant: 'amber', staff: 'green', patient: 'slate' }
type StatusFilter = 'all' | 'active' | 'disabled'

const strongPassword = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', s = '@#$%&*!'
  const r = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(r, (n, i) => (i === 5 ? s[n % s.length] : a[n % a.length])).join('')
}

/** Settings → Users & accounts: the owner creates, edits, disables and deletes sign-ins for every role. */
export function UsersTab() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const search = useDebounced(term.trim())
  const [role, setRole] = useState<Role | 'all'>('all')
  const [statusF, setStatusF] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const [pwFor, setPwFor] = useState<Profile | null>(null)
  const [del, setDel] = useState<Profile | null>(null)
  useEffect(() => setPage(1), [search, role])

  const counts = Object.fromEntries(ROLES.map((r) => [r, useCount('profiles', [['role', 'eq', r]])])) as Record<Role, ReturnType<typeof useCount>>
  const total = ROLES.reduce((s, r) => s + (counts[r].count ?? 0), 0)

  const q = useRows('profiles', {
    where: role === 'all' ? [] : [['role', 'eq', role]],
    search: search ? { term: search, columns: ['full_name', 'email', 'phone'] } : undefined,
    order: [{ column: 'created_at', asc: false }],
    range: [(page - 1) * PAGE, page * PAGE - 1], count: true,
  }, { keepPrevious: true })
  const rows = q.data?.rows ?? []
  const pages = Math.max(1, Math.ceil((q.data?.count ?? 0) / PAGE))
  const ids = rows.map((r) => r.id)
  const st = useQuery({ queryKey: ['user-status', ids], queryFn: () => usersApi.status(ids), enabled: ids.length > 0, staleTime: 15_000 })
  const status = useMemo(() => new Map((st.data ?? []).map((s) => [s.id, s])), [st.data])
  const shown = statusF === 'all' ? rows : rows.filter((r) => (statusF === 'disabled') === !!status.get(r.id)?.disabled)

  const refresh = () => { qc.invalidateQueries({ queryKey: qk('profiles') }); qc.invalidateQueries({ queryKey: ['user-status'] }); for (const t of ['patients', 'doctors', 'staff'] as const) qc.invalidateQueries({ queryKey: qk(t) }) }
  const toggle = useMutation({
    mutationFn: ({ p, active }: { p: Profile; active: boolean }) => usersApi.setActive(p.id, active),
    onMutate: ({ p, active }) => { qc.setQueryData<UserStatus[]>(['user-status', ids], (old) => old?.map((s) => (s.id === p.id ? { ...s, disabled: !active } : s))) },
    onSuccess: (_d, { p, active }) => toast.success(active ? `${p.full_name} can sign in again` : `${p.full_name} can no longer sign in`),
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ['user-status'] }) },
  })
  const remove = useMutation({
    mutationFn: (p: Profile) => usersApi.remove(p.id),
    onSuccess: (_d, p) => { toast.success(`${p.full_name}'s account was deleted`); setDel(null); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 border-b border-slate-100 p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><UserCog className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900">Users & accounts</h3>
            <p className="text-sm text-slate-500">Create sign-ins for doctors, staff and patients, change roles, reset passwords, or turn access off. Welcome and security messages go out automatically — edit them in <Link to="/settings?tab=notifications" className="font-medium text-brand-700 hover:underline">Notifications</Link>.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" icon={<Download className="h-4 w-4" />} disabled={!rows.length}
              onClick={() => downloadCsv('users.csv', rows.map((r) => ({ name: r.full_name, email: r.email, phone: r.phone ?? '', role: ROLE_LABEL[r.role], status: status.get(r.id)?.disabled ? 'disabled' : 'active', last_sign_in: status.get(r.id)?.last_sign_in_at ?? '', created: r.created_at })))}>Export page</Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New user</Button>
          </div>
        </div>
        {/* role chips double as filter */}
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3">
          <RoleChip active={role === 'all'} onClick={() => setRole('all')} label="Everyone" n={total} loading={counts.owner.isLoading} />
          {ROLES.map((r) => <RoleChip key={r} active={role === r} onClick={() => setRole(r)} label={ROLE_LABEL[r]} n={counts[r].count ?? 0} loading={counts[r].isLoading} />)}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name, e-mail or phone…" className="pl-9 pr-8" aria-label="Search users" />
            {term && <button type="button" onClick={() => setTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <Select value={statusF} onChange={(e) => setStatusF(e.target.value as StatusFilter)} className="w-40" aria-label="Status">
            <option value="all">Any status</option><option value="active">Active</option><option value="disabled">Disabled</option>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2.5 text-left">User</th><th className="px-4 py-2.5 text-left">Role</th><th className="px-4 py-2.5 text-left">Mobile</th><th className="px-4 py-2.5 text-left">Status</th><th className="px-4 py-2.5 text-left">Last sign-in</th><th className="px-4 py-2.5 text-left">Created</th><th className="w-12" /></tr>
            </thead>
            <tbody className={cn('divide-y divide-slate-100', q.isPlaceholderData && 'opacity-60')}>
              {q.isLoading && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-5 py-3"><Skeleton className="h-9" /></td></tr>)}
              {shown.map((p) => {
                const s = status.get(p.id), me = p.id === user?.id
                return (
                  <tr key={p.id} className="group hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                        <div className="min-w-0"><p className="truncate font-medium text-slate-900">{p.full_name}{me && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}</p><p className="truncate text-xs text-slate-500">{p.email}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge tone={ROLE_TONE[p.role]}>{ROLE_LABEL[p.role]}</Badge></td>
                    <td className="px-4 py-3 text-slate-600">{p.phone || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">{st.isLoading ? <Skeleton className="h-5 w-16" /> : s?.disabled ? <Badge tone="red" dot>Disabled</Badge> : <Badge tone="green" dot>Active</Badge>}</td>
                    <td className="px-4 py-3 text-slate-500">{s?.last_sign_in_at ? ago(s.last_sign_in_at) : <span className="text-slate-300">never</span>}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(p.created_at)}</td>
                    <td className="px-2 py-3 text-right">
                      <UserMenu me={me} disabled={!!s?.disabled} onEdit={() => setEditing(p)} onPassword={() => setPwFor(p)}
                        onToggle={() => toggle.mutate({ p, active: !!s?.disabled })} onDelete={() => setDel(p)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!q.isLoading && !shown.length && (
            <EmptyState icon={<Users className="h-6 w-6" />} title={search || role !== 'all' || statusF !== 'all' ? 'No users match' : 'No users yet'}
              description={search ? `Nothing found for “${search}”.` : 'Create the first account with “New user”.'}
              action={search || role !== 'all' || statusF !== 'all' ? <Button variant="outline" size="sm" onClick={() => { setTerm(''); setRole('all'); setStatusF('all') }}>Clear filters</Button> : undefined} />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>{q.data?.count ?? 0} {role === 'all' ? 'users' : ROLE_LABEL[role].toLowerCase() + ' accounts'}{statusF !== 'all' && ' · status filter applies to this page'}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <span className="px-2">Page {page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </Card>

      <UserDrawer key={editing === 'new' ? 'new' : editing?.id ?? 'none'} user={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <PasswordModal user={pwFor} onClose={() => setPwFor(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} confirmLabel="Delete account"
        title={`Delete ${del?.full_name ?? ''}'s account?`}
        description="Their sign-in is removed permanently. Medical, billing and staff records stay — they are just unlinked from this login. To pause access instead, use Disable." />
    </div>
  )
}

function RoleChip({ active, onClick, label, n, loading }: { active: boolean; onClick: () => void; label: string; n: number; loading?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', active ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-600 ring-slate-200 hover:ring-brand-300')}>
      {label}<span className={cn('rounded-full px-1.5 tabular-nums', active ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{loading ? '…' : n}</span>
    </button>
  )
}

function UserMenu({ me, disabled, onEdit, onPassword, onToggle, onDelete }: { me: boolean; disabled: boolean; onEdit: () => void; onPassword: () => void; onToggle: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
  const run = (f: () => void) => () => { setOpen(false); f() }
  return (
    <div className="relative inline-block">
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} aria-label="Account actions" aria-expanded={open}><MoreHorizontal className="h-4 w-4" /></Button>
      {open && <>
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
          <button role="menuitem" className={item} onClick={run(onEdit)}><Pencil className="h-4 w-4 text-slate-400" />Edit details</button>
          <button role="menuitem" className={item} onClick={run(onPassword)}><KeyRound className="h-4 w-4 text-slate-400" />Set password</button>
          <button role="menuitem" className={item} disabled={me} onClick={run(onToggle)}>{disabled ? <><CircleCheck className="h-4 w-4 text-emerald-500" />Enable sign-in</> : <><Ban className="h-4 w-4 text-amber-500" />Disable sign-in</>}</button>
          <div className="my-1 border-t border-slate-100" />
          <button role="menuitem" className={cn(item, 'text-rose-600')} disabled={me} onClick={run(onDelete)}><Trash2 className="h-4 w-4" />Delete account</button>
        </div>
      </>}
    </div>
  )
}

function UserDrawer({ user: u, onClose, onSaved }: { user: Profile | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = u === 'new'
  const cur = u === 'new' ? null : u
  const [d, setD] = useState<UserInput>(() => ({ email: cur?.email ?? '', full_name: cur?.full_name ?? '', role: cur?.role ?? 'staff', phone: cur?.phone ?? '', password: '' }))
  const [touched, setTouched] = useState(false)
  const [show, setShow] = useState(false)
  const set = <K extends keyof UserInput>(k: K, v: UserInput[K]) => setD((x) => ({ ...x, [k]: v }))
  const errors = {
    full_name: d.full_name.trim().length < 2 ? 'Enter the full name' : '',
    email: !validEmail(d.email) ? 'Enter a valid e-mail address' : '',
    phone: d.phone && d.phone.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit mobile number' : '',
    password: isNew && d.password && d.password.length < 8 ? 'At least 8 characters' : '',
  }
  const save = useMutation({
    mutationFn: async () => {
      const row = { ...d, email: d.email.trim(), full_name: d.full_name.trim(), phone: d.phone?.trim() || null }
      if (isNew) await usersApi.create(row)
      else if (cur) await usersApi.update(cur.id, { email: row.email, full_name: row.full_name, role: row.role, phone: row.phone })
    },
    onSuccess: () => { toast.success(isNew ? `Account created for ${d.full_name.trim()}` : 'Account updated'); onSaved(); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  const submit = () => { setTouched(true); if (!Object.values(errors).some(Boolean)) save.mutate() }
  const err = (k: keyof typeof errors) => (touched ? errors[k] || undefined : undefined)
  const roleChanged = cur && cur.role !== d.role
  return (
    <Drawer open={!!u} onClose={onClose} title={isNew ? 'New user account' : `Edit ${cur?.full_name ?? ''}`}
      subtitle={isNew ? 'They can sign in straight away with this e-mail.' : cur?.email}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{isNew ? 'Create account' : 'Save changes'}</Button></div>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label="Full name" required error={err('full_name')}><Input value={d.full_name} onChange={(e) => set('full_name', e.target.value)} autoFocus placeholder="e.g. Dr. Kavya Iyer" /></Field>
        <Field label="E-mail (sign-in)" required error={err('email')} hint={!isNew ? 'Changing it changes the sign-in address too.' : undefined}><Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" autoComplete="off" /></Field>
        <Field label="Mobile" error={err('phone')} hint="Used for SMS / WhatsApp messages and mobile password reset."><Input type="tel" value={d.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98xxxxxxxx" /></Field>
        <Field label="Role" required hint={roleChanged ? <span className="text-amber-700">Their menu and permissions change at next page load.</span> : 'Decides what they can see and do.'}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ROLES.map((r) => (
              <button key={r} type="button" onClick={() => set('role', r)} aria-pressed={d.role === r}
                className={cn('rounded-xl px-3 py-2 text-left text-sm ring-1 transition', d.role === r ? 'bg-brand-50 font-semibold text-brand-900 ring-brand-400' : 'text-slate-600 ring-slate-200 hover:ring-brand-200')}>{ROLE_LABEL[r]}</button>
            ))}
          </div>
        </Field>
        {isNew && (
          <Field label="Password" error={err('password')} hint="Leave blank and they can set their own with “Forgot password” from the welcome message.">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input type={show ? 'text' : 'password'} value={d.password ?? ''} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" className="pr-9" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <Button type="button" variant="outline" icon={<Wand2 className="h-4 w-4" />} onClick={() => { set('password', strongPassword()); setShow(true) }}>Generate</Button>
            </div>
          </Field>
        )}
        <p className="flex items-start gap-2 rounded-xl bg-brand-50/60 p-3 text-xs text-brand-900"><BellRing className="mt-0.5 h-4 w-4 shrink-0" />{isNew ? 'An “Account created” welcome message is sent on the channels you enabled for it.' : 'An “Account updated” message tells them what changed.'}</p>
      </form>
    </Drawer>
  )
}

function PasswordModal({ user: u, onClose }: { user: Profile | null; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(true)
  useEffect(() => { if (u) setPw('') }, [u])
  const m = useMutation({
    mutationFn: () => usersApi.setPassword(u!.id, pw),
    onSuccess: () => { toast.success(`Password updated for ${u!.full_name}`); onClose() },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Modal open={!!u} onClose={onClose} title={`Set password · ${u?.full_name ?? ''}`}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={pw.length < 8} onClick={() => m.mutate()}>Update password</Button></div>}>
      <div className="space-y-3">
        <Field label="New password" hint="At least 8 characters. Share it privately — they get a “Password changed” alert.">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus className="pr-9" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
            <Button type="button" variant="outline" icon={<Wand2 className="h-4 w-4" />} onClick={() => setPw(strongPassword())}>Generate</Button>
          </div>
        </Field>
        {pw && <Button type="button" variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(pw); toast.success('Copied') }}>Copy password</Button>}
      </div>
    </Modal>
  )
}

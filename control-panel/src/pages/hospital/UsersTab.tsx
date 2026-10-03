import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Copy, KeyRound, LogIn, Play, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, type Tone } from '../../../../src/components/ui'
import { cp, friendly } from '../../api'
import type { CpHospitalDetail, HospitalUser, HospitalUserRole, UserAction } from '../../types'
import { dateTime, ErrorBox, isAdmin, Section, useMe } from '../../ui'

const ROLES: { value: HospitalUserRole; label: string; tone: Tone }[] = [
  { value: 'owner', label: 'Owner', tone: 'violet' }, { value: 'doctor', label: 'Doctor', tone: 'blue' },
  { value: 'receptionist', label: 'Receptionist', tone: 'teal' }, { value: 'accountant', label: 'Accountant', tone: 'amber' },
  { value: 'staff', label: 'Staff', tone: 'slate' }, { value: 'patient', label: 'Patient', tone: 'pink' },
]
const roleOf = (r: string) => ROLES.find((x) => x.value === r) ?? { value: r as HospitalUserRole, label: r, tone: 'slate' as Tone }
const siteBase = (h: CpHospitalDetail) => (h.domain ? `https://${h.domain}` : location.origin)
const withHospital = (h: CpHospitalDetail, path: string) => `${siteBase(h)}${path}${h.domain ? '' : `${path.includes('?') ? '&' : '?'}hospital=${encodeURIComponent(h.slug)}`}`

/** Phase B: the hospital's accounts. Same rules as the hospital's own Users page (a hospital always keeps an owner). */
export function UsersTab({ h }: { h: CpHospitalDetail }) {
  const { me } = useMe()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('staff_all')
  const [page, setPage] = useState(0)
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<HospitalUser | null>(null)
  const [actAs, setActAs] = useState<HospitalUser | null>(null)
  const q = useQuery({ queryKey: ['cp-users', h.id, role, search, page], queryFn: () => cp.users(h.id, search, role, page * 50), placeholderData: keepPreviousData })
  const refresh = () => { for (const k of ['cp-users', 'cp-hospital']) qc.invalidateQueries({ queryKey: [k] }) }
  const act = useMutation({
    mutationFn: ({ action, user, args }: { action: UserAction; user?: HospitalUser; args?: Record<string, unknown>; ok: string }) =>
      action === 'password_reset' ? cp.sendPasswordReset(h.id, user!.id, user!.email!, withHospital(h, '/reset-password')).then(() => null)
        : cp.userAction(h.id, action, user?.id ?? null, args),
    onSuccess: (_r, v) => { toast.success(v.ok); setRemoving(null); refresh() },
    onError: (e) => toast.error(friendly(e)),
  })
  const busy = (id: string, a: UserAction) => act.isPending && act.variables?.user?.id === id && act.variables.action === a
  const copyInvite = (token: string) => { void navigator.clipboard?.writeText(withHospital(h, `/register?invite=${token}`)); toast.success('Invitation link copied') }

  return (
    <div className="space-y-6">
      <Section title="Accounts" subtitle="Change a role, block, send a password reset or remove. The hospital’s owner sees the same list in its Settings → Users."
        action={<Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setInviting(true)}>Invite staff</Button>}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Name, e-mail or phone" className="pl-9" aria-label="Search accounts" />
          </div>
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(0) }} className="sm:w-48" aria-label="Filter by role">
            <option value="staff_all">All staff</option><option value="">Everyone (incl. patients)</option>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}s</option>)}
          </Select>
        </div>
        {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          : !q.data ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : !q.data.rows.length ? <EmptyState icon={<Users className="h-6 w-6" />} title="No accounts match" />
          : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-2">Name</th><th className="px-5 py-2">Role</th><th className="hidden px-5 py-2 md:table-cell">Last sign-in</th><th className="px-5 py-2 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.rows.map((u) => (
                    <tr key={u.id} className={u.blocked ? 'bg-slate-50/80' : undefined}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-slate-800">{u.full_name} {u.blocked && <Badge tone="red">Blocked</Badge>}</p>
                        <p className="text-xs text-slate-500">{u.email ?? '—'}{u.phone ? ` · ${u.phone}` : ''}</p>
                      </td>
                      <td className="px-5 py-2.5">
                        {u.role === 'patient' ? <Badge tone="pink">Patient</Badge> : (
                          <Select value={u.role} aria-label={`Role of ${u.full_name}`} className="h-8 w-36 py-0 text-xs" disabled={act.isPending}
                            onChange={(e) => act.mutate({ action: 'update', user: u, args: { role: e.target.value }, ok: `${u.full_name} is now ${roleOf(e.target.value).label}` })}>
                            {ROLES.filter((r) => r.value !== 'patient').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-5 py-2.5 text-xs text-slate-500 md:table-cell">{u.last_sign_in_at ? dateTime(u.last_sign_in_at) : 'never'}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex justify-end gap-1">
                          {u.email && <Button size="sm" variant="ghost" title="E-mail a password reset link" icon={<KeyRound className="h-3.5 w-3.5" />} loading={busy(u.id, 'password_reset')}
                            onClick={() => act.mutate({ action: 'password_reset', user: u, ok: `Password reset e-mailed to ${u.email}` })}><span className="sr-only">Reset password</span></Button>}
                          {u.blocked
                            ? <Button size="sm" variant="ghost" title="Unblock" icon={<Play className="h-3.5 w-3.5" />} loading={busy(u.id, 'enable')} onClick={() => act.mutate({ action: 'enable', user: u, ok: `${u.full_name} can sign in again` })}><span className="sr-only">Unblock</span></Button>
                            : <Button size="sm" variant="ghost" title="Block sign-in" icon={<Ban className="h-3.5 w-3.5" />} loading={busy(u.id, 'disable')} onClick={() => act.mutate({ action: 'disable', user: u, ok: `${u.full_name} is blocked and signed out` })}><span className="sr-only">Block</span></Button>}
                          {isAdmin(me.role) && u.role !== 'patient' && !u.blocked && <Button size="sm" variant="ghost" title="Sign in as this user" icon={<LogIn className="h-3.5 w-3.5" />} onClick={() => setActAs(u)}><span className="sr-only">Sign in as</span></Button>}
                          {isAdmin(me.role) && <Button size="sm" variant="ghost" title="Remove account" icon={<Trash2 className="h-3.5 w-3.5 text-rose-600" />} onClick={() => setRemoving(u)}><span className="sr-only">Remove</span></Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {q.data && q.data.total > 50 && (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>{page * 50 + 1}–{Math.min((page + 1) * 50, q.data.total)} of {q.data.total.toLocaleString('en-IN')}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= q.data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Section>

      {!!q.data?.invites.length && (
        <Section title="Pending invitations" subtitle="They create their account from the link (valid 14 days).">
          <ul className="divide-y divide-slate-100">
            {q.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium text-slate-800">{i.full_name} <Badge tone={roleOf(i.role).tone}>{roleOf(i.role).label}</Badge></p><p className="text-xs text-slate-500">{i.email} · until {dateTime(i.expires_at)}</p></div>
                <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copyInvite(i.token)}>Copy link</Button>
                <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} loading={act.isPending && act.variables?.action === 'revoke_invite' && act.variables.args?.invite_id === i.id}
                  onClick={() => act.mutate({ action: 'revoke_invite', args: { invite_id: i.id }, ok: 'Invitation cancelled' })}>Cancel</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <InviteModal open={inviting} onClose={() => setInviting(false)} onSent={(token) => { setInviting(false); refresh(); copyInvite(token) }} h={h} />
      <ImpersonateModal user={actAs} h={h} onClose={() => setActAs(null)} />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} loading={act.isPending}
        title={`Remove ${removing?.full_name}?`} confirmLabel="Remove account"
        description="Their sign-in is deleted. Records they created (appointments, bills, notes) stay. A hospital’s last owner can’t be removed."
        onConfirm={() => removing && act.mutate({ action: 'delete', user: removing, ok: `${removing.full_name} was removed` })} />
    </div>
  )
}

function InviteModal({ open, onClose, onSent, h }: { open: boolean; onClose: () => void; onSent: (token: string) => void; h: CpHospitalDetail }) {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', role: 'staff' })
  const send = useMutation({
    mutationFn: () => cp.userAction(h.id, 'invite', null, f),
    onSuccess: (r) => { toast.success(`Invitation sent to ${f.email}`, { description: 'The link is copied too.' }); setF({ full_name: '', email: '', phone: '', role: 'staff' }); onSent(r.token!) },
    onError: (e) => toast.error(friendly(e)),
  })
  return (
    <Modal open={open} onClose={onClose} title={`Invite staff to ${h.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<UserPlus className="h-4 w-4" />} loading={send.isPending}
        disabled={f.full_name.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())} onClick={() => send.mutate()}>Send invitation</Button></>}>
      <div className="grid gap-3">
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mobile (optional)" hint="Gets the link on SMS / WhatsApp if on"><Input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.filter((r) => r.value !== 'patient').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
        </div>
      </div>
    </Modal>
  )
}

/** "Sign in as user": admins only, a written reason and the admin's password; 30 minutes; the hospital app shows a banner. */
function ImpersonateModal({ user, h, onClose }: { user: HospitalUser | null; h: CpHospitalDetail; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setReason(''); setPassword(''); onClose() }
  const start = async () => {
    if (!user) return
    // open the tab inside the click (pop-up blockers), point it at the hospital app once the session is ready
    const w = window.open('about:blank', '_blank')
    setBusy(true)
    try {
      const r = await cp.impersonate(user.id, reason.trim(), password)
      if (w) { w.opener = null; w.location.replace(r.url) } else window.open(r.url, '_blank', 'noopener')
      toast.success(`Signed in as ${r.email} in a new tab`, { description: 'Ends by itself after 30 minutes. Everything is logged.' })
      close()
    } catch (e) {
      w?.close()
      toast.error(friendly(e))
    } finally { setBusy(false) }
  }
  return (
    <Modal open={!!user} onClose={close} title={`Sign in as ${user?.full_name}`}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button icon={<LogIn className="h-4 w-4" />} loading={busy}
        disabled={reason.trim().length < 10 || !password} onClick={() => void start()}>Start 30-minute session</Button></>}>
      <div className="space-y-3 text-sm text-slate-600">
        <p>A new tab opens {h.name} as <b>{user?.email}</b> ({user?.role}) with a banner and an End button. You see and can do exactly what they can. The session, the reason and everything done are logged; it ends by itself after 30 minutes.</p>
        <Field label="Why (saved in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ticket #142 — doctor can’t see today’s appointments" /></Field>
        <Field label="Your password" hint="Confirms it is really you."><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

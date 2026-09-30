import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, MailPlus, Share2, UserX } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { useCreate, useTable, useUpdate } from '../../hooks/useData'
import { Badge, Button, Field, Input, Modal, Select } from '../../components/ui'
import { useSiteSettings } from '../../site/cms/content'
import { fmtDate } from '../../lib/utils'
import { ROLE_LABEL, STAFF_ROLES, type StaffInvite } from '../../types'

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('')
export const inviteLink = (base: string, token: string) => `${(base || window.location.origin).replace(/\/$/, '')}/register?invite=${token}`

/** "Invite staff" button + pending invitations (Users & Roles page, owner only). */
export function InviteStaff() {
  const { user } = useAuth()
  const site = useSiteSettings()
  const [open, setOpen] = useState(false)
  const invites = useTable('staff_invites', { enabled: user?.role === 'owner' })
  const create = useCreate('staff_invites', { silent: true })
  const update = useUpdate('staff_invites', { silent: true })
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'receptionist' as StaffInvite['role'] })
  const [created, setCreated] = useState<StaffInvite | null>(null)
  if (user?.role !== 'owner') return null

  const now = Date.now()
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending' && new Date(i.expires_at).getTime() > now)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.full_name.trim().length < 2 || !emailOk) return
    try {
      const row = await create.mutateAsync({
        full_name: form.full_name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() || null, role: form.role,
        token: randomToken(), status: 'pending', expires_at: new Date(now + 14 * 864e5).toISOString(), invited_by_name: user.full_name,
      } as never)
      setCreated(row as StaffInvite)
      setForm({ full_name: '', email: '', phone: '', role: form.role })
      toast.success('Invitation created', { description: 'It is also sent by SMS / WhatsApp / email when those are connected.' })
    } catch { /* toast shown by the hook */ }
  }
  const copy = async (i: StaffInvite) => {
    await navigator.clipboard?.writeText(inviteLink(site.siteUrl, i.token)).catch(() => null)
    toast.success('Invite link copied')
  }
  const share = (i: StaffInvite) => {
    const text = `Hi ${i.full_name.split(' ')[0]}, you're invited to join ${site.name} as ${ROLE_LABEL[i.role]}. Create your account: ${inviteLink(site.siteUrl, i.token)}`
    window.open(`https://wa.me/${(i.phone ?? '').replace(/\D/g, '').slice(-10) ? `91${(i.phone ?? '').replace(/\D/g, '').slice(-10)}` : ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  return (
    <>
      <Button variant="outline" icon={<MailPlus className="h-4 w-4" />} onClick={() => { setCreated(null); setOpen(true) }}>
        Invite staff{pending.length ? <Badge tone="violet" className="ml-1">{pending.length}</Badge> : null}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member" size="max-w-lg">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="Invite staff">
          <Field label="Full name" required><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={80} autoFocus /></Field>
          <Field label="Role" required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffInvite['role'] })}>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <Field label="Work e-mail" required hint="They must sign up with this e-mail" error={form.email && !emailOk ? 'Enter a valid e-mail' : undefined}>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Mobile (optional)" hint="For the SMS / WhatsApp invite"><Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={create.isPending} disabled={form.full_name.trim().length < 2 || !emailOk}>Create invitation</Button>
          </div>
        </form>

        {created && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm">
            <p className="font-medium text-emerald-900">Invitation for {created.full_name} is ready</p>
            <p className="mt-1 break-all font-mono text-xs text-emerald-800" data-testid="invite-link">{inviteLink(site.siteUrl, created.token)}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(created)}>Copy link</Button>
              <Button size="sm" variant="outline" icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => share(created)}>Send on WhatsApp</Button>
            </div>
          </div>
        )}

        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pending invitations</h3>
          {!pending.length ? <p className="mt-2 text-sm text-slate-500">No pending invitations.</p> : (
            <ul className="mt-2 divide-y divide-slate-100">
              {pending.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{i.full_name} <Badge tone="blue" className="ml-1">{ROLE_LABEL[i.role]}</Badge></p>
                    <p className="truncate text-xs text-slate-500">{i.email} · expires {fmtDate(i.expires_at)}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(i)} aria-label={`Copy link for ${i.full_name}`}>Link</Button>
                  <Button size="sm" variant="ghost" icon={<UserX className="h-3.5 w-3.5" />} onClick={() => update.mutate({ id: i.id, patch: { status: 'revoked' } })} aria-label={`Revoke invite for ${i.full_name}`}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  )
}

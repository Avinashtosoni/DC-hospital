import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Crown, Mail, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Select, Skeleton, Textarea } from '../../../../src/components/ui'
import { cp, friendly } from '../../api'
import type { CpHospitalDetail, HospitalProfile } from '../../types'
import { ErrorBox, isAdmin, Section, useMe } from '../../ui'
import { hospitalUrl } from '../../../../src/tenancy/urls'

const EMPTY: HospitalProfile = { name: '', tagline: '', address: '', phone: '', appointmentsPhone: '', whatsapp: '', email: '', logoUrl: '', legalName: '', gstin: '', pan: '', billingAddress: '' }

/** Phase A: what the hospital shows on its website / documents and its GST details, plus owner hand-over. */
export function DetailsTab({ h }: { h: CpHospitalDetail }) {
  const { me } = useMe()
  const qc = useQueryClient()
  const canEdit = me.role === 'admin' || me.role === 'support'
  const q = useQuery({ queryKey: ['cp-profile', h.id], queryFn: () => cp.profile(h.id) })
  const [f, setF] = useState<HospitalProfile>(EMPTY)
  useEffect(() => { if (q.data) setF({ ...EMPTY, ...q.data }) }, [q.data])
  const dirty = q.data ? (Object.keys(EMPTY) as (keyof HospitalProfile)[]).filter((k) => (f[k] ?? '') !== (q.data[k] ?? '')) : []
  const save = useMutation({
    mutationFn: () => cp.saveProfile(h.id, Object.fromEntries(dirty.map((k) => [k, f[k]]))),
    onSuccess: (r) => {
      qc.setQueryData(['cp-profile', h.id], r)
      for (const k of ['cp-hospital', 'cp-hospitals']) qc.invalidateQueries({ queryKey: [k] })
      toast.success('Details saved', { description: 'The hospital sees them on its website and documents right away.' })
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const set = (k: keyof HospitalProfile) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }))

  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-96" />
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Website & contact" subtitle="Shown on the hospital’s website, prescriptions and bills.">
          <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Hospital name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} maxLength={120} /></Field>
            <Field label="Tagline" className="sm:col-span-2"><Input value={f.tagline} onChange={set('tagline')} maxLength={160} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address} onChange={set('address')} maxLength={300} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
            <Field label="Appointments phone"><Input value={f.appointmentsPhone} onChange={set('appointmentsPhone')} inputMode="tel" /></Field>
            <Field label="WhatsApp"><Input value={f.whatsapp} onChange={set('whatsapp')} inputMode="tel" /></Field>
            <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
            <Field label="Logo address" hint="An https:// link to a PNG / SVG / WebP. The hospital can also upload one in its Settings → Appearance." className="sm:col-span-2">
              <div className="flex items-center gap-3">
                <Input value={f.logoUrl} onChange={set('logoUrl')} placeholder="https://…/logo.png" />
                {/^https:\/\//.test(f.logoUrl) && <img src={f.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-contain" />}
              </div>
            </Field>
          </fieldset>
        </Section>
        <Section title="Legal & GST" subtitle="Printed as the buyer on Hospital Comrade tax invoices.">
          <fieldset disabled={!canEdit} className="grid gap-3">
            <Field label="Legal name"><Input value={f.legalName} onChange={set('legalName')} maxLength={150} placeholder="e.g. City Care Hospital Pvt Ltd" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="GSTIN" hint="Blank if not registered"><Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="10ABCDE1234F1Z5" /></Field>
              <Field label="PAN"><Input value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="ABCDE1234F" /></Field>
            </div>
            <Field label="Billing address"><Textarea rows={3} value={f.billingAddress} onChange={set('billingAddress')} maxLength={300} /></Field>
          </fieldset>
        </Section>
      </div>
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {dirty.length > 0 && <span className="text-xs text-slate-500">{dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}</span>}
          <Button icon={<Save className="h-4 w-4" />} disabled={!dirty.length} loading={save.isPending} onClick={() => save.mutate()}>Save details</Button>
        </div>
      )}
      <OwnerSection h={h} canInvite={canEdit} />
    </div>
  )
}

function OwnerSection({ h, canInvite }: { h: CpHospitalDetail; canInvite: boolean }) {
  const { me } = useMe()
  const qc = useQueryClient()
  const [to, setTo] = useState('')
  const [old, setOld] = useState('staff')
  const staff = useQuery({ queryKey: ['cp-users', h.id, 'staff_all'], queryFn: () => cp.users(h.id, '', 'staff_all'), enabled: isAdmin(me.role) && h.owner_joined })
  const invite = useMutation({
    mutationFn: () => cp.resendOwnerInvite(h.id),
    onSuccess: (r) => {
      const link = r.link ?? hospitalUrl(h, '/register')
      void navigator.clipboard?.writeText(link).catch(() => undefined)
      toast.success(r.queued ? `Invitation e-mailed to ${r.email}` : 'Sign-up link copied', {
        description: r.queued ? 'The link is also copied — you can send it on WhatsApp.' : `E-mail is off or the platform address isn’t set (Settings → Sign-ups). Send this to ${r.email}: ${link}`,
        duration: 10_000,
      })
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const transfer = useMutation({
    mutationFn: () => cp.transferOwner(h.id, to, old),
    onSuccess: (r) => {
      toast.success(`${r.owner} is now the owner`)
      setTo('')
      for (const k of ['cp-hospital', 'cp-hospitals', 'cp-users']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const candidates = (staff.data?.rows ?? []).filter((u) => u.role !== 'owner')

  return (
    <Section title={<span className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" />Owner</span>}
      subtitle={h.owner_joined ? `Signed up: ${h.owner_email ?? '—'}` : `Waiting for ${h.owner_email ?? 'an owner e-mail'} to sign up.`}>
      {!h.owner_joined ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-slate-600">The first account created with the owner’s e-mail becomes the owner. Change the e-mail in Settings → Details.</p>
          {canInvite && <Button variant="outline" icon={<Mail className="h-4 w-4" />} loading={invite.isPending} onClick={() => invite.mutate()}>Resend sign-up link</Button>}
          <Button variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => { void navigator.clipboard?.writeText(hospitalUrl(h, '/register')); toast.success('Link copied') }}>Copy link</Button>
        </div>
      ) : !isAdmin(me.role) ? (
        <p className="text-sm text-slate-600">Only admins can hand the hospital over to another owner.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <Field label="New owner" hint="A staff account of this hospital. Invite them in Users first if needed.">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.full_name} · {u.role} · {u.email}</option>)}
            </Select>
          </Field>
          <Field label="Current owner becomes">
            <Select value={old} onChange={(e) => setOld(e.target.value)}>
              <option value="owner">Stays an owner</option><option value="doctor">Doctor</option><option value="receptionist">Receptionist</option>
              <option value="accountant">Accountant</option><option value="staff">Staff</option>
            </Select>
          </Field>
          <Button variant="secondary" icon={<Crown className="h-4 w-4" />} disabled={!to} loading={transfer.isPending}
            onClick={() => { if (confirm('Make this account the owner of the hospital?')) transfer.mutate() }}>Make owner</Button>
        </div>
      )}
    </Section>
  )
}

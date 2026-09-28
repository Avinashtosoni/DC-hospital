import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck, CalendarOff, Camera, Eye, EyeOff, HeartPulse, History, KeyRound, LayoutGrid, LogOut, Mail, Save, ShieldCheck, Stethoscope, Trash2, UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../data/adapter'
import { useTable, useUpdate } from '../hooks/useData'
import { useMe } from '../hooks/useScope'
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from '../components/ui'
import { AuditItem, useAuditResolver } from '../components/RecordHistory'
import { LEAVE_LABEL, isFullDay } from '../lib/schedule'
import { invoiceBalance } from '../lib/billing'
import { fmtDate, fmtTime, money, today } from '../lib/utils'
import { ROLE_LABEL, type Patient } from '../types'

const APPT_PREF = 'dch:pref:appt-view'
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']

/** Center-crop + downscale to a 256px square WebP (JPEG fallback) so profile photos stay tiny. */
async function squareImage(file: File, size = 256): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file')
  if (file.size > 12 * 1024 * 1024) throw new Error('That image is larger than 12 MB')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = url })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.86))
    if (blob && blob.type === 'image/webp') return blob
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the image'))), 'image/jpeg', 0.88))
  } finally { URL.revokeObjectURL(url) }
}

export default function ProfilePage() {
  const { user, refresh, changePassword, signOutEverywhere, uploadAvatar } = useAuth()
  const me = useMe()
  const qc = useQueryClient()
  const nav = useNavigate()
  const u = user!
  const [form, setForm] = useState({ full_name: u.full_name, phone: u.phone ?? '' })
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const saveProfile = async () => {
    if (form.full_name.trim().length < 2) return toast.error('Please enter your full name')
    setSaving(true)
    try {
      await db.update('profiles', u.id, { full_name: form.full_name.trim(), phone: form.phone.trim() || null })
      await refresh(); qc.invalidateQueries({ queryKey: ['table', 'profiles'] })
      toast.success('Profile updated')
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }
  const setPhoto = async (file?: File | null) => {
    if (!file) return
    setPhotoBusy(true)
    try {
      const blob = await squareImage(file)
      const url = await uploadAvatar(blob)
      await db.update('profiles', u.id, { avatar_url: url })
      await refresh(); qc.invalidateQueries({ queryKey: ['table', 'profiles'] })
      toast.success('Profile photo updated')
    } catch (e) { toast.error((e as Error).message) } finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const removePhoto = async () => {
    setPhotoBusy(true)
    try { await db.update('profiles', u.id, { avatar_url: null }); await refresh(); toast.success('Photo removed') } catch (e) { toast.error((e as Error).message) } finally { setPhotoBusy(false) }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="My Profile" description="Your personal details, photo, password and preferences." />

      {/* hero */}
      <Card className="overflow-hidden">
        <div className="relative h-28 bg-gradient-to-r from-brand-900 via-brand-600 to-brand-400">
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_85%_30%,rgba(204,204,255,.45),transparent_55%)]" />
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="flex items-end gap-4">
            <div className="relative -mt-12">
              <Avatar name={u.full_name} src={u.avatar_url} size="2xl" className="ring-4 ring-white shadow-md" />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} aria-label="Change profile photo"
                className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-brand-900 text-white shadow-lg ring-4 ring-white transition hover:bg-brand-800 disabled:opacity-60">
                <Camera className={photoBusy ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0])} />
            </div>
            <div className="min-w-0 pb-1">
              <h2 className="truncate font-display text-xl font-bold text-brand-950">{u.full_name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <Badge tone="violet">{ROLE_LABEL[u.role]}</Badge>
                <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{u.email}</span>
                {u.created_at && <span className="hidden sm:inline">· Member since {fmtDate(u.created_at, 'MMM yyyy')}</span>}
              </div>
            </div>
          </div>
          {u.avatar_url && <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={removePhoto} disabled={photoBusy}>Remove photo</Button>}
        </div>
        <RoleStats />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Personal details" subtitle="Shown to colleagues on records you create" icon={<UserRound className="h-4 w-4" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Full name" required><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoComplete="name" /></Field>
              <Field label="Mobile"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="+91 98xxx xxxxx" /></Field>
              <Field label="Email" hint="Your login email — contact the administrator to change it" className="sm:col-span-2"><Input value={u.email} disabled /></Field>
              <div className="sm:col-span-2"><Button onClick={saveProfile} loading={saving} icon={<Save className="h-4 w-4" />}>Save changes</Button></div>
            </div>
          </Card>

          {u.role === 'patient' && (me.loading ? <Skeleton className="h-72 rounded-2xl" /> : me.patient ? <PatientRecordForm p={me.patient} /> : (
            <Card><div className="p-5 text-sm text-slate-500">Your login isn’t linked to a patient record yet — the front desk links it at your next visit.</div></Card>
          ))}
          {u.role === 'doctor' && me.doctor && <DoctorCard />}
          <SecurityCard onPassword={changePassword} onEverywhere={async () => { await signOutEverywhere(); nav('/login') }} />
        </div>

        <div className="space-y-6">
          {u.role !== 'patient' && <Preferences />}
          {u.role !== 'patient' && <MyActivity />}
          {u.role === 'patient' && (
            <Card>
              <CardHeader title="Quick links" icon={<LayoutGrid className="h-4 w-4" />} />
              <div className="grid gap-2 p-4">
                {[['/me', 'My health record', HeartPulse], ['/appointments', 'My appointments', CalendarCheck], ['/invoices', 'My bills', ShieldCheck]].map(([to, label, Icon]) => {
                  const I = Icon as typeof HeartPulse
                  return <Link key={to as string} to={to as string} className="flex items-center gap-3 rounded-xl bg-brand-50/60 px-3 py-2.5 text-sm font-medium text-brand-900 transition hover:bg-brand-100"><I className="h-4 w-4" />{label as string}</Link>
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ role stats strip
function RoleStats() {
  const { user } = useAuth()
  const me = useMe()
  const appts = useTable('appointments').data ?? []
  const invoices = useTable('invoices').data ?? []
  const audit = useTable('audit_log', { enabled: user?.role !== 'patient' }).data ?? []
  const t = today()
  let items: [string, ReactNode][] = []
  if (user?.role === 'doctor' && me.doctor) {
    const mine = appts.filter((a) => a.doctor_id === me.doctor!.id)
    items = [['Today', mine.filter((a) => a.appointment_date === t && a.status !== 'cancelled').length], ['Upcoming', mine.filter((a) => a.appointment_date > t && (a.status === 'scheduled' || a.status === 'confirmed')).length], ['Seen (all time)', mine.filter((a) => a.status === 'completed').length], ['Fee', money(me.doctor.consultation_fee)]]
  } else if (user?.role === 'patient' && me.patient) {
    const mine = appts.filter((a) => a.patient_id === me.patient!.id)
    const bills = invoices.filter((i) => i.patient_id === me.patient!.id && i.status !== 'cancelled')
    items = [['MRN', me.patient.mrn], ['Upcoming visits', mine.filter((a) => a.appointment_date >= t && (a.status === 'scheduled' || a.status === 'confirmed')).length], ['Visits', mine.filter((a) => a.status === 'completed').length], ['Outstanding', money(bills.reduce((s, i) => s + invoiceBalance(i), 0))]]
  } else if (user) {
    const mine = audit.filter((e) => e.actor_id === user.id)
    const week = new Date(Date.now() - 7 * 864e5).toISOString()
    items = [['Role', ROLE_LABEL[user.role]], ['Changes this week', mine.filter((e) => (e.created_at ?? '') >= week).length], ['Records created', mine.filter((e) => e.action === 'insert').length], ['Last active', mine[0]?.created_at ? fmtDate(mine[0].created_at, 'dd MMM, HH:mm') : '—']]
  }
  if (!items.length) return null
  return (
    <div className="grid grid-cols-2 border-t border-[#efeff8] sm:grid-cols-4">
      {items.map(([k, v], i) => (
        <div key={k} className={'px-5 py-3 ' + (i % 2 ? 'border-l ' : '') + (i > 1 ? 'border-t sm:border-t-0 ' : '') + (i === 2 ? 'sm:border-l ' : '') + 'border-[#efeff8]'}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{k}</p>
          <p className="mt-0.5 truncate font-display text-lg font-bold text-brand-950">{v}</p>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ patient record (contact + medical basics)
function PatientRecordForm({ p }: { p: Patient }) {
  const upd = useUpdate('patients', { label: 'Health record' })
  const [f, setF] = useState({
    phone: p.phone ?? '', email: p.email ?? '', address: p.address ?? '', date_of_birth: p.date_of_birth ?? '', gender: p.gender,
    blood_group: p.blood_group ?? '', allergies: p.allergies ?? '', emergency_contact_name: p.emergency_contact_name ?? '', emergency_contact_phone: p.emergency_contact_phone ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = () => upd.mutate({ id: p.id, patch: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])) as Partial<Patient> })
  return (
    <Card>
      <CardHeader title="My health record" subtitle={`MRN ${p.mrn} · kept up to date for your doctors`} icon={<HeartPulse className="h-4 w-4" />} action={<StatusBadge value={p.status} />} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Mobile"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Date of birth"><Input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} max={today()} /></Field>
        <Field label="Gender"><Select value={f.gender} onChange={set('gender')}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></Field>
        <Field label="Blood group"><Select value={f.blood_group} onChange={set('blood_group')}><option value="">Not known</option>{BLOOD.map((b) => <option key={b}>{b}</option>)}</Select></Field>
        <Field label="Allergies" hint="Medicines or foods — important for prescriptions"><Input value={f.allergies} onChange={set('allergies')} placeholder="e.g. Penicillin" /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address} onChange={set('address')} /></Field>
        <Field label="Emergency contact"><Input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} placeholder="Name & relation" /></Field>
        <Field label="Emergency phone"><Input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} inputMode="tel" /></Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button onClick={save} loading={upd.isPending} icon={<Save className="h-4 w-4" />}>Save health record</Button>
          <span className="text-xs text-slate-400">MRN, admission status and insurance are managed by the hospital.</span>
        </div>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ doctor professional card + leave
function DoctorCard() {
  const me = useMe()
  const d = me.doctor!
  const depts = useTable('departments').data ?? []
  const leaves = (useTable('doctor_leaves').data ?? []).filter((l) => l.doctor_id === d.id && l.end_date >= today()).sort((a, b) => a.start_date.localeCompare(b.start_date))
  return (
    <Card>
      <CardHeader title="Professional details" subtitle="Managed by the hospital administrator" icon={<Stethoscope className="h-4 w-4" />} action={<StatusBadge value={d.status} />} />
      <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
        {([['Department', depts.find((x) => x.id === d.department_id)?.name ?? '—'], ['Specialization', d.specialization], ['Qualification', d.qualification ?? '—'], ['Consultation fee', money(d.consultation_fee)],
          ['OPD days', d.available_days?.join(', ') || 'Mon–Sat'], ['Shift', d.shift ?? '09:00–17:00']] as [string, string][]).map(([k, v]) => (
          <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-800">{v}</dd></div>
        ))}
      </dl>
      <div className="border-t border-[#efeff8] p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Upcoming leave & blocks</p>
          <Link to="/schedule?new=1"><Button size="sm" variant="outline" icon={<CalendarOff className="h-4 w-4" />}>Request leave</Button></Link>
        </div>
        {leaves.length === 0 ? <p className="rounded-xl bg-brand-50/60 p-3 text-center text-xs text-slate-500">No upcoming leave or blocked time.</p> : (
          <ul className="space-y-1.5">
            {leaves.slice(0, 5).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="min-w-0 truncate"><b className="font-medium text-slate-800">{LEAVE_LABEL[l.kind]}</b> · {fmtDate(l.start_date, 'dd MMM')}{l.end_date !== l.start_date && `–${fmtDate(l.end_date, 'dd MMM')}`}{!isFullDay(l) && ` · ${fmtTime(l.start_time)}–${fmtTime(l.end_time)}`}</span>
                <StatusBadge value={l.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ password + sessions
function SecurityCard({ onPassword, onEverywhere }: { onPassword: (c: string, n: string) => Promise<void>; onEverywhere: () => Promise<void> }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const score = useMemo(() => [f.next.length >= 8, /[A-Z]/.test(f.next) && /[a-z]/.test(f.next), /\d/.test(f.next), /[^A-Za-z0-9]/.test(f.next)].filter(Boolean).length, [f.next])
  const err = f.next && f.next.length < 8 ? 'At least 8 characters' : f.confirm && f.confirm !== f.next ? 'Passwords don’t match' : ''
  const submit = async () => {
    if (!f.current || !f.next || err || f.next !== f.confirm) return toast.error(err || 'Fill in all three fields')
    setBusy(true)
    try { await onPassword(f.current, f.next); setF({ current: '', next: '', confirm: '' }); toast.success('Password changed') } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const type = show ? 'text' : 'password'
  return (
    <Card>
      <CardHeader title="Password & security" icon={<KeyRound className="h-4 w-4" />} action={<button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-800">{show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{show ? 'Hide' : 'Show'}</button>} />
      <form className="grid gap-4 p-5 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label="Current password"><Input type={type} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password" error={f.next && f.next.length < 8 ? err : undefined}><Input type={type} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" error={f.confirm && f.confirm !== f.next ? 'Passwords don’t match' : undefined}><Input type={type} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></Field>
        {f.next && (
          <div className="sm:col-span-3">
            <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={'h-1.5 flex-1 rounded-full ' + (i < score ? ['bg-rose-400', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-500'][score - 1] : 'bg-slate-100')} />)}</div>
            <p className="mt-1 text-[11px] text-slate-500">{['Too weak', 'Weak', 'Okay', 'Good', 'Strong'][score]} — use 8+ characters with upper & lower case, a number and a symbol.</p>
          </div>
        )}
        <div className="sm:col-span-3"><Button type="submit" loading={busy} icon={<ShieldCheck className="h-4 w-4" />}>Change password</Button></div>
      </form>
      <div className="flex flex-col gap-3 border-t border-[#efeff8] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-slate-800">Sign out everywhere</p><p className="text-xs text-slate-500">Ends your sessions on every phone, tablet and computer — including this one.</p></div>
        <Button variant="outline" className="text-rose-600 hover:bg-rose-50" icon={<LogOut className="h-4 w-4" />} onClick={() => setConfirmAll(true)}>Sign out of all devices</Button>
      </div>
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} onConfirm={() => { setConfirmAll(false); onEverywhere() }} confirmLabel="Sign out everywhere"
        title="Sign out of all devices?" description="You’ll need your password to sign in again on each device." />
    </Card>
  )
}

// ------------------------------------------------------------------ preferences
function Preferences() {
  const [view, setView] = useState(() => localStorage.getItem(APPT_PREF) ?? localStorage.getItem('dch:appt-view') ?? 'month')
  const save = (v: string) => { setView(v); localStorage.setItem(APPT_PREF, v); localStorage.setItem('dch:appt-view', v); toast.success('Preference saved') }
  return (
    <Card>
      <CardHeader title="Preferences" subtitle="Saved on this device" icon={<LayoutGrid className="h-4 w-4" />} />
      <div className="p-5">
        <p className="mb-2 text-xs font-medium text-slate-600">Appointments open in</p>
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
          {[['month', 'Month'], ['day', 'Day'], ['list', 'List']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => save(v)}
              className={'rounded-xl border px-3 py-2 text-sm font-medium transition ' + (view === v ? 'border-brand-900 bg-brand-900 text-white' : 'border-brand-100 bg-white text-slate-600 hover:border-brand-300')}>{l}</button>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ my recent activity (from the audit log)
function MyActivity() {
  const { user } = useAuth()
  const q = useTable('audit_log')
  const resolve = useAuditResolver()
  const mine = useMemo(() => (q.data ?? []).filter((e) => e.actor_id === user?.id).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 8), [q.data, user])
  return (
    <Card>
      <CardHeader title="My recent activity" subtitle="From the audit log" icon={<History className="h-4 w-4" />} action={user?.role === 'owner' ? <Link to="/audit" className="text-xs font-medium text-brand-700 hover:underline">Full log</Link> : undefined} />
      <div className="p-3">
        {q.isPending ? <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
          : mine.length === 0 ? <p className="p-4 text-center text-xs text-slate-500">Nothing yet — records you create or edit will show up here.</p>
            : <ul className="divide-y divide-[#f2f2fa]">{mine.map((e) => <AuditItem key={e.id} e={e} resolve={resolve} />)}</ul>}
      </div>
    </Card>
  )
}


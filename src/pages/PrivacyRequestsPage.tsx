/**
 * /privacy-requests (owner) — patients' DPDP requests: copies of their data (self-service, logged), corrections and
 * erasures. The owner answers each one; an accepted erasure anonymises the patient (medical and billing records stay,
 * without the name) and deletes their login. Answer within 30 days — the page counts the days.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Eraser, FileDown, PencilLine, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Skeleton, Tabs, Textarea } from '../components/ui'
import { cn, fmtDate } from '../lib/utils'
import { KIND_LABEL, PRIVACY_QK, privacyApi, type PrivacyRequest, type PrivacyStatus } from '../privacy/api'

const ANSWER_WITHIN_DAYS = 30
const ICON = { access: FileDown, correction: PencilLine, erasure: Eraser }
const STATUS: Record<PrivacyStatus, { label: string; tone: 'amber' | 'green' | 'red' }> = {
  open: { label: 'Open', tone: 'amber' }, done: { label: 'Done', tone: 'green' }, rejected: { label: 'Rejected', tone: 'red' },
}
const daysOpen = (r: PrivacyRequest) => Math.floor((Date.now() - Date.parse(r.created_at)) / 864e5)

export default function PrivacyRequestsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<PrivacyStatus | 'all'>('open')
  const [answer, setAnswer] = useState<{ r: PrivacyRequest; status: 'done' | 'rejected' } | null>(null)
  const [note, setNote] = useState('')
  const q = useQuery({ queryKey: [...PRIVACY_QK, 'list', tab], queryFn: () => privacyApi.list(tab) })
  const openCount = useQuery({ queryKey: [...PRIVACY_QK, 'list', 'open'], queryFn: () => privacyApi.list('open'), enabled: tab !== 'open' })
  const nOpen = (tab === 'open' ? q.data : openCount.data)?.length

  const resolve = useMutation({
    mutationFn: () => privacyApi.resolve(answer!.r.id, answer!.status, note, user?.full_name ?? 'Owner'),
    onSuccess: () => {
      const erased = answer!.status === 'done' && answer!.r.kind === 'erasure'
      toast.success(erased ? 'Patient erased' : answer!.status === 'done' ? 'Marked as done' : 'Request rejected',
        { description: erased ? 'Name and contact details removed; the login was deleted.' : 'The patient sees your answer in their profile.' })
      setAnswer(null); setNote('')
      qc.invalidateQueries({ queryKey: PRIVACY_QK })
      if (erased) qc.invalidateQueries({ queryKey: ['table', 'patients'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const rows = q.data ?? []
  return (
    <div className="space-y-6">
      <PageHeader title="Privacy requests" description="Patients' requests under the Digital Personal Data Protection Act. Answer each one within 30 days." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'open', label: 'Open', count: nOpen }, { value: 'done', label: 'Done' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' },
        ]} />
        <p className="text-xs text-slate-500">Copies of data are downloaded by patients themselves and logged here as done.</p>
      </div>

      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Could not load the requests" description={(q.error as Error).message} action={<Button variant="outline" onClick={() => q.refetch()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title={tab === 'open' ? 'No open requests' : 'Nothing here yet'}
          description="When a patient asks for a correction or to delete their data from their profile page, it appears here and you get an e-mail." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const I = ICON[r.kind], age = daysOpen(r), late = r.status === 'open' && age >= ANSWER_WITHIN_DAYS - 5
            return (
              <Card key={r.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', r.kind === 'erasure' ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-800')}><I className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{KIND_LABEL[r.kind]}</p>
                      <Badge tone={STATUS[r.status].tone} dot>{STATUS[r.status].label}</Badge>
                      {r.status === 'open' && <span className={cn('text-xs', late ? 'font-semibold text-rose-700' : 'text-slate-500')}>{age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}{late ? ` · answer by ${fmtDate(new Date(Date.parse(r.created_at) + ANSWER_WITHIN_DAYS * 864e5).toISOString())}` : ''}</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {r.patient_id ? <Link to={`/patients/${r.patient_id}`} className="font-medium text-brand-800 hover:underline">{r.requester_name ?? 'Patient'}</Link> : (r.requester_name ?? 'Patient')}
                      <span className="text-slate-400"> · {fmtDate(r.created_at)}</span>
                    </p>
                    {r.details && <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{r.details}</p>}
                    {r.status !== 'open' && (r.resolution || r.resolved_by_name) && (
                      <p className="mt-2 text-xs text-slate-500">{r.resolution ? `“${r.resolution}”` : ''}{r.resolved_by_name ? ` — ${r.resolved_by_name}` : ''}{r.resolved_at ? `, ${fmtDate(r.resolved_at)}` : ''}</p>
                    )}
                  </div>
                  {r.status === 'open' && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" icon={<XCircle className="h-4 w-4" />} onClick={() => { setNote(''); setAnswer({ r, status: 'rejected' }) }}>Reject</Button>
                      <Button size="sm" variant={r.kind === 'erasure' ? 'danger' : 'primary'} icon={r.kind === 'erasure' ? <Eraser className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        onClick={() => { setNote(''); setAnswer({ r, status: 'done' }) }}>{r.kind === 'erasure' ? 'Erase patient' : 'Mark done'}</Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={!!answer} onClose={() => setAnswer(null)}
        title={answer?.status === 'rejected' ? 'Reject the request' : answer?.r.kind === 'erasure' ? `Erase ${answer?.r.requester_name ?? 'this patient'}?` : 'Mark as done'}
        footer={<>
          <Button variant="ghost" onClick={() => setAnswer(null)}>Cancel</Button>
          <Button variant={answer?.status === 'done' && answer.r.kind !== 'erasure' ? 'primary' : 'danger'} loading={resolve.isPending} onClick={() => resolve.mutate()}>
            {answer?.status === 'rejected' ? 'Reject' : answer?.r.kind === 'erasure' ? 'Erase permanently' : 'Mark done'}
          </Button>
        </>}>
        <div className="space-y-3 text-sm text-slate-600">
          {answer?.status === 'done' && answer.r.kind === 'erasure' && (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-900">
              The patient's name, phone, e-mail, address and emergency contact are removed, their login is deleted, their website enquiries
              are deleted and the audit trail is redacted. Visits, prescriptions, lab results and bills stay (the law requires them) under
              “Erased patient” and the MRN. <b>This cannot be undone.</b>
            </div>
          )}
          {answer?.status === 'done' && answer.r.kind === 'correction' && <p>Make the change on the patient's record first, then mark the request done.</p>}
          <Field label={answer?.status === 'rejected' ? 'Reason (the patient sees this)' : 'Note to the patient (optional)'} required={answer?.status === 'rejected'}>
            <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={answer?.status === 'rejected' ? 'For example: records of an ongoing treatment must be kept until it ends.' : 'For example: corrected your date of birth.'} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

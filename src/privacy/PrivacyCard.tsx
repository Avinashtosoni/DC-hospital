import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eraser, PencilLine, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardHeader, Field, Modal, Skeleton, Textarea } from '../components/ui'
import { fmtDate } from '../lib/utils'
import { KIND_LABEL, PRIVACY_QK, downloadJson, privacyApi, type PrivacyStatus } from './api'

const STATUS_TONE: Record<PrivacyStatus, 'amber' | 'green' | 'red'> = { open: 'amber', done: 'green', rejected: 'red' }
const STATUS_LABEL: Record<PrivacyStatus, string> = { open: 'Waiting for the hospital', done: 'Done', rejected: 'Not accepted' }

/**
 * Profile → "Your data & privacy" for patients (DPDP Act rights): a copy of everything held about them, the
 * health-tips & offers choice, and correction / erasure requests the owner answers on /privacy-requests.
 */
export function PrivacyCard({ profileId }: { profileId: string }) {
  const qc = useQueryClient()
  const key = [...PRIVACY_QK, 'mine', profileId]
  const q = useQuery({ queryKey: key, queryFn: () => privacyApi.mine(profileId) })
  const [ask, setAsk] = useState<'correction' | 'erasure' | null>(null)
  const [details, setDetails] = useState('')
  const [exporting, setExporting] = useState(false)

  const marketing = useMutation({
    mutationFn: (granted: boolean) => privacyApi.setMarketing(profileId, granted),
    // optimistic: the switch moves at once, and moves back if the save fails
    onMutate: async (granted) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, (d: typeof q.data) => (d ? { ...d, marketing: granted } : d))
      return { prev }
    },
    onError: (e, _v, c) => { qc.setQueryData(key, c?.prev); toast.error((e as Error).message) },
    onSuccess: (_d, granted) => toast.success(granted ? 'You will get health tips & offers' : 'No more health tips & offers', { description: 'Appointment, bill and report messages still reach you.' }),
  })
  const submit = useMutation({
    mutationFn: () => privacyApi.submit(profileId, ask!, details),
    onSuccess: () => {
      toast.success(ask === 'erasure' ? 'Erasure request sent' : 'Correction request sent', { description: 'The hospital has been told and will reply here.' })
      setAsk(null); setDetails('')
      qc.invalidateQueries({ queryKey: key })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const exportData = async () => {
    setExporting(true)
    try {
      const data = await privacyApi.exportMine(profileId)
      downloadJson(`my-health-data-${new Date().toISOString().slice(0, 10)}.json`, data)
      toast.success('Your data was downloaded', { description: 'Keep the file safe — it contains your medical history.' })
      qc.invalidateQueries({ queryKey: key })
    } catch (e) { toast.error((e as Error).message) } finally { setExporting(false) }
  }

  const reqs = q.data?.requests ?? []
  return (
    <Card>
      <CardHeader title="Your data & privacy" subtitle="Your rights under India's Digital Personal Data Protection Act" icon={<ShieldCheck className="h-4 w-4" />} />
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">Get a copy of your data</p>
            <p className="text-xs text-slate-500">Your profile, visits, prescriptions, lab reports, bills and payments in one file.</p>
          </div>
          <Button variant="outline" size="sm" loading={exporting} icon={<Download className="h-4 w-4" />} onClick={exportData}>Download</Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">Health tips & offers</p>
            <p className="text-xs text-slate-500">Occasional messages like health camps and birthday wishes. Appointment and bill messages always come.</p>
          </div>
          {q.isLoading ? <Skeleton className="h-6 w-11 rounded-full" /> : (
            <button type="button" role="switch" aria-checked={!!q.data?.marketing} aria-label="Health tips & offers" disabled={marketing.isPending}
              onClick={() => marketing.mutate(!q.data?.marketing)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${q.data?.marketing ? 'bg-brand-700' : 'bg-slate-300'} disabled:opacity-60`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${q.data?.marketing ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" size="sm" icon={<PencilLine className="h-4 w-4" />} onClick={() => setAsk('correction')}>Ask for a correction</Button>
          <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" icon={<Eraser className="h-4 w-4" />} onClick={() => setAsk('erasure')}>Ask to delete my data</Button>
        </div>

        {q.isLoading ? <Skeleton className="h-12 rounded-xl" /> : reqs.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {reqs.slice(0, 6).map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{KIND_LABEL[r.kind]} <span className="font-normal text-slate-400">· {fmtDate(r.created_at)}</span></p>
                  {r.resolution && <p className="text-xs text-slate-500">Hospital: {r.resolution}</p>}
                </div>
                <Badge tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask === 'erasure' ? 'Ask to delete your data' : 'Ask for a correction'}
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant={ask === 'erasure' ? 'danger' : 'primary'} loading={submit.isPending} onClick={() => submit.mutate()}>Send request</Button>
        </>}>
        {ask === 'erasure' ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>If the hospital agrees, your name, phone, e-mail and address are removed and your login is deleted — you will not be able to sign in again.</p>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">By law the hospital must keep medical records and bills for some years. Those stay, but no longer carry your name.</p>
            <Field label="Anything the hospital should know (optional)"><Textarea rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="What is wrong, and what should it be?" required hint="For example: “My date of birth is 1 May 1990, not 5 Jan 1990.”">
            <Textarea rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} autoFocus />
          </Field>
        )}
      </Modal>
    </Card>
  )
}

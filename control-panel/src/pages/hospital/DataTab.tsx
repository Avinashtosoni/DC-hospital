import { useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Download, ExternalLink, FileUp, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, Tabs } from '../../../../src/components/ui'
import { cp, friendly } from '../../api'
import { mapRows, parseCsv, TEMPLATE, type ImportKind } from '../../csv'
import type { BrowseKind, CpHospitalDetail, ImportResult } from '../../types'
import { date, dateTime, ErrorBox, inr, isAdmin, Section, useMe } from '../../ui'
import { hospitalUrl } from '../../../../src/tenancy/urls'

const LABEL: Record<string, string> = {
  patients: 'Patients', doctors: 'Doctors', staff: 'Staff records', departments: 'Departments', appointments: 'Appointments', prescriptions: 'Prescriptions',
  lab_tests: 'Lab tests', admissions: 'Admissions', wards: 'Wards', beds: 'Beds', invoices: 'Bills', payments: 'Payments received', expenses: 'Expenses',
  inventory: 'Inventory items', notices: 'Notices', site_enquiries: 'Website enquiries', visit_feedback: 'Feedback', doctor_leaves: 'Doctor leaves',
  holidays: 'Holidays', audit_log: 'Activity log entries',
}
/** the hospital app, opened as this hospital (the panel's sign-in is shared on the same address) */
/** the hospital app on the platform's own address (its subdomain, else ?hospital=) — where a team member signs in;
 *  not the custom domain, whose sign-in is separate */
export const openAsAdmin = (h: CpHospitalDetail, path = '/') => hospitalUrl({ slug: h.slug, domain: null }, path)

/** Phase C: what is in the hospital, read-only lists, export (in the hospital app) and CSV import of patients / doctors. */
export function DataTab({ h }: { h: CpHospitalDetail }) {
  const { me } = useMe()
  const q = useQuery({ queryKey: ['cp-data', h.id], queryFn: () => cp.data(h.id) })
  const d = q.data
  return (
    <div className="space-y-6">
      <Section title="Records" subtitle={d?.last_activity ? `Last activity ${dateTime(d.last_activity)}` : 'Counts of everything the hospital has stored.'}
        action={me.role !== 'finance' && <div className="flex flex-wrap gap-2">
          <a href={openAsAdmin(h)} target="_blank" rel="noopener"><Button size="sm" variant="outline" icon={<ExternalLink className="h-3.5 w-3.5" />}>Open as admin</Button></a>
          <a href={openAsAdmin(h, '/settings?tab=data')} target="_blank" rel="noopener"><Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />}>Export ZIP</Button></a>
        </div>}>
        {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-40" /> : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Appointments (30 days)', d.appointments_30d.toLocaleString('en-IN')], ['Admitted now', d.admitted_now.toLocaleString('en-IN')],
                ['Billed (30 days)', inr(Number(d.billed_30d))], ['Outstanding', inr(Number(d.outstanding))]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-brand-50/70 px-3 py-2.5"><p className="font-display text-lg font-bold text-brand-950">{v}</p><p className="text-[11px] text-slate-500">{k}</p></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div className="flex justify-between border-b border-slate-100 py-1.5"><span className="text-slate-500">Staff accounts</span><span className="font-medium tabular-nums">{d.users}</span></div>
              {Object.entries(d.counts).map(([k, n]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 py-1.5"><span className="text-slate-500">{LABEL[k] ?? k}</span><span className="font-medium tabular-nums">{Number(n).toLocaleString('en-IN')}</span></div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">To add, edit or delete records, use <b>Open as admin</b> — the hospital app with full owner access (every change is logged as you).</p>
          </>
        )}
      </Section>
      <Browse h={h} />
      {isAdmin(me.role) && <ImportSection h={h} />}
    </div>
  )
}

const COLS: Record<BrowseKind, { key: string; label: string; fmt?: (v: unknown) => string }[]> = {
  patients: [{ key: 'mrn', label: 'MRN' }, { key: 'full_name', label: 'Name' }, { key: 'gender', label: 'Gender' }, { key: 'date_of_birth', label: 'Born', fmt: (v) => date(v as string) }, { key: 'phone', label: 'Phone' }, { key: 'created_at', label: 'Added', fmt: (v) => date(v as string) }],
  doctors: [{ key: 'full_name', label: 'Name' }, { key: 'specialization', label: 'Speciality' }, { key: 'department', label: 'Department' }, { key: 'consultation_fee', label: 'Fee', fmt: (v) => inr(Number(v)) }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status' }],
  appointments: [{ key: 'appointment_date', label: 'Date', fmt: (v) => date(v as string) }, { key: 'appointment_time', label: 'Time', fmt: (v) => String(v ?? '').slice(0, 5) }, { key: 'patient', label: 'Patient' }, { key: 'doctor', label: 'Doctor' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }],
  invoices: [{ key: 'invoice_number', label: 'Bill no.' }, { key: 'issue_date', label: 'Date', fmt: (v) => date(v as string) }, { key: 'patient', label: 'Patient' }, { key: 'total', label: 'Total', fmt: (v) => inr(Number(v)) }, { key: 'amount_paid', label: 'Paid', fmt: (v) => inr(Number(v)) }, { key: 'status', label: 'Status' }],
}

function Browse({ h }: { h: CpHospitalDetail }) {
  const { me } = useMe()
  const kinds: { value: BrowseKind; label: string }[] = me.role === 'finance' ? [{ value: 'invoices', label: 'Bills' }]
    : [{ value: 'patients', label: 'Patients' }, { value: 'doctors', label: 'Doctors' }, { value: 'appointments', label: 'Appointments' }, { value: 'invoices', label: 'Bills' }]
  const [kind, setKind] = useState<BrowseKind>(kinds[0].value)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(0)
  const q = useQuery({ queryKey: ['cp-browse', h.id, kind, term, page], queryFn: () => cp.browse(h.id, kind, term, page * 25), placeholderData: keepPreviousData })
  return (
    <Section title="Look up" subtitle="Read-only. Each look-up is written to the audit log.">
      <Tabs tabs={kinds} value={kind} onChange={(k) => { setKind(k); setPage(0) }} />
      <form className="relative mt-4" onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); setPage(0) }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search and press Enter" className="pl-9" aria-label="Search" />
      </form>
      <div className="mt-4">
        {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-40" />
          : !q.data.rows.length ? <EmptyState icon={<Database className="h-6 w-6" />} title={term ? 'Nothing matches' : 'Nothing here yet'} />
          : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr>{COLS[kind].map((c) => <th key={c.key} className="whitespace-nowrap px-5 py-2">{c.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.rows.map((r) => (
                    <tr key={String(r.id)}>{COLS[kind].map((c) => <td key={c.key} className="whitespace-nowrap px-5 py-2 text-slate-700">
                      {c.key === 'status' ? <Badge>{String(r[c.key] ?? '—').replace('_', ' ')}</Badge> : (c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? '—'))}
                    </td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {q.data && q.data.total > 25 && (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>{page * 25 + 1}–{Math.min((page + 1) * 25, q.data.total)} of {q.data.total.toLocaleString('en-IN')}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * 25 >= q.data.total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </Section>
  )
}

function ImportSection({ h }: { h: CpHospitalDetail }) {
  const qc = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<ImportKind>('patients')
  const [parsed, setParsed] = useState<{ name: string; rows: Record<string, string>[]; unknown: string[] } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const run = useMutation({
    mutationFn: (dry: boolean) => cp.importRows(h.id, kind, parsed!.rows, dry),
    onSuccess: (r) => {
      setResult(r)
      if (!r.dry_run) {
        toast.success(`${r.imported} ${kind} imported`, { description: `${r.duplicates} already there, ${r.failed} with problems.` })
        setParsed(null); if (file.current) file.current.value = ''
        for (const k of ['cp-data', 'cp-browse', 'cp-hospital']) qc.invalidateQueries({ queryKey: [k] })
      }
    },
    onError: (e) => toast.error(friendly(e)),
  })
  const pick = async (f: File | undefined) => {
    setResult(null); setParsed(null)
    if (!f) return
    if (f.size > 2_000_000) { toast.error('The file is larger than 2 MB — split it.'); return }
    const m = mapRows(kind, parseCsv(await f.text()))
    if (m.missing.length) { toast.error(`The file needs a column for: ${m.missing.join(', ')}. Download the template to see the columns.`); return }
    if (!m.rows.length) { toast.error('No rows found under the header.'); return }
    if (m.rows.length > 1000) { toast.error(`${m.rows.length} rows — import at most 1,000 at a time.`); return }
    setParsed({ name: f.name, rows: m.rows, unknown: m.unknown })
    run.mutate(true)
  }
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE[kind]], { type: 'text/csv' })); a.download = `${kind}-template.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return (
    <Section title="Import from a spreadsheet" subtitle="Moving from paper or other software: upload a CSV (Excel → Save as CSV). Rows already there are skipped; a bad row never stops the rest.">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
        <Field label="What"><Select value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); setParsed(null); setResult(null); if (file.current) file.current.value = '' }}>
          <option value="patients">Patients</option><option value="doctors">Doctors</option></Select></Field>
        <Field label="CSV file" hint={kind === 'doctors' ? 'Departments must already exist in the hospital (matched by name).' : 'Dates as YYYY-MM-DD or DD/MM/YYYY; phones as 10-digit mobiles.'}>
          <Input ref={file} type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
        </Field>
        <Button variant="ghost" icon={<FileUp className="h-4 w-4" />} onClick={template}>Template</Button>
      </div>
      {parsed && result?.dry_run && (
        <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4 text-sm">
          <p className="font-medium text-brand-950">{parsed.name}: {parsed.rows.length} rows checked</p>
          <p className="mt-1 text-slate-600"><b className="text-emerald-700">{result.imported}</b> ready to import · <b>{result.duplicates}</b> already there · <b className="text-rose-700">{result.failed}</b> with problems
            {parsed.unknown.length > 0 && <> · ignored columns: {parsed.unknown.join(', ')}</>}</p>
          <ProblemList r={result} />
          <Button className="mt-3" icon={<Upload className="h-4 w-4" />} disabled={!result.imported} loading={run.isPending} onClick={() => run.mutate(false)}>Import {result.imported} {kind}</Button>
        </div>
      )}
      {result && !result.dry_run && <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Imported {result.imported}, skipped {result.duplicates} duplicates, {result.failed} with problems.<ProblemList r={result} /></div>}
    </Section>
  )
}

function ProblemList({ r }: { r: ImportResult }) {
  if (!r.errors.length) return null
  return (
    <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-white/80 px-3 py-2 text-xs text-rose-800">
      {r.errors.map((e) => <li key={e.row}>Row {e.row + 1}: {e.error}</li>)}
      {r.failed > r.errors.length && <li>…and {r.failed - r.errors.length} more</li>}
    </ul>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown, FileMinus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Skeleton } from '../../../../src/components/ui'
import { platformName } from '../../../../src/lib/supabase'
import type { PaymentRow } from '../../../../src/billing/types'
import { cp, friendly } from '../../api'
import type { CreditNote } from '../../types'
import { dateTime, ErrorBox, paise, Section } from '../../ui'

type Payment = PaymentRow & { hospital?: string; tenant_id?: string }

/** the tax invoice as a PDF (seller / buyer as snapshotted when it was paid) */
export async function downloadInvoice(p: Payment) {
  try {
    const { downloadBillingInvoice } = await import('../../../../src/billing/invoicePdf')
    const settings = await cp.settings().catch(() => null)
    const seller = { name: platformName, gstin: '', address: '', state: '', email: '', ...((settings?.billing as { seller?: object } | undefined)?.seller ?? {}) }
    await downloadBillingInvoice({ payment: p, seller: seller as never, buyer: { legalName: p.hospital ?? '', gstin: '', address: '' }, platformName })
  } catch (e) { toast.error(friendly(e)) }
}

/** per-row buttons in the payments table (admins / finance) */
export function InvoiceActions({ p, onCredit }: { p: Payment; onCredit: (p: Payment) => void }) {
  if (!p.invoice_no) return null
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" title="Download tax invoice (PDF)" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void downloadInvoice(p)}><span className="sr-only">PDF</span></Button>
      {p.status === 'paid' && <Button size="sm" variant="ghost" title="Issue a credit note" icon={<FileMinus className="h-3.5 w-3.5" />} onClick={() => onCredit(p)}><span className="sr-only">Credit note</span></Button>}
    </div>
  )
}

export function CreditNoteModal({ p, onClose }: { p: Payment | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ amount: '', reason: '', mode: 'wallet' as 'wallet' | 'refund' })
  const mode = p?.kind === 'wallet' ? 'refund' : f.mode
  const close = () => { setF({ amount: '', reason: '', mode: 'wallet' }); onClose() }
  const issue = useMutation({
    mutationFn: () => cp.creditNote(p!.id, { amount: f.amount.trim() === '' ? null : Number(f.amount), reason: f.reason.trim(), mode }),
    onSuccess: (c) => {
      toast.success(`Credit note ${c.credit_no} issued`, { description: mode === 'wallet' ? `${paise(c.total_paise)} added to the wallet.` : 'Pay the refund to the hospital (bank / UPI) and keep the reference.' })
      for (const k of ['cp-hospital', 'cp-hospitals', 'cp-payments', 'cp-credit-notes', 'cp-wallet']) qc.invalidateQueries({ queryKey: [k] })
      void downloadCreditNoteLazy(c)
      close()
    },
    onError: (e) => toast.error(friendly(e)),
  })
  return (
    <Modal open={!!p} onClose={close} title={`Credit note against ${p?.invoice_no}`}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button icon={<FileMinus className="h-4 w-4" />} loading={issue.isPending} disabled={f.reason.trim().length < 5} onClick={() => issue.mutate()}>Issue credit note</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Invoice total {paise(p?.total_paise)} (GST {paise(p?.gst_paise)}). GST is reversed in the same proportion. A full credit marks the invoice refunded. Credit notes can’t be edited or deleted.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount incl. GST (₹)" hint="Blank = everything not yet credited"><Input type="number" min={1} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Settle by"><Select value={mode} disabled={p?.kind === 'wallet'} onChange={(e) => setF({ ...f, mode: e.target.value as 'wallet' | 'refund' })}>
            <option value="wallet">Credit to the wallet</option><option value="refund">Refund (you pay it back)</option></Select></Field>
        </div>
        {p?.kind === 'wallet' && <p className="text-xs text-amber-700">A wallet top-up can only be refunded; the amount (before GST) is taken out of the wallet.</p>}
        <Field label="Reason (printed on the credit note)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Plan downgraded from Hospital to Clinic" /></Field>
      </div>
    </Modal>
  )
}

const downloadCreditNoteLazy = async (c: CreditNote) => {
  try { const { downloadCreditNote } = await import('../../creditNotePdf'); await downloadCreditNote(c, platformName) } catch (e) { toast.error(friendly(e)) }
}

export function CreditNotesSection({ tenantId, showHospital }: { tenantId?: string; showHospital?: boolean }) {
  const q = useQuery({ queryKey: ['cp-credit-notes', tenantId ?? 'all'], queryFn: () => cp.creditNotes(tenantId) })
  return (
    <Section title="Credit notes" subtitle="Issued against paid invoices (GST-compliant reversal).">
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-20" />
        : !q.data.length ? <p className="text-sm text-slate-500">None issued.</p> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">Date</th>{showHospital && <th className="px-5 py-2">Hospital</th>}<th className="px-5 py-2">Credit note</th><th className="px-5 py-2">Invoice</th><th className="px-5 py-2">Reason</th><th className="px-5 py-2 text-right">Amount</th><th className="px-5 py-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{dateTime(c.created_at)}</td>
                    {showHospital && <td className="px-5 py-2.5">{c.hospital}</td>}
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs">{c.credit_no}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-slate-600">{c.invoice_no}</td>
                    <td className="px-5 py-2.5 text-slate-700">{c.reason}<p className="text-[11px] text-slate-400">{c.mode === 'wallet' ? 'credited to wallet' : 'refund'}{c.created_by_name ? ` · ${c.created_by_name}` : ''}</p></td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums font-medium">{paise(c.total_paise)}</td>
                    <td className="px-5 py-2.5 text-right"><Button size="sm" variant="ghost" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void downloadCreditNoteLazy(c)}><span className="sr-only">PDF</span></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Section>
  )
}

const KIND: Record<string, { label: string; tone: 'green' | 'slate' | 'amber' | 'blue' }> = {
  topup: { label: 'Top-up', tone: 'green' }, usage: { label: 'Messages', tone: 'slate' }, refund: { label: 'Credit / refund', tone: 'blue' }, adjustment: { label: 'Adjustment', tone: 'amber' },
}
export function WalletLedgerSection({ tenantId }: { tenantId: string }) {
  const q = useQuery({ queryKey: ['cp-wallet', tenantId], queryFn: () => cp.walletLedger(tenantId) })
  return (
    <Section title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" />Wallet history</span>} subtitle="Every credit and debit, newest first. Message charges are one line per day and channel.">
      {q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-24" />
        : !q.data.length ? <EmptyState icon={<Wallet className="h-6 w-6" />} title="No wallet activity yet" /> : (
          <div className="-mx-5 max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">When</th><th className="px-5 py-2">What</th><th className="px-5 py-2">Note</th><th className="px-5 py-2 text-right">Amount</th><th className="px-5 py-2 text-right">Balance</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-5 py-2 text-slate-600">{dateTime(r.created_at)}</td>
                    <td className="px-5 py-2"><Badge tone={KIND[r.kind]?.tone ?? 'slate'}>{KIND[r.kind]?.label ?? r.kind}</Badge>{r.channel && <span className="ml-1 text-xs text-slate-500">{r.channel} × {r.units}</span>}</td>
                    <td className="px-5 py-2 text-xs text-slate-600">{r.note ?? ''}{r.invoice_no ? ` (${r.invoice_no})` : ''}</td>
                    <td className={`whitespace-nowrap px-5 py-2 text-right tabular-nums ${r.amount_paise < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{r.amount_paise > 0 ? '+' : ''}{paise(r.amount_paise)}</td>
                    <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums text-slate-700">{paise(r.balance_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Section>
  )
}

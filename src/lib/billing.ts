import type { Invoice } from '../types'
import { today } from './utils'

export const invoiceBalance = (i: Pick<Invoice, 'total' | 'amount_paid'>) => Math.max(0, Number(i.total) - Number(i.amount_paid))

export function deriveInvoiceStatus(i: Pick<Invoice, 'total' | 'amount_paid' | 'due_date' | 'status'>): Invoice['status'] {
  if (i.status === 'draft' || i.status === 'cancelled') return i.status
  if (i.total > 0 && i.amount_paid >= i.total) return 'paid'
  if (i.amount_paid > 0) return 'partial'
  if (i.due_date && i.due_date < today()) return 'overdue'
  return 'unpaid'
}

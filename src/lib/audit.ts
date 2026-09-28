import type { AuditEntry, TableName } from '../types'

/**
 * Tables whose changes are recorded in the audit log.
 * Mirrors the triggers created in scripts/sql/audit.sql.
 */
export const AUDITED_TABLES = [
  'patients', 'appointments', 'prescriptions', 'lab_tests', 'admissions', 'invoices', 'payments',
  'doctors', 'doctor_leaves', 'holidays', 'profiles', 'staff', 'expenses',
] as const satisfies readonly TableName[]
export type AuditedTable = (typeof AUDITED_TABLES)[number]
export const isAudited = (t: string): t is AuditedTable => (AUDITED_TABLES as readonly string[]).includes(t)

export const AUDIT_TABLE_LABEL: Record<string, string> = {
  patients: 'Patient', appointments: 'Appointment', prescriptions: 'Prescription', lab_tests: 'Lab test', admissions: 'Admission',
  invoices: 'Invoice', payments: 'Payment', doctors: 'Doctor', doctor_leaves: 'Leave / block', holidays: 'Holiday',
  profiles: 'User', staff: 'Staff member', expenses: 'Expense',
}

/** Columns that change on every write and carry no meaning for a reviewer. */
const IGNORED = new Set(['id', 'created_at', 'updated_at', '__optimistic'])

const norm = (v: unknown) => (v === undefined || v === '' ? null : v)
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

export function diffRows(before: Record<string, unknown> | null, after: Record<string, unknown> | null): AuditEntry['changes'] {
  const out: AuditEntry['changes'] = {}
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  for (const k of keys) {
    if (IGNORED.has(k)) continue
    const a = before?.[k], b = after?.[k]
    if (before && after) { if (!same(a, b)) out[k] = { from: norm(a), to: norm(b) } }
    else if (after) { if (norm(b) !== null) out[k] = { to: b } }
    else if (norm(a) !== null) out[k] = { from: a }
  }
  return out
}

/** Short human label for a record (same rules as public.audit_summary() in SQL). */
export function auditSummary(table: string, r: Record<string, any> | null | undefined): string {
  if (!r) return ''
  switch (table) {
    case 'patients': return [r.full_name, r.mrn && `(${r.mrn})`].filter(Boolean).join(' ')
    case 'invoices': return r.invoice_number ?? ''
    case 'appointments': return [r.appointment_date, r.appointment_time].filter(Boolean).join(' · ')
    case 'payments': return r.amount != null ? `₹${r.amount} · ${String(r.method ?? '').toUpperCase()}` : ''
    case 'prescriptions': return r.diagnosis ?? ''
    case 'lab_tests': return r.test_name ?? ''
    case 'doctor_leaves': return [r.kind, r.start_date, r.start_date !== r.end_date && `→ ${r.end_date}`].filter(Boolean).join(' ')
    case 'holidays': return [r.name, r.holiday_date].filter(Boolean).join(' · ')
    case 'expenses': return r.description ?? ''
    default: return r.full_name ?? r.name ?? r.title ?? ''
  }
}

export function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object')) return v.join(', ') || '—'
    return `${v.length} item${v.length === 1 ? '' : 's'}`
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

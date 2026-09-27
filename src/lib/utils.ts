import { clsx, type ClassValue } from 'clsx'
import { differenceInYears, format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'

export const cn = (...c: ClassValue[]) => clsx(c)

export const HOSPITAL = {
  name: 'DC Hospital',
  tagline: 'Multi-speciality care, 24×7',
  address: 'Plot 12, Sector 18, Dwarka, New Delhi 110075',
  phone: '+91 11 4000 2100',
  email: 'care@dchospital.com',
  gstin: '07AAACD1234F1Z5',
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 })
export const money = (n: number | null | undefined) => inr.format(Number(n ?? 0))
export const moneyCompact = (n: number | null | undefined) => inrCompact.format(Number(n ?? 0))
export const num = (n: number | null | undefined) => new Intl.NumberFormat('en-IN').format(Number(n ?? 0))

const toDate = (v: string | Date) => (v instanceof Date ? v : parseISO(v))
export const fmtDate = (v?: string | null, f = 'dd MMM yyyy') => {
  if (!v) return '—'
  const d = toDate(v)
  return isValid(d) ? format(d, f) : '—'
}
export const fmtTime = (t?: string | null) => {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const d = new Date(); d.setHours(h, m)
  return format(d, 'h:mm a')
}
export const ago = (v?: string | null) => (v ? formatDistanceToNowStrict(toDate(v), { addSuffix: true }) : '—')
export const age = (dob?: string | null) => (dob ? differenceInYears(new Date(), toDate(dob)) : null)
export const today = () => format(new Date(), 'yyyy-MM-dd')

export const initials = (name?: string | null) =>
  (name ?? '?').replace(/^Dr\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('')

export const titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

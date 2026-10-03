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
/** Hospital-wide display preferences (Settings → General → Date & time). */
const fmtPrefs = { date: 'dd MMM yyyy', time24: false }
export const setFormatPrefs = (p: { date?: string; time24?: boolean }) => { Object.assign(fmtPrefs, p) }
export const getFormatPrefs = () => ({ ...fmtPrefs })

export const fmtDate = (v?: string | null, f?: string) => {
  if (!v) return '—'
  const d = toDate(v)
  return isValid(d) ? format(d, f ?? fmtPrefs.date) : '—'
}
export const fmtTime = (t?: string | null) => {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const d = new Date(); d.setHours(h, m)
  return format(d, fmtPrefs.time24 ? 'HH:mm' : 'h:mm a')
}
export const ago = (v?: string | null) => (v ? formatDistanceToNowStrict(toDate(v), { addSuffix: true }) : '—')
export const age = (dob?: string | null) => (dob ? differenceInYears(new Date(), toDate(dob)) : null)
export const today = () => format(new Date(), 'yyyy-MM-dd')

export const initials = (name?: string | null) =>
  (name ?? '?').replace(/^Dr\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('')

export const titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** rows → CSV text (header = every key seen in any row) */
export function toCsv(rows: Record<string, unknown>[], headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]): string {
  const esc = (v: unknown) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n')
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    // text from the public website (names, messages) must never run as an Excel / Sheets formula
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n')
  // BOM so Excel opens ₹ and Hindi names as UTF-8
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

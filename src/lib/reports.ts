import { format, startOfMonth, subMonths } from 'date-fns'
import { isSupabaseConfigured, supabase } from './supabase'
import { queryAll } from '../data/adapter'
import type { Expense, Invoice, Payment } from '../types'
import { titleCase } from './utils'

/** Raw totals keyed by month ('yyyy-MM') / bucket name — what public.financial_report() returns. */
export interface RawReport {
  billed: Record<string, number>
  collected: Record<string, number>
  expenses: Record<string, number>
  sources: Record<string, number>
  cats: Record<string, number>
  doctors: Record<string, number>
}

/** Same buckets as the CASE in scripts/sql/scale.sql */
export const revenueSource = (desc: string) =>
  /^Consultation/i.test(desc) ? 'Consultations' : /^Lab/i.test(desc) ? 'Laboratory' : /bed charges|Nursing/i.test(desc) ? 'IPD / Room' : /Pharmacy/i.test(desc) ? 'Pharmacy' : /Procedure|OT/i.test(desc) ? 'Procedures' : 'Other'

const add = (m: Record<string, number>, k: string, v: number) => { m[k] = (m[k] ?? 0) + Number(v) }

/** In-memory twin of public.financial_report (demo mode). */
export function rawReport(invoices: Invoice[], payments: Payment[], expenses: Expense[], from: string): RawReport {
  const r: RawReport = { billed: {}, collected: {}, expenses: {}, sources: {}, cats: {}, doctors: {} }
  for (const i of invoices) {
    if (i.issue_date < from || i.status === 'cancelled' || i.status === 'draft') continue
    add(r.billed, i.issue_date.slice(0, 7), i.total)
    for (const it of i.items ?? []) {
      const amt = Number(it.quantity) * Number(it.unit_price)
      add(r.sources, revenueSource(it.description), amt)
      const m = it.description.match(/^Consultation – (.+)$/)
      if (m) add(r.doctors, m[1], amt)
    }
  }
  for (const p of payments) if (p.paid_on >= from) add(r.collected, p.paid_on.slice(0, 7), p.amount)
  for (const e of expenses) if (e.expense_date >= from) { add(r.expenses, e.expense_date.slice(0, 7), e.amount); add(r.cats, e.category, e.amount) }
  return r
}

export const reportBuckets = (months: number) => Array.from({ length: months }, (_, i) => {
  const d = startOfMonth(subMonths(new Date(), months - 1 - i))
  return { key: format(d, 'yyyy-MM'), label: format(d, months > 6 ? 'MMM yy' : 'MMM yyyy') }
})

/** Totals are computed in the database (Supabase) or from a date window of the demo store — never whole tables. */
export async function fetchReport(months: number): Promise<RawReport> {
  const from = `${reportBuckets(months)[0].key}-01`
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('financial_report', { p_from: from })
    if (error) throw new Error(error.message)
    return data as RawReport
  }
  const [inv, pay, exp] = await Promise.all([
    queryAll('invoices', { where: [['issue_date', 'gte', from]] }),
    queryAll('payments', { where: [['paid_on', 'gte', from]] }),
    queryAll('expenses', { where: [['expense_date', 'gte', from]] }),
  ])
  return rawReport(inv, pay, exp, from)
}

const entries = (m: Record<string, number>, name = (k: string) => k) =>
  Object.entries(m ?? {}).map(([k, v]) => ({ name: name(k), value: Number(v) })).sort((a, b) => b.value - a.value)

/** Shape the raw totals for the Reports page. */
export function shapeReport(raw: RawReport | undefined, months: number) {
  const monthly = reportBuckets(months).map((b) => {
    const billed = Number(raw?.billed?.[b.key] ?? 0), collected = Number(raw?.collected?.[b.key] ?? 0), spent = Number(raw?.expenses?.[b.key] ?? 0)
    return { label: b.label, billed, collected, expenses: spent, net: collected - spent }
  })
  const sum = (k: 'billed' | 'collected' | 'expenses' | 'net') => monthly.reduce((s, m) => s + m[k], 0)
  return {
    monthly, billed: sum('billed'), collected: sum('collected'), spent: sum('expenses'), net: sum('net'),
    sources: entries(raw?.sources ?? {}),
    cats: entries(raw?.cats ?? {}, titleCase),
    doctors: entries(raw?.doctors ?? {}).slice(0, 8),
  }
}

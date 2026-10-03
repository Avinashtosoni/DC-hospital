import { supabase } from './supabase'
import { invoiceBalance } from './billing'
import type { Expense, Invoice, Payment } from '../types'

/** What public.dashboard_finance(p_from) returns (scripts/sql/scale.sql): totals + the few rows the lists show. */
export interface FinanceSummary {
  /** 'yyyy-MM' → collected */
  revenue: Record<string, number>
  /** 'yyyy-MM' → spent */
  expenses: Record<string, number>
  /** payment method → collected since p_from */
  methods: Record<string, number>
  outstanding: number
  open_count: number
  /** the 5 open invoices with the largest balance */
  top_open: Invoice[]
  /** the 6 overdue invoices with the largest balance */
  overdue: Invoice[]
  /** the 6 latest payments */
  recent: Payment[]
}

const OPEN = ['unpaid', 'partial', 'overdue']
const add = (m: Record<string, number>, k: string, v: number) => { m[k] = (m[k] ?? 0) + Number(v) }
const byBalance = (a: Invoice, b: Invoice) => invoiceBalance(b) - invoiceBalance(a)

/** In-memory twin of public.dashboard_finance (used by the tests to pin the SQL's maths). */
export function summariseFinance(invoices: Invoice[], payments: Payment[], expenses: Expense[], from: string): FinanceSummary {
  const s: FinanceSummary = { revenue: {}, expenses: {}, methods: {}, outstanding: 0, open_count: 0, top_open: [], overdue: [], recent: [] }
  for (const p of payments) if (p.paid_on >= from) { add(s.revenue, p.paid_on.slice(0, 7), p.amount); add(s.methods, p.method, p.amount) }
  for (const e of expenses) if (e.expense_date >= from) add(s.expenses, e.expense_date.slice(0, 7), e.amount)
  const open = invoices.filter((i) => OPEN.includes(i.status))
  s.outstanding = open.reduce((t, i) => t + invoiceBalance(i), 0)
  const owing = open.filter((i) => invoiceBalance(i) > 0)
  s.open_count = owing.length
  s.top_open = [...owing].sort(byBalance).slice(0, 5)
  s.overdue = owing.filter((i) => i.status === 'overdue').sort(byBalance).slice(0, 6)
  s.recent = [...payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, 6)
  return s
}

/** Totals are computed in the database — never by downloading every payment. */
export async function fetchFinance(from: string): Promise<FinanceSummary> {
  const { data, error } = await supabase!.rpc('dashboard_finance', { p_from: from })
  if (error) throw new Error(error.message)
  return data as FinanceSummary
}

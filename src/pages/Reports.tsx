import { bc } from './dashboard/widgets'
import { useMemo, useState } from 'react'
import { Download, IndianRupee, Percent, PieChart as PieIcon, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { format, startOfMonth, subMonths } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTable } from '../hooks/useData'
import { Button, Card, CardHeader, PageHeader, Select, Skeleton, StatCard } from '../components/ui'
import { Donut } from './dashboard/widgets'
import { downloadCsv, money, moneyCompact, titleCase } from '../lib/utils'

const source = (desc: string) =>
  /^Consultation/i.test(desc) ? 'Consultations' : /^Lab/i.test(desc) ? 'Laboratory' : /bed charges|Nursing/i.test(desc) ? 'IPD / Room' : /Pharmacy/i.test(desc) ? 'Pharmacy' : /Procedure|OT/i.test(desc) ? 'Procedures' : 'Other'

export default function Reports() {
  const [months, setMonths] = useState(6)
  const invoices = useTable('invoices')
  const payments = useTable('payments')
  const expenses = useTable('expenses')
  const loading = invoices.isLoading || payments.isLoading || expenses.isLoading

  const r = useMemo(() => {
    const buckets = Array.from({ length: months }, (_, i) => { const d = startOfMonth(subMonths(new Date(), months - 1 - i)); return { key: format(d, 'yyyy-MM'), label: format(d, months > 6 ? 'MMM yy' : 'MMM yyyy') } })
    const from = buckets[0].key
    const inv = (invoices.data ?? []).filter((i) => i.issue_date.slice(0, 7) >= from && i.status !== 'cancelled' && i.status !== 'draft')
    const pay = (payments.data ?? []).filter((p) => p.paid_on.slice(0, 7) >= from)
    const exp = (expenses.data ?? []).filter((e) => e.expense_date.slice(0, 7) >= from)
    const monthly = buckets.map((b) => {
      const billed = inv.filter((i) => i.issue_date.startsWith(b.key)).reduce((s, i) => s + i.total, 0)
      const collected = pay.filter((p) => p.paid_on.startsWith(b.key)).reduce((s, p) => s + p.amount, 0)
      const spent = exp.filter((e) => e.expense_date.startsWith(b.key)).reduce((s, e) => s + e.amount, 0)
      return { label: b.label, billed, collected, expenses: spent, net: collected - spent }
    })
    const sum = (k: 'billed' | 'collected' | 'expenses' | 'net') => monthly.reduce((s, m) => s + m[k], 0)
    const bySource: Record<string, number> = {}
    inv.forEach((i) => i.items.forEach((it) => { const s = source(it.description); bySource[s] = (bySource[s] ?? 0) + it.quantity * it.unit_price }))
    const byCat: Record<string, number> = {}
    exp.forEach((e) => { byCat[titleCase(e.category)] = (byCat[titleCase(e.category)] ?? 0) + e.amount })
    const byDoctor: Record<string, number> = {}
    inv.forEach((i) => i.items.forEach((it) => { const m = it.description.match(/^Consultation – (.+)$/); if (m) byDoctor[m[1]] = (byDoctor[m[1]] ?? 0) + it.quantity * it.unit_price }))
    return {
      monthly, billed: sum('billed'), collected: sum('collected'), spent: sum('expenses'), net: sum('net'),
      sources: Object.entries(bySource).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      cats: Object.entries(byCat).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      doctors: Object.entries(byDoctor).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
    }
  }, [months, invoices.data, payments.data, expenses.data])

  return (
    <div>
      <PageHeader title="Financial Reports" description="Profit & loss, revenue mix and spending analysis."
        actions={<>
          <Select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-40">
            <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
          </Select>
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => downloadCsv(`pnl-${months}m.csv`, r.monthly)}>Export</Button>
        </>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Billed" value={money(r.billed)} icon={<Receipt className="h-5 w-5" />} tone="blue" loading={loading} />
        <StatCard label="Collected" value={money(r.collected)} icon={<IndianRupee className="h-5 w-5" />} loading={loading} hint={<span className="inline-flex items-center gap-1"><Percent className="h-3 w-3" />{r.billed ? Math.round((r.collected / r.billed) * 100) : 0}% collection rate</span>} />
        <StatCard label="Expenses" value={money(r.spent)} icon={<Wallet className="h-5 w-5" />} tone="violet" loading={loading} />
        <StatCard label="Net profit" value={money(r.net)} icon={r.net >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />} tone={r.net >= 0 ? 'green' : 'red'} loading={loading} hint={r.collected ? `${Math.round((r.net / r.collected) * 100)}% margin` : undefined} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Monthly profit & loss" subtitle="Collections vs expenses" icon={<TrendingUp className="h-4 w-4" />} />
        {loading ? <Skeleton className="m-5 h-72" /> : (
          <div className="h-80 px-2 py-4">
            <ResponsiveContainer>
              <BarChart data={r.monthly} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={moneyCompact} width={64} />
                <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="billed" name="Billed" fill={bc(300)} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="collected" name="Collected" fill={bc(600)} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expenses" name="Expenses" fill={bc(900)} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card><CardHeader title="Revenue by source" icon={<PieIcon className="h-4 w-4" />} /><Donut data={r.sources} loading={loading} formatter={money} height={300} /></Card>
        <Card><CardHeader title="Expenses by category" icon={<PieIcon className="h-4 w-4" />} /><Donut data={r.cats} loading={loading} formatter={money} height={300} /></Card>
        <Card>
          <CardHeader title="Top doctors by consultation revenue" icon={<TrendingUp className="h-4 w-4" />} />
          <div className="space-y-3 p-5">
            {loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
            {!loading && r.doctors.map((d) => (
              <div key={d.name}>
                <div className="flex justify-between text-sm"><span className="truncate text-slate-700">{d.name}</span><b className="tabular-nums">{moneyCompact(d.value)}</b></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(d.value / (r.doctors[0]?.value || 1)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="mt-6 overflow-hidden">
        <CardHeader title="Monthly breakdown" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2.5 text-left">Month</th><th className="px-5 py-2.5 text-right">Billed</th><th className="px-5 py-2.5 text-right">Collected</th><th className="px-5 py-2.5 text-right">Expenses</th><th className="px-5 py-2.5 text-right">Net</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.monthly.map((m) => <tr key={m.label} className="tabular-nums"><td className="px-5 py-3 font-medium">{m.label}</td><td className="px-5 py-3 text-right">{money(m.billed)}</td><td className="px-5 py-3 text-right text-emerald-700">{money(m.collected)}</td><td className="px-5 py-3 text-right">{money(m.expenses)}</td><td className={`px-5 py-3 text-right font-semibold ${m.net >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{money(m.net)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

import { format } from 'date-fns'
import { useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, Database, Download, HardDrive, Info, KeyRound, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { db } from '../../data/adapter'
import { Badge, Button, ConfirmDialog } from '../../components/ui'
import { isSupabaseConfigured } from '../../lib/supabase'
import { fmtDate } from '../../lib/utils'
import { deepMerge, defaultContent } from '../../site/cms/content'
import { useAppSettings } from '../../settings/AppSettingsProvider'
import { DEFAULT_APP_SETTINGS } from '../../settings/types'
import { Section, type TabCtx } from './shared'
import { exportHospitalZip } from '../../privacy/exportZip'

const supabaseHost = () => {
  const env = (window as unknown as { __ENV__?: Record<string, string> }).__ENV__
  const url = env?.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
  try { return url ? new URL(url).host : '—' } catch { return '—' }
}

/** Phase 7.2: every record of the hospital as CSV files in one ZIP — always available to the owner */
function FullExport({ hospital }: { hospital: string }) {
  const [busy, setBusy] = useState<{ done: number; total: number; table: string } | null>(null)
  const run = async () => {
    setBusy({ done: 0, total: 1, table: '' })
    try {
      const r = await exportHospitalZip(hospital, (done, total, table) => setBusy({ done, total, table }))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(r.blob)
      a.download = r.filename
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      const rows = Object.values(r.counts).reduce((s, n) => s + n, 0)
      const missing = Object.keys(r.skipped)
      if (missing.length) toast.warning('Export finished with gaps', { description: `${rows.toLocaleString('en-IN')} rows. Not complete: ${missing.join(', ')} — see README.txt in the ZIP.` })
      else toast.success('Hospital data exported', { description: `${rows.toLocaleString('en-IN')} rows in ${Object.keys(r.counts).length} CSV files.` })
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const pct = busy ? Math.round((busy.done / Math.max(1, busy.total)) * 100) : 0
  return (
    <Section title="Export all hospital data" description="Every patient, visit, prescription, lab test, bill, payment, expense and log — one CSV per table, in a ZIP. Yours to keep or move to other software." icon={<Archive className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<Download className="h-4 w-4" />} loading={!!busy} onClick={run}>{busy ? `Exporting… ${pct}%` : 'Download ZIP'}</Button>
        {busy?.table && <span className="text-xs text-slate-500">Reading {busy.table.replace(/_/g, ' ')}…</span>}
      </div>
      {busy && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-50"><div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${pct}%` }} /></div>}
      <p className="mt-3 text-xs text-slate-400">Contains patients' medical data — store the file encrypted and delete it when you no longer need it. Works on a read-only account too.</p>
    </Section>
  )
}

export function DataTab({ ctx, exportOnly }: { ctx: TabCtx; exportOnly?: boolean }) {
  const { refresh, context } = useAuth()
  const { row } = useAppSettings()
  const qc = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<'demo' | 'defaults' | null>(null)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ kind: 'dc-hospital-settings', version: 1, exported_at: new Date().toISOString(), site_settings: ctx.site, app_settings: ctx.app }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hospital-settings-${format(new Date(), 'yyyy-MM-dd')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast.success('Settings exported', { description: 'Credentials are never included.' })
  }
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text())
      if (j?.kind !== 'dc-hospital-settings' || typeof j.app_settings !== 'object') throw new Error('This is not a settings export file')
      ctx.editApp((d) => Object.assign(d, deepMerge(DEFAULT_APP_SETTINGS, j.app_settings)))
      if (j.site_settings && typeof j.site_settings === 'object') ctx.editSite((d) => Object.assign(d, deepMerge(defaultContent().settings, j.site_settings)))
      toast.success('Settings imported', { description: 'Review the tabs, then click Save changes.' })
    } catch (e) { toast.error((e as Error).message) }
  }
  const run = async () => {
    const what = confirm
    setConfirm(null)
    if (what === 'defaults') {
      ctx.editApp((d) => Object.assign(d, structuredClone(DEFAULT_APP_SETTINGS)))
      toast.info('Defaults loaded', { description: 'Click Save changes to apply. Branding and credentials are unchanged.' })
    }
    if (what === 'demo') {
      await db.reset?.()
      qc.clear()
      await refresh()
      toast.success('Demo data restored')
    }
  }

  const info: [string, ReactNode][] = [
    ['Storage', isSupabaseConfigured ? <Badge tone="green" dot>Supabase</Badge> : <Badge tone="amber" dot>Demo · this browser</Badge>],
    ['Database host', isSupabaseConfigured ? <span className="font-mono text-xs">{supabaseHost()}</span> : '—'],
    ['Settings last saved', row?.updated_at ? `${fmtDate(row.updated_at)}${row.updated_by_name ? ` by ${row.updated_by_name}` : ''}` : 'Never (defaults)'],
    ['Browser language', navigator.language],
    ['Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
  ]

  const hospital = context?.tenant?.name || ctx.site.name || 'Hospital'
  if (exportOnly) return <div className="space-y-6"><FullExport hospital={hospital} /></div>

  return (
    <div className="space-y-6">
      <FullExport hospital={hospital} />
      <Section title="Backup & restore settings" description="Move your configuration between installations, or keep a copy before big changes." icon={<HardDrive className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportJson}>Export JSON</Button>
          <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => file.current?.click()}>Import JSON</Button>
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('defaults')}>Restore default appearance & messages</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><KeyRound className="h-3.5 w-3.5" />API keys and passwords are never exported. Re-enter them after importing on a new installation.</p>
      </Section>

      <Section title="Data storage" icon={<Database className="h-4 w-4" />}>
        {isSupabaseConfigured ? (
          <p className="text-sm text-slate-600">Data is stored in your Supabase Postgres database and protected with Row Level Security. Use Supabase's daily backups or <code className="rounded bg-slate-100 px-1 text-xs">pg_dump</code> for full database backups.</p>
        ) : (
          <div className="space-y-4 text-sm text-slate-600">
            <p>Data is saved in this browser only (localStorage). To share it across devices and staff:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Create a project at supabase.com and run <code className="rounded bg-slate-100 px-1 text-xs">supabase/master.sql</code> in the SQL editor.</li>
              <li>Set <code className="rounded bg-slate-100 px-1 text-xs">VITE_SUPABASE_URL</code> and <code className="rounded bg-slate-100 px-1 text-xs">VITE_SUPABASE_ANON_KEY</code>, then restart the app.</li>
              <li>Deploy the messaging function: <code className="rounded bg-slate-100 px-1 text-xs">supabase functions deploy notify</code>.</li>
            </ol>
            <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirm('demo')}>Reset demo data</Button>
          </div>
        )}
      </Section>

      <Section title="System information" icon={<Info className="h-4 w-4" />}>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {info.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-2"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800">{v}</dd></div>)}
        </dl>
      </Section>

      <ConfirmDialog open={confirm === 'demo'} onClose={() => setConfirm(null)} onConfirm={run} confirmLabel="Reset data" title="Reset all demo data?"
        description="Every change you made in this browser will be discarded and the original demo data restored. Accounts you registered will be removed." />
      <ConfirmDialog open={confirm === 'defaults'} onClose={() => setConfirm(null)} onConfirm={run} confirmLabel="Load defaults" title="Restore default settings?"
        description="Theme, layout, dashboard widgets, modules, announcement, formats, timeout and all message settings return to their defaults. Nothing changes until you click Save changes." />
    </div>
  )
}

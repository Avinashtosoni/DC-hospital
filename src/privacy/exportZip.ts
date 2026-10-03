/**
 * Phase 7.2 — "take your data with you": every table of the hospital as CSV (Excel-ready, UTF-8) in one ZIP, with
 * a manifest and a README. The owner can always run it — on a read-only or closing account too (reads stay allowed).
 * Secrets never leave: invite tokens are dropped; API keys live in settings, which have their own export.
 */
import { queryAll } from '../data/adapter'
import { supabase } from '../lib/supabase'
import { toCsv } from '../lib/utils'
import { TABLES, type TableName } from '../types'

/** columns that must not be exported */
const SECRET_COLS: Partial<Record<TableName, string[]>> = { staff_invites: ['token'] }
/** extra tables only a database has (phase 7) */
const DB_ONLY = ['privacy_requests', 'consent_log'] as const
export const EXPORT_ROW_CAP = 200_000

export interface ExportResult { blob: Blob; filename: string; counts: Record<string, number>; skipped: Record<string, string> }

async function readDbOnly(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; from < EXPORT_ROW_CAP; from += 1000) {
    const { data, error } = await supabase!.from(table).select('*').order('created_at').order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function exportHospitalZip(hospital: string, onProgress?: (done: number, total: number, table: string) => void): Promise<ExportResult> {
  const { zipSync, strToU8 } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const counts: Record<string, number> = {}, skipped: Record<string, string> = {}
  const tables: string[] = [...TABLES, ...DB_ONLY]
  let done = 0
  for (const t of tables) {
    onProgress?.(done, tables.length, t)
    try {
      let rows = (TABLES as string[]).includes(t)
        ? (await queryAll(t as TableName, { order: [{ column: 'created_at', asc: true }, { column: 'id', asc: true }] }, EXPORT_ROW_CAP)) as unknown as Record<string, unknown>[]
        : await readDbOnly(t)
      const drop = [...(SECRET_COLS[t as TableName] ?? []), 'tenant_id']
      rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))))
      counts[t] = rows.length
      if (rows.length >= EXPORT_ROW_CAP) skipped[t] = `only the first ${EXPORT_ROW_CAP.toLocaleString('en-IN')} rows — ask Hospital Comrade for a full database copy`
      files[`${t}.csv`] = strToU8(`\uFEFF${rows.length ? toCsv(rows) : ''}`)
    } catch (e) {
      skipped[t] = (e as Error).message
    }
    done++
  }
  onProgress?.(done, tables.length, '')
  const at = new Date()
  files['manifest.json'] = strToU8(JSON.stringify({ kind: 'hospital-data-export', version: 1, hospital, exported_at: at.toISOString(), counts, skipped }, null, 2))
  files['README.txt'] = strToU8([
    `${hospital} — complete data export (${at.toLocaleString('en-IN')})`,
    '',
    'One CSV file per table. Open them in Excel / Google Sheets (UTF-8). Each row has its id; the *_id columns link',
    'tables (for example appointments.patient_id = patients.id). Lists and details (prescription medicines, invoice',
    'items, audit changes) are stored as JSON inside a cell.',
    '',
    'This file contains patients\u2019 medical and personal data. Keep it encrypted and delete it when no longer needed.',
    'Settings (theme, messages, website) have a separate export under Settings \u2192 Data & backup \u2192 Export JSON.',
    '',
    ...Object.entries(counts).map(([t, n]) => `${t.padEnd(24)} ${n}`),
    ...(Object.keys(skipped).length ? ['', 'Not complete:', ...Object.entries(skipped).map(([t, why]) => `${t}: ${why}`)] : []),
  ].join('\r\n'))
  const zip = zipSync(files, { level: 6 })
  const slug = hospital.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hospital'
  return { blob: new Blob([zip], { type: 'application/zip' }), filename: `${slug}-data-${at.toISOString().slice(0, 10)}.zip`, counts, skipped }
}

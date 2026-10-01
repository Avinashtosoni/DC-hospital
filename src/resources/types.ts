import type { SiteSettings } from '../site/cms/types'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Role, TableName, Profile, Patient, Doctor, DB } from '../types'
import type { Row } from '../data/adapter'
import type { Filter } from '../data/query'

export type Lookups = { [K in TableName]: Map<string, DB[K]> }

export interface ResourceCtx {
  role: Role
  user: Profile
  me: { patient: Patient | null; doctor: Doctor | null }
  lk: Lookups
  navigate: (to: string) => void
  /** hospital details from Settings (letterhead for downloads, booking rules) */
  site: SiteSettings
  /** fire-and-forget side-effect helpers (invalidate caches afterwards) */
  patch: <T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) => Promise<void>
  insert: <T extends TableName>(table: T, row: Partial<Row<T>>) => Promise<void>
  /** refetch every cached read of a table (after the database changed it, e.g. via a trigger) */
  refresh: (table: TableName) => void
}

export type FieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'currency' | 'date' | 'time' | 'textarea' | 'select'
  | 'relation' | 'days' | 'medications' | 'line_items'

export type Option = { value: string; label: string }

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  hint?: string
  span?: 1 | 2
  options?: Option[]
  relation?: {
    table: TableName
    label: (row: any, ctx: ResourceCtx) => string
    filter?: (row: any, ctx: ResourceCtx, values: Record<string, any>) => boolean
    /** big tables: search the database as the user types instead of listing every row */
    search?: { columns: string[]; where?: (ctx: ResourceCtx, values: Record<string, any>) => Filter[]; order?: string }
  }
  default?: (ctx: ResourceCtx, rows: any[]) => unknown
  hidden?: (ctx: ResourceCtx, values: Record<string, any>, editing: boolean) => boolean
  readOnly?: (ctx: ResourceCtx, editing: boolean) => boolean
  min?: number
}

export interface ColumnDef<R> {
  key: string
  header: string
  render: (row: R, ctx: ResourceCtx) => ReactNode
  sortValue?: (row: R, ctx: ResourceCtx) => string | number
  className?: string
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
  align?: 'right'
  /** hide this column for these roles */
  hideFor?: Role[]
  /** only show this column for these roles */
  showFor?: Role[]
}

export interface FilterDef<R> {
  key: string
  label: string
  options: Option[] | ((ctx: ResourceCtx) => Option[])
  predicate?: (row: R, value: string, ctx: ResourceCtx) => boolean
}

export interface RowAction<R> {
  label: string
  icon?: LucideIcon
  tone?: 'default' | 'danger'
  onClick: (row: R, ctx: ResourceCtx) => void | Promise<void>
}

/** a lookup table for ctx.lk: a whole (small) table, or a bounded window of a big one */
export type RelationSpec = TableName | { table: TableName; where: Filter[] }

/**
 * Server-side list mode: search, filters, sorting and paging run in the database and only the visible page
 * (plus the related rows it needs) is downloaded. Used for every table that grows with hospital activity.
 */
export interface ServerSpec {
  /** text columns matched by the search box (case-insensitive "contains") */
  search: string[]
  /** also match rows whose foreign key points at a related record matching the term (e.g. patient name / MRN) */
  searchVia?: { column: string; table: TableName; columns: string[] }[]
  /** role scope as filters (Supabase RLS enforces the same rule; this keeps demo mode identical) */
  scope?: (ctx: ResourceCtx) => Filter[]
  /** filter key → database filters for the chosen value (default: column = value) */
  filters?: Record<string, (value: string, ctx: ResourceCtx) => Filter[]>
  /** column key → database column(s) used for sorting (comma-separated for tie-breaks); unlisted columns are not sortable */
  sort?: Record<string, string>
  /** foreign keys resolved for the visible page: column → table (fills ctx.lk for those rows) */
  resolve?: Record<string, TableName>
  /** column whose highest values seed form defaults such as the next MRN / invoice number */
  latestBy?: string
}

export interface ResourceDef<T extends TableName = TableName> {
  table: T
  path: string
  title: string | ((role: Role) => string)
  singular: string
  description?: string | ((role: Role) => string)
  icon: LucideIcon
  relations?: RelationSpec[]
  server?: ServerSpec
  columns: ColumnDef<Row<T>>[]
  fields: FieldDef[]
  searchText: (row: Row<T>, ctx: ResourceCtx) => string
  filters?: FilterDef<Row<T>>[]
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  scope?: (row: Row<T>, ctx: ResourceCtx) => boolean
  rowLink?: (row: Row<T>) => string
  rowActions?: (row: Row<T>, ctx: ResourceCtx) => (RowAction<Row<T>> | false | null | undefined)[]
  canEdit?: (row: Row<T>, ctx: ResourceCtx) => boolean
  canDelete?: (row: Row<T>, ctx: ResourceCtx) => boolean
  allowCreate?: boolean
  beforeSave?: (values: Record<string, any>, ctx: ResourceCtx, existing?: Row<T>) => Record<string, any>
  /** cross-field / cross-row checks; return { fieldName: message } */
  validate?: (values: Record<string, any>, ctx: ResourceCtx, rows: Row<T>[], existing?: Row<T>) => Record<string, string> | Promise<Record<string, string>>
  afterSave?: (saved: Row<T>, ctx: ResourceCtx, existing?: Row<T>) => void | Promise<void>
  afterDelete?: (row: Row<T>, ctx: ResourceCtx) => void | Promise<void>
  emptyText?: string
  drawerWidth?: string
}

export const defineResource = <T extends TableName>(def: ResourceDef<T>) => def as unknown as ResourceDef<TableName>

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Role, TableName, Profile, Patient, Doctor, DB } from '../types'
import type { Row } from '../data/adapter'

export type Lookups = { [K in TableName]: Map<string, DB[K]> }

export interface ResourceCtx {
  role: Role
  user: Profile
  me: { patient: Patient | null; doctor: Doctor | null }
  lk: Lookups
  navigate: (to: string) => void
  /** fire-and-forget side-effect helpers (invalidate caches afterwards) */
  patch: <T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) => Promise<void>
  insert: <T extends TableName>(table: T, row: Partial<Row<T>>) => Promise<void>
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

export interface ResourceDef<T extends TableName = TableName> {
  table: T
  path: string
  title: string | ((role: Role) => string)
  singular: string
  description?: string | ((role: Role) => string)
  icon: LucideIcon
  relations?: TableName[]
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
  validate?: (values: Record<string, any>, ctx: ResourceCtx, rows: Row<T>[], existing?: Row<T>) => Record<string, string>
  afterSave?: (saved: Row<T>, ctx: ResourceCtx, existing?: Row<T>) => void | Promise<void>
  afterDelete?: (row: Row<T>, ctx: ResourceCtx) => void | Promise<void>
  emptyText?: string
  drawerWidth?: string
}

export const defineResource = <T extends TableName>(def: ResourceDef<T>) => def as unknown as ResourceDef<TableName>

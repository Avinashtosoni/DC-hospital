import type { Role, TableName } from '../types'

export type Action = 'read' | 'create' | 'update' | 'delete'
type Matrix = Partial<Record<Role, Action[]>>

const ALL: Action[] = ['read', 'create', 'update', 'delete']
const R: Action[] = ['read']
const RU: Action[] = ['read', 'update']
const RC: Action[] = ['read', 'create']
const RCU: Action[] = ['read', 'create', 'update']

/**
 * Single source of truth for role based access in the UI.
 * Mirrors the Row Level Security policies in supabase/master.sql.
 */
export const PERMISSIONS: Record<TableName, Matrix> = {
  profiles:      { owner: ALL },
  departments:   { owner: ALL, doctor: R, receptionist: R, accountant: R, staff: R, patient: R },
  doctors:       { owner: ALL, receptionist: RU, doctor: R, accountant: R, staff: R, patient: R },
  staff:         { owner: ALL, accountant: R, receptionist: R },
  patients:      { owner: ALL, receptionist: RCU, doctor: RU, staff: RU, accountant: R, patient: R },
  appointments:  { owner: ALL, receptionist: ALL, doctor: RCU, staff: R, patient: RCU },
  prescriptions: { owner: ALL, doctor: ALL, staff: R, patient: R },
  lab_tests:     { owner: ALL, doctor: RCU, staff: RCU, receptionist: RC, accountant: R, patient: R },
  wards:         { owner: ALL, receptionist: R, doctor: R, staff: R },
  beds:          { owner: ALL, receptionist: RU, doctor: RU, staff: RU },
  admissions:    { owner: ALL, receptionist: RCU, doctor: RCU, staff: RU, accountant: R },
  invoices:      { owner: ALL, accountant: ALL, receptionist: RCU, patient: R },
  payments:      { owner: ALL, accountant: ALL, receptionist: RC, patient: R },
  expenses:      { owner: ALL, accountant: ALL },
  inventory:     { owner: ALL, staff: RCU, doctor: R, accountant: R },
  notices:       { owner: ALL, doctor: R, receptionist: R, accountant: R, staff: R, patient: R },
  site_enquiries: { owner: ALL, receptionist: RU },
}

export function can(role: Role | undefined, table: TableName, action: Action) {
  if (!role) return false
  return PERMISSIONS[table][role]?.includes(action) ?? false
}

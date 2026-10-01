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
  // patients may edit their own contact details (a trigger keeps MRN / status / links read-only for them)
  patients:      { owner: ALL, receptionist: RCU, doctor: RU, staff: RU, accountant: R, patient: RU },
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
  // website forms: the owner builds them; reception reads them for the inbox (visitors read enabled ones — scripts/sql/forms.sql)
  site_forms:    { owner: ALL, receptionist: R },
  // doctors request their own leave (pending); owner / reception approve and manage everyone's
  doctor_leaves: { owner: ALL, receptionist: ALL, doctor: ALL, staff: R },
  holidays:      { owner: ALL, receptionist: ALL, doctor: R, staff: R, accountant: R, patient: R },
  // append-only; the owner sees everything, everyone else only their own actions (see ROW_RULES)
  audit_log:     { owner: R, doctor: R, receptionist: R, accountant: R, staff: R },
  // patients rate their own completed visits once; doctors read their own ratings (see ROW_RULES)
  visit_feedback: { owner: ALL, receptionist: R, doctor: R, patient: RC },
  staff_invites: { owner: ALL },
}

/**
 * Extra row conditions for staff roles, applied on top of the matrix above (RLS + UI scoping).
 * Keyed table → role → action → SQL boolean expression.
 */
export const ROW_RULES: Partial<Record<TableName, Partial<Record<Role, Partial<Record<Action, string>>>>>> = {
  doctor_leaves: {
    doctor: {
      create: "doctor_id = public.my_doctor_id() and status = 'pending'",
      update: "doctor_id = public.my_doctor_id() and status = 'pending'",
      delete: "doctor_id = public.my_doctor_id() and status = 'pending'",
    },
  },
  visit_feedback: { doctor: { read: 'doctor_id = public.my_doctor_id()' } },
  audit_log: Object.fromEntries((['doctor', 'receptionist', 'accountant', 'staff'] as Role[]).map((r) => [r, { read: 'actor_id = auth.uid()' }])),
}

export function can(role: Role | undefined, table: TableName, action: Action) {
  if (!role) return false
  return PERMISSIONS[table][role]?.includes(action) ?? false
}

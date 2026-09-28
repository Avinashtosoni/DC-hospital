export type Role = 'owner' | 'doctor' | 'receptionist' | 'accountant' | 'staff' | 'patient'

export const ROLES: Role[] = ['owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient']
export const STAFF_ROLES: Role[] = ['owner', 'doctor', 'receptionist', 'accountant', 'staff']

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Hospital Owner',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  accountant: 'Accountant',
  staff: 'Staff',
  patient: 'Patient',
}

export interface BaseRow {
  id: string
  created_at?: string
  updated_at?: string
}

export interface Profile extends BaseRow {
  full_name: string
  email: string
  role: Role
  phone?: string | null
  avatar_url?: string | null
}

export interface Department extends BaseRow {
  name: string
  description?: string | null
  location?: string | null
  phone?: string | null
}

export interface Doctor extends BaseRow {
  profile_id?: string | null
  full_name: string
  email?: string | null
  phone?: string | null
  department_id?: string | null
  specialization: string
  qualification?: string | null
  experience_years?: number | null
  consultation_fee: number
  available_days?: string[] | null
  shift?: string | null
  status: 'active' | 'on_leave' | 'inactive'
  bio?: string | null
}

export interface Staff extends BaseRow {
  profile_id?: string | null
  full_name: string
  email?: string | null
  phone?: string | null
  designation: string
  department_id?: string | null
  shift: 'morning' | 'evening' | 'night'
  salary: number
  join_date?: string | null
  status: 'active' | 'on_leave' | 'inactive'
}

export interface Patient extends BaseRow {
  profile_id?: string | null
  mrn: string
  full_name: string
  gender: 'male' | 'female' | 'other'
  date_of_birth?: string | null
  blood_group?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  allergies?: string | null
  insurance_provider?: string | null
  status: 'outpatient' | 'inpatient' | 'discharged'
}

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show'

export interface Appointment extends BaseRow {
  patient_id: string
  doctor_id: string
  appointment_date: string
  appointment_time: string
  type: 'consultation' | 'follow_up' | 'emergency' | 'checkup'
  status: AppointmentStatus
  reason?: string | null
  notes?: string | null
  /** where the booking came from */
  source?: 'desk' | 'website' | 'portal' | null
  /** public reference shown to patients who book online, e.g. DCB-4K7Q2M */
  booking_ref?: string | null
  /** when the front desk last contacted the patient about rescheduling */
  contacted_at?: string | null
}

export type LeaveKind = 'leave' | 'surgery' | 'meeting' | 'conference' | 'training' | 'other'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'
/** Full-day leave (no times) or a blocked time range (surgery, meeting…) for a doctor. */
export interface DoctorLeave extends BaseRow {
  doctor_id: string
  kind: LeaveKind
  start_date: string
  end_date: string
  /** both empty = whole day(s) */
  start_time?: string | null
  end_time?: string | null
  status: LeaveStatus
  reason?: string | null
}

/** Hospital-wide OPD closure. */
export interface Holiday extends BaseRow {
  holiday_date: string
  name: string
  note?: string | null
}

export type AuditAction = 'insert' | 'update' | 'delete'
/** Append-only change history (written by database triggers / the demo adapter — never by the UI). */
export interface AuditEntry extends BaseRow {
  table_name: string
  record_id: string | null
  action: AuditAction
  actor_id?: string | null
  actor_name?: string | null
  actor_role?: string | null
  summary?: string | null
  /** update: { column: { from, to } } · insert/delete: { column: { to } | { from } } */
  changes: Record<string, { from?: unknown; to?: unknown }>
}

export interface Medication {
  name: string
  dosage: string
  frequency: string
  duration: string
}

export interface Prescription extends BaseRow {
  patient_id: string
  doctor_id: string
  diagnosis: string
  symptoms?: string | null
  medications: Medication[]
  advice?: string | null
  follow_up_date?: string | null
  prescribed_on: string
}

export interface LabTest extends BaseRow {
  patient_id: string
  doctor_id?: string | null
  test_name: string
  category: string
  priority: 'routine' | 'urgent' | 'stat'
  status: 'requested' | 'sample_collected' | 'in_progress' | 'completed' | 'cancelled'
  result?: string | null
  price: number
  requested_on: string
  completed_on?: string | null
}

export interface Ward extends BaseRow {
  name: string
  type: 'general' | 'icu' | 'private' | 'semi_private' | 'maternity' | 'pediatric' | 'emergency'
  floor: string
  daily_rate: number
}

export interface Bed extends BaseRow {
  ward_id: string
  bed_number: string
  status: 'available' | 'occupied' | 'maintenance' | 'reserved'
}

export interface Admission extends BaseRow {
  patient_id: string
  doctor_id?: string | null
  bed_id?: string | null
  admission_date: string
  discharge_date?: string | null
  reason?: string | null
  status: 'admitted' | 'discharged'
  notes?: string | null
}

export interface LineItem {
  description: string
  quantity: number
  unit_price: number
}

export type InvoiceStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'cancelled'

export interface Invoice extends BaseRow {
  invoice_number: string
  patient_id: string
  issue_date: string
  due_date?: string | null
  items: LineItem[]
  subtotal: number
  tax: number
  discount: number
  total: number
  amount_paid: number
  status: InvoiceStatus
  notes?: string | null
}

export interface Payment extends BaseRow {
  invoice_id: string
  patient_id: string
  amount: number
  method: 'cash' | 'card' | 'upi' | 'insurance' | 'bank_transfer'
  paid_on: string
  reference?: string | null
}

export interface Expense extends BaseRow {
  category: 'salaries' | 'supplies' | 'utilities' | 'equipment' | 'maintenance' | 'rent' | 'other'
  description: string
  amount: number
  expense_date: string
  vendor?: string | null
  status: 'paid' | 'pending'
}

export interface InventoryItem extends BaseRow {
  name: string
  category: 'medicine' | 'consumable' | 'equipment' | 'surgical'
  sku: string
  quantity: number
  unit: string
  reorder_level: number
  unit_price: number
  supplier?: string | null
  expiry_date?: string | null
}

export interface Notice extends BaseRow {
  title: string
  body: string
  audience: 'all' | 'staff' | 'doctors' | 'patients'
  priority: 'normal' | 'important' | 'urgent'
  published_on: string
}

export type EnquiryStatus = 'new' | 'in_progress' | 'resolved' | 'spam'
/** Message sent from the public website's Contact form. */
export interface SiteEnquiry extends BaseRow {
  ref: string
  name: string
  phone: string
  email?: string | null
  topic: string
  speciality?: string | null
  message: string
  status: EnquiryStatus
  notes?: string | null
}

export interface DB {
  profiles: Profile
  departments: Department
  doctors: Doctor
  staff: Staff
  patients: Patient
  appointments: Appointment
  prescriptions: Prescription
  lab_tests: LabTest
  wards: Ward
  beds: Bed
  admissions: Admission
  invoices: Invoice
  payments: Payment
  expenses: Expense
  inventory: InventoryItem
  notices: Notice
  site_enquiries: SiteEnquiry
  doctor_leaves: DoctorLeave
  holidays: Holiday
  audit_log: AuditEntry
}

export type TableName = keyof DB
export const TABLES: TableName[] = [
  'profiles', 'departments', 'doctors', 'staff', 'patients', 'appointments', 'prescriptions',
  'lab_tests', 'wards', 'beds', 'admissions', 'invoices', 'payments', 'expenses', 'inventory', 'notices', 'site_enquiries',
  'doctor_leaves', 'holidays', 'audit_log',
]

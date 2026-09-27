import {
  BarChart3, BedDouble, Building2, CalendarCheck, ClipboardList, CreditCard, FlaskConical, HeartPulse, LayoutDashboard,
  Globe, Inbox, Megaphone, Package, Pill, Receipt, Settings, Stethoscope, UserCog, Users, Wallet, ShieldCheck, type LucideIcon,
} from 'lucide-react'
import type { Role } from '../../types'

export interface NavItem { label: string | ((r: Role) => string); path: string; icon: LucideIcon; roles: Role[] }
export interface NavSection { title: string; items: NavItem[] }

const S: Role[] = ['owner', 'doctor', 'receptionist', 'accountant', 'staff']

export const NAV: NavSection[] = [
  { title: 'Overview', items: [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard, roles: [...S, 'patient'] },
    { label: 'My Health Record', path: '/me', icon: HeartPulse, roles: ['patient'] },
  ] },
  { title: 'Clinical', items: [
    { label: (r) => (r === 'patient' || r === 'doctor' ? 'My Appointments' : 'Appointments'), path: '/appointments', icon: CalendarCheck, roles: ['owner', 'receptionist', 'doctor', 'staff', 'patient'] },
    { label: 'Patients', path: '/patients', icon: Users, roles: ['owner', 'receptionist', 'doctor', 'staff', 'accountant'] },
    { label: (r) => (r === 'patient' ? 'My Prescriptions' : 'Prescriptions'), path: '/prescriptions', icon: Pill, roles: ['owner', 'doctor', 'staff', 'patient'] },
    { label: (r) => (r === 'patient' ? 'My Lab Reports' : 'Laboratory'), path: '/lab-tests', icon: FlaskConical, roles: ['owner', 'doctor', 'staff', 'receptionist', 'accountant', 'patient'] },
    { label: 'Admissions', path: '/admissions', icon: ClipboardList, roles: ['owner', 'receptionist', 'doctor', 'staff', 'accountant'] },
    { label: 'Bed Management', path: '/beds', icon: BedDouble, roles: ['owner', 'receptionist', 'doctor', 'staff'] },
  ] },
  { title: 'People', items: [
    { label: (r) => (r === 'patient' ? 'Find a Doctor' : 'Doctors'), path: '/doctors', icon: Stethoscope, roles: [...S, 'patient'] },
    { label: 'Staff', path: '/staff', icon: UserCog, roles: ['owner', 'accountant', 'receptionist'] },
    { label: 'Departments', path: '/departments', icon: Building2, roles: S },
  ] },
  { title: 'Finance', items: [
    { label: (r) => (r === 'patient' ? 'My Bills' : 'Invoices'), path: '/invoices', icon: Receipt, roles: ['owner', 'accountant', 'receptionist', 'patient'] },
    { label: (r) => (r === 'patient' ? 'My Payments' : 'Payments'), path: '/payments', icon: CreditCard, roles: ['owner', 'accountant', 'receptionist', 'patient'] },
    { label: 'Expenses', path: '/expenses', icon: Wallet, roles: ['owner', 'accountant'] },
    { label: 'Financial Reports', path: '/reports', icon: BarChart3, roles: ['owner', 'accountant'] },
  ] },
  { title: 'Website', items: [
    { label: 'Website CMS', path: '/cms', icon: Globe, roles: ['owner'] },
    { label: 'Enquiries', path: '/enquiries', icon: Inbox, roles: ['owner', 'receptionist'] },
  ] },
  { title: 'Operations', items: [
    { label: 'Pharmacy & Inventory', path: '/inventory', icon: Package, roles: ['owner', 'staff', 'doctor', 'accountant'] },
    { label: 'Notice Board', path: '/notices', icon: Megaphone, roles: [...S, 'patient'] },
    { label: 'Users & Roles', path: '/users', icon: ShieldCheck, roles: ['owner'] },
    { label: 'Settings', path: '/settings', icon: Settings, roles: [...S, 'patient'] },
  ] },
]

export const navLabel = (item: NavItem, role: Role) => (typeof item.label === 'function' ? item.label(role) : item.label)
export const canSee = (path: string, role: Role) =>
  NAV.some((s) => s.items.some((i) => i.path === path && i.roles.includes(role)))

/** The demo sign-in accounts (shown on the login page in demo mode). Kept apart from the seed data so the login page
 *  doesn't pull the whole demo database into the main bundle. */
import type { Role } from '../types'

export const DEMO_PASSWORD = 'Demo@123'

export const DEMO_USERS: { id: string; email: string; full_name: string; role: Role; phone: string }[] = [
  { id: 'd0c00000-0000-4000-8000-000000000001', email: 'owner@dchospital.com', full_name: 'Avinash Tosoni', role: 'owner', phone: '+91 98100 10001' },
  { id: 'd0c00000-0000-4000-8000-000000000002', email: 'doctor@dchospital.com', full_name: 'Dr. Arjun Mehta', role: 'doctor', phone: '+91 98100 10002' },
  { id: 'd0c00000-0000-4000-8000-000000000003', email: 'reception@dchospital.com', full_name: 'Neha Kapoor', role: 'receptionist', phone: '+91 98100 10003' },
  { id: 'd0c00000-0000-4000-8000-000000000004', email: 'accounts@dchospital.com', full_name: 'Rahul Verma', role: 'accountant', phone: '+91 98100 10004' },
  { id: 'd0c00000-0000-4000-8000-000000000005', email: 'staff@dchospital.com', full_name: 'Priya Sharma', role: 'staff', phone: '+91 98100 10005' },
  { id: 'd0c00000-0000-4000-8000-000000000006', email: 'patient@dchospital.com', full_name: 'Rohan Das', role: 'patient', phone: '+91 98100 10006' },
]

export const CITY_USERS: { id: string; email: string; full_name: string; role: Role; phone: string }[] = [
  { id: 'c1c00000-0000-4000-8000-000000000001', email: 'owner@citycare.demo', full_name: 'Dr. Ritu Ranjan', role: 'owner', phone: '+91 98100 50011' },
  { id: 'c1c00000-0000-4000-8000-000000000002', email: 'doctor@citycare.demo', full_name: 'Dr. Vivek Mishra', role: 'doctor', phone: '+91 98100 50012' },
  { id: 'c1c00000-0000-4000-8000-000000000003', email: 'reception@citycare.demo', full_name: 'Swati Kumari', role: 'receptionist', phone: '+91 98100 50013' },
  { id: 'c1c00000-0000-4000-8000-000000000004', email: 'accounts@citycare.demo', full_name: 'Pankaj Prasad', role: 'accountant', phone: '+91 98100 50014' },
  { id: 'c1c00000-0000-4000-8000-000000000005', email: 'staff@citycare.demo', full_name: 'Komal Thakur', role: 'staff', phone: '+91 98100 50015' },
  { id: 'c1c00000-0000-4000-8000-000000000006', email: 'patient@citycare.demo', full_name: 'Aarav Jha', role: 'patient', phone: '+91 98100 50016' },
]

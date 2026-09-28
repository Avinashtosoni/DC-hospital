/**
 * Deterministic demo data used by BOTH the local demo mode and the Supabase master SQL generator
 * (scripts/build-master-sql.ts). Dates are expressed relative to "today" through a DateHelper so the
 * data always feels current — locally they become ISO strings, in SQL they become `current_date + n`.
 */
import type { SiteEnquiry, AuditEntry, DoctorLeave, Holiday,
  Admission, Appointment, Bed, DB, Department, Doctor, Expense, InventoryItem, Invoice, LabTest,
  LineItem, Medication, Notice, Patient, Payment, Prescription, Profile, Role, Staff, Ward,
} from '../types'

export interface DateHelper {
  /** calendar date (yyyy-mm-dd) offset from today */
  date(offsetDays: number): string
  /** timestamp offset from today at an optional HH:MM time */
  ts(offsetDays: number, time?: string): string
}

export const DEMO_PASSWORD = 'Demo@123'

export const DEMO_USERS: { id: string; email: string; full_name: string; role: Role; phone: string }[] = [
  { id: 'd0c00000-0000-4000-8000-000000000001', email: 'owner@dchospital.com', full_name: 'Avinash Tosoni', role: 'owner', phone: '+91 98100 10001' },
  { id: 'd0c00000-0000-4000-8000-000000000002', email: 'doctor@dchospital.com', full_name: 'Dr. Arjun Mehta', role: 'doctor', phone: '+91 98100 10002' },
  { id: 'd0c00000-0000-4000-8000-000000000003', email: 'reception@dchospital.com', full_name: 'Neha Kapoor', role: 'receptionist', phone: '+91 98100 10003' },
  { id: 'd0c00000-0000-4000-8000-000000000004', email: 'accounts@dchospital.com', full_name: 'Rahul Verma', role: 'accountant', phone: '+91 98100 10004' },
  { id: 'd0c00000-0000-4000-8000-000000000005', email: 'staff@dchospital.com', full_name: 'Priya Sharma', role: 'staff', phone: '+91 98100 10005' },
  { id: 'd0c00000-0000-4000-8000-000000000006', email: 'patient@dchospital.com', full_name: 'Rohan Das', role: 'patient', phone: '+91 98100 10006' },
]

// ---------------------------------------------------------------------------------------------
// helpers
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number, len: number) => String(n).padStart(len, '0')
/** deterministic uuid: table code + sequence */
export const sid = (code: number, n: number) => `d0c${pad(code, 5)}-0000-4000-8000-${pad(n, 12)}`

export function buildSeed(raw: DateHelper): { [K in keyof DB]: DB[K][] } {
  // Date helper outputs are opaque (ISO string or SQL expression) – remember offsets for reverse lookups.
  const offsets = new Map<string, number>()
  const d: DateHelper = { date: (o) => { const v = raw.date(o); offsets.set(v, o); return v }, ts: raw.ts }
  const offsetOf = (v: string): number => {
    const hit = offsets.get(v)
    if (hit === undefined) throw new Error('unknown seed date ' + v)
    return hit
  }
  const rand = mulberry32(20260927)
  const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]
  const chance = (p: number) => rand() < p
  const round = (n: number, step = 10) => Math.round(n / step) * step

  // ---------------------------------------------------------------- profiles
  const profiles: Profile[] = DEMO_USERS.map((u) => ({
    id: u.id, full_name: u.full_name, email: u.email, role: u.role, phone: u.phone, avatar_url: null,
    created_at: d.ts(-200), updated_at: d.ts(-200),
  }))
  const U = Object.fromEntries(DEMO_USERS.map((u) => [u.role, u.id])) as Record<Role, string>

  // ---------------------------------------------------------------- departments
  const deptDefs: [string, string, string][] = [
    ['Cardiology', 'Heart & vascular care, ECG, Echo, cardiac rehab', 'Block A · 2nd Floor'],
    ['Neurology', 'Brain, spine and nervous system disorders', 'Block A · 3rd Floor'],
    ['Orthopedics', 'Bones, joints, sports injuries and trauma', 'Block B · 1st Floor'],
    ['Pediatrics', 'Newborn, child and adolescent care', 'Block C · Ground Floor'],
    ['General Medicine', 'Primary care, infections, chronic disease management', 'Block A · Ground Floor'],
    ['Gynecology & Obstetrics', "Women's health, pregnancy and maternity", 'Block C · 1st Floor'],
    ['Dermatology', 'Skin, hair and nail conditions', 'Block B · 2nd Floor'],
    ['ENT', 'Ear, nose and throat', 'Block B · 2nd Floor'],
    ['Radiology', 'X-Ray, CT, MRI and ultrasound imaging', 'Block D · Basement'],
    ['Emergency', '24x7 casualty and trauma care', 'Main Building · Ground Floor'],
    ['Pathology', 'Laboratory diagnostics and blood bank', 'Block D · Ground Floor'],
  ]
  const departments: Department[] = deptDefs.map(([name, description, location], i) => ({
    id: sid(1, i + 1), name, description, location, phone: `+91 11 4000 ${pad(2100 + i, 4)}`, created_at: d.ts(-400),
  }))
  const dept = (name: string) => departments.find((x) => x.name === name)!.id

  // ---------------------------------------------------------------- doctors
  const docDefs: [string, string, string, string, number, number][] = [
    ['Dr. Arjun Mehta', 'Cardiology', 'Interventional Cardiologist', 'MBBS, MD, DM (Cardiology)', 14, 1200],
    ['Dr. Kavita Rao', 'Neurology', 'Neurologist', 'MBBS, MD, DM (Neurology)', 11, 1100],
    ['Dr. Sameer Khan', 'Orthopedics', 'Orthopedic Surgeon', 'MBBS, MS (Ortho)', 9, 900],
    ['Dr. Ananya Iyer', 'Pediatrics', 'Pediatrician', 'MBBS, MD (Pediatrics)', 8, 700],
    ['Dr. Vikram Singh', 'General Medicine', 'Physician', 'MBBS, MD (Medicine)', 16, 600],
    ['Dr. Meera Nair', 'Gynecology & Obstetrics', 'Obstetrician & Gynecologist', 'MBBS, MS (OBG)', 12, 900],
    ['Dr. Rajesh Gupta', 'Dermatology', 'Dermatologist', 'MBBS, MD (Dermatology)', 7, 800],
    ['Dr. Sneha Patil', 'ENT', 'ENT Surgeon', 'MBBS, MS (ENT)', 6, 700],
    ['Dr. Harish Menon', 'Radiology', 'Radiologist', 'MBBS, MD (Radiology)', 13, 1000],
    ['Dr. Farah Siddiqui', 'Emergency', 'Emergency Physician', 'MBBS, MEM', 5, 800],
    ['Dr. Nikhil Joshi', 'Cardiology', 'Cardiac Surgeon', 'MBBS, MS, MCh (CTVS)', 18, 1500],
    ['Dr. Pooja Bansal', 'General Medicine', 'Diabetologist', 'MBBS, MD, Fellowship Diabetology', 10, 700],
    ['Dr. Aditya Kulkarni', 'Orthopedics', 'Spine Surgeon', 'MBBS, MS (Ortho), Fellowship Spine', 12, 1100],
    ['Dr. Lakshmi Reddy', 'Pathology', 'Pathologist', 'MBBS, MD (Pathology)', 15, 500],
  ]
  const dayPools = [
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], ['Mon', 'Wed', 'Fri', 'Sat'], ['Tue', 'Thu', 'Sat'],
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ]
  const shifts = ['09:00 – 14:00', '10:00 – 17:00', '14:00 – 20:00', '08:00 – 16:00']
  const doctors: Doctor[] = docDefs.map(([full_name, dep, specialization, qualification, experience_years, consultation_fee], i) => ({
    id: sid(2, i + 1),
    profile_id: i === 0 ? U.doctor : null,
    full_name,
    email: i === 0 ? 'doctor@dchospital.com' : `${full_name.replace('Dr. ', '').toLowerCase().replace(/\s+/g, '.')}@dchospital.com`,
    phone: i === 0 ? DEMO_USERS[1].phone : `+91 98${int(100, 999)} ${int(10000, 99999)}`,
    department_id: dept(dep),
    specialization, qualification, experience_years, consultation_fee,
    available_days: pick(dayPools), shift: pick(shifts),
    status: i === 7 ? 'on_leave' : 'active',
    bio: `${specialization} with ${experience_years}+ years of clinical experience.`,
    created_at: d.ts(-380 + i),
  }))
  const doctorDept = (docId: string) => departments.find((x) => x.id === doctors.find((dd) => dd.id === docId)!.department_id)!.name

  // ---------------------------------------------------------------- staff
  const staffDefs: [string, string, string | null, Staff['shift'], number][] = [
    ['Priya Sharma', 'Head Nurse', 'General Medicine', 'morning', 52000],
    ['Neha Kapoor', 'Front Desk Receptionist', null, 'morning', 28000],
    ['Rahul Verma', 'Senior Accountant', null, 'morning', 48000],
    ['Sunita Yadav', 'Staff Nurse', 'Cardiology', 'evening', 34000],
    ['Deepak Chauhan', 'Lab Technician', 'Pathology', 'morning', 30000],
    ['Anjali Mishra', 'Pharmacist', null, 'morning', 36000],
    ['Mohammed Irfan', 'Radiology Technician', 'Radiology', 'evening', 33000],
    ['Kiran Thomas', 'ICU Nurse', 'Emergency', 'night', 40000],
    ['Ravi Prakash', 'Ward Attendant', 'Orthopedics', 'night', 18000],
    ['Geeta Devi', 'Housekeeping Supervisor', null, 'morning', 22000],
    ['Sanjay Pillai', 'Security Officer', null, 'night', 20000],
    ['Pooja Saxena', 'Receptionist', null, 'evening', 26000],
    ['Arun Bhatt', 'OT Technician', 'Orthopedics', 'morning', 32000],
    ['Fatima Sheikh', 'Staff Nurse', 'Pediatrics', 'morning', 34000],
    ['Manoj Tiwari', 'Ambulance Driver', 'Emergency', 'night', 21000],
    ['Shalini Dubey', 'Billing Executive', null, 'evening', 27000],
  ]
  const staffProfile: Record<number, string> = { 0: U.staff, 1: U.receptionist, 2: U.accountant }
  const staff: Staff[] = staffDefs.map(([full_name, designation, dep, shift, salary], i) => ({
    id: sid(3, i + 1),
    profile_id: staffProfile[i] ?? null,
    full_name,
    email: staffProfile[i] ? DEMO_USERS.find((u) => u.id === staffProfile[i])!.email : `${full_name.toLowerCase().replace(/\s+/g, '.')}@dchospital.com`,
    phone: staffProfile[i] ? DEMO_USERS.find((u) => u.id === staffProfile[i])!.phone : `+91 97${int(100, 999)} ${int(10000, 99999)}`,
    designation, department_id: dep ? dept(dep) : null, shift, salary,
    join_date: d.date(-int(120, 1500)),
    status: i === 9 ? 'on_leave' : 'active',
    created_at: d.ts(-360 + i),
  }))

  // ---------------------------------------------------------------- patients
  const maleFirst = ['Rohan', 'Amit', 'Suresh', 'Karan', 'Vivek', 'Manish', 'Rakesh', 'Imran', 'Gaurav', 'Harsh', 'Nitin', 'Sachin', 'Yash', 'Abhishek', 'Varun', 'Prakash', 'Ashok', 'Tarun', 'Kunal', 'Devendra', 'Joseph', 'Gurpreet', 'Aarav', 'Vihaan']
  const femaleFirst = ['Aisha', 'Pooja', 'Ritu', 'Swati', 'Nisha', 'Kavya', 'Divya', 'Shreya', 'Anita', 'Rekha', 'Meenakshi', 'Sakshi', 'Tanvi', 'Isha', 'Priyanka', 'Lata', 'Zoya', 'Simran', 'Nandini', 'Ira', 'Mary', 'Harpreet', 'Diya', 'Anika']
  const lastNames = ['Das', 'Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Singh', 'Khan', 'Iyer', 'Joshi', 'Malhotra', 'Chopra', 'Bose', 'Mukherjee', 'Agarwal', 'Pandey', 'Saxena', 'Fernandes', 'Kaur', 'Menon', 'Rao', 'Jain', 'Thakur']
  const cities = ['Sector 14, Gurugram, Haryana', 'Lajpat Nagar, New Delhi', 'Indirapuram, Ghaziabad, UP', 'Sector 62, Noida, UP', 'Dwarka Sector 10, New Delhi', 'Vasant Kunj, New Delhi', 'Rohini Sector 7, New Delhi', 'Faridabad Sector 21, Haryana', 'Karol Bagh, New Delhi', 'Mayur Vihar Phase 1, New Delhi']
  const bloods = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']
  const bloodWeights = [0.22, 0.02, 0.32, 0.02, 0.29, 0.02, 0.09, 0.02]
  const pickBlood = () => { let r = rand(), acc = 0; for (let i = 0; i < bloods.length; i++) { acc += bloodWeights[i]; if (r < acc) return bloods[i] } return 'O+' }
  const allergyPool = [null, null, null, null, 'Penicillin', 'Sulfa drugs', 'Peanuts', 'Dust mites', 'Aspirin', 'Latex', 'Shellfish']
  const insurers = [null, null, 'Star Health', 'HDFC ERGO', 'ICICI Lombard', 'Niva Bupa', 'Care Health', 'CGHS', 'Ayushman Bharat']

  const patients: Patient[] = []
  const PATIENT_COUNT = 80
  for (let i = 0; i < PATIENT_COUNT; i++) {
    const isDemo = i === 0
    const gender: Patient['gender'] = isDemo ? 'male' : chance(0.5) ? 'male' : 'female'
    const first = isDemo ? 'Rohan' : gender === 'male' ? pick(maleFirst) : pick(femaleFirst)
    const last = isDemo ? 'Das' : pick(lastNames)
    const full_name = `${first} ${last}`
    const ecGender = chance(0.5)
    patients.push({
      id: sid(4, i + 1),
      profile_id: isDemo ? U.patient : null,
      mrn: `DCH-${100001 + i}`,
      full_name, gender,
      date_of_birth: d.date(-int(isDemo ? 32 * 365 : 2 * 365, isDemo ? 32 * 365 : 82 * 365)),
      blood_group: isDemo ? 'B+' : pickBlood(),
      phone: isDemo ? DEMO_USERS[5].phone : `+91 9${int(6000, 9999)} ${int(10000, 99999)}`,
      email: isDemo ? 'patient@dchospital.com' : chance(0.7) ? `${first}.${last}${int(1, 99)}@gmail.com`.toLowerCase() : null,
      address: pick(cities),
      emergency_contact_name: `${ecGender ? pick(maleFirst) : pick(femaleFirst)} ${last}`,
      emergency_contact_phone: `+91 9${int(6000, 9999)} ${int(10000, 99999)}`,
      allergies: isDemo ? 'Penicillin' : pick(allergyPool),
      insurance_provider: isDemo ? 'Star Health' : pick(insurers),
      status: 'outpatient',
      created_at: d.ts(-int(10, 240)),
    })
  }

  // ---------------------------------------------------------------- clinical knowledge
  const clinical: Record<string, { reasons: string[]; dx: string[]; meds: Medication[]; labs: string[] }> = {
    'Cardiology': { reasons: ['Chest pain on exertion', 'Palpitations', 'High blood pressure review', 'Shortness of breath'], dx: ['Stable angina', 'Essential hypertension', 'Paroxysmal SVT', 'Dyslipidemia'], meds: [
      { name: 'Atorvastatin 20mg', dosage: '1 tab', frequency: 'Once daily (night)', duration: '30 days' },
      { name: 'Amlodipine 5mg', dosage: '1 tab', frequency: 'Once daily', duration: '30 days' },
      { name: 'Aspirin 75mg', dosage: '1 tab', frequency: 'Once daily after lunch', duration: '30 days' },
      { name: 'Metoprolol 25mg', dosage: '1 tab', frequency: 'Twice daily', duration: '30 days' }], labs: ['ECG', 'Lipid Profile', '2D Echo', 'Troponin I'] },
    'Neurology': { reasons: ['Recurrent headaches', 'Dizziness', 'Numbness in hands', 'Seizure follow-up'], dx: ['Migraine without aura', 'Benign positional vertigo', 'Carpal tunnel syndrome', 'Epilepsy – controlled'], meds: [
      { name: 'Naproxen 500mg', dosage: '1 tab', frequency: 'SOS (max 2/day)', duration: '10 days' },
      { name: 'Propranolol 10mg', dosage: '1 tab', frequency: 'Twice daily', duration: '60 days' },
      { name: 'Betahistine 16mg', dosage: '1 tab', frequency: 'Thrice daily', duration: '14 days' },
      { name: 'Levetiracetam 500mg', dosage: '1 tab', frequency: 'Twice daily', duration: '90 days' }], labs: ['MRI Brain', 'EEG', 'Vitamin B12', 'Nerve Conduction Study'] },
    'Orthopedics': { reasons: ['Knee pain', 'Lower back pain', 'Ankle sprain', 'Shoulder stiffness'], dx: ['Osteoarthritis knee', 'Lumbar spondylosis', 'Grade II ankle sprain', 'Frozen shoulder'], meds: [
      { name: 'Aceclofenac + Paracetamol', dosage: '1 tab', frequency: 'Twice daily after food', duration: '7 days' },
      { name: 'Calcium + Vitamin D3', dosage: '1 tab', frequency: 'Once daily', duration: '60 days' },
      { name: 'Thiocolchicoside 4mg', dosage: '1 tab', frequency: 'Twice daily', duration: '5 days' },
      { name: 'Diclofenac gel', dosage: 'Apply locally', frequency: 'Thrice daily', duration: '14 days' }], labs: ['X-Ray Knee AP/Lat', 'X-Ray LS Spine', 'Vitamin D', 'Uric Acid'] },
    'Pediatrics': { reasons: ['Fever and cough', 'Vaccination', 'Growth check-up', 'Loose motions'], dx: ['Viral URTI', 'Routine immunization', 'Normal growth', 'Acute gastroenteritis'], meds: [
      { name: 'Paracetamol syrup 250mg/5ml', dosage: '5 ml', frequency: 'Every 6 hrs if fever', duration: '3 days' },
      { name: 'ORS sachet', dosage: '1 sachet in 1L water', frequency: 'After each loose stool', duration: '3 days' },
      { name: 'Zinc syrup 20mg', dosage: '5 ml', frequency: 'Once daily', duration: '14 days' },
      { name: 'Cetirizine syrup', dosage: '2.5 ml', frequency: 'Once daily (night)', duration: '5 days' }], labs: ['CBC', 'Stool Routine', 'CRP', 'Urine Routine'] },
    'General Medicine': { reasons: ['Fever for 3 days', 'Diabetes follow-up', 'General weakness', 'Acidity and bloating'], dx: ['Viral fever', 'Type 2 diabetes mellitus', 'Iron deficiency anemia', 'Gastritis'], meds: [
      { name: 'Metformin 500mg', dosage: '1 tab', frequency: 'Twice daily after meals', duration: '30 days' },
      { name: 'Pantoprazole 40mg', dosage: '1 tab', frequency: 'Once daily before breakfast', duration: '14 days' },
      { name: 'Ferrous ascorbate', dosage: '1 tab', frequency: 'Once daily', duration: '60 days' },
      { name: 'Paracetamol 650mg', dosage: '1 tab', frequency: 'Thrice daily if fever', duration: '5 days' }], labs: ['CBC', 'HbA1c', 'Fasting Blood Sugar', 'LFT', 'KFT', 'Dengue NS1'] },
    'Gynecology & Obstetrics': { reasons: ['Antenatal check-up', 'Irregular periods', 'Pelvic pain', 'Post-natal visit'], dx: ['Normal pregnancy – 24 weeks', 'PCOS', 'Dysmenorrhea', 'Post-partum – healthy'], meds: [
      { name: 'Folic acid 5mg', dosage: '1 tab', frequency: 'Once daily', duration: '90 days' },
      { name: 'Iron + Folic acid', dosage: '1 tab', frequency: 'Once daily', duration: '90 days' },
      { name: 'Mefenamic acid 500mg', dosage: '1 tab', frequency: 'SOS', duration: '5 days' },
      { name: 'Myo-inositol', dosage: '1 sachet', frequency: 'Twice daily', duration: '90 days' }], labs: ['USG Obstetric', 'Thyroid Profile', 'Hemoglobin', 'USG Pelvis'] },
    'Dermatology': { reasons: ['Skin rash', 'Acne', 'Hair fall', 'Itching'], dx: ['Contact dermatitis', 'Acne vulgaris', 'Telogen effluvium', 'Fungal infection (Tinea)'], meds: [
      { name: 'Clindamycin gel 1%', dosage: 'Apply thin layer', frequency: 'Night', duration: '30 days' },
      { name: 'Levocetirizine 5mg', dosage: '1 tab', frequency: 'Once daily', duration: '10 days' },
      { name: 'Luliconazole cream', dosage: 'Apply locally', frequency: 'Twice daily', duration: '21 days' },
      { name: 'Biotin 10mg', dosage: '1 tab', frequency: 'Once daily', duration: '60 days' }], labs: ['CBC', 'KOH Mount', 'Thyroid Profile', 'Serum Ferritin'] },
    'ENT': { reasons: ['Ear pain', 'Sore throat', 'Blocked nose', 'Hearing loss'], dx: ['Acute otitis media', 'Pharyngitis', 'Allergic rhinitis', 'Wax impaction'], meds: [
      { name: 'Amoxicillin + Clavulanate 625mg', dosage: '1 tab', frequency: 'Twice daily', duration: '5 days' },
      { name: 'Fluticasone nasal spray', dosage: '2 puffs', frequency: 'Once daily', duration: '30 days' },
      { name: 'Montelukast + Levocetirizine', dosage: '1 tab', frequency: 'Night', duration: '14 days' },
      { name: 'Wax softening drops', dosage: '3 drops', frequency: 'Thrice daily', duration: '5 days' }], labs: ['Audiometry', 'X-Ray PNS', 'Throat Swab Culture'] },
    'Radiology': { reasons: ['Imaging review', 'Ultrasound abdomen', 'CT follow-up'], dx: ['Fatty liver grade I', 'Renal calculus 4mm', 'Normal study'], meds: [
      { name: 'Ursodeoxycholic acid 300mg', dosage: '1 tab', frequency: 'Twice daily', duration: '30 days' }], labs: ['USG Abdomen', 'CT Abdomen', 'Chest X-Ray'] },
    'Emergency': { reasons: ['Road traffic injury', 'Acute abdominal pain', 'High fever with chills', 'Breathlessness'], dx: ['Soft tissue injury', 'Acute gastritis', 'Suspected malaria', 'Acute asthma exacerbation'], meds: [
      { name: 'Ondansetron 4mg', dosage: '1 tab', frequency: 'SOS', duration: '3 days' },
      { name: 'Salbutamol inhaler', dosage: '2 puffs', frequency: 'SOS', duration: '14 days' },
      { name: 'Tramadol 50mg', dosage: '1 tab', frequency: 'SOS (max 3/day)', duration: '3 days' }], labs: ['CBC', 'Malaria Antigen', 'Chest X-Ray', 'Serum Electrolytes'] },
    'Pathology': { reasons: ['Report review'], dx: ['Report discussed'], meds: [
      { name: 'Multivitamin', dosage: '1 tab', frequency: 'Once daily', duration: '30 days' }], labs: ['CBC', 'Blood Group', 'Peripheral Smear'] },
  }
  const labPrice: Record<string, number> = {
    'ECG': 300, 'Lipid Profile': 650, '2D Echo': 2200, 'Troponin I': 1200, 'MRI Brain': 7500, 'EEG': 2500, 'Vitamin B12': 900,
    'Nerve Conduction Study': 3000, 'X-Ray Knee AP/Lat': 600, 'X-Ray LS Spine': 700, 'Vitamin D': 1400, 'Uric Acid': 250, 'CBC': 350,
    'Stool Routine': 200, 'CRP': 500, 'Urine Routine': 200, 'HbA1c': 550, 'Fasting Blood Sugar': 120, 'LFT': 700, 'KFT': 700,
    'Dengue NS1': 900, 'USG Obstetric': 1500, 'Thyroid Profile': 600, 'Hemoglobin': 150, 'USG Pelvis': 1300, 'KOH Mount': 300,
    'Serum Ferritin': 800, 'Audiometry': 800, 'X-Ray PNS': 500, 'Throat Swab Culture': 700, 'USG Abdomen': 1400, 'CT Abdomen': 5500,
    'Chest X-Ray': 450, 'Malaria Antigen': 450, 'Serum Electrolytes': 600, 'Blood Group': 150, 'Peripheral Smear': 250,
  }
  const labCategory = (t: string) =>
    /X-Ray|MRI|CT|USG|Echo/.test(t) ? 'Radiology' : /ECG|EEG|Nerve|Audiometry/.test(t) ? 'Diagnostics' : /Culture|Swab|KOH|Malaria|Dengue/.test(t) ? 'Microbiology' : /CBC|Hemoglobin|Smear|Blood Group/.test(t) ? 'Hematology' : 'Biochemistry'
  const resultFor = (t: string) => {
    const normals: Record<string, string> = {
      'CBC': 'Hb 13.2 g/dL, TLC 7,400/µL, Platelets 2.4 L/µL — within normal limits',
      'HbA1c': `HbA1c ${(5.6 + rand() * 3).toFixed(1)}%`,
      'Lipid Profile': `Total cholesterol ${int(160, 260)} mg/dL, LDL ${int(90, 180)} mg/dL, HDL ${int(35, 60)} mg/dL`,
      'Fasting Blood Sugar': `${int(84, 180)} mg/dL`,
      'Vitamin D': `${int(9, 45)} ng/mL`,
      'Thyroid Profile': `TSH ${(0.8 + rand() * 6).toFixed(2)} µIU/mL, T3/T4 normal`,
      'ECG': 'Normal sinus rhythm, no acute ST-T changes',
      'Chest X-Ray': 'Lung fields clear, cardiac silhouette normal',
    }
    return normals[t] ?? 'No significant abnormality detected'
  }

  // ---------------------------------------------------------------- appointments + prescriptions + labs
  const appointments: Appointment[] = []
  const prescriptions: Prescription[] = []
  const lab_tests: LabTest[] = []
  const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']
  const activeDoctors = doctors.filter((x) => x.status === 'active' && x.specialization !== 'Pathologist')
  const usedSlots = new Set<string>()

  const addAppointment = (patient: Patient, doctor: Doctor, offset: number, forcedStatus?: Appointment['status']) => {
    let time = pick(times)
    let guard = 0
    while (usedSlots.has(`${doctor.id}|${offset}|${time}`) && guard++ < 20) time = pick(times)
    usedSlots.add(`${doctor.id}|${offset}|${time}`)
    const clin = clinical[doctorDept(doctor.id)]
    let status: Appointment['status']
    if (forcedStatus) status = forcedStatus
    else if (offset < 0) status = chance(0.82) ? 'completed' : chance(0.6) ? 'cancelled' : 'no_show'
    else if (offset === 0) status = pick(['scheduled', 'confirmed', 'checked_in', 'completed', 'confirmed'] as const)
    else status = chance(0.55) ? 'confirmed' : 'scheduled'
    const type: Appointment['type'] = doctorDept(doctor.id) === 'Emergency' ? 'emergency' : chance(0.25) ? 'follow_up' : chance(0.15) ? 'checkup' : 'consultation'
    const appt: Appointment = {
      id: sid(5, appointments.length + 1),
      patient_id: patient.id, doctor_id: doctor.id,
      appointment_date: d.date(offset), appointment_time: time, type, status,
      reason: pick(clin.reasons),
      notes: status === 'cancelled' ? 'Cancelled by patient over phone' : null,
      created_at: d.ts(offset - int(1, 10)),
    }
    appointments.push(appt)

    if (status === 'completed') {
      const idx = clin.reasons.indexOf(appt.reason!)
      const diagnosis = clin.dx[Math.min(idx, clin.dx.length - 1)] ?? pick(clin.dx)
      if (chance(0.8)) {
        const meds = [...clin.meds].sort(() => rand() - 0.5).slice(0, int(1, Math.min(3, clin.meds.length)))
        prescriptions.push({
          id: sid(6, prescriptions.length + 1),
          patient_id: patient.id, doctor_id: doctor.id, diagnosis,
          symptoms: appt.reason, medications: meds,
          advice: pick(['Plenty of fluids and adequate rest', 'Low-salt, low-fat diet; 30 min walk daily', 'Avoid oily and spicy food', 'Review with reports', 'Keep the affected area clean and dry', 'Complete the full course of medicines']),
          follow_up_date: chance(0.6) ? d.date(offset + int(7, 30)) : null,
          prescribed_on: d.date(offset),
          created_at: d.ts(offset, time),
        })
      }
      if (chance(0.45)) {
        const test = pick(clin.labs)
        const done = offset < -1 || chance(0.4)
        lab_tests.push({
          id: sid(7, lab_tests.length + 1),
          patient_id: patient.id, doctor_id: doctor.id,
          test_name: test, category: labCategory(test),
          priority: chance(0.8) ? 'routine' : chance(0.7) ? 'urgent' : 'stat',
          status: done ? 'completed' : pick(['requested', 'sample_collected', 'in_progress'] as const),
          result: done ? resultFor(test) : null,
          price: labPrice[test] ?? 500,
          requested_on: d.date(offset),
          completed_on: done ? d.date(Math.min(0, offset + int(0, 2))) : null,
          created_at: d.ts(offset, time),
        })
      }
    }
    return appt
  }

  // demo patient history with demo doctor + others
  const demoPatient = patients[0]
  const demoDoctor = doctors[0]
  addAppointment(demoPatient, demoDoctor, -38, 'completed')
  addAppointment(demoPatient, doctors[4], -21, 'completed')
  addAppointment(demoPatient, demoDoctor, -9, 'completed')
  addAppointment(demoPatient, doctors[6], -3, 'cancelled')
  addAppointment(demoPatient, demoDoctor, 4, 'confirmed')
  addAppointment(demoPatient, doctors[11], 11, 'scheduled')

  // demo doctor – busy today
  for (let k = 0; k < 6; k++) addAppointment(patients[1 + k * 3], demoDoctor, 0)
  for (let k = 0; k < 14; k++) addAppointment(pick(patients.slice(1)), demoDoctor, int(-40, 12))

  // everyone else
  for (let k = 0; k < 330; k++) {
    const offset = chance(0.76) ? (chance(0.55) ? int(-14, -1) : int(-45, -15)) : chance(0.12) ? 0 : int(1, 14)
    addAppointment(pick(patients.slice(1)), pick(activeDoctors), offset)
  }
  appointments.sort((a, b) => offsetOf(a.appointment_date) - offsetOf(b.appointment_date) || a.appointment_time.localeCompare(b.appointment_time))

  // standalone lab tests (walk-in)
  for (let k = 0; k < 14; k++) {
    const test = pick(Object.keys(labPrice))
    const offset = int(-20, 0)
    const done = offset < -2 && chance(0.8)
    lab_tests.push({
      id: sid(7, lab_tests.length + 1), patient_id: pick(patients).id, doctor_id: pick(activeDoctors).id,
      test_name: test, category: labCategory(test), priority: chance(0.8) ? 'routine' : 'urgent',
      status: done ? 'completed' : pick(['requested', 'sample_collected', 'in_progress'] as const),
      result: done ? resultFor(test) : null, price: labPrice[test], requested_on: d.date(offset),
      completed_on: done ? d.date(offset + 1) : null, created_at: d.ts(offset),
    })
  }

  // ---------------------------------------------------------------- wards & beds
  const wardDefs: [string, Ward['type'], string, number, number, string][] = [
    ['General Ward – Male', 'general', 'Ground Floor', 1500, 10, 'GM'],
    ['General Ward – Female', 'general', 'Ground Floor', 1500, 10, 'GF'],
    ['Intensive Care Unit', 'icu', '1st Floor', 9000, 6, 'ICU'],
    ['Private Rooms', 'private', '3rd Floor', 5500, 6, 'PR'],
    ['Semi-Private Rooms', 'semi_private', '3rd Floor', 3200, 6, 'SP'],
    ['Maternity Ward', 'maternity', '2nd Floor', 3000, 6, 'MT'],
    ['Pediatric Ward', 'pediatric', '2nd Floor', 2200, 6, 'PD'],
    ['Emergency Observation', 'emergency', 'Ground Floor', 2500, 4, 'ER'],
  ]
  const wards: Ward[] = []
  const beds: Bed[] = []
  wardDefs.forEach(([name, type, floor, daily_rate, count, code], wi) => {
    const ward: Ward = { id: sid(8, wi + 1), name, type, floor, daily_rate, created_at: d.ts(-400) }
    wards.push(ward)
    for (let b = 1; b <= count; b++) {
      beds.push({ id: sid(9, beds.length + 1), ward_id: ward.id, bed_number: `${code}-${pad(b, 2)}`, status: 'available', created_at: d.ts(-400) })
    }
  })
  // a few beds under maintenance/reserved
  beds[9].status = 'maintenance'
  beds[27].status = 'reserved'
  beds[40].status = 'maintenance'

  // ---------------------------------------------------------------- admissions
  const admissions: Admission[] = []
  const admissionReasons = ['Acute MI – observation', 'Dengue with thrombocytopenia', 'Post-op knee replacement', 'Pneumonia', 'Uncontrolled diabetes', 'Normal delivery', 'Road traffic accident – fracture femur', 'Severe dehydration', 'Appendicectomy', 'COPD exacerbation', 'Typhoid fever', 'Head injury – observation']
  const freeBeds = () => beds.filter((b) => b.status === 'available')
  const admittedPatients = new Set<string>()
  // current admissions
  for (let k = 0; k < 16; k++) {
    let p = pick(patients.slice(1))
    let guard = 0
    while (admittedPatients.has(p.id) && guard++ < 30) p = pick(patients.slice(1))
    admittedPatients.add(p.id)
    const bed = pick(freeBeds())
    bed.status = 'occupied'
    const offset = -int(0, 9)
    admissions.push({
      id: sid(10, admissions.length + 1), patient_id: p.id, doctor_id: pick(activeDoctors).id, bed_id: bed.id,
      admission_date: d.date(offset), discharge_date: null, reason: pick(admissionReasons), status: 'admitted',
      notes: 'Vitals stable. Continue current management.', created_at: d.ts(offset, '11:00'),
    })
    p.status = 'inpatient'
  }
  // historical discharges
  const discharged: Admission[] = []
  for (let k = 0; k < 14; k++) {
    const p = pick(patients.slice(1).filter((x) => !admittedPatients.has(x.id)))
    const bed = pick(beds.filter((b) => b.status !== 'maintenance'))
    const start = -int(15, 150)
    const stay = int(2, 8)
    const a: Admission = {
      id: sid(10, admissions.length + 1), patient_id: p.id, doctor_id: pick(activeDoctors).id, bed_id: bed.id,
      admission_date: d.date(start), discharge_date: d.date(start + stay), reason: pick(admissionReasons), status: 'discharged',
      notes: 'Discharged in stable condition with advice.', created_at: d.ts(start, '10:00'),
    }
    admissions.push(a)
    discharged.push(a)
    if (p.status === 'outpatient') p.status = 'discharged'
  }

  // ---------------------------------------------------------------- invoices & payments
  const invoices: Invoice[] = []
  const payments: Payment[] = []
  const methods: Payment['method'][] = ['cash', 'card', 'upi', 'upi', 'insurance', 'bank_transfer']
  const makeInvoice = (patientId: string, offset: number, items: LineItem[], opts: { forceStatus?: Invoice['status'] } = {}) => {
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
    const discount = chance(0.2) ? round(subtotal * 0.05) : 0
    const tax = round((subtotal - discount) * 0.05, 1)
    const total = subtotal - discount + tax
    const dueOffset = offset + 15
    let status: Invoice['status'] = opts.forceStatus ?? (offset < -20 ? (chance(0.88) ? 'paid' : chance(0.5) ? 'partial' : 'overdue') : chance(0.6) ? 'paid' : chance(0.4) ? 'partial' : 'unpaid')
    if (status === 'unpaid' && dueOffset < 0) status = 'overdue'
    const amount_paid = status === 'paid' ? total : status === 'partial' ? round(total * (0.3 + rand() * 0.4)) : 0
    const inv: Invoice = {
      id: sid(11, invoices.length + 1), invoice_number: `INV-${pad(10001 + invoices.length, 5)}`, patient_id: patientId,
      issue_date: d.date(offset), due_date: d.date(dueOffset), items, subtotal, tax, discount, total, amount_paid, status,
      notes: null, created_at: d.ts(offset, '18:00'),
    }
    invoices.push(inv)
    if (amount_paid > 0) {
      const method = pick(methods)
      payments.push({
        id: sid(12, payments.length + 1), invoice_id: inv.id, patient_id: patientId, amount: amount_paid, method,
        paid_on: d.date(Math.min(0, offset + int(0, 5))),
        reference: method === 'cash' ? null : `${method.toUpperCase().slice(0, 3)}${int(100000, 999999)}`,
        created_at: d.ts(Math.min(0, offset + int(0, 5)), '18:30'),
      })
    }
    return inv
  }

  // historic + walk-in revenue across 6 months so financial charts look alive
  for (let k = 0; k < 560; k++) {
    const offset = -int(1, 178)
    if (chance(0.22)) {
      // past IPD / day-care package
      const ward = pick(wardDefs)
      const days = int(1, 6)
      const items: LineItem[] = [
        { description: `${ward[0]} – bed charges`, quantity: days, unit_price: ward[3] },
        { description: 'Nursing & monitoring', quantity: days, unit_price: 800 },
        { description: 'Pharmacy & consumables', quantity: 1, unit_price: round(int(3000, 22000)) },
      ]
      if (chance(0.55)) items.push({ description: pick(['Procedure / OT charges', 'Procedure – Angiography', 'Procedure – Arthroscopy', 'Procedure – LSCS', 'Procedure – Endoscopy']), quantity: 1, unit_price: round(int(18000, 95000), 100) })
      makeInvoice(pick(patients.slice(1)).id, offset, items)
      continue
    }
    const doc = pick(activeDoctors)
    const items: LineItem[] = [{ description: `Consultation – ${doc.full_name}`, quantity: 1, unit_price: doc.consultation_fee }]
    if (chance(0.6)) { const t = pick(Object.keys(labPrice)); items.push({ description: `Lab – ${t}`, quantity: 1, unit_price: labPrice[t] }) }
    if (chance(0.4)) items.push({ description: 'Pharmacy – medicines', quantity: 1, unit_price: round(int(300, 3500)) })
    makeInvoice(pick(patients.slice(1)).id, offset, items)
  }
  // completed appointments
  const completedAppts: { a: Appointment; offset: number }[] = []
  appointments.forEach((a) => { if (a.status === 'completed') completedAppts.push({ a, offset: offsetOf(a.appointment_date) }) })
  completedAppts.forEach(({ a, offset }) => {
    const doc = doctors.find((x) => x.id === a.doctor_id)!
    const items: LineItem[] = [{ description: `Consultation – ${doc.full_name}`, quantity: 1, unit_price: doc.consultation_fee }]
    lab_tests.filter((l) => l.patient_id === a.patient_id && l.requested_on === a.appointment_date).forEach((l) =>
      items.push({ description: `Lab – ${l.test_name}`, quantity: 1, unit_price: l.price }))
    makeInvoice(a.patient_id, offset, items, a.patient_id === demoPatient.id && offset > -10 ? { forceStatus: 'unpaid' } : {})
  })
  // admissions
  admissions.forEach((a) => {
    const ward = wards.find((w) => w.id === beds.find((b) => b.id === a.bed_id)!.ward_id)!
    const start = offsetOf(a.admission_date)
    const end = a.discharge_date ? offsetOf(a.discharge_date) : 0
    const days = Math.max(1, end - start)
    const items: LineItem[] = [
      { description: `${ward.name} – bed charges`, quantity: days, unit_price: ward.daily_rate },
      { description: 'Nursing & monitoring', quantity: days, unit_price: 800 },
      { description: 'Pharmacy & consumables', quantity: 1, unit_price: round(int(2000, 18000)) },
    ]
    if (chance(0.3)) items.push({ description: 'Procedure / OT charges', quantity: 1, unit_price: round(int(15000, 65000), 100) })
    makeInvoice(a.patient_id, a.discharge_date ? end : start, items, a.status === 'admitted' ? { forceStatus: chance(0.5) ? 'partial' : 'unpaid' } : {})
  })

  // ---------------------------------------------------------------- expenses
  const expenses: Expense[] = []
  for (let m = 5; m >= 0; m--) {
    const base = -m * 30
    const add = (category: Expense['category'], description: string, amount: number, vendor: string | null, dayInMonth: number) => {
      const offset = base - 25 + dayInMonth
      if (offset > 0) return
      expenses.push({
        id: sid(13, expenses.length + 1), category, description, amount, expense_date: d.date(offset), vendor,
        status: m === 0 && chance(0.4) ? 'pending' : 'paid', created_at: d.ts(offset),
      })
    }
    add('salaries', 'Monthly staff & doctor payroll', 660_000 + round(int(-20000, 30000), 1000), 'Payroll', 25)
    add('rent', 'Building lease – Block C', 150000, 'DLF Estates', 1)
    add('utilities', 'Electricity bill', round(int(95000, 135000), 100), 'BSES Rajdhani', 8)
    add('utilities', 'Water & medical gas', round(int(18000, 30000), 100), 'Linde India', 10)
    add('supplies', 'Pharmacy stock replenishment', round(int(150000, 240000), 100), 'Apollo Distributors', 5)
    add('supplies', 'Surgical consumables', round(int(45000, 80000), 100), 'Medline Supplies', 14)
    add('maintenance', 'Biomedical equipment AMC', round(int(25000, 50000), 100), 'Philips Healthcare', 18)
    if (chance(0.4)) add('equipment', pick(['Patient monitor (x2)', 'Infusion pumps (x5)', 'Portable X-ray unit', 'ICU ventilator service kit']), round(int(80000, 280000), 1000), 'GE Healthcare', 20)
    add('other', 'Housekeeping & laundry', round(int(35000, 55000), 100), 'CleanCare Services', 12)
  }

  // ---------------------------------------------------------------- inventory
  const invDefs: [string, InventoryItem['category'], string, number, string, number, number, string, number | null][] = [
    ['Paracetamol 650mg', 'medicine', 'MED-001', 4200, 'tablets', 1000, 1.8, 'Micro Labs', 420],
    ['Amoxicillin + Clavulanate 625mg', 'medicine', 'MED-002', 640, 'tablets', 500, 18, 'GSK Pharma', 300],
    ['Pantoprazole 40mg', 'medicine', 'MED-003', 1800, 'tablets', 600, 4.5, 'Alkem Labs', 510],
    ['Metformin 500mg', 'medicine', 'MED-004', 2600, 'tablets', 800, 2.2, 'USV Ltd', 600],
    ['Atorvastatin 20mg', 'medicine', 'MED-005', 380, 'tablets', 500, 7.5, 'Sun Pharma', 380],
    ['Amlodipine 5mg', 'medicine', 'MED-006', 1450, 'tablets', 500, 2.8, 'Cipla', 460],
    ['Insulin Glargine 100IU', 'medicine', 'MED-007', 42, 'pens', 30, 780, 'Sanofi', 95],
    ['Ceftriaxone 1g injection', 'medicine', 'MED-008', 210, 'vials', 150, 52, 'Lupin', 240],
    ['Ondansetron 4mg injection', 'medicine', 'MED-009', 95, 'ampoules', 120, 14, 'Zydus', 20],
    ['Normal Saline 500ml', 'consumable', 'CON-001', 860, 'bottles', 300, 32, 'Baxter', 700],
    ['Ringer Lactate 500ml', 'consumable', 'CON-002', 140, 'bottles', 200, 38, 'Baxter', 650],
    ['Disposable Syringe 5ml', 'consumable', 'CON-003', 5200, 'pcs', 1500, 4, 'BD India', 900],
    ['IV Cannula 20G', 'consumable', 'CON-004', 480, 'pcs', 400, 28, 'BD India', 800],
    ['Nitrile Gloves (M)', 'consumable', 'CON-005', 90, 'boxes', 100, 450, 'Kimberly-Clark', null],
    ['N95 Masks', 'consumable', 'CON-006', 1200, 'pcs', 500, 35, '3M India', 1000],
    ['Surgical Gauze Roll', 'surgical', 'SUR-001', 320, 'rolls', 150, 65, 'Medline Supplies', null],
    ['Suture Vicryl 2-0', 'surgical', 'SUR-002', 48, 'packs', 60, 320, 'Ethicon', 540],
    ['Surgical Blade No. 22', 'surgical', 'SUR-003', 900, 'pcs', 300, 6, 'Swann-Morton', 1200],
    ['Foley Catheter 16Fr', 'surgical', 'SUR-004', 150, 'pcs', 80, 95, 'Romsons', 700],
    ['Pulse Oximeter', 'equipment', 'EQP-001', 24, 'units', 10, 1800, 'Dr Trust', null],
    ['Digital BP Monitor', 'equipment', 'EQP-002', 18, 'units', 8, 2600, 'Omron', null],
    ['Wheelchair (foldable)', 'equipment', 'EQP-003', 12, 'units', 6, 7500, 'Karma Healthcare', null],
    ['Nebulizer Machine', 'equipment', 'EQP-004', 4, 'units', 6, 3200, 'Philips', null],
    ['Glucometer Strips', 'consumable', 'CON-007', 35, 'boxes', 40, 850, 'Accu-Chek', 150],
    ['Salbutamol Inhaler', 'medicine', 'MED-010', 160, 'inhalers', 60, 140, 'Cipla', 330],
    ['Cetirizine 10mg', 'medicine', 'MED-011', 2100, 'tablets', 500, 1.2, 'Dr. Reddy\'s', 25],
  ]
  const inventory: InventoryItem[] = invDefs.map(([name, category, sku, quantity, unit, reorder_level, unit_price, supplier, expiry], i) => ({
    id: sid(14, i + 1), name, category, sku, quantity, unit, reorder_level, unit_price, supplier,
    expiry_date: expiry === null ? null : d.date(expiry), created_at: d.ts(-300 + i),
  }))

  // ---------------------------------------------------------------- notices
  const notices: Notice[] = [
    { id: sid(15, 1), title: 'Free cardiac screening camp this Sunday', body: 'DC Hospital is organising a free ECG and BP screening camp from 9 AM to 2 PM at the main lobby. Please inform your patients.', audience: 'all', priority: 'important', published_on: d.date(-1), created_at: d.ts(-1, '09:00') },
    { id: sid(15, 2), title: 'NABH audit preparation', body: 'All departments must update SOP documentation and infection control logs before the audit next week.', audience: 'staff', priority: 'urgent', published_on: d.date(-2), created_at: d.ts(-2, '10:00') },
    { id: sid(15, 3), title: 'New MRI 3T machine operational', body: 'Radiology has commissioned a new 3 Tesla MRI. Slots can now be booked through the front desk.', audience: 'all', priority: 'normal', published_on: d.date(-6), created_at: d.ts(-6, '12:00') },
    { id: sid(15, 4), title: 'CME: Updates in diabetes management', body: 'Continuing medical education session by Dr. Pooja Bansal on Friday, 4 PM, Conference Hall B.', audience: 'doctors', priority: 'normal', published_on: d.date(-4), created_at: d.ts(-4, '15:00') },
    { id: sid(15, 5), title: 'Online reports now available', body: 'Patients can now view their lab results, prescriptions and invoices directly from the patient portal.', audience: 'patients', priority: 'normal', published_on: d.date(-8), created_at: d.ts(-8, '11:00') },
    { id: sid(15, 6), title: 'Night shift roster updated', body: 'The revised night shift roster for nursing staff is available with the Head Nurse.', audience: 'staff', priority: 'normal', published_on: d.date(-10), created_at: d.ts(-10, '17:00') },
  ]

  // ---------------------------------------------------------------- website enquiries (Contact form)
  const enquiryDefs: [string, string, string | null, string, string | null, string, SiteEnquiry['status'], number, string | null][] = [
    ['Sunita Agarwal', '9810012345', 'sunita.a@gmail.com', 'Book an appointment', 'Cardiology', 'I would like a cardiology consultation for my father (68). He has had chest discomfort on walking for a week.', 'new', 0, null],
    ['Rohit Malhotra', '9899023456', null, 'Billing & insurance', null, 'Is Star Health cashless accepted for a planned knee replacement? Please share the documents needed.', 'new', 0, null],
    ['Meenakshi Iyer', '9711034567', 'meenakshi.iyer@outlook.com', 'Medical records', null, 'I need a copy of my discharge summary from March for an insurance claim.', 'in_progress', -1, 'Records desk informed; ready for pickup tomorrow.'],
    ['Aman Gupta', '9953045678', 'aman.g@yahoo.in', 'Feedback or complaint', null, 'Wanted to thank the night nursing team in Ward B — they were incredibly kind to my mother.', 'resolved', -3, 'Shared with nursing superintendent. Thanked patient by phone.'],
    ['Farah Khan', '9818056789', null, 'Book an appointment', 'Pediatrics', 'Need a vaccination appointment for my 9-month-old this Saturday morning if possible.', 'resolved', -4, 'Booked with Dr. Ananya Iyer, Sat 10:30.'],
    ['Karan Sethi', '9650067890', 'karan.sethi@gmail.com', 'Careers', null, 'I am a BSc Nursing graduate with 3 years of ICU experience. Are there any openings?', 'in_progress', -6, 'CV forwarded to HR.'],
    ['Win Big Offers', '9000000000', 'promo@spam.example', 'Something else', null, 'Get 10,000 followers instantly!!! Visit our site now.', 'spam', -7, null],
  ]
  const site_enquiries: SiteEnquiry[] = enquiryDefs.map(([name, phone, email, topic, speciality, message, status, day, notes], i) => ({
    id: sid(16, i + 1), ref: `DCH-${String(482101 + i * 37)}`, name, phone, email, topic, speciality, message, status, notes,
    created_at: d.ts(day, `${String(9 + i).padStart(2, '0')}:${i % 2 ? '40' : '15'}`),
  }))

  // ---------------------------------------------------------------- doctor leave & blocked time
  const docId = (name: string) => doctors.find((x) => x.full_name === name)!.id
  const leaveDefs: [string, DoctorLeave['kind'], number, number, string | null, string | null, DoctorLeave['status'], string][] = [
    ['Dr. Sneha Patil', 'leave', -3, 12, null, null, 'approved', 'Medical leave'],
    ['Dr. Arjun Mehta', 'conference', 9, 10, null, null, 'approved', 'Cardiological Society of India — annual conference'],
    ['Dr. Nikhil Joshi', 'surgery', 1, 1, '10:00', '13:00', 'approved', 'CABG — OT 2'],
    ['Dr. Vikram Singh', 'meeting', 2, 2, '16:00', '17:00', 'approved', 'Quality & NABH committee'],
    ['Dr. Aditya Kulkarni', 'surgery', 3, 3, '09:00', '12:00', 'approved', 'Spinal fusion — OT 1'],
    ['Dr. Kavita Rao', 'leave', 20, 22, null, null, 'pending', 'Family function'],
    ['Dr. Pooja Bansal', 'training', 14, 14, '14:00', '17:00', 'pending', 'Insulin pump certification'],
    ['Dr. Meera Nair', 'leave', 5, 5, null, null, 'rejected', 'Personal work — clashes with scheduled deliveries'],
  ]
  const doctor_leaves: DoctorLeave[] = leaveDefs.map(([name, kind, from, to, st, et, status, reason], i) => ({
    id: sid(17, i + 1), doctor_id: docId(name), kind, start_date: d.date(from), end_date: d.date(to), start_time: st, end_time: et, status, reason,
    created_at: d.ts(Math.min(from, 0) - 2 - i, '11:00'),
  }))

  // ---------------------------------------------------------------- hospital holidays (OPD closed; emergency stays open)
  const year = new Date().getFullYear()
  const holidayDefs: [string, string][] = [
    [`${year}-01-26`, 'Republic Day'], [`${year}-08-15`, 'Independence Day'], [`${year}-10-02`, 'Gandhi Jayanti'], [`${year}-12-25`, 'Christmas'],
    [`${year + 1}-01-26`, 'Republic Day'], [`${year + 1}-08-15`, 'Independence Day'], [`${year + 1}-10-02`, 'Gandhi Jayanti'], [`${year + 1}-12-25`, 'Christmas'],
    ...(year === 2026 ? [['2026-11-08', 'Diwali'], ['2026-10-20', 'Dussehra']] as [string, string][] : []),
  ]
  const holidays: Holiday[] = holidayDefs.sort((x, y) => x[0].localeCompare(y[0])).map(([holiday_date, name], i) => ({
    id: sid(18, i + 1), holiday_date, name, note: 'OPD closed · Emergency & pharmacy open 24×7', created_at: d.ts(-120, '10:00'),
  }))

  // ---------------------------------------------------------------- a few online bookings, so the source filter has data
  appointments.filter((a) => offsetOf(a.appointment_date) >= 0 && a.status !== 'cancelled').slice(0, 9).forEach((a, i) => {
    if (i % 2) return
    a.source = 'website'
    a.booking_ref = `DCB-${(740213 + i * 7919).toString(36).toUpperCase()}`
  })

  // ---------------------------------------------------------------- audit trail (recent activity so the log isn't empty)
  const AU = Object.fromEntries(DEMO_USERS.map((u) => [u.role, u])) as Record<Role, (typeof DEMO_USERS)[number]>
  const audit_log: AuditEntry[] = []
  const log = (table: string, record: { id: string } | undefined, action: AuditEntry['action'], who: Role, summary: string, changes: AuditEntry['changes'], day: number, time: string) => {
    if (!record) return
    audit_log.push({ id: sid(19, audit_log.length + 1), table_name: table, record_id: record.id, action, actor_id: AU[who].id, actor_name: AU[who].full_name, actor_role: who, summary, changes, created_at: d.ts(day, time) })
  }
  const pt = patients.slice(-4)
  pt.forEach((p, i) => log('patients', p, 'insert', 'receptionist', `${p.full_name} (${p.mrn})`, { full_name: { to: p.full_name }, phone: { to: p.phone }, gender: { to: p.gender } }, -i, `09:${10 + i * 7}`))
  const p0 = patients[3]
  log('patients', p0, 'update', 'receptionist', `${p0.full_name} (${p0.mrn})`, { phone: { from: '+91 98111 00000', to: p0.phone }, address: { from: null, to: p0.address } }, 0, '10:05')
  const todayAppts = appointments.filter((a) => offsetOf(a.appointment_date) === 0)
  todayAppts.slice(0, 3).forEach((a, i) => log('appointments', a, 'update', i === 2 ? 'doctor' : 'receptionist', `${a.appointment_time} · ${patients.find((p) => p.id === a.patient_id)?.full_name ?? ''}`, { status: { from: 'scheduled', to: a.status } }, 0, `0${8 + i}:4${i}`))
  const inv = invoices.slice(0, 4)
  if (inv[0]) log('invoices', inv[0], 'update', 'accountant', inv[0].invoice_number, { discount: { from: 0, to: inv[0].discount || 200 }, total: { from: inv[0].total + (inv[0].discount || 200), to: inv[0].total } }, -1, '12:20')
  if (inv[1]) log('invoices', inv[1], 'insert', 'receptionist', inv[1].invoice_number, { total: { to: inv[1].total }, status: { to: 'unpaid' } }, -1, '11:02')
  if (inv[2]) log('invoices', inv[2], 'update', 'owner', inv[2].invoice_number, { notes: { from: null, to: 'Senior citizen concession approved by management' } }, -2, '17:45')
  payments.slice(0, 3).forEach((p, i) => log('payments', p, 'insert', 'accountant', `₹${p.amount} · ${p.method.toUpperCase()}`, { amount: { to: p.amount }, method: { to: p.method }, reference: { to: p.reference ?? null } }, -i, `1${3 + i}:1${i}`))
  prescriptions.slice(0, 3).forEach((r, i) => log('prescriptions', r, i === 1 ? 'update' : 'insert', 'doctor', r.diagnosis,
    i === 1 ? { advice: { from: 'Review after 2 weeks', to: 'Review after 1 week with fasting sugar report' } } : { diagnosis: { to: r.diagnosis }, medications: { to: `${r.medications.length} medicines` } }, -i - 1, `1${1 + i}:3${i}`))
  log('doctor_leaves', doctor_leaves[1], 'update', 'receptionist', 'Dr. Arjun Mehta — conference', { status: { from: 'pending', to: 'approved' } }, -2, '15:05')
  audit_log.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))

  return {
    profiles, departments, doctors, staff, patients, appointments, prescriptions, lab_tests, wards, beds,
    admissions, invoices, payments, expenses, inventory, notices, site_enquiries, doctor_leaves, holidays, audit_log,
  }

}

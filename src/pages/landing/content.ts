// Copy & data for the public landing page. Edit freely — no logic lives here.

export const NAV_LINKS = [
  { id: 'features', label: 'Services' },
  { id: 'doctors', label: 'Doctors' },
  { id: 'why-us', label: 'Why DC' },
  { id: 'packages', label: 'Packages' },
  { id: 'faq', label: 'FAQ' },
] as const

export const SPECIALITIES = [
  'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics', 'General Medicine', 'Gynecology & Obstetrics',
  'Dermatology', 'ENT', 'Radiology', 'Emergency', 'Pathology', 'Diabetology',
]

export const STATS = [
  { value: 120000, suffix: '+', label: 'Patients cared for', format: 'lakh' as const },
  { value: 35, suffix: '+', label: 'Expert specialists' },
  { value: 12, suffix: '', label: 'Super-specialities' },
  { value: 4.9, suffix: '★', label: 'Average patient rating', decimals: 1 },
]

export const INSURERS = [
  'Star Health', 'HDFC ERGO', 'ICICI Lombard', 'Niva Bupa', 'Care Health', 'Ayushman Bharat', 'CGHS', 'Tata AIG', 'Bajaj Allianz', 'Aditya Birla Health',
]

export type LandingDoctor = {
  name: string; role: string; dept: string; img: string; exp: number; rating: number; reviews: number
  fee: number; days: string; langs: string; next: string
}

export const DOCTORS: LandingDoctor[] = [
  { name: 'Dr. Arjun Mehta', role: 'Interventional Cardiologist', dept: 'Cardiology', img: '/landing/doc-arjun.webp', exp: 14, rating: 4.9, reviews: 1284, fee: 1200, days: 'Mon – Fri', langs: 'English, Hindi', next: 'Today, 4:30 PM' },
  { name: 'Dr. Kavita Rao', role: 'Neurologist', dept: 'Neurology', img: '/landing/doc-kavita.webp', exp: 11, rating: 4.9, reviews: 962, fee: 1100, days: 'Mon, Wed, Fri, Sat', langs: 'English, Hindi, Kannada', next: 'Today, 11:30 AM' },
  { name: 'Dr. Ananya Iyer', role: 'Pediatrician', dept: 'Pediatrics', img: '/landing/doc-ananya.webp', exp: 8, rating: 5.0, reviews: 1531, fee: 700, days: 'Mon – Sat', langs: 'English, Hindi, Tamil', next: 'Tomorrow, 10:00 AM' },
  { name: 'Dr. Sameer Khan', role: 'Orthopedic Surgeon', dept: 'Orthopedics', img: '/landing/doc-sameer.webp', exp: 9, rating: 4.8, reviews: 874, fee: 900, days: 'Tue, Thu, Sat', langs: 'English, Hindi, Urdu', next: 'Today, 6:00 PM' },
]

export const TESTIMONIALS = [
  { name: 'Sunita Agarwal', place: 'Patna', text: 'Booked a cardiology slot on my phone in under a minute. No queue at the counter, the doctor already had my old reports. Felt genuinely looked after.', tag: 'Cardiology' },
  { name: 'Rakesh Yadav', place: 'Dwarka, Delhi', text: 'My father was admitted at 2 AM. The emergency team was calm and quick, and the cashless approval came through before morning.', tag: 'Emergency' },
  { name: 'Priyanka Sinha', place: 'Gurugram', text: 'Dr. Ananya is wonderful with kids. Prescriptions and vaccination reminders arrive on my phone — I never lose a paper again.', tag: 'Pediatrics' },
  { name: 'Mohammed Irfan', place: 'Noida', text: 'Knee replacement recovery went smoother than I imagined. Physiotherapy schedule, bills and reports — all in one app.', tag: 'Orthopedics' },
  { name: 'Anjali Deshmukh', place: 'Janakpuri', text: 'Transparent bill with every line item. No surprises at discharge. That alone made me trust DC Hospital.', tag: 'Billing' },
  { name: 'Vivek Chauhan', place: 'Faridabad', text: 'The executive health check was done in one morning, and my report with doctor notes was online the same evening.', tag: 'Health check' },
  { name: 'Farzana Begum', place: 'Old Delhi', text: 'The staff explained everything patiently in Hindi. The rooms are spotless and quiet — more like a hotel than a hospital.', tag: 'In-patient care' },
  { name: 'Karthik Subramanian', place: 'Vasant Kunj', text: 'Rescheduled my neuro consult twice from the app with zero hassle. Lab reports showed up before I even reached home.', tag: 'Neurology' },
]

export type Package = {
  name: string; blurb: string; tests: number; price: number; couple: number; popular?: boolean; features: string[]
}

export const PACKAGES: Package[] = [
  {
    name: 'Essential', blurb: 'A smart yearly baseline for adults under 35.', tests: 45, price: 1499, couple: 2699,
    features: ['Complete blood count (CBC)', 'Fasting blood sugar', 'Lipid profile', 'Liver & kidney function', 'Thyroid (TSH)', 'Urine routine', 'Physician consultation'],
  },
  {
    name: 'Comprehensive', blurb: 'Our most-loved check-up for complete peace of mind.', tests: 78, price: 3999, couple: 7199, popular: true,
    features: ['Everything in Essential', 'HbA1c & insulin', 'Vitamin D & B12', 'ECG + chest X-ray', 'Ultrasound abdomen', 'Cardiologist + physician consult', 'Diet & lifestyle counselling'],
  },
  {
    name: 'Executive', blurb: 'Deep screening for busy professionals 40+.', tests: 96, price: 7999, couple: 14399,
    features: ['Everything in Comprehensive', '2D Echo + TMT', 'Pulmonary function test', 'Cancer markers (age-appropriate)', 'All specialist consultations', 'Dedicated care manager', 'Reports within 24 hours'],
  },
]

export const FAQS = [
  { q: 'How do I book an appointment online?', a: 'Create a free patient account, choose a speciality or doctor, pick a slot that suits you and confirm. You will get an instant confirmation — the whole process takes about 30 seconds. You can also call our helpdesk 24×7.' },
  { q: 'Do you offer cashless treatment with insurance?', a: 'Yes. We are empanelled with 30+ insurers and TPAs including Ayushman Bharat and CGHS. Our insurance desk handles pre-authorisation for planned and emergency admissions so you can focus on recovery.' },
  { q: 'Can I see my prescriptions and lab reports online?', a: 'Absolutely. Every prescription, lab report and bill is added to your secure patient portal as soon as it is ready. You can view, download or share them with any doctor.' },
  { q: 'Is the emergency department open 24×7?', a: 'Yes — our emergency and trauma unit is staffed round the clock by emergency physicians, with ICU, cath-lab and operation theatres on standby. Call +91 11 4000 2100 or walk straight in.' },
  { q: 'How do I reschedule or cancel an appointment?', a: 'Open “My appointments” in the patient portal and cancel or book a new slot in one tap. There are no cancellation charges if you cancel at least 2 hours before your slot.' },
  { q: 'Is my medical data safe?', a: 'Your records are protected with role-based access — only your treating team and you can see them. Data is encrypted in transit and at rest, and every access is logged.' },
]

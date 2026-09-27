// Copy & data for the public landing page. Edit freely — no logic lives here.

export const NAV_LINKS = [
  { to: '/about', label: 'About' },
  { to: '/services', label: 'Services', mega: true },
  { to: '/find-a-doctor', label: 'Find a Doctor' },
  { to: '/packages', label: 'Health Packages' },
  { to: '/contact', label: 'Contact' },
] as const

export const STATS = [
  { value: 120000, suffix: '+', label: 'Patients cared for', format: 'lakh' as const },
  { value: 35, suffix: '+', label: 'Expert specialists' },
  { value: 12, suffix: '', label: 'Super-specialities' },
  { value: 4.9, suffix: '★', label: 'Average patient rating', decimals: 1 },
]

export const INSURERS = [
  'Star Health', 'HDFC ERGO', 'ICICI Lombard', 'Niva Bupa', 'Care Health', 'Ayushman Bharat', 'CGHS', 'Tata AIG', 'Bajaj Allianz', 'Aditya Birla Health',
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

export type FaqItem = { q: string; a: string }
export const FAQ_GROUPS: { id: string; title: string; items: FaqItem[] }[] = [
  { id: 'appointments', title: 'Appointments', items: [
    { q: 'How do I book an appointment online?', a: 'Create a free patient account, choose a speciality or doctor, pick a slot that suits you and confirm. You will get an instant confirmation — the whole process takes about 30 seconds. You can also call our helpdesk 24×7.' },
    { q: 'How do I reschedule or cancel an appointment?', a: 'Open “My appointments” in the patient portal and cancel or book a new slot in one tap. There are no cancellation charges if you cancel at least 2 hours before your slot.' },
    { q: 'Can I book for a family member?', a: 'Yes. You can book appointments for parents, children or your spouse from your own account and keep their records organised in one place.' },
    { q: 'Do you offer video consultations?', a: 'Yes, most of our doctors offer secure video follow-ups. Choose “Teleconsultation” while booking or ask the front desk after your visit.' },
  ] },
  { id: 'billing', title: 'Insurance & Billing', items: [
    { q: 'Do you offer cashless treatment with insurance?', a: 'Yes. We are empanelled with 30+ insurers and TPAs including Ayushman Bharat and CGHS. Our insurance desk handles pre-authorisation for planned and emergency admissions so you can focus on recovery.' },
    { q: 'How can I pay my bill?', a: 'Pay by UPI, credit/debit card, net banking or cash at the billing counter. Every bill is itemised and available in your patient portal.' },
    { q: 'Can I get a cost estimate before surgery?', a: 'Absolutely. Our patient-care desk shares a written estimate based on your doctor’s plan, room choice and insurance coverage before admission.' },
    { q: 'Is EMI available?', a: 'Yes, no-cost EMI options are available on major credit cards and through partner finance companies for planned procedures.' },
  ] },
  { id: 'reports', title: 'Reports & Records', items: [
    { q: 'Can I see my prescriptions and lab reports online?', a: 'Absolutely. Every prescription, lab report and bill is added to your secure patient portal as soon as it is ready. You can view, download or share them with any doctor.' },
    { q: 'How long do lab reports take?', a: 'Most routine blood tests are ready within 6 hours. Specialised tests such as cultures or biopsies may take 2–5 days — the portal shows live status.' },
    { q: 'Is my medical data safe?', a: 'Your records are protected with role-based access — only your treating team and you can see them. Data is encrypted in transit and at rest, and every access is logged.' },
  ] },
  { id: 'visiting', title: 'Visiting & Admission', items: [
    { q: 'What are the visiting hours?', a: 'General wards: 11:00 AM – 1:00 PM and 5:00 PM – 7:00 PM. ICU visits are allowed for one attendant at a time at 12:00 PM and 6:00 PM. Private rooms allow one attendant to stay overnight.' },
    { q: 'What should I bring for admission?', a: 'A photo ID, insurance card or TPA details, previous medical records, current medicines and comfortable clothing. We provide toiletries and meals.' },
    { q: 'Is parking available?', a: 'Yes, free multi-level parking for patients and visitors with dedicated spaces for emergency drop-off and differently-abled visitors.' },
  ] },
  { id: 'emergency', title: 'Emergency', items: [
    { q: 'Is the emergency department open 24×7?', a: 'Yes — our emergency and trauma unit is staffed round the clock by emergency physicians, with ICU, cath-lab and operation theatres on standby. Call +91 11 4000 2100 or walk straight in.' },
    { q: 'How do I call an ambulance?', a: 'Call +91 11 4000 2100 and choose option 1. Our GPS-tracked ALS ambulances cover Delhi NCR, and paramedics share your vitals with the ER team on the way.' },
  ] },
]
export const FAQS: FaqItem[] = FAQ_GROUPS.flatMap((g) => g.items)

export const PACKAGE_COMPARE: { group: string; rows: [string, boolean | string, boolean | string, boolean | string][] }[] = [
  { group: 'Blood & urine', rows: [
    ['Complete blood count', true, true, true], ['Blood sugar (fasting)', true, true, true], ['HbA1c', false, true, true],
    ['Lipid profile', true, true, true], ['Liver & kidney function', true, true, true], ['Thyroid profile', 'TSH', 'T3, T4, TSH', 'T3, T4, TSH'],
    ['Vitamin D & B12', false, true, true], ['Cancer markers', false, false, true], ['Urine routine', true, true, true],
  ] },
  { group: 'Heart & imaging', rows: [
    ['ECG', false, true, true], ['Chest X-ray', false, true, true], ['Ultrasound abdomen', false, true, true], ['2D Echo', false, false, true], ['TMT (stress test)', false, false, true], ['Pulmonary function test', false, false, true],
  ] },
  { group: 'Consultations', rows: [
    ['Physician', true, true, true], ['Cardiologist', false, true, true], ['Dietician', false, true, true], ['Eye & dental check', false, false, true], ['Dedicated care manager', false, false, true],
  ] },
]

import {
  Activity, Ambulance, Baby, Bone, Brain, ClipboardCheck, Droplet, Droplets, Ear, Flower2, HeartPulse, House, Microscope,
  MonitorDot, Pill, ScanLine, Siren, Sparkles, Stethoscope, Video, type LucideIcon,
} from 'lucide-react'

export type Service = {
  slug: string
  name: string
  icon: LucideIcon
  tagline: string
  summary: string
  description: string[]
  conditions: string[]
  treatments: string[]
  technology: string[]
  stats: [string, string][]
  hours: string
  featured?: boolean
}

export const SERVICES: Service[] = [
  {
    slug: 'cardiology', name: 'Cardiology', icon: HeartPulse, featured: true,
    tagline: 'Heart care that never skips a beat',
    summary: 'Complete heart care from prevention and diagnostics to angioplasty and bypass surgery.',
    description: [
      'Our Cardiac Sciences centre brings interventional cardiologists, cardiac surgeons and a dedicated cardiac ICU under one roof, so every heart patient gets a coordinated plan from day one.',
      'A 24×7 cath-lab and a “door-to-balloon” protocol under 60 minutes mean that when every second counts, our team is already moving.',
    ],
    conditions: ['Coronary artery disease', 'Heart attack', 'Heart failure', 'Arrhythmia', 'Hypertension', 'Valve disease', 'Congenital heart defects', 'High cholesterol'],
    treatments: ['Coronary angiography & angioplasty', 'Bypass surgery (CABG)', 'Pacemaker & ICD implantation', 'Valve repair & replacement', '2D Echo, TMT & Holter', 'Preventive cardiology clinic'],
    technology: ['Flat-panel digital cath-lab', '3D echocardiography', '12-bed cardiac ICU', 'Remote ECG monitoring'],
    stats: [['4,800+', 'Cardiac procedures'], ['< 60 min', 'Door-to-balloon'], ['98.6%', 'Angioplasty success']],
    hours: 'OPD Mon–Sat, 9:00 AM – 8:00 PM · Emergency 24×7',
  },
  {
    slug: 'neurology', name: 'Neurology', icon: Brain, featured: true,
    tagline: 'Expert care for brain, spine & nerves',
    summary: 'Stroke-ready neurology with advanced diagnostics for epilepsy, migraine and movement disorders.',
    description: [
      'From sudden stroke to long-standing headaches, our neurologists combine careful clinical examination with advanced imaging and neuro-physiology to find the real cause.',
      'Our stroke unit follows international thrombolysis protocols, and a neuro-rehabilitation team helps patients regain independence after discharge.',
    ],
    conditions: ['Stroke', 'Epilepsy & seizures', 'Migraine & headache', 'Parkinson’s disease', 'Multiple sclerosis', 'Neuropathy', 'Vertigo', 'Memory disorders'],
    treatments: ['Thrombolysis for acute stroke', 'EEG & video EEG', 'Nerve conduction studies', 'Botox for migraine & spasticity', 'Epilepsy management', 'Neuro-rehabilitation'],
    technology: ['1.5T MRI & CT angiography', '32-channel digital EEG', 'EMG/NCV lab', 'Dedicated stroke unit'],
    stats: [['1,200+', 'Stroke patients treated'], ['24×7', 'Stroke team'], ['3.5 hrs', 'Thrombolysis window']],
    hours: 'OPD Mon, Wed, Fri & Sat · Stroke team 24×7',
  },
  {
    slug: 'orthopedics', name: 'Orthopedics', icon: Bone, featured: true,
    tagline: 'Move freely, live fully',
    summary: 'Joint replacement, sports injury, spine and trauma care — back on your feet sooner.',
    description: [
      'Our orthopaedic and spine surgeons use minimally invasive and computer-assisted techniques to reduce pain, blood loss and hospital stay.',
      'In-house physiotherapy begins within hours of surgery, with a personalised plan that follows you home.',
    ],
    conditions: ['Knee & hip arthritis', 'Sports injuries', 'Fractures & trauma', 'Back & neck pain', 'Slipped disc', 'Frozen shoulder', 'Osteoporosis', 'Ligament tears'],
    treatments: ['Total knee & hip replacement', 'Arthroscopic ACL reconstruction', 'Minimally invasive spine surgery', 'Fracture fixation', 'Shoulder arthroscopy', 'PRP & joint injections'],
    technology: ['Computer-navigated joint replacement', 'Laminar-flow modular OTs', 'C-arm fluoroscopy', 'Physiotherapy & rehab gym'],
    stats: [['2,500+', 'Joint replacements'], ['Day 1', 'Walking after surgery'], ['4.9★', 'Patient rating']],
    hours: 'OPD Mon–Sat, 10:00 AM – 7:00 PM',
  },
  {
    slug: 'pediatrics', name: 'Pediatrics', icon: Baby, featured: true,
    tagline: 'Gentle care for little ones',
    summary: 'Child-friendly care from newborn to teen — vaccinations, growth checks and NICU.',
    description: [
      'Our pediatric wing is designed to feel less like a hospital and more like a playroom, with specialists who know how to make children (and parents) feel at ease.',
      'A level-III NICU, 24×7 pediatric emergency and a vaccination clinic with digital reminders keep your child protected at every stage.',
    ],
    conditions: ['Fever & infections', 'Asthma & allergies', 'Growth & nutrition issues', 'Newborn jaundice', 'Diarrhoea & dehydration', 'Developmental delays'],
    treatments: ['Complete vaccination schedule', 'Newborn & well-baby clinic', 'Level-III NICU', 'Pediatric emergency', 'Growth & development tracking', 'Adolescent health'],
    technology: ['Level-III NICU & PICU', 'Neonatal ventilators', 'Phototherapy units', 'Child-friendly OPD'],
    stats: [['15,000+', 'Children cared for'], ['Level III', 'NICU'], ['5.0★', 'Parent rating']],
    hours: 'OPD Mon–Sat, 9:00 AM – 8:00 PM · Emergency 24×7',
  },
  {
    slug: 'general-medicine', name: 'General Medicine', icon: Stethoscope,
    tagline: 'Your first stop for everyday health',
    summary: 'Experienced physicians for fever, infections, lifestyle diseases and preventive care.',
    description: [
      'Our internal medicine team is your family’s first point of contact — diagnosing, treating and coordinating care with specialists whenever needed.',
      'We focus on long-term relationships and prevention, helping you manage blood pressure, thyroid and other chronic conditions with confidence.',
    ],
    conditions: ['Fever, dengue & typhoid', 'Hypertension', 'Thyroid disorders', 'Anaemia', 'Respiratory infections', 'Gastric problems', 'Fatigue & weakness'],
    treatments: ['Comprehensive consultations', 'Chronic disease management', 'Preventive health checks', 'Vaccinations for adults', 'In-patient medical care'],
    technology: ['Integrated lab & imaging', 'Digital health records', 'Teleconsultation follow-ups'],
    stats: [['40,000+', 'Consultations / year'], ['Same day', 'Appointments'], ['6', 'Senior physicians']],
    hours: 'OPD Mon–Sat, 8:00 AM – 9:00 PM',
  },
  {
    slug: 'gynecology-obstetrics', name: 'Gynecology & Obstetrics', icon: Flower2, featured: true,
    tagline: 'Every stage of womanhood, cared for',
    summary: 'Pregnancy care, safe deliveries, fertility guidance and advanced gynaecological surgery.',
    description: [
      'From your first pregnancy test to post-natal care, our obstetricians, midwives and lactation experts walk the journey with you.',
      'Luxury birthing suites, painless delivery options and a NICU next door ensure mother and baby are safe and comfortable.',
    ],
    conditions: ['High-risk pregnancy', 'PCOS / PCOD', 'Menstrual disorders', 'Fibroids & cysts', 'Infertility', 'Menopause care'],
    treatments: ['Antenatal & postnatal care', 'Normal & painless delivery', 'C-section', 'Laparoscopic surgery', 'Fertility counselling', 'Cervical cancer screening'],
    technology: ['LDR birthing suites', '4D ultrasound', 'Laparoscopy suite', 'Level-III NICU next door'],
    stats: [['6,000+', 'Happy deliveries'], ['24×7', 'Obstetric team'], ['4.9★', 'Mother rating']],
    hours: 'OPD Mon–Sat, 10:00 AM – 6:00 PM · Labour room 24×7',
  },
  {
    slug: 'dermatology', name: 'Dermatology', icon: Sparkles,
    tagline: 'Healthy skin, hair & nails',
    summary: 'Medical and aesthetic dermatology — acne, allergies, hair loss and laser treatments.',
    description: [
      'Our dermatologists treat everything from stubborn acne and eczema to hair loss and pigmentation using evidence-based medicine.',
      'An aesthetic suite offers safe, doctor-performed laser and skin procedures with honest advice and realistic results.',
    ],
    conditions: ['Acne & scars', 'Eczema & psoriasis', 'Fungal infections', 'Hair fall', 'Pigmentation', 'Skin allergies'],
    treatments: ['Medical dermatology', 'Chemical peels', 'Laser hair reduction', 'PRP for hair', 'Mole & wart removal', 'Patch testing'],
    technology: ['Diode & Q-switched lasers', 'Digital dermoscopy', 'Phototherapy unit'],
    stats: [['9,000+', 'Patients treated'], ['FDA-approved', 'Lasers'], ['4.8★', 'Patient rating']],
    hours: 'OPD Mon–Sat, 11:00 AM – 7:00 PM',
  },
  {
    slug: 'ent', name: 'ENT', icon: Ear,
    tagline: 'Hear, breathe & speak better',
    summary: 'Ear, nose and throat care including endoscopic sinus surgery and hearing solutions.',
    description: [
      'Our ENT surgeons diagnose and treat conditions of the ear, nose, throat, head and neck with the latest endoscopic and microscopic techniques.',
      'An in-house audiology lab offers hearing tests and hearing-aid fitting, with speech therapy for children and adults.',
    ],
    conditions: ['Sinusitis', 'Tonsillitis', 'Hearing loss', 'Ear infections', 'Snoring & sleep apnoea', 'Voice disorders'],
    treatments: ['Endoscopic sinus surgery', 'Tonsillectomy & adenoidectomy', 'Tympanoplasty', 'Hearing aids', 'Sleep studies', 'Speech therapy'],
    technology: ['HD ENT endoscopy', 'Operating microscope', 'Audiology & BERA lab'],
    stats: [['3,200+', 'ENT surgeries'], ['Same day', 'Hearing tests'], ['4.8★', 'Patient rating']],
    hours: 'OPD Mon–Sat, 10:00 AM – 5:00 PM',
  },
  {
    slug: 'radiology', name: 'Radiology & Imaging', icon: ScanLine,
    tagline: 'See clearly, diagnose accurately',
    summary: 'MRI, CT, ultrasound, digital X-ray and mammography with same-day reports.',
    description: [
      'Our imaging department runs round the clock with high-resolution scanners and experienced radiologists who report quickly and clearly.',
      'Low-dose protocols, a calm scanning environment and online reports make every scan comfortable and fast.',
    ],
    conditions: ['Injury evaluation', 'Tumour detection', 'Stroke imaging', 'Pregnancy scans', 'Breast screening', 'Abdominal pain'],
    treatments: ['1.5T MRI', '128-slice CT', 'Ultrasound & Doppler', 'Digital X-ray', 'Mammography', 'Image-guided biopsies'],
    technology: ['128-slice CT scanner', '1.5T silent MRI', '4D ultrasound', 'PACS with online reports'],
    stats: [['60,000+', 'Scans / year'], ['4 hrs', 'Average report time'], ['24×7', 'CT & X-ray']],
    hours: 'Open 24×7',
  },
  {
    slug: 'emergency', name: 'Emergency & Trauma', icon: Siren, featured: true,
    tagline: 'Always open. Always ready.',
    summary: '24×7 emergency, trauma and critical care with rapid ambulance response.',
    description: [
      'Our emergency department is staffed round the clock by emergency physicians, with surgeons, cardiologists and neurologists on call within minutes.',
      'Triage begins the moment you arrive — or even before, with paramedics in our ALS ambulances sharing vitals with the ER team en route.',
    ],
    conditions: ['Chest pain & heart attack', 'Stroke', 'Road accidents & trauma', 'Breathing difficulty', 'Poisoning', 'Burns', 'High fever & seizures'],
    treatments: ['Resuscitation & triage', 'Trauma surgery', 'Emergency cardiac care', 'Critical care & ICU', 'Advanced life support ambulance', 'Minor procedures'],
    technology: ['ALS ambulances with GPS', '30-bed multi-speciality ICU', 'Point-of-care labs', 'Dedicated trauma OT'],
    stats: [['< 5 min', 'Triage time'], ['24×7', 'Ambulance'], ['30', 'ICU beds']],
    hours: 'Open 24×7, 365 days',
  },
  {
    slug: 'pathology', name: 'Laboratory & Pathology', icon: Microscope,
    tagline: 'Accurate results, delivered fast',
    summary: 'Fully automated lab with home sample collection and online reports in hours.',
    description: [
      'Our laboratory runs over 1,500 tests with fully automated analysers and strict internal and external quality controls.',
      'Book home sample collection, track your sample and receive reports on your phone — often within 6 hours.',
    ],
    conditions: ['Diabetes monitoring', 'Thyroid tests', 'Infections', 'Vitamin deficiencies', 'Cancer markers', 'Hormone tests'],
    treatments: ['Biochemistry & haematology', 'Microbiology & culture', 'Histopathology', 'Molecular diagnostics (RT-PCR)', 'Home sample collection', 'Health check-up panels'],
    technology: ['Fully automated analysers', 'Barcode sample tracking', 'Online reports'],
    stats: [['1,500+', 'Tests offered'], ['6 hrs', 'Average turnaround'], ['Home', 'Sample collection']],
    hours: 'Open 24×7 · Home collection 6:00 AM – 8:00 PM',
  },
  {
    slug: 'diabetology', name: 'Diabetes & Endocrinology', icon: Droplet,
    tagline: 'Take control of your sugar',
    summary: 'Personalised diabetes, thyroid and hormone care with diet and lifestyle coaching.',
    description: [
      'Diabetes is a lifelong partnership. Our diabetologists, dieticians and educators build a plan around your food, work and family life.',
      'Continuous glucose monitoring, foot-care clinics and regular reviews help prevent complications before they start.',
    ],
    conditions: ['Type 1 & Type 2 diabetes', 'Gestational diabetes', 'Thyroid disorders', 'Obesity', 'PCOS', 'Diabetic foot'],
    treatments: ['Diabetes reversal programme', 'Insulin pump & CGM', 'Diet & lifestyle counselling', 'Diabetic foot clinic', 'Thyroid management'],
    technology: ['Continuous glucose monitors', 'HbA1c point-of-care testing', 'Foot pressure analysis'],
    stats: [['8,000+', 'Patients enrolled'], ['1.4%', 'Avg. HbA1c drop'], ['4.9★', 'Patient rating']],
    hours: 'OPD Mon–Sat, 9:00 AM – 5:00 PM',
  },
]

export const serviceBySlug = (slug?: string) => SERVICES.find((s) => s.slug === slug)

export const SUPPORT_SERVICES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Ambulance, title: 'ALS Ambulance', text: 'GPS-tracked advanced life-support ambulances across Delhi NCR, 24×7.' },
  { icon: MonitorDot, title: 'ICU & Critical Care', text: '30-bed multi-speciality ICU with 1:1 nursing for critical patients.' },
  { icon: Pill, title: '24×7 Pharmacy', text: 'Genuine medicines, always in stock, with home delivery for refills.' },
  { icon: Activity, title: 'Physiotherapy & Rehab', text: 'Sports, neuro and post-surgery rehabilitation with modern equipment.' },
  { icon: House, title: 'Home Care', text: 'Nursing, sample collection and doctor visits in the comfort of your home.' },
  { icon: Video, title: 'Teleconsultation', text: 'Follow up with your doctor over secure video — no travel needed.' },
  { icon: ClipboardCheck, title: 'Health Check-ups', text: 'Doctor-designed packages with same-day reports and consultation.' },
  { icon: Droplets, title: 'Blood Bank', text: 'Licensed blood bank with component separation, open round the clock.' },
]

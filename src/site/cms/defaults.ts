import { DOCTORS } from '../data/doctors'
import { SERVICES, SUPPORT_SERVICES } from '../data/services'
import type { SiteContent } from './types'

/**
 * Built-in content — exactly what the site showed before the CMS existed.
 * Used for any section that has never been saved from the dashboard, and to seed `site_content` in master.sql.
 */
export const DEFAULT_CONTENT: SiteContent = {
  // ================================================================ settings
  settings: {
    name: 'DC Hospital',
    tagline: 'Care · 24×7',
    about: 'Multi-speciality hospital delivering compassionate, technology-first care to families across Delhi NCR since 2009.',
    address: 'Plot 12, Sector 18, Dwarka, New Delhi 110075',
    phone: '+91 11 4000 2100',
    appointmentsPhone: '+91 11 4000 2200',
    whatsapp: '+91 98100 40002',
    email: 'care@dchospital.com',
    topBar: { enabled: true, text: 'Emergency & ambulance open 24×7' },
    emergency: { title: '24×7 Emergency & Ambulance', text: 'Trauma, cardiac & stroke-ready team. Walk in any time or call — we’re always open.' },
    hours: [
      { label: 'Emergency & ICU', value: '24 × 7', highlight: true },
      { label: 'OPD consultations', value: 'Mon–Sat · 8 AM – 9 PM', highlight: false },
      { label: 'Laboratory', value: '24 × 7', highlight: true },
      { label: 'Pharmacy', value: '24 × 7', highlight: true },
      { label: 'Visiting hours', value: '11–1 PM · 5–7 PM', highlight: false },
      { label: 'Billing desk', value: 'Daily · 8 AM – 10 PM', highlight: false },
    ],
    directions: [
      { icon: 'TrainFront', text: 'Dwarka Sector 21 Metro (Blue Line) — 6 min by e-rickshaw' },
      { icon: 'Car', text: 'Free multi-level parking · Valet at main entrance' },
      { icon: 'Siren', text: 'Dedicated emergency drop-off at Gate 2' },
    ],
    map: {
      embedUrl: 'https://www.openstreetmap.org/export/embed.html?bbox=77.030%2C28.582%2C77.062%2C28.602&layer=mapnik&marker=28.5921%2C77.0460',
      directionsUrl: 'https://www.openstreetmap.org/?mlat=28.5921&mlon=77.0460#map=16/28.5921/77.0460',
    },
    socials: [
      { platform: 'Instagram', url: '' },
      { platform: 'Facebook', url: '' },
      { platform: 'X', url: '' },
      { platform: 'LinkedIn', url: '' },
      { platform: 'YouTube', url: '' },
    ],
    cta: {
      badge: '23 specialists available today',
      title: 'Your health can’t wait in a queue. *Neither should you.*',
      lead: 'Book your consultation in 30 seconds — or talk to our care team right now.',
      note: 'Free account · No booking fee · Cancel anytime',
    },
    pages: { about: true, services: true, doctors: true, packages: true, contact: true, faq: true },
    seoDescription: 'DC Hospital — multi-speciality care in New Delhi. Book appointments with top specialists in 30 seconds, get digital prescriptions & lab reports online, 24×7 emergency.',
    booking: {
      enabled: true,
      advanceDays: 30,
      minNoticeMinutes: 60,
      payNote: 'Pay at the reception when you arrive — cash, card or UPI. Please come 15 minutes early with a photo ID.',
      showDemoOtp: true,
    },
    billing: {
      legalName: 'DC Hospital Private Limited',
      gstin: '07AAACD1234F1Z5',
      regNo: 'DL/CE/2019/004512',
      pan: 'AAACD1234F',
      sac: '999312',
      gstRate: 0,
      exemptNote: 'Healthcare services by a clinical establishment are exempt from GST — Notification No. 12/2017-Central Tax (Rate), Sr. No. 74.',
      upiId: 'dchospital@icici',
      footer: 'This is a computer-generated document and does not require a physical signature.',
      signatory: 'Authorised signatory',
    },
  },

  // ================================================================ home
  home: {
    seo: {
      title: 'Multi-speciality care, 24×7 | Book appointments online',
      description: 'DC Hospital — multi-speciality care in New Delhi. Book appointments with top specialists in 30 seconds, get digital prescriptions & lab reports online, 24×7 emergency.',
    },
    sections: { stats: true, features: true, doctors: true, why: true, testimonials: true, packages: true, faq: true, cta: true },
    hero: {
      badge: 'Book, consult & get reports — all online',
      line1: 'Care that feels personal.',
      line2: 'Booking that feels *effortless.*',
      subtitle: '35+ trusted specialists, 12 super-specialities and a 24×7 emergency team — with appointments in 30 seconds, digital prescriptions and lab reports right on your phone. That’s healthcare the way it should be.',
      image: '/landing/hero.webp',
      imageAlt: 'Smiling DC Hospital doctor holding a tablet',
      rating: '4.9/5',
      trust: 'Loved by *1.2 lakh+* patients & families',
    },
    stats: [
      { value: 120000, suffix: '+', label: 'Patients cared for', format: 'lakh', decimals: 0 },
      { value: 35, suffix: '+', label: 'Expert specialists', format: 'plain', decimals: 0 },
      { value: 12, suffix: '', label: 'Super-specialities', format: 'plain', decimals: 0 },
      { value: 4.9, suffix: '★', label: 'Average patient rating', format: 'plain', decimals: 1 },
    ],
    insurersTitle: 'Cashless treatment with 30+ insurers & government schemes',
    insurers: [
      'Star Health', 'HDFC ERGO', 'ICICI Lombard', 'Niva Bupa', 'Care Health', 'Ayushman Bharat', 'CGHS', 'Tata AIG', 'Bajaj Allianz', 'Aditya Birla Health',
    ],
    features: {
      eyebrow: 'Care, simplified',
      title: 'Everything you need, *before, during & after* your visit',
      lead: 'From the first booking to your final report, {name} keeps every step clear, quick and connected — so you spend less time waiting and more time healing.',
    },
    featureCards: [
      { title: 'Book in 30 seconds', text: 'See real-time availability for every doctor, pick a slot and you’re done. Try it right here.' },
      { title: 'Digital prescriptions', text: 'Clear dosage, timing and duration — always on your phone, easy to share with any pharmacy.' },
      { title: 'Reports on your phone', text: 'NABL-standard lab with results delivered online — most within 6 hours.' },
      { title: '24×7 emergency & ICU', text: 'Trauma, cardiac and stroke-ready team with ambulance dispatch in minutes.' },
      { title: 'Honest, itemised billing', text: 'Every charge explained upfront. Pay by UPI, card or insurance — no surprises at discharge.' },
    ],
    doctors: {
      eyebrow: 'Meet our specialists',
      title: 'Doctors who listen *first*',
      lead: 'Senior consultants trained at India’s finest institutions — who take time to explain, not just prescribe.',
    },
    why: {
      eyebrow: 'Why patients choose DC',
      title: 'Hospital-grade care. *Hotel-grade comfort.*',
      image: '/landing/care.webp',
      waitValue: '8', waitLabel: 'Avg. OPD wait', waitNote: '↓ 64% vs city average',
      badgeTitle: 'NABH-grade protocols', badgeText: 'Infection-safe care',
    },
    benefits: [
      { icon: 'Timer', title: 'Wait less, heal more', text: 'Timed OPD slots and live queue updates cut average waiting to under 10 minutes.' },
      { icon: 'FileText', title: 'One record for life', text: 'Visits, prescriptions, scans and bills — your complete history in one secure place.' },
      { icon: 'CreditCard', title: 'Know the cost upfront', text: 'Transparent package pricing and itemised bills. Cashless with 30+ insurers.' },
      { icon: 'Users', title: 'Care for the whole family', text: 'Manage appointments and reports for parents and kids from a single account.' },
    ],
    steps: {
      eyebrow: 'How it works',
      title: 'Your first visit in 3 simple steps',
      items: [
        { title: 'Create your free account', text: 'Sign up in seconds with your phone or email.' },
        { title: 'Choose doctor & time', text: 'Filter by speciality, language or earliest slot.' },
        { title: 'Visit & get everything online', text: 'Prescriptions, reports and bills land in your portal.' },
      ],
    },
    testimonials: {
      eyebrow: 'Patient stories',
      title: 'Trusted by *1.2 lakh+* families',
      lead: 'Real words from people we’ve had the privilege to care for.',
      reviews: '*4.9* from 8,400+ Google reviews',
    },
    packages: {
      eyebrow: 'Health check-up packages',
      title: 'Prevention that *pays for itself*',
      lead: 'Doctor-designed screenings with same-day reports and a consultation to walk you through every result.',
      note: 'Home sample collection available across Delhi NCR · Prices inclusive of GST',
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Questions? *We’ve got answers.*',
      lead: 'Can’t find what you’re looking for? Our patient care team is available round the clock.',
    },
  },

  // ================================================================ about
  about: {
    seo: { title: 'About us', description: 'Since 2009, DC Hospital has cared for over 1.2 lakh families in Delhi NCR with compassion, safety and transparent, technology-first healthcare.' },
    hero: {
      eyebrow: 'Our story',
      title: 'Healthcare with a *human heart*',
      lead: 'For more than 15 years, {name} has combined senior specialists, modern technology and genuine warmth to deliver care that families across Delhi NCR trust.',
      badgeTitle: 'Since 2009', badgeText: 'Serving Delhi NCR',
    },
    mission: {
      eyebrow: 'Why we exist',
      title: 'Care that is *personal, safe & honest*',
      image: '/landing/care.webp',
      quote: 'Good medicine starts with listening. Everything else follows.',
      quoteBy: 'Dr. Vikram Singh, Medical Director',
      items: [
        { icon: 'Target', title: 'Our mission', text: 'To deliver world-class, affordable healthcare with compassion — making every patient feel informed, respected and safe.' },
        { icon: 'Eye', title: 'Our vision', text: 'To be North India’s most trusted family hospital, where technology makes care simpler and kinder for everyone.' },
        { icon: 'HeartHandshake', title: 'Our promise', text: 'Senior doctors, transparent costs and a care team that picks up the phone — at 3 PM or 3 AM.' },
      ],
    },
    journey: {
      eyebrow: 'Our journey',
      title: 'From 40 beds to *1.2 lakh families*',
      milestones: [
        { year: '2009', title: 'A 40-bed promise', text: 'DC Hospital opens in Dwarka with 40 beds, 6 doctors and one belief — every patient deserves to be heard.' },
        { year: '2013', title: 'Cardiac & critical care', text: 'Launch of our cath-lab, cardiac ICU and 24×7 emergency — the first in the neighbourhood.' },
        { year: '2017', title: 'Growing to 150 beds', text: 'New tower with modular OTs, level-III NICU and a dedicated mother & child wing.' },
        { year: '2021', title: 'Digital-first care', text: 'Online booking, e-prescriptions and reports-on-phone for every patient.' },
        { year: '2024', title: 'Centres of excellence', text: 'Neuro-sciences, joint replacement and diabetes reversal programmes established.' },
        { year: 'Today', title: '1.2 lakh+ families', text: '35+ specialists, 12 super-specialities and a patient portal that puts you in control.' },
      ],
    },
    values: {
      eyebrow: 'Our values',
      title: 'What guides *every decision*',
      lead: 'Six principles every member of our 900-strong team lives by — from surgeons to security.',
      items: [
        { icon: 'HandHeart', title: 'Compassion first', text: 'We treat every patient like family — with patience, dignity and warmth.' },
        { icon: 'ShieldCheck', title: 'Uncompromising safety', text: 'Infection control, medication safety and clinical audits built into every process.' },
        { icon: 'Eye', title: 'Radical transparency', text: 'Clear explanations, honest estimates and itemised bills. No surprises, ever.' },
        { icon: 'Lightbulb', title: 'Always improving', text: 'We adopt technology that makes care faster and kinder — never just for show.' },
        { icon: 'Users', title: 'Teamwork', text: 'Doctors, nurses and staff work as one team around each patient.' },
        { icon: 'Leaf', title: 'Responsible care', text: 'Green operations, fair pricing and free health camps for our community.' },
      ],
    },
    leadership: {
      eyebrow: 'Leadership',
      title: 'The people *behind the care*',
      people: [
        { name: 'Avinash Tosoni', role: 'Founder & Managing Director', image: '', quote: 'We built DC Hospital so that no family ever feels lost in a hospital again.' },
        { name: 'Dr. Vikram Singh', role: 'Senior Physician & Medical Director', image: '/landing/doc-vikram.webp', quote: '' },
        { name: 'Dr. Nikhil Joshi', role: 'Head — Cardiac Surgery', image: '/landing/doc-nikhil.webp', quote: '' },
        { name: 'Dr. Lakshmi Reddy', role: 'Head — Laboratory Services', image: '/landing/doc-lakshmi.webp', quote: '' },
      ],
    },
    accreditations: {
      eyebrow: 'Quality & safety',
      title: 'Certified to care',
      lead: 'Independent standards that hold us accountable, every single day.',
      items: [
        { title: 'NABH-grade protocols', text: 'Patient safety & quality standards' },
        { title: 'NABL-standard lab', text: 'Accurate, audited diagnostics' },
        { title: 'ISO 9001:2015', text: 'Quality management systems' },
        { title: 'Green OT certified', text: 'Energy-efficient operation theatres' },
      ],
    },
    cta: { title: 'Experience care that *feels different.*', lead: 'Join 1.2 lakh+ families who trust {name} with their health.' },
  },

  // ================================================================ services page
  servicesPage: {
    seo: { title: 'Medical services & specialities', description: 'Explore 12 super-specialities at DC Hospital — cardiology, neurology, orthopaedics, paediatrics, women’s health, 24×7 emergency and more.' },
    hero: {
      eyebrow: 'Centres of excellence',
      title: 'Every speciality. *One caring team.*',
      lead: 'From everyday fevers to complex heart surgery, our 12 super-specialities work together so you get the right care — the first time.',
    },
    featured: { eyebrow: 'Signature programmes', title: 'Where we *lead the way*' },
    support: { eyebrow: 'Round-the-clock support', title: 'Everything around *your treatment*', lead: 'Diagnostics, pharmacy, rehab and home care — all coordinated by the same team.' },
    cta: { badge: 'Free guidance, 24×7', title: 'Not sure which specialist *you need?*', lead: 'Call our care team — a trained nurse will guide you to the right doctor, free of charge.' },
    detailCta: { title: 'Get expert {service} care *today.*', lead: 'Book your consultation in 30 seconds — or talk to our care team right now.' },
    detailFaqs: [
      { q: 'How do I book a {service} consultation?', a: 'Book online in 30 seconds from the patient portal, or call {phone}. Choose any of our {service} specialists and a time that suits you.' },
      { q: 'Is cashless insurance accepted for treatment?', a: 'Yes. Our insurance desk handles cashless approvals with 30+ insurers and TPAs, including Ayushman Bharat and CGHS, for planned and emergency care.' },
      { q: 'What should I bring to my first visit?', a: 'Bring a photo ID, your insurance card if applicable, previous prescriptions and any recent test reports or scans. Arrive 10 minutes early for registration.' },
      { q: 'Can I see my prescriptions and lab reports online?', a: 'Absolutely. Every prescription, lab report and bill is added to your secure patient portal as soon as it is ready. You can view, download or share them with any doctor.' },
    ],
  },

  // ================================================================ doctors page
  doctorsPage: {
    seo: { title: 'Find a doctor', description: 'Search DC Hospital specialists by name, speciality, language or availability and book an appointment online in 30 seconds.' },
    hero: { eyebrow: '{count} senior specialists', title: 'Find the *right doctor* for you', lead: 'Search by name, speciality, condition or language. See real availability and book in seconds.' },
    cta: { badge: 'Free care coordination', title: 'Can’t decide? *We’ll help you choose.*', lead: 'Our care coordinators match you with the right specialist based on your symptoms — free of charge.' },
  },

  // ================================================================ packages page
  packagesPage: {
    seo: { title: 'Health check-up packages', description: 'Doctor-designed preventive health check-up packages from ₹1,499 with same-day reports, specialist consultation and home sample collection.' },
    hero: { eyebrow: 'Preventive health', title: 'Know your health. *Stay ahead of it.*', lead: 'Doctor-designed check-ups that catch problems early — with same-day reports and a specialist to explain every result.' },
    compare: { eyebrow: 'Compare', title: 'What’s *included*', lead: 'Every package includes a doctor consultation and online reports.' },
    day: {
      eyebrow: 'Your check-up day',
      title: 'Done by *breakfast time*',
      lead: 'A smooth, guided morning — with a care coordinator by your side at every step.',
      steps: [
        { icon: 'ClipboardList', time: '7:30 AM', title: 'Check-in', text: 'Quick registration at our dedicated health check lounge — no queues.' },
        { icon: 'Syringe', time: '7:45 AM', title: 'Samples & vitals', text: 'Fasting blood & urine samples, BP, BMI and body composition.' },
        { icon: 'Coffee', time: '8:15 AM', title: 'Healthy breakfast', text: 'Complimentary breakfast while you wait for the next tests.' },
        { icon: 'Stethoscope', time: '9:00 AM', title: 'Scans & consults', text: 'ECG, X-ray, ultrasound and specialist consultations as per package.' },
        { icon: 'FileCheck2', time: 'Same day', title: 'Reports & review', text: 'Reports on your phone and a doctor review of every result.' },
      ],
    },
    homeCollection: { title: 'Prefer home collection?', text: 'Our phlebotomist visits between 6 and 10 AM across Delhi NCR — at no extra cost on Comprehensive & Executive.' },
    faqTitle: { eyebrow: 'Good to know', title: 'Before your *check-up*' },
    faqs: [
      { q: 'Do I need to fast before my health check?', a: 'Yes — please fast for 10–12 hours before your appointment (water is allowed). Take your regular BP or thyroid medicines unless your doctor says otherwise.' },
      { q: 'How long does the check-up take?', a: 'Essential takes about 2 hours, Comprehensive about 3 hours and Executive about 4 hours, including breakfast and consultations.' },
      { q: 'Can samples be collected at home?', a: 'Yes, blood and urine samples can be collected at home across Delhi NCR. Imaging and consultations are done at the hospital at a time of your choice.' },
      { q: 'Do you offer cashless treatment with insurance?', a: 'Yes. We are empanelled with 30+ insurers and TPAs including Ayushman Bharat and CGHS. Our insurance desk handles pre-authorisation for planned and emergency admissions so you can focus on recovery.' },
      { q: 'How can I pay my bill?', a: 'Pay by UPI, credit/debit card, net banking or cash at the billing counter. Every bill is itemised and available in your patient portal.' },
    ],
    cta: { badge: 'Couples save 10%', title: 'Give your family the gift of *early detection.*', lead: 'Book a package for yourself or a loved one — couples save 10%.' },
  },

  // ================================================================ contact page
  contactPage: {
    seo: { title: 'Contact us', description: 'Reach {name} 24×7 at {phone}. Visit us at {address}, or send us a message online.' },
    hero: { eyebrow: 'We’re here for you', title: 'Let’s talk about *your health*', lead: 'Questions about appointments, bills or reports? Our patient care team is available round the clock — call, WhatsApp or write to us.' },
    formTitle: 'Send us a message',
    formNote: 'Fields marked * are required. For medical emergencies, please call {phone}.',
    topics: ['Book an appointment', 'Billing & insurance', 'Medical records', 'Feedback or complaint', 'Careers', 'Something else'],
    successText: 'Your message has reached our patient care team. We’ll call you back within 2 working hours.',
  },

  // ================================================================ faq page
  faqPage: {
    seo: { title: 'Frequently asked questions', description: 'Answers about appointments, insurance, billing, reports, visiting hours and emergency care at DC Hospital.' },
    hero: { eyebrow: 'Help centre', title: 'How can we *help you?*', lead: 'Quick answers to the questions patients ask us most.' },
  },

  // ================================================================ legal
  legal: {
    privacy: {
      title: 'Privacy policy', updated: '1 September 2026',
      lead: 'Your health information is deeply personal. This policy explains what we collect, why, and how we keep it safe.',
      sections: [
        { h: 'Information we collect', p: ['Identity and contact details (name, age, gender, phone, email, address) that you share while registering or booking.', 'Medical information created during your care — consultation notes, prescriptions, lab results, imaging, admission and billing records.', 'Technical data such as device type and pages visited on our website, used only to keep the service secure and working well.'] },
        { h: 'How we use your information', p: ['To provide, coordinate and follow up on your medical care.', 'To process appointments, payments and insurance claims on your behalf.', 'To send reminders, reports and important service updates. We never sell your data or use it for third-party advertising.'] },
        { h: 'When we share information', p: ['With the doctors, nurses and staff directly involved in your care — access is role-based and logged.', 'With your insurer or TPA when you opt for cashless treatment, and with laboratories or specialists you are referred to.', 'When required by Indian law, including the Digital Personal Data Protection Act, 2023, or a valid court order.'] },
        { h: 'How we protect it', p: ['Data is encrypted in transit and at rest. Staff access is limited to what their role requires, and every access to a medical record is audited.', 'We follow recognised healthcare information security practices and review them regularly.'] },
        { h: 'Your rights', p: ['You can access, download or request correction of your records through the patient portal or at the medical records desk.', 'You may withdraw consent for non-essential communication at any time. Some records must be retained for the period required by medical regulations.'] },
        { h: 'Grievance officer', p: ['For any privacy concern, contact our Grievance Officer at {email} or {phone}, {address}. We respond within 7 working days.'] },
      ],
    },
    terms: {
      title: 'Terms of use', updated: '1 September 2026',
      lead: 'These terms govern your use of the {name} website, patient portal and online booking services.',
      sections: [
        { h: 'Our online services', p: ['The website and portal let you learn about our services, book or manage appointments, and view your records. They do not replace an in-person medical consultation.', 'In an emergency, call {phone} or visit the nearest emergency department immediately — do not rely on online booking.'] },
        { h: 'Your account', p: ['You are responsible for keeping your login credentials confidential and for activity under your account.', 'Please provide accurate information. You may manage family members’ appointments only with their consent or as their legal guardian.'] },
        { h: 'Appointments & cancellations', p: ['Slots are confirmed subject to doctor availability. In rare cases we may need to reschedule; we will inform you as early as possible.', 'You can cancel free of charge up to 2 hours before your appointment through the portal.'] },
        { h: 'Fees & payments', p: ['Consultation fees and package prices shown online are inclusive of applicable taxes unless stated otherwise.', 'Final treatment costs depend on clinical needs. Estimates are provided in good faith and may change as your care progresses.'] },
        { h: 'Website content', p: ['Information on this website is for general awareness and is not medical advice. Always consult a qualified doctor about your specific condition.', 'All content, logos and design are the property of {name} and may not be reused without permission.'] },
        { h: 'Governing law', p: ['These terms are governed by the laws of India, and courts at New Delhi shall have exclusive jurisdiction.'] },
      ],
    },
  },

  // ================================================================ collections
  services: SERVICES,
  support: SUPPORT_SERVICES,
  doctors: DOCTORS,
  packages: {
    items: [
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
    ],
    compare: [
      { group: 'Blood & urine', rows: [
        { label: 'Complete blood count', cells: ['yes', 'yes', 'yes'] }, { label: 'Blood sugar (fasting)', cells: ['yes', 'yes', 'yes'] }, { label: 'HbA1c', cells: ['no', 'yes', 'yes'] },
        { label: 'Lipid profile', cells: ['yes', 'yes', 'yes'] }, { label: 'Liver & kidney function', cells: ['yes', 'yes', 'yes'] }, { label: 'Thyroid profile', cells: ['TSH', 'T3, T4, TSH', 'T3, T4, TSH'] },
        { label: 'Vitamin D & B12', cells: ['no', 'yes', 'yes'] }, { label: 'Cancer markers', cells: ['no', 'no', 'yes'] }, { label: 'Urine routine', cells: ['yes', 'yes', 'yes'] },
      ] },
      { group: 'Heart & imaging', rows: [
        { label: 'ECG', cells: ['no', 'yes', 'yes'] }, { label: 'Chest X-ray', cells: ['no', 'yes', 'yes'] }, { label: 'Ultrasound abdomen', cells: ['no', 'yes', 'yes'] }, { label: '2D Echo', cells: ['no', 'no', 'yes'] }, { label: 'TMT (stress test)', cells: ['no', 'no', 'yes'] }, { label: 'Pulmonary function test', cells: ['no', 'no', 'yes'] },
      ] },
      { group: 'Consultations', rows: [
        { label: 'Physician', cells: ['yes', 'yes', 'yes'] }, { label: 'Cardiologist', cells: ['no', 'yes', 'yes'] }, { label: 'Dietician', cells: ['no', 'yes', 'yes'] }, { label: 'Eye & dental check', cells: ['no', 'no', 'yes'] }, { label: 'Dedicated care manager', cells: ['no', 'no', 'yes'] },
      ] },
    ],
  },
  faqs: [
    { id: 'appointments', title: 'Appointments', items: [
      { featured: true, q: 'How do I book an appointment online?', a: 'Create a free patient account, choose a speciality or doctor, pick a slot that suits you and confirm. You will get an instant confirmation — the whole process takes about 30 seconds. You can also call our helpdesk 24×7.' },
      { featured: true, q: 'How do I reschedule or cancel an appointment?', a: 'Open “My appointments” in the patient portal and cancel or book a new slot in one tap. There are no cancellation charges if you cancel at least 2 hours before your slot.' },
      { q: 'Can I book for a family member?', a: 'Yes. You can book appointments for parents, children or your spouse from your own account and keep their records organised in one place.' },
      { q: 'Do you offer video consultations?', a: 'Yes, most of our doctors offer secure video follow-ups. Choose “Teleconsultation” while booking or ask the front desk after your visit.' },
    ] },
    { id: 'billing', title: 'Insurance & Billing', items: [
      { featured: true, q: 'Do you offer cashless treatment with insurance?', a: 'Yes. We are empanelled with 30+ insurers and TPAs including Ayushman Bharat and CGHS. Our insurance desk handles pre-authorisation for planned and emergency admissions so you can focus on recovery.' },
      { q: 'How can I pay my bill?', a: 'Pay by UPI, credit/debit card, net banking or cash at the billing counter. Every bill is itemised and available in your patient portal.' },
      { q: 'Can I get a cost estimate before surgery?', a: 'Absolutely. Our patient-care desk shares a written estimate based on your doctor’s plan, room choice and insurance coverage before admission.' },
      { q: 'Is EMI available?', a: 'Yes, no-cost EMI options are available on major credit cards and through partner finance companies for planned procedures.' },
    ] },
    { id: 'reports', title: 'Reports & Records', items: [
      { featured: true, q: 'Can I see my prescriptions and lab reports online?', a: 'Absolutely. Every prescription, lab report and bill is added to your secure patient portal as soon as it is ready. You can view, download or share them with any doctor.' },
      { q: 'How long do lab reports take?', a: 'Most routine blood tests are ready within 6 hours. Specialised tests such as cultures or biopsies may take 2–5 days — the portal shows live status.' },
      { q: 'Is my medical data safe?', a: 'Your records are protected with role-based access — only your treating team and you can see them. Data is encrypted in transit and at rest, and every access is logged.' },
    ] },
    { id: 'visiting', title: 'Visiting & Admission', items: [
      { featured: true, q: 'What are the visiting hours?', a: 'General wards: 11:00 AM – 1:00 PM and 5:00 PM – 7:00 PM. ICU visits are allowed for one attendant at a time at 12:00 PM and 6:00 PM. Private rooms allow one attendant to stay overnight.' },
      { q: 'What should I bring for admission?', a: 'A photo ID, insurance card or TPA details, previous medical records, current medicines and comfortable clothing. We provide toiletries and meals.' },
      { q: 'Is parking available?', a: 'Yes, free multi-level parking for patients and visitors with dedicated spaces for emergency drop-off and differently-abled visitors.' },
    ] },
    { id: 'emergency', title: 'Emergency', items: [
      { q: 'Is the emergency department open 24×7?', a: 'Yes — our emergency and trauma unit is staffed round the clock by emergency physicians, with ICU, cath-lab and operation theatres on standby. Call {phone} or walk straight in.' },
      { q: 'How do I call an ambulance?', a: 'Call {phone} and choose option 1. Our GPS-tracked ALS ambulances cover Delhi NCR, and paramedics share your vitals with the ER team on the way.' },
    ] },
  ],
  testimonials: [
    { name: 'Sunita Agarwal', place: 'Patna', text: 'Booked a cardiology slot on my phone in under a minute. No queue at the counter, the doctor already had my old reports. Felt genuinely looked after.', tag: 'Cardiology' },
    { name: 'Rakesh Yadav', place: 'Dwarka, Delhi', text: 'My father was admitted at 2 AM. The emergency team was calm and quick, and the cashless approval came through before morning.', tag: 'Emergency' },
    { name: 'Priyanka Sinha', place: 'Gurugram', text: 'Dr. Ananya is wonderful with kids. Prescriptions and vaccination reminders arrive on my phone — I never lose a paper again.', tag: 'Pediatrics' },
    { name: 'Mohammed Irfan', place: 'Noida', text: 'Knee replacement recovery went smoother than I imagined. Physiotherapy schedule, bills and reports — all in one app.', tag: 'Orthopedics' },
    { name: 'Anjali Deshmukh', place: 'Janakpuri', text: 'Transparent bill with every line item. No surprises at discharge. That alone made me trust DC Hospital.', tag: 'Billing' },
    { name: 'Vivek Chauhan', place: 'Faridabad', text: 'The executive health check was done in one morning, and my report with doctor notes was online the same evening.', tag: 'Health check' },
    { name: 'Farzana Begum', place: 'Old Delhi', text: 'The staff explained everything patiently in Hindi. The rooms are spotless and quiet — more like a hotel than a hospital.', tag: 'In-patient care' },
    { name: 'Karthik Subramanian', place: 'Vasant Kunj', text: 'Rescheduled my neuro consult twice from the app with zero hassle. Lab reports showed up before I even reached home.', tag: 'Neurology' },
  ],
}

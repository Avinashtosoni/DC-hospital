// Public doctor directory. Names/specialities mirror the demo seed so the site and the app feel like one hospital.

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
export const WEEK: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export type SiteDoctor = {
  slug: string
  name: string
  role: string
  dept: string
  service: string // service slug
  img: string
  exp: number
  rating: number
  reviews: number
  fee: number
  days: Day[]
  time: string
  langs: string[]
  quals: string
  bio: string
  education: { degree: string; inst: string; year: number }[]
  expertise: string[]
  awards?: string[]
  featured?: boolean
  onLeave?: boolean
}

export const DOCTORS: SiteDoctor[] = [
  {
    slug: 'arjun-mehta', name: 'Dr. Arjun Mehta', role: 'Interventional Cardiologist', dept: 'Cardiology', service: 'cardiology', img: '/landing/doc-arjun.webp',
    exp: 14, rating: 4.9, reviews: 1284, fee: 1200, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], time: '10:00 AM – 5:00 PM', langs: ['English', 'Hindi', 'Gujarati'],
    quals: 'MBBS, MD, DM (Cardiology)', featured: true,
    bio: 'Dr. Arjun Mehta has performed over 3,000 angioplasties and leads our 24×7 primary angioplasty programme. He is known for explaining complex heart conditions in simple words and for his focus on preventive cardiology.',
    education: [{ degree: 'DM Cardiology', inst: 'AIIMS, New Delhi', year: 2012 }, { degree: 'MD Medicine', inst: 'Maulana Azad Medical College', year: 2009 }, { degree: 'MBBS', inst: 'Maulana Azad Medical College', year: 2005 }],
    expertise: ['Primary angioplasty', 'Complex PCI', 'Heart failure', 'Preventive cardiology', 'Hypertension'],
    awards: ['Best Young Cardiologist — Delhi Medical Association, 2019'],
  },
  {
    slug: 'kavita-rao', name: 'Dr. Kavita Rao', role: 'Neurologist', dept: 'Neurology', service: 'neurology', img: '/landing/doc-kavita.webp',
    exp: 11, rating: 4.9, reviews: 962, fee: 1100, days: ['Mon', 'Wed', 'Fri', 'Sat'], time: '9:00 AM – 2:00 PM', langs: ['English', 'Hindi', 'Kannada'],
    quals: 'MBBS, MD, DM (Neurology)', featured: true,
    bio: 'Dr. Kavita Rao heads our stroke unit and epilepsy clinic. She has a special interest in headache medicine and women’s neurology, and is passionate about stroke awareness in the community.',
    education: [{ degree: 'DM Neurology', inst: 'NIMHANS, Bengaluru', year: 2015 }, { degree: 'MD Medicine', inst: 'Kasturba Medical College, Manipal', year: 2011 }, { degree: 'MBBS', inst: 'Bangalore Medical College', year: 2007 }],
    expertise: ['Acute stroke', 'Epilepsy', 'Migraine', 'Movement disorders', 'Neuropathy'],
  },
  {
    slug: 'sameer-khan', name: 'Dr. Sameer Khan', role: 'Orthopedic Surgeon', dept: 'Orthopedics', service: 'orthopedics', img: '/landing/doc-sameer.webp',
    exp: 9, rating: 4.8, reviews: 874, fee: 900, days: ['Tue', 'Thu', 'Sat'], time: '2:00 PM – 8:00 PM', langs: ['English', 'Hindi', 'Urdu'],
    quals: 'MBBS, MS (Ortho), Fellowship Arthroplasty', featured: true,
    bio: 'Dr. Sameer Khan specialises in knee and hip replacement and sports injuries. His patients typically walk on the day of surgery thanks to rapid-recovery protocols.',
    education: [{ degree: 'Fellowship Arthroplasty', inst: 'Endo Klinik, Hamburg', year: 2018 }, { degree: 'MS Orthopaedics', inst: 'KEM Hospital, Mumbai', year: 2016 }, { degree: 'MBBS', inst: 'Grant Medical College, Mumbai', year: 2012 }],
    expertise: ['Knee replacement', 'Hip replacement', 'ACL reconstruction', 'Sports injuries', 'Fracture care'],
  },
  {
    slug: 'ananya-iyer', name: 'Dr. Ananya Iyer', role: 'Pediatrician', dept: 'Pediatrics', service: 'pediatrics', img: '/landing/doc-ananya.webp',
    exp: 8, rating: 5.0, reviews: 1531, fee: 700, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], time: '9:00 AM – 2:00 PM', langs: ['English', 'Hindi', 'Tamil'],
    quals: 'MBBS, MD (Pediatrics)', featured: true,
    bio: 'Dr. Ananya Iyer is loved by children and parents alike for her gentle, playful approach. She runs our well-baby and vaccination clinic and has a special interest in childhood asthma and nutrition.',
    education: [{ degree: 'MD Pediatrics', inst: 'JIPMER, Puducherry', year: 2017 }, { degree: 'MBBS', inst: 'Madras Medical College', year: 2013 }],
    expertise: ['Newborn care', 'Vaccination', 'Childhood asthma', 'Growth & nutrition', 'Adolescent health'],
  },
  {
    slug: 'vikram-singh', name: 'Dr. Vikram Singh', role: 'Senior Physician & Medical Director', dept: 'General Medicine', service: 'general-medicine', img: '/landing/doc-vikram.webp',
    exp: 16, rating: 4.9, reviews: 2140, fee: 600, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], time: '8:00 AM – 4:00 PM', langs: ['English', 'Hindi', 'Punjabi'],
    quals: 'MBBS, MD (Medicine)',
    bio: 'Dr. Vikram Singh is our Medical Director and a trusted family physician for thousands of Delhi households. He believes good medicine starts with listening.',
    education: [{ degree: 'MD Internal Medicine', inst: 'PGIMER, Chandigarh', year: 2010 }, { degree: 'MBBS', inst: 'Government Medical College, Patiala', year: 2006 }],
    expertise: ['Fever & infections', 'Hypertension', 'Thyroid', 'Preventive health', 'Geriatric care'],
    awards: ['Excellence in Clinical Care — IMA Delhi, 2021'],
  },
  {
    slug: 'meera-nair', name: 'Dr. Meera Nair', role: 'Obstetrician & Gynecologist', dept: 'Gynecology & Obstetrics', service: 'gynecology-obstetrics', img: '/landing/doc-meera.webp',
    exp: 12, rating: 4.9, reviews: 1410, fee: 900, days: ['Mon', 'Tue', 'Thu', 'Fri', 'Sat'], time: '10:00 AM – 5:00 PM', langs: ['English', 'Hindi', 'Malayalam'],
    quals: 'MBBS, MS (OBG), FMAS',
    bio: 'Dr. Meera Nair has guided over 4,000 mothers through safe deliveries. She specialises in high-risk pregnancy and minimally invasive gynaecological surgery.',
    education: [{ degree: 'MS Obstetrics & Gynaecology', inst: 'Lady Hardinge Medical College', year: 2014 }, { degree: 'MBBS', inst: 'Government Medical College, Thiruvananthapuram', year: 2010 }],
    expertise: ['High-risk pregnancy', 'Painless delivery', 'Laparoscopic surgery', 'PCOS', 'Menopause care'],
  },
  {
    slug: 'rajesh-gupta', name: 'Dr. Rajesh Gupta', role: 'Dermatologist', dept: 'Dermatology', service: 'dermatology', img: '/landing/doc-rajesh.webp',
    exp: 7, rating: 4.8, reviews: 690, fee: 800, days: ['Mon', 'Wed', 'Fri', 'Sat'], time: '11:00 AM – 7:00 PM', langs: ['English', 'Hindi'],
    quals: 'MBBS, MD (Dermatology)',
    bio: 'Dr. Rajesh Gupta combines medical and aesthetic dermatology with an honest, evidence-first approach — no unnecessary procedures, just results.',
    education: [{ degree: 'MD Dermatology', inst: 'Banaras Hindu University', year: 2019 }, { degree: 'MBBS', inst: 'King George’s Medical University', year: 2015 }],
    expertise: ['Acne & scars', 'Hair loss', 'Psoriasis', 'Laser treatments', 'Pigmentation'],
  },
  {
    slug: 'sneha-patil', name: 'Dr. Sneha Patil', role: 'ENT Surgeon', dept: 'ENT', service: 'ent', img: '/landing/doc-sneha.webp',
    exp: 6, rating: 4.8, reviews: 512, fee: 700, days: ['Tue', 'Thu', 'Sat'], time: '10:00 AM – 5:00 PM', langs: ['English', 'Hindi', 'Marathi'],
    quals: 'MBBS, MS (ENT)', onLeave: true,
    bio: 'Dr. Sneha Patil is an endoscopic sinus and ear surgeon with a keen interest in pediatric ENT and sleep medicine.',
    education: [{ degree: 'MS ENT', inst: 'B. J. Medical College, Pune', year: 2020 }, { degree: 'MBBS', inst: 'Government Medical College, Nagpur', year: 2016 }],
    expertise: ['Sinus surgery', 'Ear surgery', 'Pediatric ENT', 'Snoring & sleep apnoea'],
  },
  {
    slug: 'harish-menon', name: 'Dr. Harish Menon', role: 'Chief Radiologist', dept: 'Radiology', service: 'radiology', img: '/landing/doc-harish.webp',
    exp: 13, rating: 4.8, reviews: 430, fee: 1000, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], time: '9:00 AM – 5:00 PM', langs: ['English', 'Hindi', 'Malayalam'],
    quals: 'MBBS, MD (Radiology)',
    bio: 'Dr. Harish Menon leads our imaging department and specialises in neuro and musculoskeletal imaging and image-guided interventions.',
    education: [{ degree: 'MD Radiodiagnosis', inst: 'CMC Vellore', year: 2013 }, { degree: 'MBBS', inst: 'Calicut Medical College', year: 2009 }],
    expertise: ['MRI', 'CT angiography', 'Musculoskeletal imaging', 'Image-guided biopsy'],
  },
  {
    slug: 'farah-siddiqui', name: 'Dr. Farah Siddiqui', role: 'Emergency Physician', dept: 'Emergency', service: 'emergency', img: '/landing/doc-farah.webp',
    exp: 5, rating: 4.9, reviews: 388, fee: 800, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], time: 'Rotating 24×7 shifts', langs: ['English', 'Hindi', 'Urdu'],
    quals: 'MBBS, MEM',
    bio: 'Dr. Farah Siddiqui is part of our round-the-clock emergency team, trained in advanced trauma and cardiac life support.',
    education: [{ degree: 'MEM Emergency Medicine', inst: 'AIIMS, New Delhi', year: 2021 }, { degree: 'MBBS', inst: 'Jamia Hamdard (HIMSR)', year: 2017 }],
    expertise: ['Trauma care', 'Cardiac emergencies', 'Poisoning', 'Critical care'],
  },
  {
    slug: 'nikhil-joshi', name: 'Dr. Nikhil Joshi', role: 'Head — Cardiac Surgery', dept: 'Cardiology', service: 'cardiology', img: '/landing/doc-nikhil.webp',
    exp: 18, rating: 4.9, reviews: 980, fee: 1500, days: ['Mon', 'Wed', 'Fri'], time: '11:00 AM – 3:00 PM', langs: ['English', 'Hindi', 'Marathi'],
    quals: 'MBBS, MS, MCh (CTVS)',
    bio: 'Dr. Nikhil Joshi has performed more than 5,000 open-heart surgeries including beating-heart bypass and valve repairs, with outcomes on par with global benchmarks.',
    education: [{ degree: 'MCh Cardiothoracic Surgery', inst: 'AIIMS, New Delhi', year: 2008 }, { degree: 'MS General Surgery', inst: 'AFMC, Pune', year: 2004 }, { degree: 'MBBS', inst: 'AFMC, Pune', year: 2000 }],
    expertise: ['Beating-heart bypass', 'Valve repair', 'Minimally invasive cardiac surgery', 'Aortic surgery'],
    awards: ['Lifetime Achievement — Indian Association of CTVS, 2024'],
  },
  {
    slug: 'pooja-bansal', name: 'Dr. Pooja Bansal', role: 'Diabetologist', dept: 'General Medicine', service: 'diabetology', img: '/landing/doc-pooja.webp',
    exp: 10, rating: 4.9, reviews: 1120, fee: 700, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], time: '9:00 AM – 1:00 PM', langs: ['English', 'Hindi'],
    quals: 'MBBS, MD, Fellowship Diabetology',
    bio: 'Dr. Pooja Bansal runs our diabetes reversal programme, combining medication, nutrition and habit coaching to help patients cut medicines safely.',
    education: [{ degree: 'Fellowship Diabetology', inst: 'Madras Diabetes Research Foundation', year: 2017 }, { degree: 'MD Medicine', inst: 'University College of Medical Sciences, Delhi', year: 2015 }, { degree: 'MBBS', inst: 'UCMS, Delhi', year: 2011 }],
    expertise: ['Type 2 diabetes', 'Insulin therapy', 'Thyroid', 'Obesity', 'Gestational diabetes'],
  },
  {
    slug: 'aditya-kulkarni', name: 'Dr. Aditya Kulkarni', role: 'Spine Surgeon', dept: 'Orthopedics', service: 'orthopedics', img: '/landing/doc-aditya.webp',
    exp: 12, rating: 4.8, reviews: 760, fee: 1100, days: ['Mon', 'Wed', 'Thu', 'Sat'], time: '10:00 AM – 4:00 PM', langs: ['English', 'Hindi', 'Marathi'],
    quals: 'MBBS, MS (Ortho), Fellowship Spine',
    bio: 'Dr. Aditya Kulkarni is a minimally invasive spine surgeon who believes most back pain can be treated without surgery — and when surgery is needed, it should be as small as possible.',
    education: [{ degree: 'Fellowship Spine Surgery', inst: 'National University Hospital, Singapore', year: 2015 }, { degree: 'MS Orthopaedics', inst: 'Seth GS Medical College, Mumbai', year: 2013 }, { degree: 'MBBS', inst: 'BJ Medical College, Pune', year: 2009 }],
    expertise: ['Slipped disc', 'Endoscopic spine surgery', 'Scoliosis', 'Spinal trauma'],
  },
  {
    slug: 'lakshmi-reddy', name: 'Dr. Lakshmi Reddy', role: 'Head — Laboratory Services', dept: 'Pathology', service: 'pathology', img: '/landing/doc-lakshmi.webp',
    exp: 15, rating: 4.8, reviews: 310, fee: 500, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], time: '8:00 AM – 2:00 PM', langs: ['English', 'Hindi', 'Telugu'],
    quals: 'MBBS, MD (Pathology)',
    bio: 'Dr. Lakshmi Reddy oversees quality across our 24×7 laboratory, with expertise in haematopathology and cancer diagnostics.',
    education: [{ degree: 'MD Pathology', inst: 'Osmania Medical College', year: 2011 }, { degree: 'MBBS', inst: 'Gandhi Medical College, Hyderabad', year: 2007 }],
    expertise: ['Haematopathology', 'Cytology', 'Cancer diagnostics', 'Lab quality systems'],
  },
]

export const doctorBySlug = (slug?: string) => DOCTORS.find((d) => d.slug === slug)
export const doctorsForService = (slug: string) => DOCTORS.filter((d) => d.service === slug)
export const DEPARTMENTS = Array.from(new Set(DOCTORS.map((d) => d.dept)))

/** Human label for the next day this doctor consults, relative to today. */
export function nextAvailable(d: SiteDoctor, from = new Date()): string {
  if (d.onLeave) return 'On leave'
  for (let i = 0; i < 7; i++) {
    const dt = new Date(from); dt.setDate(from.getDate() + i)
    const dow = WEEK[(dt.getDay() + 6) % 7]
    if (d.days.includes(dow)) {
      if (i === 0) return 'Today'
      if (i === 1) return 'Tomorrow'
      return dt.toLocaleDateString('en-IN', { weekday: 'long' })
    }
  }
  return 'By appointment'
}

export const REVIEW_POOL = [
  { name: 'Ramesh K.', text: 'Explained everything patiently and never rushed me. I finally understand my condition.', rating: 5 },
  { name: 'Shalini M.', text: 'Very knowledgeable and kind. The follow-up on the app was super convenient.', rating: 5 },
  { name: 'Ajay T.', text: 'Waited less than 10 minutes. Doctor was thorough and gave clear advice.', rating: 5 },
  { name: 'Neelam S.', text: 'Excellent experience — the treatment worked and the staff were caring.', rating: 4 },
  { name: 'Imran A.', text: 'Honest advice, no unnecessary tests. Highly recommend to my family.', rating: 5 },
  { name: 'Deepa R.', text: 'Calm, confident and reassuring. Made a stressful time much easier.', rating: 5 },
]

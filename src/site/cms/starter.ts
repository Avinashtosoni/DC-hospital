import { DEFAULT_CONTENT } from './defaults'
import type { SiteContent } from './types'

/**
 * Starter website for every hospital EXCEPT the primary one (multi-hospital "Hospital Comrade" installs).
 *
 * DEFAULT_CONTENT is DC Hospital's own website — its history, founder, team, patient numbers, reviews, map pin and
 * Delhi-specific texts. A newly onboarded hospital must never show those claims as its own, so it starts from this
 * neutral copy instead: same layout and design, texts use the {name}/{phone}/… tokens, and the sections that only
 * make sense with real facts (numbers, reviews, milestones, leadership, accreditations, doctor profiles, packages) are
 * empty or switched off until the hospital fills them in from the CMS.
 *
 * Anything a hospital saves in the CMS always wins over these values (see mergeRows).
 */
const D = DEFAULT_CONTENT

export const STARTER_CONTENT: SiteContent = {
  ...D,

  // ---------------------------------------------------------------- collections
  // services stay (the booking wizard maps doctors' departments onto them) but without numbers/equipment claims
  services: D.services.map((s) => ({
    ...s,
    summary: s.summary.replace(/ and NICU/, ''),
    description: [s.summary.replace(/ and NICU/, '')],
    treatments: s.treatments.filter((t) => !/NICU/.test(t)),
    technology: [], stats: [], hours: '',
    // a clinic may not run an emergency department — the hospital switches it on in the CMS if it does
    ...(s.slug === 'emergency' ? { hidden: true } : {}),
  })),
  support: [],
  doctors: [],
  packages: D.packages,
  faqs: D.faqs
    .filter((g) => g.id !== 'visiting')
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !/30\+ insurers|EMI|video consultations|lab reports take|ambulance|emergency department/i.test(i.q + i.a)),
    }))
    .filter((g) => g.items.length),
  testimonials: [],

  // ---------------------------------------------------------------- settings
  settings: {
    ...D.settings,
    name: 'Our hospital',
    tagline: 'Care you can trust',
    about: '{name} — consultations, diagnostics and care for the whole family, with online booking and digital records.',
    address: '', phone: '', appointmentsPhone: '', whatsapp: '', email: '', siteUrl: '',
    topBar: { enabled: false, text: 'Book your appointment online in 30 seconds' },
    emergency: { title: 'Need help?', text: 'Call us or walk in during working hours — our team is happy to help.' },
    hours: [{ label: 'OPD consultations', value: 'Mon–Sat · 9 AM – 6 PM', highlight: false }],
    directions: [],
    map: { embedUrl: '', directionsUrl: '' },
    cta: { ...D.settings.cta, badge: 'Online booking open' },
    pages: { about: true, services: true, doctors: false, packages: false, contact: true, faq: true },
    seoDescription: '{name} — book appointments online, get digital prescriptions and reports on your phone.',
    brand: { ...D.settings.brand, shortName: '' },
    portal: { ...D.settings.portal, showDemoLogins: false },
    booking: { ...D.settings.booking, showDemoOtp: false },
    billing: { ...D.settings.billing, legalName: '', gstin: '', regNo: '', pan: '', upiId: '' },
  },

  // ---------------------------------------------------------------- home
  home: {
    ...D.home,
    seo: { title: 'Book appointments online', description: '{name} — book appointments online, get digital prescriptions and reports on your phone.' },
    sections: { stats: false, features: true, doctors: false, why: false, testimonials: false, packages: false, faq: true, cta: true },
    hero: {
      ...D.home.hero,
      subtitle: 'Experienced doctors and a caring team — with appointments in 30 seconds, digital prescriptions and reports right on your phone.',
      imageAlt: 'Doctor at {name} holding a tablet',
      rating: '',
      trust: '',
    },
    stats: [],
    insurersTitle: '',
    insurers: [],
    featureCards: [
      { title: 'Book in 30 seconds', text: 'See real-time availability for every doctor, pick a slot and you’re done. Try it right here.' },
      { title: 'Digital prescriptions', text: 'Clear dosage, timing and duration — always on your phone, easy to share with any pharmacy.' },
      { title: 'Reports on your phone', text: 'Lab results are added to your patient portal as soon as they are ready.' },
      { title: 'Reminders that help', text: 'Appointment confirmations and reminders on SMS or WhatsApp, so you never miss a visit.' },
      { title: 'Clear, itemised billing', text: 'Every charge explained upfront. Pay by UPI, card or cash — and keep every bill in your portal.' },
    ],
    doctors: { ...D.home.doctors, lead: 'Experienced doctors who take time to explain, not just prescribe.' },
    why: { ...D.home.why, eyebrow: 'Why patients choose us', waitNote: '', badgeTitle: 'Safe, clean care', badgeText: 'Infection-safe protocols' },
    benefits: D.home.benefits.map((b) => (b.icon === 'CreditCard' ? { ...b, text: 'Transparent pricing and itemised bills — no surprises.' } : b)),
    testimonials: { ...D.home.testimonials, title: 'What our *patients* say', reviews: '' },
    packages: { ...D.home.packages, note: 'Prices inclusive of applicable taxes' },
    faq: { ...D.home.faq, lead: 'Can’t find what you’re looking for? Call or message our team.' },
  },

  // ---------------------------------------------------------------- about
  about: {
    ...D.about,
    seo: { title: 'About us', description: 'About {name} — our care, our team and our values.' },
    hero: {
      eyebrow: 'About us',
      title: 'Healthcare with a *human heart*',
      lead: '{name} combines experienced doctors, modern technology and genuine warmth to deliver care that families trust.',
      badgeTitle: '', badgeText: '',
    },
    mission: {
      ...D.about.mission,
      quote: '', quoteBy: '',
      items: D.about.mission.items.map((i) => (i.icon === 'Eye' ? { ...i, text: 'To be the family hospital our community trusts, where technology makes care simpler and kinder for everyone.' } : i)),
    },
    journey: { ...D.about.journey, title: 'Our *journey*', milestones: [] },
    values: { ...D.about.values, lead: 'The principles every member of our team lives by.' },
    leadership: { ...D.about.leadership, people: [] },
    accreditations: { ...D.about.accreditations, items: [] },
    cta: { title: 'Experience care that *feels different.*', lead: 'Book your visit at {name} in 30 seconds.' },
  },

  // ---------------------------------------------------------------- pages
  servicesPage: {
    ...D.servicesPage,
    seo: { title: 'Medical services & specialities', description: 'Explore the specialities at {name} and book a consultation online.' },
    hero: { ...D.servicesPage.hero, eyebrow: 'Our specialities', lead: 'From everyday fevers to ongoing conditions, our doctors work together so you get the right care — the first time.' },
    featured: { eyebrow: 'Specialities', title: 'Care for *every need*' },
    cta: { ...D.servicesPage.cta, badge: 'Free guidance', lead: 'Call our team at {phone} — we’ll help you choose the right doctor.' },
    detailFaqs: D.servicesPage.detailFaqs.filter((f) => !/insurers|24×7/.test(f.a)),
  },
  doctorsPage: {
    ...D.doctorsPage,
    seo: { title: 'Find a doctor', description: 'Find a doctor at {name} and book an appointment online.' },
    hero: { ...D.doctorsPage.hero, eyebrow: 'Our doctors' },
  },
  packagesPage: {
    ...D.packagesPage,
    seo: { title: 'Health check-up packages', description: 'Preventive health check-up packages at {name}.' },
    homeCollection: { ...D.packagesPage.homeCollection, text: 'Ask our team about home sample collection in your area.' },
    faqs: D.packagesPage.faqs.filter((f) => !/insurers|Delhi/.test(f.a)),
  },
  contactPage: {
    ...D.contactPage,
    seo: { title: 'Contact us', description: 'Reach {name} at {phone}. Visit us at {address}, or send us a message online.' },
    successText: 'Your message has reached our team. We’ll get back to you soon.',
  },
  faqPage: {
    ...D.faqPage,
    seo: { title: 'Frequently asked questions', description: 'Answers about appointments, billing, reports and visiting {name}.' },
  },
  legal: {
    privacy: D.legal.privacy,
    terms: {
      ...D.legal.terms,
      sections: D.legal.terms.sections.map((s) => (s.h === 'Governing law'
        ? { ...s, p: ['These terms are governed by the laws of India, and the competent courts at the place where {name} is located shall have exclusive jurisdiction.'] }
        : s)),
    },
  },
}

/** the code defaults for a hospital's website: DC Hospital's own content for the primary hospital, the neutral starter otherwise */
export const baseContent = (primary: boolean): SiteContent => (primary ? DEFAULT_CONTENT : STARTER_CONTENT)

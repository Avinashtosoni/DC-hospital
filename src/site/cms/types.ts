/**
 * Content model for the public website. Every top-level key of `SiteContent` is stored as ONE row in the
 * `site_content` table (key → jsonb) and edited from the dashboard CMS. Code defaults live in ./defaults.ts
 * and are used for any key that has never been saved (or if the database can't be reached).
 *
 * Text fields support:
 *   *word*        → highlighted (gradient) text in headings
 *   {phone} {appointments} {whatsapp} {email} {address} {name}  → replaced with the values from Site settings
 */

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

export interface Seo { title: string; description: string }
export interface Heading { eyebrow: string; title: string; lead: string }
export interface IconItem { icon: string; title: string; text: string }
export interface Cta { badge: string; title: string; lead: string }
export interface FaqItem { q: string; a: string }
export interface Stat { value: number; suffix: string; label: string; format: 'plain' | 'lakh'; decimals: number }

// ------------------------------------------------------------------ settings
export interface SiteSettings {
  name: string
  tagline: string
  about: string
  address: string
  phone: string
  appointmentsPhone: string
  whatsapp: string
  email: string
  topBar: { enabled: boolean; text: string }
  emergency: { title: string; text: string }
  hours: { label: string; value: string; highlight: boolean }[]
  directions: { icon: string; text: string }[]
  map: { embedUrl: string; directionsUrl: string }
  socials: { platform: 'Instagram' | 'Facebook' | 'X' | 'LinkedIn' | 'YouTube'; url: string }[]
  cta: Cta & { note: string }
  pages: { about: boolean; services: boolean; doctors: boolean; packages: boolean; contact: boolean; faq: boolean }
  seoDescription: string
  /** Logo, favicon and names used across the website, dashboard, login and documents. */
  brand: {
    /** short name for tight spaces (mobile header, SMS signature) */
    shortName: string
    /** line under the name in the dashboard sidebar */
    appSubtitle: string
    /** square logo / mark (PNG, SVG or WebP). Empty = built-in icon */
    logoUrl: string
    /** browser-tab icon. Empty = logo */
    faviconUrl: string
    /** show the hospital name next to the logo (turn off if the logo already contains the name) */
    showName: boolean
  }
  /** Sign-in / patient portal behaviour. */
  portal: {
    /** allow patients to create their own portal account on /register */
    allowSignup: boolean
    /** show the one-click demo accounts on the login page (turn OFF in production) */
    showDemoLogins: boolean
    /** optional message on the sign-in page */
    loginNotice: string
  }
  /** Online appointment booking from the public website (/book). */
  booking: {
    enabled: boolean
    /** how far ahead patients can book */
    advanceDays: number
    /** earliest bookable slot today = now + this many minutes */
    minNoticeMinutes: number
    /** shown on the confirmation + invoice */
    payNote: string
    /** show the OTP on screen when no SMS gateway is connected (demo / testing only) */
    showDemoOtp: boolean
  }
  /** Letterhead + tax details printed on invoices / bills of supply. */
  billing: {
    legalName: string
    gstin: string
    regNo: string
    pan: string
    /** SAC code for services, e.g. 999312 (medical & dental services) */
    sac: string
    /** GST % applied to online consultation bookings (0 = exempt healthcare service) */
    gstRate: number
    exemptNote: string
    upiId: string
    footer: string
    signatory: string
  }
}

// ------------------------------------------------------------------ pages
export interface HomeContent {
  seo: Seo
  sections: { stats: boolean; features: boolean; doctors: boolean; why: boolean; testimonials: boolean; packages: boolean; faq: boolean; cta: boolean }
  hero: { badge: string; line1: string; line2: string; subtitle: string; image: string; imageAlt: string; rating: string; trust: string }
  stats: Stat[]
  insurersTitle: string
  insurers: string[]
  features: Heading
  featureCards: { title: string; text: string }[]
  doctors: Heading
  why: { eyebrow: string; title: string; image: string; waitValue: string; waitLabel: string; waitNote: string; badgeTitle: string; badgeText: string }
  benefits: IconItem[]
  steps: { eyebrow: string; title: string; items: { title: string; text: string }[] }
  testimonials: Heading & { reviews: string }
  packages: Heading & { note: string }
  faq: Heading
}

export interface AboutContent {
  seo: Seo
  hero: Heading & { badgeTitle: string; badgeText: string }
  mission: { eyebrow: string; title: string; image: string; quote: string; quoteBy: string; items: IconItem[] }
  journey: { eyebrow: string; title: string; milestones: { year: string; title: string; text: string }[] }
  values: Heading & { items: IconItem[] }
  leadership: { eyebrow: string; title: string; people: { name: string; role: string; image: string; quote: string }[] }
  accreditations: Heading & { items: { title: string; text: string }[] }
  cta: { title: string; lead: string }
}

export interface ServicesPage {
  seo: Seo
  hero: Heading
  featured: { eyebrow: string; title: string }
  support: Heading
  cta: Cta
  detailCta: { title: string; lead: string }
  detailFaqs: FaqItem[]
}

export interface DoctorsPage {
  seo: Seo
  hero: { eyebrow: string; title: string; lead: string }
  cta: Cta
}

export interface PackagesPage {
  seo: Seo
  hero: Heading
  compare: Heading
  day: Heading & { steps: { icon: string; time: string; title: string; text: string }[] }
  homeCollection: { title: string; text: string }
  faqTitle: { eyebrow: string; title: string }
  faqs: FaqItem[]
  cta: Cta
}

export interface ContactPage {
  seo: Seo
  hero: Heading
  formTitle: string
  formNote: string
  topics: string[]
  successText: string
}

export interface FaqPage { seo: Seo; hero: Heading }

export interface LegalDoc { title: string; lead: string; updated: string; sections: { h: string; p: string[] }[] }
export interface LegalContent { privacy: LegalDoc; terms: LegalDoc }

// ------------------------------------------------------------------ collections
export interface Service {
  slug: string
  name: string
  icon: string
  tagline: string
  summary: string
  description: string[]
  conditions: string[]
  treatments: string[]
  technology: string[]
  stats: { value: string; label: string }[]
  hours: string
  featured?: boolean
  hidden?: boolean
}

export interface SupportService { icon: string; title: string; text: string; hidden?: boolean }

export interface SiteDoctor {
  slug: string
  name: string
  role: string
  dept: string
  service: string
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
  awards: string[]
  featured?: boolean
  onLeave?: boolean
  hidden?: boolean
}

export interface Package {
  name: string
  blurb: string
  tests: number
  price: number
  couple: number
  popular?: boolean
  features: string[]
  hidden?: boolean
}
export interface PackagesContent {
  items: Package[]
  /** cells follow the order of `items`: "yes", "no"/"" or any short text (e.g. "TSH") */
  compare: { group: string; rows: { label: string; cells: string[] }[] }[]
}

export interface FaqGroup { id: string; title: string; items: (FaqItem & { featured?: boolean })[] }
export interface Testimonial { name: string; place: string; text: string; tag: string; hidden?: boolean }

// ------------------------------------------------------------------ root
export interface SiteContent {
  settings: SiteSettings
  home: HomeContent
  about: AboutContent
  servicesPage: ServicesPage
  doctorsPage: DoctorsPage
  packagesPage: PackagesPage
  contactPage: ContactPage
  faqPage: FaqPage
  legal: LegalContent
  services: Service[]
  support: SupportService[]
  doctors: SiteDoctor[]
  packages: PackagesContent
  faqs: FaqGroup[]
  testimonials: Testimonial[]
}

export type ContentKey = keyof SiteContent
export const CONTENT_KEYS: ContentKey[] = [
  'settings', 'home', 'about', 'servicesPage', 'doctorsPage', 'packagesPage', 'contactPage', 'faqPage', 'legal',
  'services', 'support', 'doctors', 'packages', 'faqs', 'testimonials',
]

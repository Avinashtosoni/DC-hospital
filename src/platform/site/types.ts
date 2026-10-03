/**
 * Content of the Hospital Comrade product site (PLATFORM_DOMAIN). Every page key is edited in the control panel →
 * Website and stored in `platform_content`; a key that was never published shows the defaults in ./defaults.ts.
 * Text fields may use *asterisks* to highlight words and {platform}, {company}, {email}, {phone}, {address},
 * {domain}, {grievance} tokens, which are filled in when the page is shown.
 */
export interface Seo { title: string; description: string; image?: string }
export interface Heading { eyebrow: string; title: string; lead: string }
export interface IconItem { icon: string; title: string; text: string }
export interface QA { q: string; a: string }
export interface Cta { title: string; lead: string; button: string; link: string }

export interface BrandContent {
  tagline: string
  logo: string
  email: string
  phone: string
  whatsapp: string
  address: string
  hours: string
  announcement: { enabled: boolean; text: string; link: string; linkText: string }
  social: { linkedin: string; x: string; facebook: string; instagram: string; youtube: string }
  footerText: string
}

export interface HomeContent {
  seo: Seo
  hero: { badge: string; title: string; lead: string; primary: string; secondary: string; note: string; image: string }
  stats: { value: string; label: string }[]
  roles: { title: string; items: { name: string; text: string }[] }
  highlights: Heading & { items: IconItem[] }
  steps: { items: { title: string; text: string }[] }
  website: Heading & { points: string[]; image: string }
  pricing: Heading
  testimonials: Heading & { items: { quote: string; name: string; role: string; photo: string }[] }
  faq: Heading & { items: QA[] }
  cta: Cta
}

export interface FeaturesContent {
  seo: Seo
  heading: Heading
  modules: { icon: string; title: string; summary: string; points: string[]; image: string }[]
  extras: Heading & { items: IconItem[] }
  cta: Cta
}

export interface PricingContent {
  seo: Seo
  heading: Heading
  note: string
  compare: { title: string; rows: { feature: string; clinic: string; hospital: string; enterprise: string }[] }
  addons: Heading & { items: { title: string; price: string; text: string }[] }
  faqs: QA[]
  cta: Cta
}

export interface SolutionsContent {
  seo: Seo
  heading: Heading
  items: { icon: string; title: string; lead: string; points: string[]; plan: string; image: string }[]
  cta: Cta
}

export interface SecurityContent {
  seo: Seo
  heading: Heading
  items: IconItem[]
  compliance: Heading & { points: string[] }
  note: string
  cta: Cta
}

export interface AboutContent {
  seo: Seo
  heading: Heading
  story: string[]
  image: string
  mission: { title: string; text: string }
  vision: { title: string; text: string }
  values: Heading & { items: IconItem[] }
  team: Heading & { items: { name: string; role: string; photo: string; bio: string }[] }
  cta: Cta
}

export interface ContactContent {
  seo: Seo
  heading: Heading
  formTitle: string
  thanks: string
  mapUrl: string
}

export interface FaqContent { seo: Seo; heading: Heading; groups: { title: string; items: QA[] }[]; cta: Cta }

export interface BlogContent { seo: Seo; heading: Heading; empty: string; cta: Cta }

export interface LegalDocContent {
  slug: string
  title: string
  short: string
  updated: string
  intro: string
  sections: { h: string; p: string[] }[]
  hidden?: boolean
}
export interface LegalContent { docs: LegalDocContent[] }

export interface PlatformSite {
  brand: BrandContent
  home: HomeContent
  features: FeaturesContent
  pricing: PricingContent
  solutions: SolutionsContent
  security: SecurityContent
  about: AboutContent
  contact: ContactContent
  faq: FaqContent
  blog: BlogContent
  legal: LegalContent
}
export type PageKey = keyof PlatformSite
export const PAGE_KEYS: PageKey[] = ['brand', 'home', 'features', 'pricing', 'solutions', 'security', 'about', 'contact', 'faq', 'blog', 'legal']

export interface PostSummary { slug: string; title: string; excerpt: string; cover: string | null; tags: string[]; author: string | null; published_at: string }
export interface Post extends PostSummary { body: string; status: 'draft' | 'published'; updated_at: string; seo: Partial<Seo> }

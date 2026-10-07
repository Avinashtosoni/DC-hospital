/**
 * Declarative editor schema for every website content key. The CMS renders forms from this, so adding a new
 * editable field is usually a one-line change here (plus the type in site/cms/types.ts and a default value).
 */
import type { LucideIcon } from 'lucide-react'
import {
  BookOpenText, CircleHelp, FileText, Globe, HeartPulse, House, Info, Mail, MessageSquareQuote, Package, Search, Settings2,
  Sparkles, Stethoscope, UsersRound,
} from 'lucide-react'
import type { ContentKey, SiteContent } from '../../site/cms/types'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Obj = Record<string, any>
export interface Ctx { site: SiteContent; root: any; /** steer the live preview to a page (null = section default) */ focus?: (path: string | null) => void }

interface Base { k: string; label: string; hint?: string; full?: boolean }
export type FieldDef =
  | (Base & { t: 'text' | 'url'; placeholder?: string })
  | (Base & { t: 'textarea'; rows?: number })
  | (Base & { t: 'rich'; multiline?: boolean })
  | (Base & { t: 'number'; step?: number; min?: number; max?: number })
  | (Base & { t: 'toggle' })
  | (Base & { t: 'image' })
  | (Base & { t: 'icon' })
  | (Base & { t: 'select'; options: string[] | ((c: Ctx) => { value: string; label: string }[]) })
  | (Base & { t: 'tags'; placeholder?: string })
  | (Base & { t: 'strings'; multiline?: boolean; addLabel?: string })
  | (Base & { t: 'days' })
  | (Base & { t: 'cells' })
  | (Base & { t: 'group'; fields: FieldDef[]; collapsed?: boolean })
  | (Base & {
    t: 'list'; item: FieldDef[]; title: (v: any, i: number) => string; subtitle?: (v: any) => string; thumb?: (v: any) => string | undefined
    newItem: (c: Ctx) => Obj; hideable?: boolean; fixed?: boolean; addLabel?: string
    /** public page of an item — the live preview follows the item being edited */
    preview?: (v: any) => string
  })

// ------------------------------------------------------------------ reusable bits
const RICH_HINT = 'Wrap words in *asterisks* to highlight them.'
const TOKEN_HINT = 'You can use {phone}, {email}, {address} or {name} — they are filled in from Site settings.'
const seo = (): FieldDef => ({
  k: 'seo', t: 'group', label: 'Search engine (SEO)', collapsed: true, fields: [
    { k: 'title', t: 'text', label: 'Page title', hint: 'Shown in the browser tab and Google. The hospital name is added automatically.', full: true },
    { k: 'description', t: 'textarea', label: 'Meta description', rows: 2, hint: 'About 150 characters. ' + TOKEN_HINT, full: true },
  ],
})
const heading = (k: string, label: string, extra: FieldDef[] = []): FieldDef => ({
  k, t: 'group', label, fields: [
    { k: 'eyebrow', t: 'text', label: 'Eyebrow (small label)' },
    { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
    { k: 'lead', t: 'textarea', label: 'Intro text', rows: 2, full: true },
    ...extra,
  ],
})
const cta = (k = 'cta', label = 'Call-to-action band'): FieldDef => ({
  k, t: 'group', label, fields: [
    { k: 'badge', t: 'text', label: 'Badge' },
    { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
    { k: 'lead', t: 'textarea', label: 'Text', rows: 2, full: true },
  ],
})
const iconItems = (k: string, label: string, noun: string): FieldDef => ({
  k, t: 'list', label, title: (v) => v.title || `Untitled ${noun}`, subtitle: (v) => v.text,
  newItem: () => ({ icon: 'Sparkles', title: `New ${noun}`, text: '' }), addLabel: `Add ${noun}`,
  item: [{ k: 'icon', t: 'icon', label: 'Icon' }, { k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
})
const faqList = (k: string, label: string, featured = false): FieldDef => ({
  k, t: 'list', label, title: (v) => v.q || 'New question', subtitle: (v) => v.a,
  newItem: () => ({ q: 'New question?', a: '' }), addLabel: 'Add question',
  item: [
    { k: 'q', t: 'text', label: 'Question', full: true },
    { k: 'a', t: 'textarea', label: 'Answer', rows: 3, full: true, hint: TOKEN_HINT },
    ...(featured ? [{ k: 'featured', t: 'toggle', label: 'Show on the home page' } as FieldDef] : []),
  ],
})
const legalDoc = (k: string, label: string): FieldDef => ({
  k, t: 'group', label, fields: [
    { k: 'title', t: 'text', label: 'Title' },
    { k: 'updated', t: 'text', label: 'Last updated', placeholder: '1 September 2026' },
    { k: 'lead', t: 'textarea', label: 'Intro', rows: 2, full: true },
    {
      k: 'sections', t: 'list', label: 'Sections', full: true, title: (v, i) => `${i + 1}. ${v.h || 'Untitled section'}`,
      newItem: () => ({ h: 'New section', p: [''] }), addLabel: 'Add section',
      item: [{ k: 'h', t: 'text', label: 'Heading', full: true }, { k: 'p', t: 'strings', label: 'Paragraphs', multiline: true, addLabel: 'Add paragraph', full: true }],
    },
  ],
})
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const uniqueSlug = (base: string, taken: string[]) => { let s = slugify(base) || 'item'; let n = 2; const b = s; while (taken.includes(s)) s = `${b}-${n++}`; return s }

// ------------------------------------------------------------------ sections
export interface Section {
  key: ContentKey
  label: string
  description: string
  icon: LucideIcon
  group: 'General' | 'Pages' | 'Collections'
  /** Public page shown in the live preview. */
  preview: string
  fields: FieldDef[]
}

export const SECTIONS: Section[] = [
  {
    key: 'settings', label: 'Site settings', group: 'General', icon: Settings2, preview: '/contact',
    description: 'Hospital name, contact details, opening hours, social links and which pages are visible.',
    fields: [
      {
        k: '', t: 'group', label: 'Identity', fields: [
          { k: 'name', t: 'text', label: 'Hospital name' },
          { k: 'tagline', t: 'text', label: 'Logo tagline', placeholder: 'Care · 24×7' },
          { k: 'about', t: 'textarea', label: 'Short description (footer)', rows: 2, full: true },
          { k: 'seoDescription', t: 'textarea', label: 'Default meta description', rows: 2, full: true },
        ],
      },
      {
        k: '', t: 'group', label: 'Contact details', fields: [
          { k: 'phone', t: 'text', label: 'Main / emergency phone' },
          { k: 'appointmentsPhone', t: 'text', label: 'Appointments phone' },
          { k: 'whatsapp', t: 'text', label: 'WhatsApp number' },
          { k: 'email', t: 'text', label: 'Email' },
          { k: 'address', t: 'textarea', label: 'Address', rows: 2, full: true },
        ],
      },
      {
        k: 'pages', t: 'group', label: 'Visible pages', hint: 'Switched-off pages disappear from menus and show “not found” to visitors.', fields: [
          { k: 'about', t: 'toggle', label: 'About us' },
          { k: 'services', t: 'toggle', label: 'Services & specialities' },
          { k: 'doctors', t: 'toggle', label: 'Find a doctor' },
          { k: 'packages', t: 'toggle', label: 'Health packages' },
          { k: 'contact', t: 'toggle', label: 'Contact' },
          { k: 'faq', t: 'toggle', label: 'FAQ' },
        ],
      },
      { k: 'topBar', t: 'group', label: 'Top announcement bar', fields: [{ k: 'enabled', t: 'toggle', label: 'Show the bar' }, { k: 'text', t: 'text', label: 'Text', full: true }] },
      { k: 'emergency', t: 'group', label: 'Emergency box', fields: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'text', label: 'Text' }] },
      {
        k: 'cta', t: 'group', label: 'Default call-to-action band', hint: 'Used at the bottom of pages unless a page sets its own.', fields: [
          { k: 'badge', t: 'text', label: 'Badge' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
          { k: 'lead', t: 'textarea', label: 'Text', rows: 2, full: true }, { k: 'note', t: 'text', label: 'Small print', full: true },
        ],
      },
      {
        k: 'hours', t: 'list', label: 'Opening hours', title: (v) => v.label || 'New row', subtitle: (v) => v.value, addLabel: 'Add row',
        newItem: () => ({ label: 'Department', value: 'Mon–Sat · 9 AM – 5 PM', highlight: false }),
        item: [{ k: 'label', t: 'text', label: 'Department' }, { k: 'value', t: 'text', label: 'Hours' }, { k: 'highlight', t: 'toggle', label: 'Highlight in green (e.g. 24×7)' }],
      },
      {
        k: 'directions', t: 'list', label: 'Getting here', title: (v) => v.text || 'New line', addLabel: 'Add line',
        newItem: () => ({ icon: 'MapPin', text: '' }), item: [{ k: 'icon', t: 'icon', label: 'Icon' }, { k: 'text', t: 'text', label: 'Text' }],
      },
      {
        k: 'map', t: 'group', label: 'Map', fields: [
          { k: 'embedUrl', t: 'url', label: 'Embed URL', full: true, hint: 'OpenStreetMap “Share → HTML” or Google Maps “Embed a map” src URL. Leave blank to hide.' },
          { k: 'directionsUrl', t: 'url', label: '“Get directions” link', full: true },
        ],
      },
      {
        k: 'booking', t: 'group', label: 'Online booking', collapsed: true,
        hint: 'Patients book real slots at /book. Availability comes from each doctor’s days, shift, leave and hospital holidays in the dashboard.',
        fields: [
          { k: 'enabled', t: 'toggle', label: 'Accept online bookings' },
          { k: 'advanceDays', t: 'number', label: 'Book up to (days ahead)', min: 1, max: 180 },
          { k: 'minNoticeMinutes', t: 'number', label: 'Minimum notice (minutes)', min: 0, max: 1440, step: 15 },
          { k: 'payNote', t: 'textarea', label: 'Payment note on the confirmation', rows: 2, full: true },
        ],
      },
      {
        k: 'billing', t: 'group', label: 'Billing, GST & letterhead', collapsed: true,
        hint: 'Printed on every invoice. Name, address, phone and email come from Identity / Contact details above.',
        fields: [
          { k: 'legalName', t: 'text', label: 'Registered (legal) name' },
          { k: 'gstin', t: 'text', label: 'GSTIN', placeholder: '07AAACD1234F1Z5' },
          { k: 'regNo', t: 'text', label: 'Clinical establishment reg. no.' },
          { k: 'pan', t: 'text', label: 'PAN' },
          { k: 'sac', t: 'text', label: 'SAC code (consultations)', placeholder: '999312' },
          { k: 'gstRate', t: 'number', label: 'GST % on online consultation bookings', min: 0, max: 28, hint: '0 = exempt healthcare service → a “Bill of Supply” is issued instead of a “Tax Invoice”.' },
          { k: 'exemptNote', t: 'textarea', label: 'Exemption note (when GST is 0)', rows: 2, full: true },
          { k: 'upiId', t: 'text', label: 'UPI ID for payments' },
          { k: 'signatory', t: 'text', label: 'Signatory line' },
          { k: 'footer', t: 'textarea', label: 'Invoice footer', rows: 2, full: true },
        ],
      },
      {
        k: 'socials', t: 'list', label: 'Social links', title: (v) => v.platform, subtitle: (v) => v.url || 'Hidden — no URL', addLabel: 'Add link',
        newItem: () => ({ platform: 'Instagram', url: '' }),
        item: [{ k: 'platform', t: 'select', label: 'Platform', options: ['Instagram', 'Facebook', 'X', 'LinkedIn', 'YouTube'] }, { k: 'url', t: 'url', label: 'Profile URL', hint: 'Leave blank to hide.' }],
      },
    ],
  },
  {
    key: 'home', label: 'Home page', group: 'Pages', icon: House, preview: '/welcome',
    description: 'Hero, statistics, feature cards, benefits and every section heading on the landing page.',
    fields: [
      seo(),
      {
        k: 'sections', t: 'group', label: 'Visible sections', fields: [
          { k: 'stats', t: 'toggle', label: 'Statistics & insurers' }, { k: 'features', t: 'toggle', label: 'Features' },
          { k: 'doctors', t: 'toggle', label: 'Featured doctors' }, { k: 'why', t: 'toggle', label: 'Why choose us' },
          { k: 'testimonials', t: 'toggle', label: 'Testimonials' }, { k: 'packages', t: 'toggle', label: 'Health packages' },
          { k: 'faq', t: 'toggle', label: 'FAQ' }, { k: 'cta', t: 'toggle', label: 'Call-to-action band' },
        ],
      },
      {
        k: 'hero', t: 'group', label: 'Hero', fields: [
          { k: 'badge', t: 'text', label: 'Badge', full: true },
          { k: 'line1', t: 'rich', label: 'Headline — line 1', hint: RICH_HINT },
          { k: 'line2', t: 'rich', label: 'Headline — line 2', hint: RICH_HINT },
          { k: 'subtitle', t: 'textarea', label: 'Subtitle', rows: 3, full: true },
          { k: 'image', t: 'image', label: 'Hero image' },
          { k: 'imageAlt', t: 'text', label: 'Image description (alt text)' },
          { k: 'rating', t: 'text', label: 'Rating', placeholder: '4.9/5' },
          { k: 'trust', t: 'rich', label: 'Trust line', hint: '*Asterisks* make text bold.' },
        ],
      },
      {
        k: 'stats', t: 'list', label: 'Statistics', title: (v) => `${v.value}${v.suffix} ${v.label}`, addLabel: 'Add statistic',
        newItem: () => ({ value: 100, suffix: '+', label: 'New statistic', format: 'plain', decimals: 0 }),
        item: [
          { k: 'value', t: 'number', label: 'Number', step: 0.1 }, { k: 'suffix', t: 'text', label: 'Suffix', placeholder: '+' },
          { k: 'label', t: 'text', label: 'Label' }, { k: 'format', t: 'select', label: 'Format', options: ['plain', 'lakh'], hint: '“lakh” shows 120000 as 1.2 lakh' },
          { k: 'decimals', t: 'number', label: 'Decimals', min: 0, max: 2 },
        ],
      },
      { k: 'insurersTitle', t: 'text', label: 'Insurers heading', full: true },
      { k: 'insurers', t: 'tags', label: 'Insurance partners', full: true, placeholder: 'Type a name and press Enter' },
      heading('features', 'Features — heading'),
      {
        k: 'featureCards', t: 'list', label: 'Feature cards', fixed: true, hint: 'The five cards of the feature grid, in order.',
        title: (v) => v.title, subtitle: (v) => v.text, newItem: () => ({ title: '', text: '' }),
        item: [{ k: 'title', t: 'text', label: 'Title', full: true }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
      },
      heading('doctors', 'Featured doctors — heading'),
      {
        k: 'why', t: 'group', label: 'Why choose us', fields: [
          { k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
          { k: 'image', t: 'image', label: 'Image', full: true },
          { k: 'waitLabel', t: 'text', label: 'Stat label' }, { k: 'waitValue', t: 'text', label: 'Stat value (minutes)' },
          { k: 'waitNote', t: 'text', label: 'Stat note' }, { k: 'badgeTitle', t: 'text', label: 'Badge title' }, { k: 'badgeText', t: 'text', label: 'Badge text' },
        ],
      },
      iconItems('benefits', 'Benefits', 'benefit'),
      {
        k: 'steps', t: 'group', label: 'How it works', fields: [
          { k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
          {
            k: 'items', t: 'list', label: 'Steps', full: true, title: (v, i) => `${i + 1}. ${v.title}`, addLabel: 'Add step',
            newItem: () => ({ title: 'New step', text: '' }), item: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
          },
        ],
      },
      heading('testimonials', 'Testimonials — heading', [{ k: 'reviews', t: 'rich', label: 'Reviews line', hint: '*Asterisks* make text bold.', full: true }]),
      heading('packages', 'Packages — heading', [{ k: 'note', t: 'text', label: 'Footnote', full: true }]),
      heading('faq', 'FAQ — heading'),
    ],
  },
  {
    key: 'about', label: 'About page', group: 'Pages', icon: Info, preview: '/about',
    description: 'Story, mission, milestones, values, leadership team and accreditations.',
    fields: [
      seo(),
      heading('hero', 'Hero', [{ k: 'badgeTitle', t: 'text', label: 'Badge title' }, { k: 'badgeText', t: 'text', label: 'Badge text' }]),
      {
        k: 'mission', t: 'group', label: 'Mission', fields: [
          { k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
          { k: 'image', t: 'image', label: 'Image', full: true },
          { k: 'quote', t: 'textarea', label: 'Quote', rows: 2 }, { k: 'quoteBy', t: 'text', label: 'Quote by' },
          iconItems('items', 'Mission cards', 'card'),
        ],
      },
      {
        k: 'journey', t: 'group', label: 'Journey', fields: [
          { k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
          {
            k: 'milestones', t: 'list', label: 'Milestones', full: true, title: (v) => `${v.year} — ${v.title}`, addLabel: 'Add milestone',
            newItem: () => ({ year: String(new Date().getFullYear()), title: 'New milestone', text: '' }),
            item: [{ k: 'year', t: 'text', label: 'Year', hint: 'A 4-digit year, or any word (e.g. “Today”)' }, { k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
          },
        ],
      },
      heading('values', 'Values', [iconItems('items', 'Values', 'value')]),
      {
        k: 'leadership', t: 'group', label: 'Leadership', fields: [
          { k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT },
          {
            k: 'people', t: 'list', label: 'People', full: true, title: (v) => v.name, subtitle: (v) => v.role, thumb: (v) => v.image, addLabel: 'Add person',
            newItem: () => ({ name: 'New person', role: '', image: '', quote: '' }),
            item: [
              { k: 'name', t: 'text', label: 'Name' }, { k: 'role', t: 'text', label: 'Role' },
              { k: 'image', t: 'image', label: 'Photo', hint: 'Leave empty to show initials with a quote.' }, { k: 'quote', t: 'textarea', label: 'Quote', rows: 2 },
            ],
          },
        ],
      },
      heading('accreditations', 'Accreditations', [{
        k: 'items', t: 'list', label: 'Certificates', full: true, title: (v) => v.title, subtitle: (v) => v.text, addLabel: 'Add certificate',
        newItem: () => ({ title: 'New certificate', text: '' }), item: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'text', label: 'Text' }],
      }]),
      { k: 'cta', t: 'group', label: 'Call-to-action band', fields: [{ k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT }, { k: 'lead', t: 'text', label: 'Text' }] },
    ],
  },
  {
    key: 'servicesPage', label: 'Services page', group: 'Pages', icon: Stethoscope, preview: '/services',
    description: 'Headings of the services overview and the shared parts of every speciality page.',
    fields: [
      seo(), heading('hero', 'Hero'),
      { k: 'featured', t: 'group', label: 'Signature programmes', hint: 'Shows the first 3 specialities marked “featured”.', fields: [{ k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT }] },
      heading('support', 'Support services — heading'),
      cta(),
      { k: 'detailCta', t: 'group', label: 'Speciality pages — call-to-action', hint: '{service} is replaced with the speciality name.', fields: [{ k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT }, { k: 'lead', t: 'text', label: 'Text' }] },
      { ...faqList('detailFaqs', 'Speciality pages — FAQs'), hint: 'Shown on every speciality page. {service} is replaced with the speciality name.' },
    ],
  },
  {
    key: 'doctorsPage', label: 'Find a doctor page', group: 'Pages', icon: Search, preview: '/find-a-doctor',
    description: 'Hero and call-to-action of the doctor directory.',
    fields: [
      seo(),
      { k: 'hero', t: 'group', label: 'Hero', hint: '{count} is replaced with the number of doctors.', fields: [{ k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT }, { k: 'lead', t: 'textarea', label: 'Intro text', rows: 2, full: true }] },
      cta(),
    ],
  },
  {
    key: 'packagesPage', label: 'Packages page', group: 'Pages', icon: Package, preview: '/packages',
    description: 'Hero, comparison heading, check-up day timeline and package FAQs.',
    fields: [
      seo(), heading('hero', 'Hero'), heading('compare', 'Comparison table — heading'),
      heading('day', 'Check-up day', [{
        k: 'steps', t: 'list', label: 'Timeline', full: true, title: (v) => `${v.time} · ${v.title}`, addLabel: 'Add step',
        newItem: () => ({ icon: 'Clock', time: '', title: 'New step', text: '' }),
        item: [{ k: 'icon', t: 'icon', label: 'Icon' }, { k: 'time', t: 'text', label: 'Time' }, { k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }],
      }]),
      { k: 'homeCollection', t: 'group', label: 'Home collection note', hint: 'Clear the title to hide it.', fields: [{ k: 'title', t: 'text', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Text', rows: 2, full: true }] },
      { k: 'faqTitle', t: 'group', label: 'FAQ heading', fields: [{ k: 'eyebrow', t: 'text', label: 'Eyebrow' }, { k: 'title', t: 'rich', label: 'Heading', hint: RICH_HINT }] },
      faqList('faqs', 'Package FAQs'),
      cta(),
    ],
  },
  {
    key: 'contactPage', label: 'Contact page', group: 'Pages', icon: Mail, preview: '/contact',
    description: 'Hero, form texts and enquiry topics. Phone numbers, hours and map live in Site settings.',
    fields: [
      seo(), heading('hero', 'Hero'),
      {
        k: '', t: 'group', label: 'Enquiry form', fields: [
          { k: 'formTitle', t: 'text', label: 'Form title' }, { k: 'formNote', t: 'text', label: 'Form note', hint: TOKEN_HINT },
          { k: 'topics', t: 'tags', label: 'Topics', full: true, placeholder: 'Add a topic and press Enter' },
          { k: 'successText', t: 'textarea', label: 'Thank-you message', rows: 2, full: true },
        ],
      },
    ],
  },
  { key: 'faqPage', label: 'FAQ page', group: 'Pages', icon: CircleHelp, preview: '/faq', description: 'Hero of the help centre. Questions are edited under Collections → FAQs.', fields: [seo(), heading('hero', 'Hero')] },
  { key: 'legal', label: 'Privacy & terms', group: 'Pages', icon: FileText, preview: '/privacy', description: 'Privacy policy and terms of use.', fields: [legalDoc('privacy', 'Privacy policy'), legalDoc('terms', 'Terms of use')] },

  // ------------------------------------------------------------------ collections
  {
    key: 'services', label: 'Specialities', group: 'Collections', icon: HeartPulse, preview: '/services',
    description: 'Every speciality with its own page — conditions, treatments, technology and key numbers.',
    fields: [{
      k: '', t: 'list', label: 'Specialities', hideable: true, preview: (v) => `/services/${v.slug}`, title: (v) => v.name, subtitle: (v) => v.tagline, addLabel: 'Add speciality',
      newItem: ({ root }) => ({ slug: uniqueSlug('new-speciality', (root as Obj[]).map((s) => s.slug)), name: 'New speciality', icon: 'Stethoscope', tagline: '', summary: '', description: [''], conditions: [], treatments: [], technology: [], stats: [], hours: 'OPD Mon–Sat, 9:00 AM – 5:00 PM', featured: false }),
      item: [
        { k: 'name', t: 'text', label: 'Name' }, { k: 'slug', t: 'text', label: 'URL slug', hint: 'Page address: /services/slug — lowercase letters, numbers and dashes.' },
        { k: 'icon', t: 'icon', label: 'Icon' }, { k: 'tagline', t: 'text', label: 'Tagline' },
        { k: 'summary', t: 'textarea', label: 'Summary (cards)', rows: 2, full: true },
        { k: 'description', t: 'strings', label: 'Overview paragraphs', multiline: true, addLabel: 'Add paragraph', full: true },
        { k: 'conditions', t: 'tags', label: 'Conditions treated', full: true },
        { k: 'treatments', t: 'tags', label: 'Treatments & procedures', full: true },
        { k: 'technology', t: 'tags', label: 'Technology', full: true },
        {
          k: 'stats', t: 'list', label: 'Key numbers (3 recommended)', full: true, title: (v) => `${v.value} ${v.label}`, addLabel: 'Add number',
          newItem: () => ({ value: '100+', label: 'Label' }), item: [{ k: 'value', t: 'text', label: 'Value' }, { k: 'label', t: 'text', label: 'Label' }],
        },
        { k: 'hours', t: 'text', label: 'OPD hours', full: true },
        { k: 'featured', t: 'toggle', label: 'Featured (Signature programmes)' },
      ],
    }],
  },
  {
    key: 'support', label: 'Support services', group: 'Collections', icon: Sparkles, preview: '/services',
    description: 'Ambulance, pharmacy, ICU, home care and other services listed on the Services page.',
    fields: [{ ...iconItems('', 'Support services', 'service'), hideable: true } as FieldDef],
  },
  {
    key: 'doctors', label: 'Doctors', group: 'Collections', icon: UsersRound, preview: '/find-a-doctor',
    description: 'Public doctor profiles — photo, schedule, fees, education and expertise.',
    fields: [{
      k: '', t: 'list', label: 'Doctors', hideable: true, preview: (v) => `/find-a-doctor/${v.slug}`, title: (v) => v.name, subtitle: (v) => `${v.role}${v.onLeave ? ' · On leave' : ''}`, thumb: (v) => v.img, addLabel: 'Add doctor',
      newItem: ({ root, site }) => ({
        slug: uniqueSlug('new-doctor', (root as Obj[]).map((d) => d.slug)), name: 'Dr. New Doctor', role: 'Consultant', dept: site.services[0]?.name ?? 'General Medicine', service: site.services[0]?.slug ?? '',
        img: '', exp: 5, rating: 4.8, reviews: 0, fee: 800, days: ['Mon', 'Wed', 'Fri'], time: '10:00 AM – 2:00 PM', langs: ['English', 'Hindi'], quals: 'MBBS, MD', bio: '', education: [], expertise: [], awards: [], featured: false,
      }),
      item: [
        { k: 'name', t: 'text', label: 'Full name' }, { k: 'slug', t: 'text', label: 'URL slug', hint: 'Profile address: /find-a-doctor/slug' },
        { k: 'img', t: 'image', label: 'Photo', hint: 'Portrait, ideally 4:5.' }, { k: 'role', t: 'text', label: 'Designation' },
        { k: 'dept', t: 'text', label: 'Department (filter label)' },
        { k: 'service', t: 'select', label: 'Speciality page', options: ({ site }) => [{ value: '', label: '— None —' }, ...site.services.map((s) => ({ value: s.slug, label: s.name }))] },
        { k: 'quals', t: 'text', label: 'Qualifications', full: true },
        { k: 'exp', t: 'number', label: 'Experience (years)', min: 0 }, { k: 'fee', t: 'number', label: 'Consultation fee (₹)', min: 0, step: 50 },
        { k: 'rating', t: 'number', label: 'Rating', min: 0, max: 5, step: 0.1 }, { k: 'reviews', t: 'number', label: 'Number of reviews', min: 0 },
        { k: 'days', t: 'days', label: 'OPD days', full: true }, { k: 'time', t: 'text', label: 'OPD timing' },
        { k: 'langs', t: 'tags', label: 'Languages' },
        { k: 'bio', t: 'textarea', label: 'Biography', rows: 4, full: true },
        { k: 'expertise', t: 'tags', label: 'Areas of expertise', full: true },
        {
          k: 'education', t: 'list', label: 'Education', full: true, title: (v) => `${v.degree} — ${v.inst}`, subtitle: (v) => String(v.year), addLabel: 'Add degree',
          newItem: () => ({ degree: 'MBBS', inst: '', year: 2010 }), item: [{ k: 'degree', t: 'text', label: 'Degree' }, { k: 'inst', t: 'text', label: 'Institution' }, { k: 'year', t: 'number', label: 'Year' }],
        },
        { k: 'awards', t: 'strings', label: 'Awards & memberships', addLabel: 'Add award', full: true },
        { k: 'featured', t: 'toggle', label: 'Feature on the home page' }, { k: 'onLeave', t: 'toggle', label: 'On leave (no booking)' },
      ],
    }],
  },
  {
    key: 'packages', label: 'Health packages', group: 'Collections', icon: Package, preview: '/packages',
    description: 'Check-up packages, prices and the comparison table.',
    fields: [
      {
        k: 'items', t: 'list', label: 'Packages', hideable: true, title: (v) => v.name, subtitle: (v) => `₹${Number(v.price).toLocaleString('en-IN')} · ${v.tests} tests`, addLabel: 'Add package',
        newItem: () => ({ name: 'New package', blurb: '', tests: 40, price: 2499, couple: 4499, popular: false, features: [] }),
        item: [
          { k: 'name', t: 'text', label: 'Name' }, { k: 'blurb', t: 'text', label: 'Short description' },
          { k: 'tests', t: 'number', label: 'Number of tests', min: 0 }, { k: 'price', t: 'number', label: 'Price — individual (₹)', min: 0, step: 100 },
          { k: 'couple', t: 'number', label: 'Price — couple (₹)', min: 0, step: 100 }, { k: 'popular', t: 'toggle', label: 'Highlight as “Most popular”' },
          { k: 'features', t: 'strings', label: 'Included', addLabel: 'Add item', full: true },
        ],
      },
      {
        k: 'compare', t: 'list', label: 'Comparison table', hint: 'One column per package, in the order above. Use “yes”, leave empty for “not included”, or type a short note.',
        title: (v) => v.group, subtitle: (v) => `${v.rows?.length ?? 0} rows`, addLabel: 'Add group', newItem: () => ({ group: 'New group', rows: [] }),
        item: [
          { k: 'group', t: 'text', label: 'Group name', full: true },
          {
            k: 'rows', t: 'list', label: 'Rows', full: true, title: (v) => v.label, addLabel: 'Add row', newItem: ({ root }) => ({ label: 'New test', cells: (root.items as Obj[]).map(() => 'yes') }),
            item: [{ k: 'label', t: 'text', label: 'Test / service', full: true }, { k: 'cells', t: 'cells', label: 'Included in', full: true }],
          },
        ],
      },
    ],
  },
  {
    key: 'faqs', label: 'FAQs', group: 'Collections', icon: BookOpenText, preview: '/faq',
    description: 'Help-centre questions grouped by category. Mark questions to also show them on the home page.',
    fields: [{
      k: '', t: 'list', label: 'Categories', title: (v) => v.title, subtitle: (v) => `${v.items?.length ?? 0} questions`, addLabel: 'Add category',
      newItem: ({ root }) => ({ id: uniqueSlug('category', (root as Obj[]).map((g) => g.id)), title: 'New category', items: [] }),
      item: [{ k: 'title', t: 'text', label: 'Category name' }, { k: 'id', t: 'text', label: 'ID', hint: 'Internal, lowercase.' }, faqList('items', 'Questions', true)],
    }],
  },
  {
    key: 'testimonials', label: 'Testimonials', group: 'Collections', icon: MessageSquareQuote, preview: '/welcome',
    description: 'Patient stories shown on the home page.',
    fields: [{
      k: '', t: 'list', label: 'Testimonials', hideable: true, title: (v) => v.name, subtitle: (v) => `${v.place} · ${v.tag}`, addLabel: 'Add testimonial',
      newItem: () => ({ name: 'Patient name', place: 'New Delhi', tag: 'Cardiology', text: '' }),
      item: [{ k: 'name', t: 'text', label: 'Name' }, { k: 'place', t: 'text', label: 'Location' }, { k: 'tag', t: 'text', label: 'Tag / department' }, { k: 'text', t: 'textarea', label: 'Story', rows: 3, full: true }],
    }],
  },
]

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s])) as Record<ContentKey, Section>
export const GLOBE_ICON = Globe

/** Returns human-readable problems that would break the public site (duplicate/empty slugs etc.). */
export function validate(key: ContentKey, data: any): string[] {
  const errs: string[] = []
  const slugs = (list: Obj[], field: string, noun: string) => {
    const seen = new Set<string>()
    list.forEach((x, i) => {
      const s = String(x[field] ?? '')
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) errs.push(`${noun} #${i + 1} (${x.name ?? x.title ?? ''}): the URL slug “${s}” may only contain lowercase letters, numbers and dashes.`)
      else if (seen.has(s)) errs.push(`${noun} #${i + 1}: the slug “${s}” is used twice.`)
      seen.add(s)
    })
  }
  if (key === 'services') slugs(data, 'slug', 'Speciality')
  if (key === 'doctors') slugs(data, 'slug', 'Doctor')
  if (key === 'faqs') slugs(data, 'id', 'FAQ category')
  if (key === 'settings' && !String(data.name ?? '').trim()) errs.push('Hospital name is required.')
  return errs
}

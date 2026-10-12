/**
 * Website forms (Settings → Forms): the Contact form, the Patient review form and any custom form the owner builds.
 * Every submission lands in the Enquiries inbox (site_enquiries) with the form it came from and all its answers.
 *
 * The same rules run in three places — keep them in step:
 *   validateAnswers()  here (browser + demo mode)
 *   public.submit_site_form()  in scripts/sql/forms.sql (the database never trusts the browser)
 */
import type { SiteEnquiry, SiteForm } from '../types'

export type FieldType = 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'radio' | 'checkboxes' | 'rating' | 'consent'
/** fields with a role fill the inbox columns (name, mobile…) — every form has a name and a mobile so staff can reply */
export type FieldRole = 'name' | 'phone' | 'email' | 'message' | 'topic' | 'speciality'

export interface FormField {
  id: string
  type: FieldType
  label: string
  placeholder?: string
  help?: string
  required?: boolean
  /** select / radio / checkboxes. Empty on the Contact form's topic = the topics from Website CMS → Contact page */
  options?: string[]
  /** 'services' = the hospital's specialities (Website CMS → Services) */
  optionsFrom?: 'services'
  width?: 'full' | 'half'
  role?: FieldRole
}

export interface FormSettings {
  /** label in the Enquiries inbox; empty = the form name */
  topic?: string
  submitLabel?: string
  successTitle?: string
  successText?: string
  /** chip colour in the inbox */
  color?: FormColor
}

export type FormKind = SiteForm['kind']
export const FORM_COLORS = ['brand', 'amber', 'sky', 'rose', 'emerald', 'violet', 'teal', 'slate'] as const
export type FormColor = (typeof FORM_COLORS)[number]
export const COLOR_CLASS: Record<FormColor, { dot: string; chip: string; solid: string }> = {
  brand: { dot: 'bg-brand-500', chip: 'bg-brand-50 text-brand-800 ring-brand-200', solid: 'bg-brand-600' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 ring-amber-200', solid: 'bg-amber-500' },
  sky: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-800 ring-sky-200', solid: 'bg-sky-500' },
  rose: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-800 ring-rose-200', solid: 'bg-rose-500' },
  emerald: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', solid: 'bg-emerald-500' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-800 ring-violet-200', solid: 'bg-violet-500' },
  teal: { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-800 ring-teal-200', solid: 'bg-teal-500' },
  slate: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 ring-slate-200', solid: 'bg-slate-500' },
}

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'text', label: 'Short text', hint: 'One line' },
  { type: 'textarea', label: 'Long text', hint: 'Paragraph' },
  { type: 'email', label: 'Email', hint: 'Checked format' },
  { type: 'phone', label: 'Mobile', hint: '10-digit Indian' },
  { type: 'number', label: 'Number', hint: 'Age, count…' },
  { type: 'date', label: 'Date', hint: 'Calendar picker' },
  { type: 'select', label: 'Dropdown', hint: 'Pick one' },
  { type: 'radio', label: 'Choice chips', hint: 'Pick one' },
  { type: 'checkboxes', label: 'Checkboxes', hint: 'Pick many' },
  { type: 'rating', label: 'Star rating', hint: '1 to 5' },
  { type: 'consent', label: 'Agreement', hint: 'Tick to accept' },
]
export const hasOptions = (t: FieldType) => t === 'select' || t === 'radio' || t === 'checkboxes'

export const LIMITS = { text: 200, textarea: 2000, options: 30 }
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
export const RESERVED_SLUGS = ['new', 'edit', 'admin']
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'form'
export const fieldKey = (label: string, taken: string[]) => {
  const base = slugify(label).replace(/-/g, '_').slice(0, 30) || 'field'
  let k = base, i = 2
  while (taken.includes(k)) k = `${base}_${i++}`
  return k
}

export type Answers = Record<string, string | string[] | number | boolean | null | undefined>
export type FieldErrors = Record<string, string>

const MOBILE = /^[6-9]\d{9}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const mobile10 = (v: string) => v.replace(/\D/g, '').slice(-10)
const str = (v: Answers[string]) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)).trim()
const isEmpty = (f: FormField, v: Answers[string]) =>
  f.type === 'consent' ? v !== true : f.type === 'checkboxes' ? !Array.isArray(v) || v.length === 0 : str(v) === ''

/** Field-by-field errors (empty object = OK). `optionsFor` resolves CMS-driven option lists. */
export function validateAnswers(fields: FormField[], a: Answers, optionsFor: (f: FormField) => string[] = (f) => f.options ?? []): FieldErrors {
  const e: FieldErrors = {}
  for (const f of fields) {
    const v = a[f.id]
    const required = f.required || f.role === 'name' || f.role === 'phone'
    if (isEmpty(f, v)) { if (required) e[f.id] = f.type === 'consent' ? 'Please accept to continue' : f.type === 'rating' ? 'Please choose a rating' : `${f.label} is required`; continue }
    const s = str(v)
    const opts = optionsFor(f)
    switch (f.type) {
      case 'text': if (s.length > LIMITS.text) e[f.id] = `Keep it under ${LIMITS.text} characters`; else if (f.role === 'name' && s.length < 2) e[f.id] = 'Please enter your full name'; break
      case 'textarea': if (s.length > LIMITS.textarea) e[f.id] = `Keep it under ${LIMITS.textarea} characters`; else if (f.role === 'message' && f.required && s.length < 10) e[f.id] = 'Tell us a little more (at least 10 characters)'; break
      case 'email': if (!EMAIL.test(s) || s.length > 200) e[f.id] = 'Enter a valid email address'; break
      case 'phone': if (!MOBILE.test(mobile10(s)) || s.replace(/[\d\s+-]/g, '') !== '') e[f.id] = 'Enter a valid 10-digit mobile number'; break
      case 'number': if (!/^-?\d+(\.\d+)?$/.test(s)) e[f.id] = 'Enter a number'; break
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) e[f.id] = 'Pick a date'; break
      case 'rating': if (![1, 2, 3, 4, 5].includes(Number(v))) e[f.id] = 'Please choose a rating'; break
      case 'select': case 'radio': if (opts.length && !opts.includes(s)) e[f.id] = 'Please choose one of the options'; break
      case 'checkboxes': if (opts.length && !(v as string[]).every((x) => opts.includes(x))) e[f.id] = 'Please choose from the options'; break
    }
  }
  return e
}

/** What a submission becomes in the inbox — mirrors public.submit_site_form(). */
export function toEnquiry(form: Pick<SiteForm, 'id' | 'name' | 'fields' | 'settings'>, a: Answers): Omit<SiteEnquiry, 'id' | 'created_at' | 'updated_at' | 'ref' | 'status'> {
  const fields = form.fields as FormField[]
  const byRole = (r: FieldRole) => fields.find((f) => f.role === r)
  const val = (f?: FormField) => (f ? str(a[f.id]) : '')
  const data = fields.filter((f) => !isEmpty(f, a[f.id])).map((f) => ({
    id: f.id, label: f.label, type: f.type,
    value: f.type === 'checkboxes' ? (a[f.id] as string[]) : f.type === 'rating' || f.type === 'number' ? Number(a[f.id]) : f.type === 'consent' ? true : str(a[f.id]),
  }))
  // the message column: the form's message field, otherwise every other answer as "Label: value" lines
  const shown = new Set(['name', 'phone', 'email', 'topic', 'speciality'])
  const lines = fields.filter((f) => !(f.role && shown.has(f.role)) && f.type !== 'consent' && !isEmpty(f, a[f.id]))
    .map((f) => `${f.label}: ${f.type === 'rating' ? `${a[f.id]}/5` : str(a[f.id])}`)
  const message = (val(byRole('message')) || lines.join('\n') || form.name).slice(0, 2000)
  const settings = (form.settings ?? {}) as FormSettings
  return {
    name: val(byRole('name')).slice(0, 120), phone: val(byRole('phone')), email: val(byRole('email')) || null,
    topic: (val(byRole('topic')) || settings.topic?.trim() || form.name).slice(0, 80),
    speciality: val(byRole('speciality')) || null, message,
    form_id: form.id, form_name: form.name, data,
    notes: null, starred: false, read_at: null,
  }
}

/** Topic label a form puts in the inbox (the Contact form uses its topic choices instead). */
export const formTopic = (f: Pick<SiteForm, 'name' | 'settings'>) => ((f.settings ?? {}) as FormSettings).topic?.trim() || f.name

// ------------------------------------------------------------------ built-in forms
export const CONTACT_FORM_ID = 'f0000000-0000-4000-8000-000000000001'
export const REVIEW_FORM_ID = 'f0000000-0000-4000-8000-000000000002'

const nameField: FormField = { id: 'name', type: 'text', label: 'Full name', placeholder: 'Priya Sharma', required: true, role: 'name', width: 'half' }
const phoneField: FormField = { id: 'phone', type: 'phone', label: 'Mobile number', placeholder: '98100 12345', required: true, role: 'phone', width: 'half' }
const emailField: FormField = { id: 'email', type: 'email', label: 'Email', placeholder: 'you@example.com', role: 'email', width: 'half' }
const consentField = (text: string): FormField => ({ id: 'consent', type: 'consent', label: text, required: true })

export type FormDef = Pick<SiteForm, 'id' | 'slug' | 'name' | 'description' | 'kind' | 'enabled' | 'fields' | 'settings' | 'sort'>

export const DEFAULT_FORMS: FormDef[] = [
  {
    id: CONTACT_FORM_ID, slug: 'contact', name: 'Contact form', kind: 'contact', enabled: true, sort: 0,
    description: 'The form on the Contact page. Topics come from Website CMS → Contact page unless you set options here.',
    fields: [
      nameField, phoneField, emailField,
      { id: 'speciality', type: 'select', label: 'Speciality', placeholder: 'Not sure / general', optionsFrom: 'services', role: 'speciality', width: 'half' },
      { id: 'topic', type: 'radio', label: 'How can we help?', required: true, options: [], role: 'topic' },
      { id: 'message', type: 'textarea', label: 'Message', placeholder: 'Tell us how we can help…', required: true, role: 'message' },
      consentField('I agree to be contacted about my enquiry and accept the privacy policy.'),
    ],
    settings: { submitLabel: 'Send message', color: 'brand' },  // thank-you text: Website CMS → Contact page
  },
  {
    id: REVIEW_FORM_ID, slug: 'review', name: 'Patient review', kind: 'review', enabled: true, sort: 1,
    description: 'Share your experience at our hospital. Reviews are read by the management.',
    fields: [
      { id: 'rating', type: 'rating', label: 'Overall experience', required: true },
      nameField, phoneField,
      { id: 'doctor', type: 'text', label: 'Doctor or department you visited', placeholder: 'e.g. Dr. Arjun Mehta, Cardiology', width: 'half' },
      { id: 'visit_date', type: 'date', label: 'Date of visit', width: 'half' },
      { id: 'liked', type: 'checkboxes', label: 'What went well?', options: ['Doctor consultation', 'Nursing care', 'Cleanliness', 'Waiting time', 'Billing & front desk'] },
      { id: 'message', type: 'textarea', label: 'Your review', placeholder: 'Tell us about your visit…', required: true, role: 'message' },
      { id: 'publish', type: 'consent', label: 'You may publish my first name with this review on the website.' },
    ],
    settings: { topic: 'Patient review', submitLabel: 'Submit review', successTitle: 'Thank you for your review!', successText: 'Your feedback helps us care better for every patient.', color: 'amber' },
  },
]

/** Starting points for "New form". */
export const FORM_TEMPLATES: { key: string; label: string; hint: string; make: () => Omit<FormDef, 'id' | 'sort'> }[] = [
  { key: 'blank', label: 'Blank form', hint: 'Name, mobile and a message', make: () => ({ slug: 'new-form', name: 'New form', kind: 'custom', enabled: false, description: '', settings: { submitLabel: 'Submit', color: 'violet' },
    fields: [nameField, phoneField, { id: 'message', type: 'textarea', label: 'Message', required: false, role: 'message' }] }) },
  { key: 'callback', label: 'Callback request', hint: 'Best time to call', make: () => ({ slug: 'callback', name: 'Callback request', kind: 'custom', enabled: false, description: 'Leave your number and we will call you back.',
    settings: { topic: 'Callback request', submitLabel: 'Request a callback', successText: 'We will call you at the time you picked.', color: 'sky' },
    fields: [nameField, phoneField, { id: 'best_time', type: 'radio', label: 'Best time to call', required: true, options: ['Morning (9–12)', 'Afternoon (12–4)', 'Evening (4–8)'] }, { id: 'message', type: 'textarea', label: 'What is it about?', role: 'message' }] }) },
  { key: 'careers', label: 'Job application', hint: 'Role, experience, notes', make: () => ({ slug: 'careers', name: 'Job application', kind: 'custom', enabled: false, description: 'Join our team of doctors, nurses and staff.',
    settings: { topic: 'Careers', submitLabel: 'Apply', successText: 'Our HR team will contact you if your profile matches an opening.', color: 'emerald' },
    fields: [nameField, phoneField, emailField, { id: 'role', type: 'select', label: 'Position', required: true, options: ['Doctor', 'Nurse', 'Technician', 'Front office', 'Other'], width: 'half' },
      { id: 'experience', type: 'number', label: 'Years of experience', width: 'half' }, { id: 'message', type: 'textarea', label: 'About you', placeholder: 'Qualifications, current role, notice period…', role: 'message' }] }) },
  { key: 'camp', label: 'Health camp registration', hint: 'Age, gender, date', make: () => ({ slug: 'health-camp', name: 'Health camp registration', kind: 'custom', enabled: false, description: 'Register for our free health check-up camp.',
    settings: { topic: 'Health camp', submitLabel: 'Register', successText: 'You are registered. Please carry a photo ID on the day.', color: 'teal' },
    fields: [nameField, phoneField, { id: 'age', type: 'number', label: 'Age', required: true, width: 'half' }, { id: 'gender', type: 'radio', label: 'Gender', options: ['Male', 'Female', 'Other'], width: 'half' },
      { id: 'tests', type: 'checkboxes', label: 'Tests you are interested in', options: ['Blood sugar', 'Blood pressure', 'Eye check-up', 'Dental check-up', 'BMI'] }, consentField('I agree to be contacted about this camp.')] }) },
]

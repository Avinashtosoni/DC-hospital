/**
 * The built-in plans. They are written into platform_settings 'billing' on install; after that the Control Panel's
 * Plans & billing page is where plans live (add, edit, hide, archive, reorder) and every page — product site,
 * sign-up, the hospital's Billing page, invoices — reads them from the database (src/platform/planStore.ts).
 * This list is only the fallback when the database can't be reached.
 * Prices are per hospital per month, before GST. `price: null` = "talk to us".
 */
export type PlanId = string
export interface Plan {
  id: PlanId
  name: string
  price: number | null
  /** shown after the price, e.g. "+" for "from ₹7,999+" */
  suffix?: string
  tagline: string
  features: string[]
  highlight?: boolean
  cta: string
  /** messages per month included on Hospital Comrade's shared accounts (beyond them: prepaid wallet, phase 4) */
  included: { sms: number; whatsapp: number; email: number }
  /** shown on the product site's pricing (hidden plans can still be given to a hospital by the platform team) */
  public?: boolean
  /** no longer offered: kept for hospitals already on it, can't be chosen any more */
  archived?: boolean
  /** hospitals can start a free trial on it from the sign-up page (otherwise the button asks for a call back) */
  signup?: boolean
  /** position on the pricing page, lowest first */
  order?: number
  /** the last change hospital owners were told about */
  /** last change owners were told about (cp_save_plan); `others` = the part for hospitals on their own agreed price */
  notice?: { at: string; text: string; others?: string | null } | null
}

export const PLANS: Plan[] = [
  {
    id: 'clinic', name: 'Clinic', price: 999, tagline: 'For single-doctor and small clinics',
    features: [
      'Appointments & online booking',
      'Patient records & digital prescriptions',
      'Billing, receipts & GST-ready invoices',
      'Patient portal',
      'Clinic website on your own domain',
      'Email support',
    ],
    cta: 'Start free trial', signup: true,
    included: { sms: 100, whatsapp: 300, email: 1000 },
  },
  {
    id: 'hospital', name: 'Hospital', price: 2999, highlight: true, tagline: 'For growing multi-speciality hospitals',
    features: [
      'Everything in Clinic',
      'Wards, beds & admissions',
      'Lab tests, inventory & expenses',
      'Staff roles: doctor, reception, accounts, staff',
      'WhatsApp / SMS reminders & booking OTP',
      'Website CMS, enquiry forms & feedback',
      'Reports & owner dashboard',
    ],
    cta: 'Start free trial', signup: true,
    included: { sms: 500, whatsapp: 1500, email: 5000 },
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 7999, suffix: '+', tagline: 'For large hospitals and groups',
    features: [
      'Everything in Hospital',
      'Higher limits for doctors, staff and data',
      'WhatsApp booking bot',
      'Priority support & onboarding help',
      'Data import from your old software',
    ],
    cta: 'Talk to sales',
    included: { sms: 2000, whatsapp: 5000, email: 20000 },
  },
  {
    id: 'custom', name: 'Custom', price: null, tagline: 'Your modules, your price',
    features: [
      'Pick only the modules you need',
      'Custom integrations',
      'Multi-branch setups',
      'Pricing that fits your budget',
    ],
    cta: 'Get a quote',
    included: { sms: 0, whatsapp: 0, email: 0 },
  },
]

/** every field filled in (older saved plans lack the newer ones) */
export function normalisePlan(id: string, saved: Partial<Plan> | null | undefined, i = 99): Plan {
  const base = PLANS.find((p) => p.id === id)
  const s = saved ?? {}
  return {
    id,
    name: String(s.name ?? base?.name ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
    price: s.price === undefined ? base?.price ?? null : s.price === null || (s.price as unknown) === '' ? null : Number(s.price),
    suffix: s.suffix ?? base?.suffix ?? '',
    tagline: s.tagline ?? base?.tagline ?? '',
    features: Array.isArray(s.features) ? s.features.map(String) : base?.features ?? [],
    highlight: !!(s.highlight ?? base?.highlight),
    cta: s.cta || base?.cta || 'Get started',
    included: { sms: 0, whatsapp: 0, email: 0, ...(base?.included ?? {}), ...(s.included ?? {}) },
    public: s.public ?? true,
    archived: !!s.archived,
    signup: s.signup ?? base?.signup ?? false,
    order: typeof s.order === 'number' ? s.order : base ? PLANS.indexOf(base) : i,
    notice: s.notice ?? null,
  }
}

/** a plans object from the database ({ id: plan }) → sorted list */
export function planList(saved: Record<string, Partial<Plan>> | null | undefined): Plan[] {
  if (!saved || typeof saved !== 'object' || !Object.keys(saved).length) return PLANS.map((p, i) => normalisePlan(p.id, p, i))
  return Object.entries(saved).map(([id, p], i) => normalisePlan(id, p, 50 + i)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

/** what visitors may pick on the product site */
export const offered = (plans: Plan[]) => plans.filter((p) => p.public !== false && !p.archived)

export const PLAN_LABEL: Record<string, string> = Object.fromEntries(PLANS.map((p) => [p.id, p.name]))

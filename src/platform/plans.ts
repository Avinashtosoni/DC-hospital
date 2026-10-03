/**
 * Plans shown on the Hospital Comrade product page. Edit freely — this file is the only place they live.
 * Prices are per hospital per month, before GST. `price: null` = "talk to us".
 */
export interface Plan {
  id: 'clinic' | 'hospital' | 'enterprise' | 'custom'
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
    cta: 'Start with Clinic',
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
    cta: 'Choose Hospital',
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

export const PLAN_LABEL: Record<Plan['id'], string> = Object.fromEntries(PLANS.map((p) => [p.id, p.name])) as Record<Plan['id'], string>

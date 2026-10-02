/**
 * Phase 8.1 — the platform's own legal pages (Terms, Privacy, Refunds & cancellation, Delivery, DPA, Contact).
 * Razorpay's website review asks for these before payments go live. Company details come from runtime env
 * (PLATFORM_LEGAL_NAME, PLATFORM_ADDRESS, PLATFORM_EMAIL, PLATFORM_PHONE, PLATFORM_GRIEVANCE_OFFICER,
 * PLATFORM_JURISDICTION); prices and periods from the billing defaults.
 *
 * ⚠ A starting point written for an Indian B2B SaaS — have a lawyer review it before launch.
 */
import { BILLING_DEFAULTS } from './billing'
import { platformCompany, platformDomain, platformName } from '../lib/supabase'

/** bump when the text changes materially — stored with each acceptance (signup, checkout) */
export const LEGAL_VERSION = '2026-10-02'

export type LegalSlug = 'terms' | 'privacy' | 'refunds' | 'delivery' | 'dpa' | 'contact'
export interface LegalDoc { slug: LegalSlug; title: string; short: string; intro: string; sections: { h: string; p: string[] }[] }

export function legalDocs(): LegalDoc[] {
  const c = platformCompany, P = platformName, site = platformDomain
  const B = BILLING_DEFAULTS
  const contact = [c.email && `e-mail ${c.email}`, c.phone && `phone ${c.phone}`].filter(Boolean).join(', ')
  const grievance = c.grievanceOfficer ? `${c.grievanceOfficer} (Grievance Officer)` : 'our Grievance Officer'

  return [
    {
      slug: 'terms', title: 'Terms of Service', short: 'Terms',
      intro: `These terms are an agreement between ${c.legalName} ("we", "us"), which runs ${P} at ${site}, and the hospital, clinic or person that signs up ("you"). By creating an account, starting a trial or paying, you accept them.`,
      sections: [
        { h: '1. The service', p: [
          `${P} is online software for hospitals and clinics: appointments, patient records, prescriptions, laboratory, wards, billing, a hospital website, and messages by SMS, WhatsApp and e-mail. It runs in a web browser; we host it.`,
          'Features differ by plan, as shown on the pricing page at the time you subscribe. We may improve or change features; we will not remove a core feature of a paid plan during a period you have paid for.',
        ] },
        { h: '2. Accounts', p: [
          'One account belongs to one hospital or clinic. The person who signs up as owner confirms they are authorised to act for it.',
          'You decide who on your team gets access and with which role. Keep passwords private and remove people who leave. You are responsible for everything done under your accounts.',
        ] },
        { h: '3. Free trial', p: [
          `New hospitals get a free trial (currently ${B.trialDays} days unless we agree otherwise). No payment details are needed. When the trial ends without a plan, the account becomes read-only after a grace period of ${B.graceDays} days: you can still sign in, see and export everything, but not add or change records.`,
        ] },
        { h: '4. Plans, prices and payment', p: [
          `Prices are in Indian rupees per month, before GST (charged at ${B.gstPercent}%). A yearly plan costs ${B.yearlyMonths} months' price. A GST tax invoice is issued for every payment.`,
          'Plans are prepaid for the period you choose and do not renew automatically — we remind you before the end. Payments are processed by Razorpay; we never see or store your card or bank details.',
          'Messages beyond your plan\u2019s monthly allowance are charged from a prepaid message wallet at the rates shown in Billing & plan. If the wallet is empty, extra messages are not sent.',
          'We may change prices with at least 30 days\u2019 notice by e-mail; a change never affects a period you have already paid for.',
        ] },
        { h: '5. Your data', p: [
          'Everything you and your patients enter is your data. You are the Data Fiduciary for it under the Digital Personal Data Protection Act, 2023; we process it only to provide the service, as set out in our Data Processing Agreement, which forms part of these terms.',
          'You can export all your data at any time (Settings \u2192 Data & backup), including while your account is read-only or closing.',
          'You are responsible for having a lawful basis to collect your patients\u2019 data, for the medical content you record, and for answering your patients\u2019 requests (the software gives you the tools).',
        ] },
        { h: '6. Acceptable use', p: [
          'Do not use the service for anything unlawful; to send messages people have not agreed to receive or that break TRAI / DLT rules; to upload malware; to try to reach other hospitals\u2019 data; or to overload, probe or copy the service.',
          'We may suspend an account that puts the service, other customers or patients at risk, telling you why as soon as we safely can.',
        ] },
        { h: '7. Availability and support', p: [
          'We aim for the service to be available around the clock and take regular backups, but we do not promise it will be uninterrupted or error-free. Planned maintenance is announced in advance when it may cause downtime.',
          `Support is by ${contact || 'e-mail'} on working days (Monday to Saturday, 10:00\u201318:00 IST).`,
        ] },
        { h: '8. Ending the service', p: [
          'You can stop at any time by not renewing, or ask us to close your account. We may close an account that stays unpaid or breaks these terms.',
          'When an account is closed it becomes read-only and the owner is e-mailed a notice period (normally 30 days, at least 7) to download the data. After that, all of the hospital\u2019s data is permanently deleted, except our own GST invoices, which the law requires us to keep. Copies in backups expire within 30 days.',
        ] },
        { h: '9. Liability', p: [
          'The software helps you run your hospital; clinical decisions remain yours and your doctors\u2019. To the extent the law allows, we are not liable for indirect or consequential loss (such as lost profit or revenue), and our total liability for any claim is limited to the amount you paid us in the 12 months before it arose.',
          'Nothing in these terms limits liability that cannot be limited by law.',
        ] },
        { h: '10. General', p: [
          `These terms are governed by the laws of India. The courts at ${c.jurisdiction} have exclusive jurisdiction.`,
          'We may update these terms; material changes are e-mailed to owners at least 30 days before they apply. If you keep using the service after that, the new terms apply.',
          `Questions: ${contact || 'see the Contact page'}. ${c.legalName}, ${c.address}.`,
        ] },
      ],
    },
    {
      slug: 'privacy', title: 'Privacy Policy', short: 'Privacy',
      intro: `How ${c.legalName} handles personal data on ${P}. It covers two roles: the data of our own customers (hospital owners and staff, people who contact us), for which we are the Data Fiduciary; and patients' data kept by hospitals, for which each hospital is the Data Fiduciary and we are its Data Processor.`,
      sections: [
        { h: '1. Data we collect about our customers', p: [
          'Account details: name, e-mail, mobile number, role and hospital. Billing details: legal name, GSTIN, billing address and payment records (card and bank details stay with Razorpay). Usage data: sign-in times, actions recorded in audit logs, and technical logs needed to keep the service secure.',
          'When you use the contact form: your name, organisation, phone, e-mail, city and message.',
        ] },
        { h: '2. Why we use it', p: [
          'To create and run your account, bill you and issue GST invoices, send service messages (trial and renewal reminders, security notices), give support, keep the service secure, and meet legal obligations. We use contact-form details only to reply to you about the service.',
          'We do not sell personal data and do not use it for advertising.',
        ] },
        { h: '3. Patients\u2019 data', p: [
          'Patients\u2019 records are entered and controlled by their hospital. We process them only on the hospital\u2019s behalf and instructions to provide the service (see the Data Processing Agreement). Patients should contact their hospital first to see, correct or delete their data; the hospital\u2019s website shows its own privacy policy and grievance officer. Patients can also download their data and make requests from their profile in the patient portal.',
        ] },
        { h: '4. Where data is kept and who helps us', p: [
          'Data is stored in India on Supabase (managed PostgreSQL on Amazon Web Services, Mumbai region). Service providers who process data for us: Supabase / AWS (hosting), Cloudflare (network and SSL), Razorpay (payments), and the SMS, WhatsApp and e-mail providers a hospital chooses for its messages. Each is bound to protect the data.',
        ] },
        { h: '5. Security', p: [
          'Each hospital\u2019s data is separated in the database itself; access is limited by role; connections are encrypted (HTTPS); sensitive actions are logged; backups are encrypted. If a personal-data breach happens we inform the affected hospitals without delay and the Data Protection Board of India as the law requires.',
        ] },
        { h: '6. How long we keep it', p: [
          'Account and usage data: while your account is active, then until the hospital\u2019s data is deleted after closure. Invoices and payment records: 8 years (tax law). Logs: up to 3 years. Contact-form messages: up to 3 years after they are handled.',
        ] },
        { h: '7. Your rights', p: [
          `You can ask to access, correct or delete your personal data, withdraw consent, or nominate someone to act for you, by writing to ${c.email || 'us'}. We reply within 30 days. If you are not satisfied, contact ${grievance}; you may also complain to the Data Protection Board of India.`,
        ] },
        { h: '8. Cookies and storage', p: [
          'We do not use advertising or tracking cookies. The app stores your session and preferences in your browser\u2019s local storage so you stay signed in.',
        ] },
        { h: '9. Contact', p: [
          `${c.legalName}, ${c.address}. ${contact}. Grievance Officer: ${c.grievanceOfficer || 'see the Contact page'}.`,
        ] },
      ],
    },
    {
      slug: 'refunds', title: 'Refund & Cancellation Policy', short: 'Refunds',
      intro: `How cancellations and refunds work for ${P} subscriptions and message-wallet top-ups.`,
      sections: [
        { h: 'Free trial', p: ['The trial is free and needs no payment. Nothing is charged when it ends.'] },
        { h: 'Cancelling a plan', p: [
          'Plans are prepaid and do not renew automatically, so there is nothing to cancel: if you do not renew, the plan simply ends on its last day and the account turns read-only after the grace period. You can also ask us to close the account at any time.',
        ] },
        { h: 'Refunds on plans', p: [
          'If you are not satisfied, you can ask for a full refund of your first paid plan within 7 days of paying it. After that, payments for the current period are not refunded, including when you stop early, except where required by law or where we close your account without you breaking the terms (then we refund the unused months).',
          'Payments charged twice or by mistake are always refunded in full.',
        ] },
        { h: 'Message wallet', p: [
          'Wallet top-ups are used for messages beyond your plan. Unused balance is not refundable while the account is active. When your account is closed, unused balance above \u20b9100 is refunded on request within 30 days of closure.',
        ] },
        { h: 'How refunds are paid', p: [
          'Refunds go back to the original payment method through Razorpay within 5\u20137 working days after approval (bank timelines may add a few days). A GST credit note is issued.',
          `To ask for a refund, write to ${c.email || 'us'} with your hospital name and invoice number.`,
        ] },
      ],
    },
    {
      slug: 'delivery', title: 'Service Delivery Policy', short: 'Delivery',
      intro: `${P} is software used online; nothing is shipped.`,
      sections: [
        { h: 'Delivery', p: [
          'The service is delivered online. A trial is available as soon as your hospital account is created. A paid plan or wallet top-up is applied to your account immediately after the payment succeeds, and a GST invoice is available in Billing & plan at once.',
          `If a successful payment is not reflected within 30 minutes, contact ${c.email || 'us'} with the Razorpay payment ID.`,
        ] },
        { h: 'Custom domains', p: ['Connecting your own domain depends on the DNS record you add at your domain provider; it usually works within minutes and at most 48 hours.'] },
      ],
    },
    {
      slug: 'dpa', title: 'Data Processing Agreement', short: 'DPA',
      intro: `This agreement forms part of the Terms of Service between the hospital ("Hospital", the Data Fiduciary) and ${c.legalName} ("Processor"), for personal data the Hospital keeps on ${P}, under the Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.`,
      sections: [
        { h: '1. Scope', p: [
          'Personal data of the Hospital\u2019s patients, their relatives, staff and website visitors, including health data, entered into or collected by the service. Purpose: providing the service described in the Terms. Duration: the term of the subscription plus the closure notice period.',
        ] },
        { h: '2. Instructions', p: [
          'The Processor processes the data only on the Hospital\u2019s documented instructions \u2014 the Terms, this agreement and the Hospital\u2019s use of the software\u2019s features \u2014 and not for its own purposes. It tells the Hospital if it believes an instruction breaks the law.',
        ] },
        { h: '3. Confidentiality and access', p: [
          'Only Processor staff who need access to provide support or keep the service running get it, under confidentiality obligations; support access is read-only unless the Hospital asks for help with a change, and every access is logged in the Hospital\u2019s audit trail.',
        ] },
        { h: '4. Security measures', p: [
          'Database-level isolation between hospitals; role-based access; encryption in transit (HTTPS/TLS) and of backups; audit logs of changes; automatic sign-out; password policies; regular backups and restore tests; timely security updates.',
        ] },
        { h: '5. Sub-processors', p: [
          'The Hospital authorises: Supabase Inc. / Amazon Web Services (hosting, Mumbai region), Cloudflare (network, SSL), Razorpay (payments), and the messaging providers the Hospital selects. The Processor gives 30 days\u2019 notice of new sub-processors by e-mail; the Hospital may object and end the service with a pro-rata refund.',
        ] },
        { h: '6. Personal-data breaches', p: [
          'The Processor informs the Hospital without undue delay, and aims to within 24 hours of becoming aware of a breach affecting its data, with what is known: what happened, what data and people are affected, the likely consequences and the steps taken \u2014 so the Hospital can inform the Data Protection Board and the affected people. The Processor keeps a record of every incident.',
        ] },
        { h: '7. Helping the Hospital', p: [
          'The software lets the Hospital give patients a copy of their data, correct it, erase it and record consent; the Processor helps further on request. It also helps with security questions, impact assessments and the Board\u2019s enquiries, as reasonably needed.',
        ] },
        { h: '8. Deletion and return', p: [
          'The Hospital can export all data at any time. When the service ends, the Hospital gets a notice period (at least 7 days) to export it; then the Processor deletes it, keeping only what the law requires (its own invoices). Backups expire within 30 days.',
        ] },
        { h: '9. Location and audits', p: [
          'Data is stored in India. On reasonable written notice (once a year, or after a breach), the Processor answers the Hospital\u2019s security questionnaire and provides evidence of the measures above.',
        ] },
      ],
    },
    {
      slug: 'contact', title: 'Contact us', short: 'Contact',
      intro: `${P} is run by ${c.legalName}.`,
      sections: [
        { h: 'Address', p: [`${c.legalName}`, c.address] },
        { h: 'Reach us', p: [c.email ? `E-mail: ${c.email}` : '', c.phone ? `Phone / WhatsApp: ${c.phone}` : '', 'Monday to Saturday, 10:00\u201318:00 IST. We reply to e-mails within one working day.'].filter(Boolean) },
        { h: 'Grievance Officer', p: [
          `${c.grievanceOfficer || 'Grievance Officer'}${c.email ? ` \u2014 ${c.email}` : ''}. Complaints about personal data are acknowledged within 48 hours and resolved within 30 days.`,
          'Patients: for your medical records, please contact your hospital first \u2014 its website lists its own grievance officer.',
        ] },
      ],
    },
  ]
}

export const legalDoc = (slug: string) => legalDocs().find((d) => d.slug === slug) ?? null
/** absolute link to a legal page on the platform's domain (for the hospital app, which runs on other domains) */
export const legalUrl = (slug: LegalSlug) => `https://${platformDomain}/legal/${slug}`

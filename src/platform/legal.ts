/**
 * Phase 8.1 — the platform's own legal pages (Terms, Privacy, Refunds & cancellation, Delivery, DPA, Cookies,
 * Acceptable use, Grievance redressal, Disclaimer, Service levels, Contact). The control panel's Website CMS can
 * override any of them (src/platform/site — this file is the default text).
 * Razorpay's website review asks for these before payments go live. Company details come from runtime env
 * (PLATFORM_LEGAL_NAME, PLATFORM_ADDRESS, PLATFORM_EMAIL, PLATFORM_PHONE, PLATFORM_GRIEVANCE_OFFICER,
 * PLATFORM_JURISDICTION); prices and periods from the billing defaults.
 *
 * ⚠ A starting point written for an Indian B2B SaaS — have a lawyer review it before launch.
 */
import { BILLING_DEFAULTS } from './billing'
import { platformCompany, platformDomain, platformName } from '../lib/supabase'

/** bump when the text changes materially — stored with each acceptance (signup, checkout) */
export const LEGAL_VERSION = '2026-10-03'

export type LegalSlug = 'terms' | 'privacy' | 'refunds' | 'delivery' | 'dpa' | 'cookies' | 'acceptable-use' | 'grievance' | 'disclaimer' | 'sla' | 'contact'
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
      slug: 'cookies', title: 'Cookie Policy', short: 'Cookies',
      intro: `What ${P} stores in your browser, and why. In short: only what is needed to sign you in and remember your choices \u2014 no advertising or tracking cookies.`,
      sections: [
        { h: '1. What we store', p: [
          'Sign-in session: a secure token kept in your browser\u2019s local storage so you stay signed in. It is removed when you sign out. (A temporary support session opened by our team is kept only in that browser tab.)',
          'Preferences: things like the hospital you picked, a dismissed notice or the sidebar layout, so the app looks the same next time.',
          'Offline app files: when you install the app or use it on a slow connection, the browser keeps a copy of the app\u2019s files (not patient records) so it starts faster.',
        ] },
        { h: '2. What we do not use', p: [
          'No advertising cookies, no cross-site tracking, no selling or sharing of browsing data. We do not use third-party analytics that profile you.',
        ] },
        { h: '3. Third parties', p: [
          'Payment pages are run by Razorpay and may set their own cookies needed for fraud checks and the payment itself. If error reporting is switched on, technical details of an error (not form contents) are sent to our error-monitoring provider so we can fix it.',
        ] },
        { h: '4. Your choices', p: [
          'Because we only store what the service needs to work, there is nothing to opt out of without breaking sign-in. You can clear the stored data at any time in your browser settings \u2014 you will simply be signed out.',
          `Questions: ${c.email || 'see the Contact page'}.`,
        ] },
      ],
    },
    {
      slug: 'acceptable-use', title: 'Acceptable Use Policy', short: 'Acceptable use',
      intro: `These rules keep ${P} safe and reliable for every hospital and patient. They form part of the Terms of Service and apply to everyone who uses an account.`,
      sections: [
        { h: '1. Lawful, clinical use', p: [
          'Use the service only to run a genuine hospital, clinic or healthcare practice, in line with Indian law \u2014 including the Clinical Establishments rules that apply to you, the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.',
          'Record only information you have a lawful reason to keep, and keep it accurate.',
        ] },
        { h: '2. Messages', p: [
          'Send SMS, WhatsApp and e-mail only to people who gave you their number or address for that purpose (appointments, reports, bills, reminders). Promotional messages need the person\u2019s consent and must follow TRAI\u2019s DLT rules and WhatsApp\u2019s policies.',
          'Do not send spam, misleading health claims, or messages that impersonate someone else.',
        ] },
        { h: '3. Security', p: [
          'Do not share logins between people; give each staff member their own account and the lowest role that lets them work. Remove access as soon as someone leaves.',
          'Do not try to reach another hospital\u2019s data, bypass limits or access controls, scan or load-test the service, or upload malware. If you find a security issue, tell us at ' + (c.email || 'our support address') + ' and give us reasonable time to fix it before telling anyone else.',
        ] },
        { h: '4. Content on your website', p: [
          'Your hospital website must not carry unlawful, defamatory or infringing content, or advertising that breaks the rules for medical practitioners and hospitals (for example, guaranteed cures or misleading claims). Use only images and text you have the right to use.',
        ] },
        { h: '5. Fair use', p: [
          'Plans include generous limits. Automated bulk exports, scraping or traffic far beyond normal hospital use may be slowed or paused so other customers are not affected; we will contact you first where we can.',
        ] },
        { h: '6. If the rules are broken', p: [
          'We may remove content, pause messaging, or suspend an account that puts patients, other customers or the service at risk. We tell you why as soon as it is safe to do so, and restore access once the problem is fixed. Your data stays exportable.',
        ] },
      ],
    },
    {
      slug: 'grievance', title: 'Grievance Redressal', short: 'Grievances',
      intro: `How to raise a complaint about ${P} \u2014 about the service, billing, content or personal data \u2014 and how quickly we respond. Published under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal Data Protection Act, 2023.`,
      sections: [
        { h: 'Grievance Officer', p: [
          `${c.grievanceOfficer || 'Grievance Officer'}, ${c.legalName}`,
          c.address,
          [c.email && `E-mail: ${c.email}`, c.phone && `Phone: ${c.phone}`].filter(Boolean).join(' \u00b7 ') || 'Contact details: see the Contact page.',
        ] },
        { h: 'How to complain', p: [
          'Write to the Grievance Officer with: your name and contact details, the hospital account (if any), what happened and when, and what you would like us to do. Add screenshots or invoice numbers if they help.',
          'Patients: your medical records belong to your hospital. For a copy, correction or deletion of your records, contact the hospital first \u2014 its website lists its own grievance officer. Write to us if the hospital does not respond, or if your complaint is about the software itself.',
        ] },
        { h: 'Timelines', p: [
          'We acknowledge every complaint within 24 hours (48 hours on holidays) and resolve it within 15 days. Complaints about personal data are resolved within 30 days at most.',
          'Requests to remove content that is unlawful or that exposes someone\u2019s private or intimate information are acted on within 24 hours of a valid complaint.',
        ] },
        { h: 'If you are not satisfied', p: [
          'You can ask for the decision to be reviewed by a senior member of our team by replying to our answer. For personal-data complaints you may also approach the Data Protection Board of India once our process is complete.',
        ] },
      ],
    },
    {
      slug: 'disclaimer', title: 'Disclaimer', short: 'Disclaimer',
      intro: `Please read this before relying on ${P} or on the content of this website.`,
      sections: [
        { h: 'Not medical advice', p: [
          `${P} is practice-management software. It does not diagnose, treat or give medical advice. Clinical decisions, prescriptions and the medical content recorded in the software are the responsibility of the hospital and its doctors.`,
          'Hospital websites built with the software are run by those hospitals. We do not check or endorse what they publish about doctors, treatments or prices.',
        ] },
        { h: 'Emergencies', p: [
          'Do not use online booking or WhatsApp for medical emergencies. Call 108 / 112 or go to the nearest emergency department.',
        ] },
        { h: 'Website content', p: [
          'Articles, guides and examples on this site (including GST, legal or compliance notes) are general information, written carefully but not a substitute for professional advice for your situation. Rules change; check the current law or ask an adviser before acting.',
          'Screens and examples are illustrative; features depend on your plan and may change as the product improves.',
        ] },
        { h: 'Third-party services', p: [
          'Payments, messaging, domains and hosting rely on third-party providers. Their availability and terms are outside our control, though we choose them carefully and tell you which ones we use.',
        ] },
      ],
    },
    {
      slug: 'sla', title: 'Service Levels & Support', short: 'Service levels',
      intro: `What you can expect from ${P}: availability, backups, support hours and response times. These are targets we work to; Enterprise customers can agree stronger, contractual commitments.`,
      sections: [
        { h: '1. Availability', p: [
          'Target: 99.5% monthly availability of the hospital app and websites, excluding planned maintenance and problems caused by things outside our control (your internet connection, DNS changes at your domain provider, or outages at major cloud providers).',
          'Planned maintenance is done outside clinic hours where possible (usually after 11 pm IST) and announced in the app at least 48 hours ahead if downtime is expected.',
        ] },
        { h: '2. Backups and recovery', p: [
          'Your data is backed up automatically every day and kept for at least 7 days; backups are encrypted. Recovery targets after a major incident: data loss of at most 24 hours and service restored within 8 hours.',
          'You can also download a full export of your hospital\u2019s data at any time from Settings \u2192 Data & backup.',
        ] },
        { h: '3. Support', p: [
          `Support hours: Monday to Saturday, 10:00\u201318:00 IST, by ${[c.email && 'e-mail', c.phone && 'phone / WhatsApp'].filter(Boolean).join(' and ') || 'e-mail'}.`,
          'First response targets: service down for everyone \u2014 within 1 hour, any time; a key feature not working (billing, booking, sign-in) \u2014 within 4 working hours; other questions \u2014 within 1 working day.',
          'Enterprise plans include priority support and a named contact for onboarding.',
        ] },
        { h: '4. Incidents', p: [
          'If an incident affects your hospital we post a notice in the app, keep you updated until it is resolved, and share a short summary of what happened afterwards. Personal-data breaches are reported as set out in the Data Processing Agreement.',
        ] },
        { h: '5. If we miss a target', p: [
          'If monthly availability falls below 99.5% because of us, the owner can ask for a credit of 5% of that month\u2019s plan fee for each full 0.5% below target, up to 25%, as wallet balance or off the next renewal. Ask within 30 days of the month ending.',
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

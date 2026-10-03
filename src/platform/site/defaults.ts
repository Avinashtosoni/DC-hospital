/**
 * The product site's built-in text — shown for any page that was never published from the control panel, and the
 * starting point when someone edits it there. Plan prices come from ../plans.ts (they must match billing).
 */
import { LEGAL_VERSION, legalDocs } from '../legal'
import type { PlatformSite } from './types'

const cta = (title: string, lead: string, button = 'Start free trial', link = '/signup') => ({ title, lead, button, link })

export function defaultSite(): PlatformSite {
  return {
    brand: {
      tagline: 'Hospital management software with your own website',
      logo: '',
      email: '{email}',
      phone: '{phone}',
      whatsapp: '',
      address: '{address}',
      hours: 'Monday to Saturday, 10:00–18:00 IST',
      announcement: { enabled: false, text: 'New: WhatsApp booking bot for Enterprise hospitals.', link: '/features', linkText: 'See what’s new' },
      social: { linkedin: '', x: '', facebook: '', instagram: '', youtube: '' },
      footerText: 'Appointments, records, billing, wards and a beautiful website for Indian hospitals and clinics — in one place.',
    },

    home: {
      seo: {
        title: 'Hospital & clinic management software with your own website',
        description: '{platform} — appointments, patient records, billing, lab, wards, WhatsApp reminders and a hospital website on your own domain. Plans from ₹999/month.',
      },
      hero: {
        badge: 'Made for Indian hospitals & clinics',
        title: 'Run your hospital *and your website* from one place.',
        lead: 'Appointments, patient records, billing, lab, wards and WhatsApp reminders — plus a beautiful hospital website on your own domain. Ready in a day.',
        primary: 'Start free trial',
        secondary: 'Book a guided demo',
        note: 'Free trial, no card · Plans from ₹999/month',
        image: '',
      },
      stats: [
        { value: '6', label: 'roles, one login each' },
        { value: '10+', label: 'modules included' },
        { value: '1 day', label: 'to go live' },
        { value: '₹999', label: 'per month to start' },
      ],
      roles: {
        title: 'One login for every role in your hospital',
        items: [
          { name: 'Owner', text: 'Dashboards, reports, settings' },
          { name: 'Doctor', text: 'Schedule, charts, prescriptions' },
          { name: 'Reception', text: 'Bookings, check-in, beds' },
          { name: 'Accounts', text: 'Bills, payments, expenses' },
          { name: 'Staff', text: 'Lab, inventory, tasks' },
          { name: 'Patient', text: 'Booking, reports, bills' },
        ],
      },
      highlights: {
        eyebrow: 'Features', title: 'Everything a hospital runs on',
        lead: 'No more registers, spreadsheets and five different apps. Every department works on the same live data.',
        items: [
          { icon: 'CalendarCheck', title: 'Appointments & online booking', text: 'Doctor calendars, leaves and holidays, walk-ins and a 30-second booking page for patients — with OTP verification.' },
          { icon: 'FileText', title: 'Patient records & prescriptions', text: 'One record per patient with visits, vitals, prescriptions and reports — and a portal where patients see their own.' },
          { icon: 'CreditCard', title: 'Billing & payments', text: 'Itemised bills, GST-ready invoices, UPI / card / cash payments, dues and daily collection reports.' },
          { icon: 'FlaskConical', title: 'Lab & inventory', text: 'Lab orders and results, medicine and consumable stock with low-stock alerts, and expense tracking.' },
          { icon: 'Bed', title: 'Wards & admissions', text: 'Live bed board, admissions and discharges — so reception always knows what’s free.' },
          { icon: 'Globe2', title: 'Your own website', text: 'A fast, beautiful hospital website on your domain, edited from the dashboard — doctors, services, packages, forms.' },
          { icon: 'Phone', title: 'WhatsApp & SMS', text: 'Booking confirmations, reminders and OTPs on WhatsApp or SMS, plus an optional WhatsApp booking bot.' },
          { icon: 'Activity', title: 'Reports & dashboards', text: 'Revenue, footfall, doctor performance and outstanding dues at a glance for the owner.' },
        ],
      },
      steps: {
        items: [
          { title: 'Pick a plan', text: 'Start with the modules you need — upgrade any time.' },
          { title: 'We set you up', text: 'Your hospital, staff logins and website, on your own domain with SSL.' },
          { title: 'Go live', text: 'Import your patients, invite your team and start booking.' },
        ],
      },
      website: {
        eyebrow: 'Hospital website included', title: 'A website patients *actually book from*',
        lead: 'Every plan includes a fast, mobile-first website on your own domain, connected to your live doctor schedules.',
        points: [
          'Doctor profiles with real-time slots and online booking',
          'Departments, health packages, facilities and gallery',
          'Enquiry and feedback forms that land in your dashboard',
          'Edit text, photos and pages yourself — no developer needed',
          'SSL certificate, SEO basics and Google-friendly speed built in',
        ],
        image: '',
      },
      pricing: { eyebrow: 'Pricing', title: 'Simple, honest pricing', lead: 'Per hospital, per month. Prices exclude GST. Every plan includes your website, SSL certificate, backups and updates.' },
      testimonials: { eyebrow: 'Customers', title: 'Hospitals that run on {platform}', lead: '', items: [] },
      faq: {
        eyebrow: 'FAQ', title: 'Questions, answered', lead: '',
        items: [
          { q: 'Do I need to install anything?', a: 'No. Everything runs in the browser on any computer, tablet or phone, and can be installed as an app from the browser.' },
          { q: 'Can I use my own domain?', a: 'Yes. Your website and dashboard run on your own domain (for example www.yourhospital.in). We give you one DNS record to add and handle the SSL certificate for you.' },
          { q: 'Is my hospital’s data separate from other hospitals?', a: 'Yes. Every hospital’s data is isolated in the database itself, each staff member only sees what their role allows, and sensitive actions are logged.' },
          { q: 'Can you move my data from my old software?', a: 'Yes — patients, doctors and other masters can be imported. Enterprise plans include assisted migration.' },
        ],
      },
      cta: cta('Ready to run your hospital on one system?', 'Start a free trial today — no card needed. Or talk to us and we’ll set everything up for you.'),
    },

    features: {
      seo: { title: 'Features', description: 'Every {platform} module in detail: appointments, OPD, patient records, prescriptions, billing & GST, lab, inventory, wards, website CMS, WhatsApp and reports.' },
      heading: { eyebrow: 'Features', title: 'One system for the *whole hospital*', lead: 'From the reception desk to the owner’s dashboard — every department on the same live data, with the right access for each role.' },
      modules: [
        { icon: 'CalendarCheck', title: 'Appointments & online booking', summary: 'Fill your OPD without phone tag.', image: '', points: [
          'Doctor-wise calendars with slots, leaves and holidays', 'Walk-ins and phone bookings from reception in seconds',
          'Online booking on your website with mobile OTP', 'Confirmation and reminder messages on WhatsApp / SMS', 'Reschedule and cancel with one click'] },
        { icon: 'FileText', title: 'Patient records & prescriptions', summary: 'Every visit, in one place.', image: '', points: [
          'Single record per patient with UHID', 'Vitals, diagnosis, notes and visit history', 'Digital prescriptions with print / PDF',
          'Reports and documents attached to the record', 'Patient portal: appointments, prescriptions and bills'] },
        { icon: 'CreditCard', title: 'Billing, payments & GST', summary: 'Know exactly what came in today.', image: '', points: [
          'Itemised bills for consultation, procedures, lab and pharmacy items', 'Cash, UPI, card and part-payments with receipts',
          'GST-ready invoices and dues tracking', 'Daily collection and expense reports', 'Accountant role with only the money screens'] },
        { icon: 'FlaskConical', title: 'Lab & inventory', summary: 'Tests and stock under control.', image: '', points: [
          'Lab orders from the doctor, results recorded by staff', 'Medicine and consumable stock with low-stock alerts',
          'Expense tracking by category', 'Purchase and usage history'] },
        { icon: 'Bed', title: 'Wards, beds & admissions', summary: 'A live bed board for IPD.', image: '', points: [
          'Wards and beds with live status', 'Admit, transfer and discharge patients', 'Prevents double-booking a bed', 'Admission history on the patient record'] },
        { icon: 'Globe2', title: 'Hospital website & CMS', summary: 'Your brand, your domain.', image: '', points: [
          'Beautiful, fast website on your own domain with SSL', 'Doctors, departments, packages, gallery, blog-style pages',
          'Enquiry, feedback and custom forms', 'Edit everything yourself with draft and publish', 'Search-engine friendly titles and descriptions'] },
        { icon: 'Phone', title: 'WhatsApp, SMS & e-mail', summary: 'Patients informed automatically.', image: '', points: [
          'Booking confirmations, reminders and OTPs', 'Use our shared accounts or connect your own', 'Optional WhatsApp booking bot', 'Message templates you can edit'] },
        { icon: 'Activity', title: 'Reports & owner dashboard', summary: 'The numbers that matter.', image: '', points: [
          'Revenue, collections and outstanding dues', 'Footfall and doctor-wise performance', 'Department and service trends', 'Export to Excel / CSV'] },
        { icon: 'Users', title: 'Staff & roles', summary: 'Everyone sees only what they need.', image: '', points: [
          'Owner, doctor, receptionist, accountant, staff and patient roles', 'Invite staff by link; remove access in one click',
          'Audit log of sensitive actions', 'Salaries visible only to owner and accounts'] },
      ],
      extras: {
        eyebrow: 'Also included', title: 'The small things that save hours', lead: '',
        items: [
          { icon: 'MonitorDot', title: 'Works everywhere', text: 'Any browser on desktop, tablet or phone — install it as an app.' },
          { icon: 'ShieldCheck', title: 'Secure by design', text: 'Data isolated per hospital, role-based access and encrypted connections.' },
          { icon: 'Clock', title: 'Daily backups', text: 'Automatic backups and a full export whenever you want it.' },
          { icon: 'HeartHandshake', title: 'Indian support team', text: 'Help in English and Hindi on working days.' },
        ],
      },
      cta: cta('See it with your own hospital’s data', 'Start a free trial and set up your doctors in minutes.'),
    },

    pricing: {
      seo: { title: 'Pricing', description: '{platform} plans: Clinic ₹999, Hospital ₹2,999 and Enterprise from ₹7,999 per month. Free trial, no card. Your website, SSL, backups and updates included.' },
      heading: { eyebrow: 'Pricing', title: 'Simple, *honest* pricing', lead: 'Per hospital, per month. Prices exclude GST. Every plan includes your website, SSL certificate, backups and updates.' },
      note: 'Yearly billing available. Need a different mix of modules? Choose Custom and we’ll quote for exactly what you use.',
      compare: {
        title: 'Compare plans',
        rows: [
          { feature: 'Appointments & online booking', clinic: '✓', hospital: '✓', enterprise: '✓' },
          { feature: 'Patient records & prescriptions', clinic: '✓', hospital: '✓', enterprise: '✓' },
          { feature: 'Billing & GST invoices', clinic: '✓', hospital: '✓', enterprise: '✓' },
          { feature: 'Patient portal', clinic: '✓', hospital: '✓', enterprise: '✓' },
          { feature: 'Website on your own domain', clinic: '✓', hospital: '✓', enterprise: '✓' },
          { feature: 'Wards, beds & admissions', clinic: '—', hospital: '✓', enterprise: '✓' },
          { feature: 'Lab, inventory & expenses', clinic: '—', hospital: '✓', enterprise: '✓' },
          { feature: 'Staff roles', clinic: 'Owner + doctor', hospital: 'All roles', enterprise: 'All roles' },
          { feature: 'WhatsApp / SMS reminders & OTP', clinic: '—', hospital: '✓', enterprise: '✓' },
          { feature: 'WhatsApp booking bot', clinic: '—', hospital: '—', enterprise: '✓' },
          { feature: 'Messages included / month (WhatsApp · SMS)', clinic: '300 · 100', hospital: '1,500 · 500', enterprise: '5,000 · 2,000' },
          { feature: 'Data import from old software', clinic: 'Self-service', hospital: 'Self-service', enterprise: 'Done for you' },
          { feature: 'Support', clinic: 'E-mail', hospital: 'E-mail & phone', enterprise: 'Priority + onboarding' },
        ],
      },
      addons: {
        eyebrow: 'Add-ons', title: 'Pay only for what you use', lead: '',
        items: [
          { title: 'Extra messages', price: 'Prepaid wallet', text: 'Messages beyond your plan are charged from a top-up wallet at the rates shown in Billing.' },
          { title: 'Data migration', price: 'On quote', text: 'We move patients, doctors and history from your old software for you.' },
          { title: 'On-site training', price: 'On quote', text: 'Our team trains your reception, doctors and accounts at your hospital.' },
        ],
      },
      faqs: [
        { q: 'Is there a free trial?', a: 'Yes. Every new hospital gets a free trial with all the features of its plan. No card is needed.' },
        { q: 'What happens when the trial ends?', a: 'Choose a plan to continue. If you don’t, the account becomes read-only after a short grace period — you can still sign in and export everything.' },
        { q: 'Do prices include GST?', a: 'No, prices are before GST. You get a GST tax invoice for every payment.' },
        { q: 'Can I change plans later?', a: 'Yes, upgrade or downgrade any time from Billing & plan.' },
      ],
      cta: cta('Start free — upgrade when you’re ready', 'No card, no setup fee. Your website and dashboard in a day.'),
    },

    solutions: {
      seo: { title: 'Solutions', description: '{platform} for single-doctor clinics, multi-speciality hospitals, nursing homes and hospital groups.' },
      heading: { eyebrow: 'Solutions', title: 'Built for *your kind* of practice', lead: 'Start small and add modules as you grow — the same system works for a one-doctor clinic and a 200-bed hospital.' },
      items: [
        { icon: 'Stethoscope', title: 'Clinics & solo doctors', lead: 'Spend time on patients, not registers.', plan: 'clinic', image: '', points: [
          'Online booking with your own clinic website', 'Digital prescriptions in under a minute', 'Bills, receipts and daily collection on your phone', 'Patients see their prescriptions in the portal'] },
        { icon: 'Building2', title: 'Multi-speciality hospitals', lead: 'Every department on the same page.', plan: 'hospital', image: '', points: [
          'Reception, doctors, accounts and staff each with their own screens', 'Live bed board, admissions and discharge', 'Lab orders, inventory and expenses', 'WhatsApp reminders reduce no-shows'] },
        { icon: 'Bed', title: 'Nursing homes & maternity centres', lead: 'IPD and billing without the paperwork.', plan: 'hospital', image: '', points: [
          'Admissions with bed and ward tracking', 'Itemised IPD bills with part-payments', 'Health packages on your website', 'Feedback forms after discharge'] },
        { icon: 'Award', title: 'Hospital groups & chains', lead: 'Scale with confidence.', plan: 'enterprise', image: '', points: [
          'Higher limits for doctors, staff and data', 'Assisted migration from your old software', 'WhatsApp booking bot', 'Priority support and onboarding'] },
      ],
      cta: cta('Not sure which plan fits?', 'Tell us about your hospital and we’ll recommend the right setup.', 'Talk to us', '/contact'),
    },

    security: {
      seo: { title: 'Security & privacy', description: 'How {platform} protects hospital and patient data: isolation per hospital, role-based access, encryption, audit logs, backups and DPDP Act readiness.' },
      heading: { eyebrow: 'Security & privacy', title: 'Patient data deserves *serious protection*', lead: 'Security is built into the database itself — not bolted on afterwards.' },
      items: [
        { icon: 'ShieldCheck', title: 'Isolation per hospital', text: 'Every row is tagged with its hospital and the database refuses to show it to anyone else — even if the app had a bug.' },
        { icon: 'Users', title: 'Role-based access', text: 'Doctors, reception, accounts and staff each see only the screens and records their role needs. Salaries stay private.' },
        { icon: 'BadgeCheck', title: 'Encryption', text: 'All connections use HTTPS / TLS; backups are encrypted; passwords are never stored in plain text.' },
        { icon: 'ClipboardList', title: 'Audit logs', text: 'Sensitive actions — billing changes, deletions, support access — are recorded with who and when.' },
        { icon: 'Clock', title: 'Backups & export', text: 'Daily automatic backups, and a full export of your data whenever you want it.' },
        { icon: 'FileCheck2', title: 'Your data stays yours', text: 'We never sell data or use it for advertising. When you leave, you get a full export and we delete the rest.' },
      ],
      compliance: {
        eyebrow: 'Compliance', title: 'Ready for India’s privacy law', lead: 'Tools that help you meet the Digital Personal Data Protection Act, 2023.',
        points: [
          'Data Processing Agreement included with every plan',
          'Patient data access, correction and deletion from the app',
          'Consent records for online booking and forms',
          'Breach notification process and Grievance Officer',
          'Support access by our team is logged and time-limited',
        ],
      },
      note: 'Found a security issue? Please tell us at {email} — we respond quickly and appreciate responsible disclosure.',
      cta: cta('Questions from your IT or compliance team?', 'We’re happy to answer security questionnaires and walk them through how it works.', 'Contact us', '/contact'),
    },

    about: {
      seo: { title: 'About us', description: '{platform} is built by {company} to give Indian hospitals and clinics simple, affordable software and a great website.' },
      heading: { eyebrow: 'About us', title: 'Software that *hospitals enjoy* using', lead: 'We build {platform} for the hospitals and clinics that keep India healthy — especially the ones big software forgot.' },
      story: [
        'Most hospitals we met were running on paper registers, a billing program from another decade and a website nobody could update. The software that did exist was expensive, complicated and needed an IT team.',
        '{platform} brings everything into one simple system: appointments, records, billing, wards, messages and a beautiful website — in the browser, on any device, set up in a day.',
        'We are {company}, based in {address}. We build, host and support {platform} ourselves, and we listen closely to the doctors, receptionists and owners who use it every day.',
      ],
      image: '',
      mission: { title: 'Our mission', text: 'Give every hospital and clinic in India software that is simple, affordable and trustworthy — so they can spend their time on patients.' },
      vision: { title: 'Our vision', text: 'A country where booking a doctor, getting a prescription and paying a bill is as easy at a small-town clinic as at a big-city hospital.' },
      values: {
        eyebrow: 'Values', title: 'What we care about', lead: '',
        items: [
          { icon: 'Lightbulb', title: 'Simple first', text: 'If reception needs training to use it, we haven’t finished designing it.' },
          { icon: 'ShieldCheck', title: 'Trust', text: 'Patient data is protected like it’s our own family’s.' },
          { icon: 'HandHeart', title: 'Fair pricing', text: 'Honest, published prices — no surprises, no lock-in.' },
          { icon: 'HeartHandshake', title: 'Real support', text: 'People who answer, in your language.' },
        ],
      },
      team: { eyebrow: 'Team', title: 'The people behind {platform}', lead: '', items: [] },
      cta: cta('Let’s build a better hospital together', 'Start a free trial or talk to our team.'),
    },

    contact: {
      seo: { title: 'Contact us', description: 'Talk to the {platform} team — demos, pricing, onboarding and support.' },
      heading: { eyebrow: 'Contact', title: 'Let’s set up *your hospital*', lead: 'Tell us a little about your hospital or clinic — we’ll call you back within one working day with a demo and a quote.' },
      formTitle: 'Request a call back',
      thanks: 'We’ve received your details and will call you soon.',
      mapUrl: '',
    },

    faq: {
      seo: { title: 'FAQ', description: 'Answers about {platform}: setup, pricing, data security, websites, WhatsApp, migration and support.' },
      heading: { eyebrow: 'FAQ', title: 'Frequently asked *questions*', lead: 'Can’t find your answer? Write to us — we reply within one working day.' },
      groups: [
        { title: 'Getting started', items: [
          { q: 'Do I need to install anything?', a: 'No. Everything runs in the browser on any computer, tablet or phone, and can be installed as an app from the browser.' },
          { q: 'How long does setup take?', a: 'Most clinics are live the same day. Hospitals usually take a day or two to add doctors, staff and their website content.' },
          { q: 'Can you move my data from my old software?', a: 'Yes — patients, doctors and other masters can be imported from Excel / CSV. Enterprise plans include assisted migration.' },
        ] },
        { title: 'Website & domain', items: [
          { q: 'Can I use my own domain?', a: 'Yes. Your website and dashboard run on your own domain (for example www.yourhospital.in). We give you one DNS record to add and handle the SSL certificate for you.' },
          { q: 'Can I edit the website myself?', a: 'Yes. Text, photos, doctors, departments and packages are edited from the dashboard, with draft and publish.' },
        ] },
        { title: 'Data & security', items: [
          { q: 'Is my hospital’s data separate from other hospitals?', a: 'Yes. Every hospital’s data is isolated in the database itself, each staff member only sees what their role allows, and sensitive actions are logged.' },
          { q: 'Can I export my data?', a: 'Any time, from Settings → Data & backup — including after your plan ends.' },
          { q: 'Who can see patient records?', a: 'Only your own staff, according to their role. Our support team can look only when you ask for help, and every access is logged.' },
        ] },
        { title: 'Billing', items: [
          { q: 'Is there a free trial?', a: 'Yes, with no card needed.' },
          { q: 'How do I pay?', a: 'Online by UPI, card or net banking through Razorpay. You get a GST invoice for every payment.' },
          { q: 'Can I get a refund?', a: 'Yes — see our Refund & Cancellation Policy for details.' },
        ] },
      ],
      cta: cta('Still have questions?', 'Our team is happy to help.', 'Contact us', '/contact'),
    },

    blog: {
      seo: { title: 'Blog', description: 'Guides for hospital and clinic owners: running an OPD, GST billing, patient communication, websites and more from {platform}.' },
      heading: { eyebrow: 'Blog', title: 'Guides for *better hospitals*', lead: 'Practical advice on running a hospital or clinic — from the {platform} team.' },
      empty: 'Our first articles are on their way. Check back soon!',
      cta: cta('Put these ideas to work', 'Try {platform} free for your hospital.'),
    },

    legal: {
      docs: legalDocs().map((d) => ({ slug: d.slug, title: d.title, short: d.short, updated: LEGAL_VERSION, intro: d.intro, sections: d.sections })),
    },
  }
}

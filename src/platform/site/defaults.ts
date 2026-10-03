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
      problems: {
        eyebrow: 'Why switch', title: 'From registers and rush to *calm, connected care*',
        lead: 'Most hospitals juggle paper registers, a separate billing program, WhatsApp groups and a website nobody updates. {platform} replaces all of it.',
        before: [
          'Patients queue at the desk because nobody knows which slots are free',
          'Doctors flip through old files to find last visit’s prescription',
          'Bills are typed twice and dues are tracked in a notebook',
          'Reminders depend on someone remembering to call',
          'The owner sees the day’s collection only at closing time',
          'The website still shows doctors who left two years ago',
        ],
        after: [
          'Live doctor calendars — patients book online or at the desk in seconds',
          'Every visit, vital and prescription on one patient record',
          'Bills generated from the visit, with UPI / card / cash and automatic receipts',
          'WhatsApp and SMS confirmations and reminders go out on their own',
          'Revenue, footfall and dues on the owner’s phone, in real time',
          'Website updated from the dashboard — doctors and slots always current',
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
      india: {
        eyebrow: 'Made for India', title: 'Built around how *Indian hospitals* actually work', lead: 'Not a foreign product with a rupee sign added — designed for Indian patients, staff, payments and rules from day one.',
        items: [
          { icon: 'Wallet', title: 'UPI, cards & cash', text: 'Take payments the way patients pay — UPI, card, cash or part-payment — with instant receipts.' },
          { icon: 'FileCheck2', title: 'GST-ready billing', text: 'Bills with your hospital’s GSTIN and tax details — and a proper GST tax invoice for every subscription payment you make.' },
          { icon: 'Phone', title: 'WhatsApp first', text: 'Patients in India live on WhatsApp — confirmations, reminders and reports go there, with SMS as backup.' },
          { icon: 'ShieldCheck', title: 'DPDP Act ready', text: 'Consent records, patient data requests and a Grievance Officer flow for the Digital Personal Data Protection Act, 2023.' },
          { icon: 'Users', title: 'Hindi & English support', text: 'Talk to people who understand hospitals in Bihar, UP, Delhi or Kerala — in the language you prefer.' },
          { icon: 'MonitorDot', title: 'Works on low bandwidth', text: 'A light app that runs on an ordinary laptop or phone, even on a slow connection.' },
        ],
      },
      integrations: {
        title: 'Works with the services you already use',
        items: ['WhatsApp', 'SMS (DLT)', 'E-mail', 'Razorpay', 'UPI', 'Google Maps', 'Cloudflare SSL', 'Excel / CSV import'],
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
          { q: 'What if my internet goes down?', a: 'The app is light and recovers the moment you are back online. Many hospitals keep a mobile hotspot as backup — the app works the same on a phone connection.' },
          { q: 'How long is the free trial?', a: 'Long enough to set up your doctors and try real bookings. No card is needed, and you can ask us to extend it if you need more time.' },
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
        { icon: 'Smile', title: 'Patient portal', summary: 'Patients help themselves.', image: '', points: [
          'Book appointments online', 'See prescriptions, lab reports and bills', 'Works on any phone — no app to install',
          'Fewer calls to reception for “is my report ready?”'] },
        { icon: 'CalendarDays', title: 'Doctor schedules, leaves & holidays', summary: 'No more double bookings.', image: '', points: [
          'Weekly timings per doctor with slot length', 'Leaves and hospital holidays block booking automatically',
          'Walk-in queue alongside booked slots', 'Doctors see their day on the phone'] },
        { icon: 'ClipboardCheck', title: 'Feedback, notices & enquiries', summary: 'Listen, inform, follow up.', image: '', points: [
          'Feedback request after the visit, with ratings for the owner', 'Notices for staff',
          'Website enquiries and custom forms in one inbox', 'Star, note and close each enquiry'] },
        { icon: 'FileText', title: 'Data export & backups', summary: 'Your data is always yours.', image: '', points: [
          'Full export of your hospital’s data as a ZIP, any time', 'Excel / CSV exports from every list',
          'Automatic daily backups', 'Import patients and doctors from your old software'] },
      ],
      journey: {
        eyebrow: 'A patient’s day', title: 'One record follows the patient *from booking to follow-up*', lead: 'Every step updates the same record, so nobody re-types anything and nothing gets lost between desks.',
        items: [
          { title: 'Books', text: 'Online with OTP, on WhatsApp, or at the reception desk — the slot is held instantly.' },
          { title: 'Gets reminded', text: 'Confirmation and a reminder before the visit, on WhatsApp or SMS.' },
          { title: 'Checks in', text: 'Reception marks arrival; the doctor sees who is waiting.' },
          { title: 'Consults', text: 'Vitals, notes, prescription and lab orders on one screen; prescription printed or shared.' },
          { title: 'Pays', text: 'The bill is built from the visit; UPI, card or cash; receipt on WhatsApp.' },
          { title: 'Comes back', text: 'Reports in the portal, a feedback request, and easy re-booking for the follow-up.' },
        ],
      },
      byRole: {
        eyebrow: 'For every role', title: 'Each person sees *exactly what they need*', lead: 'Simple screens for each job — and nothing they shouldn’t see.',
        items: [
          { name: 'Owner', icon: 'Award', points: ['Live revenue, collections and dues', 'Doctor and department performance', 'Staff, roles and settings', 'Website and messaging control'] },
          { name: 'Doctor', icon: 'Stethoscope', points: ['Today’s queue and schedule', 'Patient history at a glance', 'Prescriptions in under a minute', 'Lab orders and results'] },
          { name: 'Reception', icon: 'CalendarCheck', points: ['Book, check in and reschedule fast', 'Register new patients in seconds', 'Bed availability', 'Website enquiries'] },
          { name: 'Accounts', icon: 'Wallet', points: ['Bills, payments and receipts', 'Dues follow-up', 'Expenses and daily collection', 'Exports for your CA'] },
          { name: 'Staff', icon: 'FlaskConical', points: ['Lab results entry', 'Inventory and stock alerts', 'Tasks and notices', 'Only the screens they need'] },
          { name: 'Patient', icon: 'Smile', points: ['Online booking', 'Prescriptions and reports', 'Bills and payments', 'Reminders on WhatsApp'] },
        ],
      },
      extras: {
        eyebrow: 'Also included', title: 'The small things that save hours', lead: '',
        items: [
          { icon: 'MonitorDot', title: 'Works everywhere', text: 'Any browser on desktop, tablet or phone — install it as an app.' },
          { icon: 'ShieldCheck', title: 'Secure by design', text: 'Data isolated per hospital, role-based access and encrypted connections.' },
          { icon: 'Clock', title: 'Daily backups', text: 'Automatic backups and a full export whenever you want it.' },
          { icon: 'HeartHandshake', title: 'Indian support team', text: 'Help in English and Hindi on working days.' },
          { icon: 'Lightbulb', title: 'Regular updates', text: 'New features arrive automatically — no reinstalling, no upgrade fees.' },
          { icon: 'Globe2', title: 'Your own domain', text: 'Website and dashboard on your hospital’s address, with free SSL.' },
          { icon: 'Timer', title: 'Fast everywhere', text: 'Pages load quickly even on mobile data — patients don’t wait.' },
          { icon: 'Accessibility', title: 'Accessible', text: 'Readable fonts, keyboard navigation and screen-reader labels.' },
        ],
      },
      cta: cta('See it with your own hospital’s data', 'Start a free trial and set up your doctors in minutes.'),
    },

    pricing: {
      seo: { title: 'Pricing', description: '{platform} plans: Clinic ₹999, Hospital ₹2,999 and Enterprise from ₹7,999 per month. Free trial, no card. Your website, SSL, backups and updates included.' },
      heading: { eyebrow: 'Pricing', title: 'Simple, *honest* pricing', lead: 'Per hospital, per month. Prices exclude GST. Every plan includes your website, SSL certificate, backups and updates.' },
      note: 'Yearly billing available. Need a different mix of modules? Choose Custom and we’ll quote for exactly what you use.',
      included: {
        eyebrow: 'In every plan', title: 'No hidden extras', lead: 'These come with every plan, from Clinic to Enterprise.',
        items: [
          'Hospital website on your own domain', 'Free SSL certificate', 'Daily automatic backups', 'Full data export any time',
          'All updates and new features', 'Patient portal', 'Role-based staff logins', 'GST tax invoice for every payment',
          'Data Processing Agreement (DPDP)', 'Support by e-mail',
        ],
      },
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
        { q: 'Is there a setup fee?', a: 'No. Self-service setup is free. Enterprise onboarding, on-site training and assisted data migration can be quoted separately if you want them.' },
        { q: 'Do you charge per doctor or per user?', a: 'No — plans are per hospital. Add the staff you need; Enterprise raises the limits for very large teams.' },
        { q: 'How do messages work?', a: 'Each plan includes a monthly number of WhatsApp, SMS and e-mail messages on our shared accounts. Beyond that, messages are charged from a prepaid wallet — or connect your own provider.' },
        { q: 'Do you offer a yearly discount?', a: 'Yes. A yearly plan costs fewer months than paying monthly — see Billing & plan inside the app for the current offer.' },
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
        { icon: 'Microscope', title: 'Diagnostic centres & labs', lead: 'Orders in, reports out — on time.', plan: 'hospital', image: '', points: [
          'Test orders linked to the patient record', 'Results entered once and shared in the portal', 'Health packages with online booking', 'Bills and dues for every test'] },
        { icon: 'Video', title: 'Day-care & speciality centres', lead: 'Planned procedures, smooth paperwork.', plan: 'hospital', image: '', points: [
          'Pre-booked procedures with reminders', 'Short-stay admissions and discharge', 'Itemised procedure billing', 'Feedback after every visit'] },
      ],
      specialities: {
        eyebrow: 'Specialities', title: 'Ready for *every speciality*', lead: 'Departments, doctors and services are yours to define — the same system adapts to how each speciality works.',
        items: [
          { icon: 'HeartPulse', title: 'Cardiology', text: 'Follow-up schedules and long-term patient history.' },
          { icon: 'Baby', title: 'Paediatrics & maternity', text: 'Family records, appointment reminders and IPD stays.' },
          { icon: 'Bone', title: 'Orthopaedics', text: 'Procedures, admissions and physiotherapy follow-ups.' },
          { icon: 'Eye', title: 'Eye care', text: 'Quick OPD flow, prescriptions and repeat visits.' },
          { icon: 'Smile', title: 'Dental', text: 'Multi-sitting treatments with part-payments.' },
          { icon: 'Brain', title: 'Neurology & psychiatry', text: 'Private notes and careful, role-based access.' },
          { icon: 'Microscope', title: 'Pathology & radiology', text: 'Test orders, results and report sharing.' },
          { icon: 'Stethoscope', title: 'General medicine', text: 'High-volume OPD with walk-ins and booked slots.' },
        ],
      },
      switching: {
        eyebrow: 'Switching is easy', title: 'Live in days, *not months*', lead: 'No servers to buy, no long implementation project.',
        items: [
          { title: 'Day 1 — Set up', text: 'Create your hospital, add departments, doctors and timings. Your website goes live on a temporary address.' },
          { title: 'Day 2 — Bring your data', text: 'Import patients and doctors from Excel or your old software. Invite your staff with their own logins.' },
          { title: 'Day 3 — Train & test', text: 'Reception and doctors try real bookings and bills. We answer questions as they come.' },
          { title: 'Go live', text: 'Point your domain, switch on WhatsApp reminders and start booking patients online.' },
        ],
      },
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
      access: {
        eyebrow: 'Who sees what', title: 'Access by role, *enforced by the database*', lead: 'These rules are checked on the server for every request — hiding a button is never the only protection.',
        rows: [
          { role: 'Owner', can: 'Everything in the hospital: reports, settings, staff, billing, website', cannot: 'Other hospitals’ data' },
          { role: 'Doctor', can: 'Own schedule, patient records, prescriptions, lab orders', cannot: 'Salaries, settings, other doctors’ prescriptions' },
          { role: 'Reception', can: 'Bookings, patient registration, check-in, beds, unpaid bills', cannot: 'Salaries, staff directory, reports' },
          { role: 'Accounts', can: 'Bills, payments, expenses, financial reports', cannot: 'Clinical notes, settings' },
          { role: 'Staff', can: 'Lab results, inventory, assigned tasks', cannot: 'Billing, reports, settings' },
          { role: 'Patient', can: 'Own appointments, prescriptions, reports and bills', cannot: 'Anyone else’s records' },
          { role: '{platform} support', can: 'Help when you ask — every access logged, sign-in sessions limited to 30 minutes', cannot: 'Sell, share or use your data for anything else' },
        ],
      },
      faqs: [
        { q: 'Where is our data stored?', a: 'In a managed PostgreSQL database in India (Supabase on AWS, Mumbai region), with encrypted backups.' },
        { q: 'Can your team see our patients’ records?', a: 'Only when you ask us for help, and every access is recorded in your hospital’s audit log. Support sessions are time-limited and need a written reason.' },
        { q: 'What happens to our data if we leave?', a: 'You can export everything at any time. When an account is closed you get a notice period to download it; then it is permanently deleted, except invoices the law requires us to keep.' },
        { q: 'Do you sign a data processing agreement?', a: 'Yes — our Data Processing Agreement is part of the Terms of Service for every plan, so it applies automatically.' },
        { q: 'How do you handle a data breach?', a: 'We inform affected hospitals quickly (we aim for within 24 hours) with what we know and what we are doing, so you can meet your own reporting duties under the DPDP Act.' },
      ],
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
      approach: {
        eyebrow: 'How we work', title: 'Built *with* hospitals, not just for them', lead: '',
        items: [
          { title: 'We sit at the front desk', text: 'Features start from watching how reception, doctors and accounts really work — not from a spec sheet.' },
          { title: 'We ship small and often', text: 'Improvements arrive every few weeks, automatically, without disturbing your day.' },
          { title: 'We keep it affordable', text: 'One honest price per hospital, so a small clinic can use the same software as a large hospital.' },
          { title: 'We protect what matters', text: 'Patient privacy and data safety are designed in from the database up, and checked with every change.' },
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
      next: {
        eyebrow: 'What happens next', title: 'From hello to live in a few days', lead: '',
        items: [
          { title: 'We call you', text: 'Within one working day, to understand your hospital, doctors and current software.' },
          { title: 'A guided demo', text: 'A 30-minute screen-share using examples from your own speciality.' },
          { title: 'Your quote & trial', text: 'A clear price for the plan that fits, and a free trial set up for you.' },
          { title: 'Go live', text: 'We help you import data, train staff and connect your domain.' },
        ],
      },
      faqs: [
        { q: 'I’m an existing customer — how do I get support?', a: 'E-mail us with your hospital name and a screenshot if possible. Urgent problems: call or WhatsApp during office hours.' },
        { q: 'Can you visit our hospital?', a: 'For Enterprise customers we can arrange on-site onboarding and training. Everyone else gets online setup help.' },
        { q: 'Do you work with hospital groups or partners?', a: 'Yes — write to us about multi-hospital setups, reseller or implementation partnerships.' },
      ],
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
          { q: 'Do I get a GST invoice?', a: 'Yes, a GST tax invoice for every payment, downloadable from Billing & plan.' },
        ] },
        { title: 'WhatsApp & SMS', items: [
          { q: 'Do I need my own WhatsApp Business account?', a: 'No. You can start on our shared accounts with messages included in your plan, or connect your own WhatsApp / SMS provider later.' },
          { q: 'Which messages are sent automatically?', a: 'Booking confirmations, reminders, OTPs for online booking, and other events you switch on — each with a template you can edit.' },
          { q: 'What about DLT registration for SMS?', a: 'SMS in India needs DLT-registered templates. We help you set up the templates you need; if you use your own sender ID, your SMS provider registers them with you.' },
        ] },
        { title: 'Support & training', items: [
          { q: 'How do I get help?', a: 'By e-mail on working days; Hospital and Enterprise plans also get phone support. See Service Levels & Support for response times.' },
          { q: 'Do you train my staff?', a: 'Every account gets online setup help, and the screens are designed to be learnt in minutes. Enterprise plans include onboarding sessions.' },
          { q: 'Is the software updated regularly?', a: 'Yes. Updates are automatic and free — you always have the latest version.' },
        ] },
        { title: 'Patients', items: [
          { q: 'Do patients need to install an app?', a: 'No. They book on your website and get messages on WhatsApp or SMS. The patient portal works in any browser.' },
          { q: 'How do patients get their reports?', a: 'In the patient portal, once the result is entered by your staff.' },
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

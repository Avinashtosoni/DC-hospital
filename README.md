# DC Hospital · Management System

A full-stack **Hospital Management System** for hospital owners, doctors, receptionists, accountants, staff and patients. It's built with **React + TypeScript + Tailwind** and runs on **Supabase** (Postgres, Auth and Row Level Security).

![stack](https://img.shields.io/badge/React-18-61dafb) ![stack](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ecf8e) ![stack](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

| Area | What's included |
| --- | --- |
| **Auth** | Email/password sign-in and patient self-registration. There are 6 roles, with role-based navigation, page guards and permissions for each action. |
| **Dashboards** | A dashboard for each role: owner KPIs and revenue charts, the doctor's patient queue, front-desk quick actions, accountant cash-flow, the staff task list and a patient portal. |
| **Patients** | Full CRUD, auto-generated MRNs and a health record page with tabs for appointments, prescriptions, labs, admissions and billing. |
| **Appointments** | Book / confirm / check-in / complete / cancel / no-show. Patients book, **reschedule** and cancel their own appointments (the database enforces the slot rules). |
| **Prescriptions** | E-prescriptions with a medicines editor and a printable prescription. |
| **Laboratory** | Test orders tracked from requested → sample collected → in progress → completed, with results. |
| **IPD** | Admissions, bed allocation and discharge. A visual board shows occupancy for every ward and bed. |
| **Billing** | Invoices with line items, discount and GST. Recording a payment updates the balance and status automatically. Invoices are printable. |
| **Finance** | Expenses, a P&L report, revenue by source, expenses by category, top doctors, and CSV export. |
| **Operations** | Pharmacy and inventory (low-stock and expiry alerts, one-click restock), a notice board with audience targeting, users and roles, and settings. |
| **Patient experience** | **Hindi / English** switch, **installable app (PWA)**, **PDF downloads** of lab reports and bills, **self-reschedule**, **post-visit rating**, and a **WhatsApp booking chatbot**. See [Patient experience](#patient-experience). |
| **UX** | Skeleton loaders, empty states, **optimistic create/update/delete with rollback**, toasts, responsive layout with a mobile drawer, search, filters, sorting and server-side pagination (no row limit), and an *unsaved changes* prompt on forms. |

## Quick start (demo mode, no backend needed)

```bash
npm install
npm run dev          # http://localhost:5173
```

Without Supabase credentials, the app runs in **demo mode**. It loads realistic seed data (80 patients, 14 doctors, 350+ appointments, 800+ invoices, 6 months of finances) and saves every change in your browser's `localStorage`. You can restore the original data from **Settings → Reset demo data**.

### Demo accounts (password `Demo@123`)

| Role | Email |
| --- | --- |
| Hospital Owner | owner@dchospital.com |
| Doctor | doctor@dchospital.com |
| Receptionist | reception@dchospital.com |
| Accountant | accounts@dchospital.com |
| Staff (Head Nurse) | staff@dchospital.com |
| Patient | patient@dchospital.com |

The login screen also has one-click buttons for each account.

## Using Supabase (persistent, multi-user)

1. Create a Supabase project, then open **SQL Editor → New query**.
2. Paste and run **[`supabase/master.sql`](supabase/master.sql)** (demo / staging) — or **[`supabase/production.sql`](supabase/production.sql)** for a real hospital (see [Going live](#going-live)). `master.sql` creates:
   - all 15 tables, constraints and indexes
   - helper functions (`has_role`, `my_patient_id`, …)
   - triggers: `updated_at`, auto profile + patient record on sign-up, a role-change guard, and admission ↔ bed/patient status sync
   - **Row Level Security policies** for every table and role (generated from `src/auth/permissions.ts`, the same matrix the UI uses)
   - the 6 demo login accounts and all demo data, with dates relative to `current_date` so the data always looks current
3. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Restart `npm run dev` and sign in with a demo account.

> ⚠️ Re-running `master.sql` drops and recreates all DC Hospital tables, replacing their data with the demo data.

New users who sign up become **patients**. To add staff, the owner uses **Users & Roles → Invite staff**: pick the role, and the invitee gets an SMS / WhatsApp / e-mail link (`/register?invite=…`, valid 14 days, single use). Signing up with the invited e-mail gives them that role automatically; any other e-mail just becomes a patient. Only the owner can change roles, and the database enforces this.

### Regenerating the master SQL

The schema lives in `scripts/sql/schema.sql`, the permission matrix in `src/auth/permissions.ts` and the demo data in `src/data/seed.ts`. After changing any of them:

```bash
npm run sql:build    # rewrites supabase/master.sql
```

## Public website

Signed-out visitors get a multi-page, patient-facing hospital website. Signed-in users still land on their dashboard at `/`, and every public page stays reachable while signed in.

| Route | Page |
| --- | --- |
| `/` (guests) · `/welcome` | Home: hero with quick booking, stats, services bento, doctors, testimonials, packages, FAQ |
| `/about` | Story, mission/vision, milestone timeline, values, leadership, accreditations |
| `/services` | Searchable grid of 12 specialities, signature programmes, 24×7 support services |
| `/services/:slug` | Speciality detail: overview, conditions, procedures, technology, that department's doctors, FAQ, sticky booking card |
| `/find-a-doctor` | Doctor directory: search (name, condition, language), department filter, "available today", sort. Filters sync to the URL |
| `/find-a-doctor/:slug` | Doctor profile: credentials, education, weekly OPD schedule, reviews, a 7-day slot picker that hands off to booking, similar doctors |
| `/packages` | Health check-ups with an Individual/Couple toggle, a full comparison table, check-up-day timeline and FAQ |
| `/contact` | Contact channels, validated enquiry form with a reference number, map, hours and directions |
| `/faq` | Searchable, categorised help centre |
| `/privacy` · `/terms` | Legal pages with a sticky, scroll-spy table of contents |
| any unknown URL | Branded 404 (unknown dashboard URLs still send guests to the login page) |

- **Palette:** periwinkle → deep blue (`#CCCCFF`, `#A3A3CC`, `#5C5C99`, `#292966`), exposed as the Tailwind `peri-*` scale. Headings use Plus Jakarta Sans.
- **Shared shell** (`SiteLayout.tsx`): a sticky glass navbar with a Services mega-menu and active-link states, the footer, and a mobile sticky Call/Book bar. Pages set their own `<title>`/meta description and scroll to the top on navigation.
- **Accessibility:** a skip link, breadcrumbs, aria-wired tabs, radios, accordions and form errors, and keyboard-friendly menus. All motion (scroll reveals, counters, parallax) respects `prefers-reduced-motion`. Layouts are tested at 390 px and 1440 px with no horizontal overflow.
- **Code:** in `src/site/`. Page components live in `pages/`, shared blocks in `ui.tsx`/`parts.tsx`, and copy in `content.ts`. Speciality and doctor data live in `data/services.ts` and `data/doctors.ts`, so edit those to change the content. Every page is lazy-loaded as its own small chunk. Images are in `public/landing/`.
- **Contact enquiries** are stored in the browser (`localStorage`, key `dch:enquiries:v1`). To collect them centrally, point `submit()` in `pages/Contact.tsx` at a Supabase table or an email/webhook endpoint.

## Website CMS (Dashboard → Website → Website CMS)

The hospital **owner** can edit every public page without touching code:

| Section | What you can change |
|---|---|
| **Site settings** | Hospital name & tagline, phone / WhatsApp / email / address, opening hours, directions, map, social links, top bar, emergency box, default call-to-action, and **which pages are visible** |
| **Pages** | Home (hero, stats, insurers, features, benefits, steps, section headings, show/hide each section), About, Services, Find a doctor, Packages, Contact, FAQ, Privacy & Terms — including SEO title/description |
| **Collections** | Specialities (each gets its own `/services/:slug` page), support services, doctors (photo, OPD days, fees, education…), health packages + comparison table, FAQs, testimonials |
| **Media library** | Upload images (auto-resized to WebP in the browser), reuse built-in photos |

- **Live preview** — the page updates as you type (desktop / mobile view). Nothing is public until you press **Publish**.
- **Hide, reorder, duplicate, delete** any list item; drafts survive switching dashboard pages.
- **Version history** — every publish/reset keeps the previous version; restore it with one click.
- **Validation** — duplicate/invalid URL slugs are blocked before publishing.
- Headings support `*highlight*` and texts support `{phone}`, `{email}`, `{address}`, `{name}` tokens from Site settings.
- **Contact form → Enquiries**: messages from `/contact` land in *Dashboard → Website → Enquiries* (owner & receptionist), a Gmail-style inbox:
  folders (Inbox / Starred / Unread / In progress / Resolved / Spam), topic labels, bold unread rows, a reading pane with
  Call / WhatsApp / email reply, status and internal notes, bulk actions with Undo, CSV export and keyboard shortcuts
  (`j`/`k`, `e` resolve, `!` spam, `s` star, `/` search, `?` help). Read/star state is stored in `site_enquiries.read_at` / `starred`.
  Upgrading an existing database: `alter table public.site_enquiries add column if not exists starred boolean not null default false, add column if not exists read_at timestamptz;`
  or simply run `supabase/upgrade-2026-10.sql`, which includes it.

**Storage.** With Supabase, content lives in `site_content` (one JSONB row per section), history in `site_content_revisions`
(written by a trigger that also stamps who published), images in the public `site-media` storage bucket and enquiries in
`site_enquiries`. RLS: anyone can read content and submit an enquiry; only the owner can write content or upload media.
Sections that were never edited fall back to the defaults in `src/site/cms/defaults.ts`. Re-running `master.sql` resets
the hospital demo data but **keeps your website content, history and images**. In demo mode the same features use
browser storage.

## Online booking, leave calendar, invoices & audit log

- **Online booking (`/book`)** — the patient picks a speciality, then a doctor, then a live free slot, verifies their phone with a one-time code and gets an instant confirmation. The confirmation includes an invoice and booking reference `DCB-XXXXXX`, a calendar (.ics) download, WhatsApp sharing and a print/PDF option. On the database side, `public_book_appointment` creates or reuses the patient record (matched by phone), the appointment and an unpaid invoice in one transaction. A unique index stops two patients booking the same slot. Doctor profile pages show real free slots too.
  - **OTP / SMS:** the code is generated and stored hashed in `booking_otps`. Limits: one code per phone every 30 s, 5 codes per hour, 5 attempts per code, and codes expire after 10 min. Until an SMS gateway (MSG91, Twilio, etc.) is connected, turn on **CMS → Settings → Online booking → Show demo OTP** so the code appears on screen. Turn it off once real SMS is live. To connect a gateway, send the SMS from a Supabase Edge Function or database webhook on `booking_otps` inserts.
  - Booking rules (on/off, how many days ahead, minimum notice, pay-at-hospital note) and invoice details (legal name, GSTIN, PAN, SAC, GST rate, UPI) are set in **CMS → Settings**. When the GST rate is 0, which is standard for clinical consultations, invoices print as a *Bill of Supply*. When a rate is set, they print as a *Tax Invoice* with CGST/SGST.
- **Leave & Holidays (`/schedule`)** — date-range leave; blocked time for surgery, meetings, conferences or training; and hospital holidays. Doctors request leave and the owner or reception approves it. Approved entries close those slots everywhere, including online booking. Patients already booked into those slots appear in the **Reschedule queue**.
- **Invoices** — A4 letterhead layout with GSTIN, SAC, amount in words and a status stamp. **Print / PDF** prints only the invoice.
- **Audit log (`/audit`)** — database triggers record every create, update and delete on patients, appointments, prescriptions, lab orders, admissions, invoices, payments and leave: who did it, their role, when, and a field-by-field before/after. The log can't be edited or deleted. The owner sees everything, and other staff see their own changes. A *History* tab also appears on patient and invoice pages.
- **My profile (`/profile`)** — photo upload, personal details, password change, preferences and your own recent activity.

## Going live

Demo logins use a public password (`Demo@123`), so **never run a real hospital on `master.sql`'s demo accounts**.

* **New project (recommended):** open `supabase/production.sql`, change the ✏️ owner e-mail, run it, then *Create account* in the app with that e-mail — you are the Owner. It has the full schema and security but **no demo accounts or data**.
* **Already on the demo data:** **Settings → Security & access → Go-live checklist** shows what's still demo. *Lock demo accounts* bans every demo login except yours, and *Clear demo data* deletes the demo patients, visits, bills and so on (your own records stay). Both are owner-only database functions (`lock_demo_accounts()`, `clear_demo_data()`).
* Set **Settings → General → Website address** (filled in automatically on first save) so invitation and feedback links point to your domain.

### Upgrading an existing database

Re-running `master.sql` / `production.sql` **recreates the tables (data is lost)**. For a database that already holds real data,
run **`supabase/upgrade-2026-10.sql`** instead. It is safe to run twice and keeps all rows; it adds the enquiry-inbox columns,
no-cascade record protection, collision-proof MRN / invoice numbers, IST default dates, the OTP / Contact-form rate limits and
the indexes / functions behind server-side pagination (section 15), "Forgot password" by mobile OTP (section 16) and
**website forms** (section 17: `site_forms`, form answers on enquiries, `submit_site_form()`; older messages are filed under the Contact form) and **messaging** (section 18: push / FCM device tokens, account messages,
custom & scheduled messages, Supabase cron helpers, usage report and owner-only user management).

### Sign-in, sign-out and "Forgot password"

* **Sign out** always lands on the public website home (idle sign-out goes to the sign-in page with a notice).
* **Forgot password** offers two options: an **e-mail link** (Supabase Auth; add `https://<domain>/reset-password` to the
  allowed redirect URLs) and a **mobile OTP** on WhatsApp / SMS. The OTP is only sent when the e-mail and the mobile number
  belong to the same account, is never shown on screen, and is offered only once a WhatsApp or SMS gateway is switched on in
  Settings → Notifications (event *Password reset OTP*). Resetting this way signs the account out on every device.
  Existing databases get it from section 16 of `supabase/upgrade-2026-10.sql`.
* In demo mode both options work locally: the reset link and the code are shown on screen.

### Server-side pagination (big hospitals)

The app never downloads a whole patient, appointment, billing or audit table. Lists ask the database for **one page**
(search, filters and sorting run in Postgres via PostgREST), dashboards read **head-only counts** and short date windows,
and reports come from one aggregate call (`financial_report()`). Names on a page are resolved only for the rows shown.
Payments keep `invoices.amount_paid` / `status` in sync with a database trigger, so balances stay right without
re-reading every payment. Demo mode runs the very same queries against the browser store, so both modes behave alike.

### Production checklist (per hospital install)

1. **Database:** a Supabase project per hospital, `supabase/production.sql` run once. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   **and `REQUIRE_BACKEND=true`** on the container. With `REQUIRE_BACKEND` the app refuses to start in demo mode, so it can never quietly
   save patient data in one browser's localStorage.
2. **Supabase → Authentication → URL configuration:** set *Site URL* to the hospital domain and add `https://<domain>/reset-password`
   to *Redirect URLs* (used by **Forgot password**). Configure a custom SMTP server (Supabase's built-in mailer is heavily rate limited).
3. **Backups:** Supabase Pro daily backups / PITR, or a nightly `pg_dump`. Test a restore once.
4. **Messaging:** connect SMS / WhatsApp before turning on online booking. The OTP is capped at 5 per number per hour and
   200 per hour for the whole site (`booking.otpHourlyLimit` in site settings); the Contact form allows 3 per number and 60 per hour overall.
5. **Legal:** edit the Privacy policy / Terms (Website CMS → Legal) with the hospital's legal name, grievance officer and address
   (DPDP Act 2023). Records are never cascade-deleted: patients, doctors and invoices with history can't be deleted
   (deactivate / cancel them instead), which keeps medical and GST records intact.
6. **Scale:** lists load each table into the browser (up to 100,000 rows per table). That suits clinics and small or medium hospitals.
   Very busy hospitals should archive old years or move to server-side paging.

## Patient experience

| Feature | How it works |
| --- | --- |
| **हिन्दी / English** | A language switch on the website header, sign-in / register, the booking wizard, feedback page and patient portal (saved per device, defaults to the phone's language). Staff screens stay in English. Strings live in `src/i18n/hi.ts` (English text is the key, missing strings fall back to English). Content typed into the CMS (services, doctor bios) is shown as entered. |
| **Installable app (PWA)** | `manifest.webmanifest`, icons and a service worker (`public/sw.js`): cached app shell and assets for flaky mobile data, *Install the app* prompt for patients (with an iPhone hint), home-screen shortcuts (Book / Visits / Reports), and an *Update* toast after each deploy (the build stamps `sw.js` and writes `/version.json`). |
| **Downloads** | Patients download **lab reports** (completed tests) and **bills** as real PDF files — from the dashboard, *My Lab Reports*, *My Bills* and the bill page. Letterhead, GSTIN, Tax Invoice vs Bill of Supply and amount-in-words come from Settings → Billing. jsPDF loads only when a download is clicked. PDFs are in English (built-in PDF fonts have no Devanagari). |
| **Self-reschedule** | *My Appointments → Reschedule* (or the button on the dashboard) shows the same doctor's free slots. Allowed up to **Settings → Billing & booking → reschedule cut-off** hours before the visit; after that the patient is asked to call. The database trigger re-checks the slot and locks every other field. |
| **Post-visit rating** | After a visit is marked *completed*, the patient gets a feedback link (SMS / WhatsApp / e-mail, event *feedback_request*) and a prompt on their dashboard: 1–5 stars, tags, comment, *would recommend?*. One rating per visit, within 60 days. Staff see results under **Patient Feedback** (`/ratings`); doctors see only their own. |
| **WhatsApp chatbot** | Patients message the hospital's WhatsApp number: *1* book (speciality → doctor → free slot → name → confirm), *2* see / cancel appointments, *3* timings & address, *4* reception. Works in Hindi (`hindi`). Same slot rules as the website; bookings are tagged *source: WhatsApp* and get an unpaid invoice. Try it in **Settings → Notifications → WhatsApp booking chatbot** (a live chat preview). |

### WhatsApp via WA CRM / OpenWA (recommended for India)

[OpenWA](https://github.com/rmyndharis/OpenWA)-based gateways such as **WA CRM** send from your own linked WhatsApp number as normal chats, so **no Meta template approval** is needed. OTPs, confirmations and reminders go out exactly as written.

1. **Settings → Notifications → WhatsApp →** choose **WA CRM / OpenWA**.
2. **Gateway URL:** paste the base URL (`https://wacrm.example.in`) or the whole `…/api/sessions/<id>/messages/send-text` URL; the **Session ID** is filled in for you.
3. **API key:** paste the `owa_k1_…` key and click *Save*. It is stored write-only in `app_secrets`; the browser can never read it back. Use a key with the **operator** role, scoped to this session.
4. **Chat ID format:** default `91{phone}@c.us` (`{phone}` = 10-digit mobile).
5. Turn the channel on, **Save changes**, then **Send test**. The test first checks that the WhatsApp session is `ready`; if it isn't, it tells you to scan the QR in WA CRM.

How a message is sent (by the `notify` Edge Function — the key never reaches the browser):

```
POST <gateway>/api/sessions/<session>/messages/send-text
X-API-Key: <key>
{ "chatId": "919876543210@c.us", "text": "…" }
```

Errors are explained in the delivery log. A disconnected phone (409) or pacing (429) is retried 2/4/8 minutes later; a bad key or unknown session is not retried.

### Booking OTP on WhatsApp + WhatsApp confirmation

* **Visitors who are not registered** verify their mobile on `/book` with a 6-digit code. When both WhatsApp and SMS are ticked for **Booking OTP** (Notifications → Messages & templates), they pick **Get code on WhatsApp** or **Get code by SMS**; the one chosen in **Settings → Billing & booking → Booking code (OTP) — offer first** is highlighted. With only one channel on, the code goes out straight away. After 30 s they can resend, or switch to the other channel.
* Server side: `booking_otp_channels()` (public) lists the usable channels and `request_booking_otp(phone, channel)` queues the code **only on the chosen channel**, with the same rate limits (1 per 30 s, 5 per hour, 10-minute expiry, 5 attempts). If no gateway is connected, the page says so instead of pretending a code was sent.
* Signed-in patients book from the portal without an OTP.
* When the booking is made, **Appointment booked** is queued on WhatsApp (and SMS / email if ticked) and delivered immediately.
* Every template has an optional **WhatsApp text** with `*bold*`, emoji and line breaks, plus a WhatsApp-bubble preview. The OTP, booked, reminder, rescheduled and cancelled messages come with WhatsApp wording out of the box. Empty = the SMS text is used.

### Turning on the WhatsApp chatbot

1. `supabase functions deploy whatsapp-bot --no-verify-jwt` (the webhook is public; requests are verified by signature instead).
2. Settings → Notifications → **WhatsApp**: choose **WA CRM / OpenWA**, **Meta Cloud API** or **Twilio**, enter the credentials, turn it on.
3. **WhatsApp booking chatbot** card → turn it on and copy the webhook URL (`https://<project>.supabase.co/functions/v1/whatsapp-bot`).
   * **Meta:** WhatsApp → Configuration → Webhook → paste the URL, set a *verify token* (save the same text in the card), subscribe to `messages`. Save the **app secret** too so every incoming request's `X-Hub-Signature-256` is checked.
   * **Twilio:** WhatsApp sender → *When a message comes in* → the URL (POST). Requests are checked against your Twilio auth token.
   * **WA CRM / OpenWA:** Sessions → your session → Webhooks → add the URL, subscribe to `message.received`, set a **secret** and save the same secret in the card. Each delivery's `X-OpenWA-Signature` is verified; unsigned requests are rejected, because the sender's number is the patient's identity. Group chats, your own messages and `@lid` privacy IDs are ignored.

The conversation logic is `supabase/functions/_shared/bot.ts` — plain TypeScript used by the Edge Function, the in-app preview and the tests. Chat state is kept per number in `wa_sessions` (service role only) and resets after 30 minutes.

## Settings (Dashboard → Settings, owner only)

| Tab | What you can change |
|---|---|
| **General & brand** | Hospital name, short name, sidebar subtitle, **logo** and favicon uploads (media library), contact numbers, date/time format, first day of the week. Changes show up on the website, sidebar, sign-in page, invoices and prescriptions. |
| **Appearance** | 8 theme colours plus any custom colour (previewed live), sidebar style, interface size, corner radius, **hide modules** for everyone except the owner, and an announcement banner aimed at staff, patients or everyone. |
| **Dashboard** | Show or hide each stat card and panel, per role, plus the greeting header. |
| **Notifications & APIs** | **Usage this month** per channel with your ₹ per-message rates (full report under *Reports → Messaging usage*, plus a *Messages this month* widget on the owner and accountant dashboards). Credentials for **SMS** (MSG91, Fast2SMS, Twilio, webhook), **WhatsApp** (Meta Cloud API, Interakt, Twilio, webhook) and **Email** (Resend, SendGrid, SMTP). Each channel has setup hints and a *Send test* button. An events × channels matrix picks which messages go out (OTP, booked, reminder, rescheduled, cancelled, invoice, payment, lab report ready), with a template editor (tokens, SMS segment counter, DLT ID, WhatsApp template name and variables, push title/text) and a delivery log. **Push (Firebase Cloud Messaging):** paste the Firebase web config snippet, the VAPID key and the service-account JSON (stored as a secret); users turn on alerts from the bell menu. Account events (*account created / updated / deleted, password changed*) and *notice published* have their own templates. **Custom & scheduled messages:** create, duplicate, delete and *Send now* any message to everyone, all staff, chosen roles, patients or today's birthdays — manually, once at a time, daily, weekly or monthly — with an audience count and cost estimate. **Automatic sending (Supabase cron):** shows whether pg_cron / pg_net are on and switches on the jobs with one click. |
| **Users & accounts** | Every sign-in in one paginated, searchable list with role chips (counts per role), status (active / disabled) and last sign-in. **Create** an account for any role (optional or generated password — otherwise they use *Forgot password*), **edit** name / e-mail / mobile / role, **set a new password**, **disable / enable** sign-in, or **delete** the login (medical, billing and staff records are kept and only unlinked). You can't disable/delete yourself or remove the last owner — enforced again in the database (`admin_*` functions). |
| **Billing & booking** | GST letterhead (GSTIN/PAN validation, SAC code, rate, UPI ID, signatory, footer) and online booking rules. |
| **Website forms** | Manage every form on the website: the **Contact form** (`/contact`), the **Patient review** form (`/forms/review`) and any **custom form** (`/forms/<link>`) started blank or from a template (callback request, job application, health-camp registration). Field builder with 11 field types (text, long text, email, mobile, number, date, dropdown, choice chips, checkboxes, star rating, agreement), required / half-width / help text / options (or the hospital's specialities), reorder, live preview, switch on/off, duplicate, delete (submissions are kept). Name and mobile are always asked so the team can reply. Every submission is validated again in the database (`submit_site_form`) and lands in **Enquiries**, which now has a *Forms* section (unread counts, filter, per-form CSV with a column per question) and shows all answers in the reading pane. |
| **Security & access** | Idle auto sign-out, patient self-signup, demo-login buttons, sign-in notice, and a read-only permissions matrix. |
| **Data & backup** | Export/import settings as JSON (credentials are never included), restore defaults, reset demo data, system info. |

Other roles only see **My account** there.

### How credentials and messages work (Supabase mode)

* API keys go into `app_secrets`, which has RLS on and no policies. The browser can write keys through `set_app_secret()`, but can never read them back; `app_secret_status()` only returns a masked `••••1234`. Every change is written to the audit log without the value.
* Database triggers on appointments, invoices, payments and lab tests, plus the booking OTP, queue messages in `notification_outbox` via `notify_enqueue()`. If queuing fails, it never blocks the booking or invoice itself.
* The **`notify` Edge Function** delivers queued messages. Right after an action the app asks it to send *just those* messages (by id; anyone may do this, it can't reach other messages). Flushing the **whole queue** needs the service-role key (pg_cron) or a signed-in staff member, and *Send test* is owner-only. Deploy it once:

  ```bash
  supabase functions deploy notify     # uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY automatically
  ```
* To send appointment reminders every day at 18:00 IST, and retry anything left in the queue, enable **pg_cron** and **pg_net** and schedule:

  ```sql
  select cron.schedule('appointment-reminders', '30 12 * * *', $$ select public.queue_appointment_reminders() $$);
  select cron.schedule('notify-flush', '*/5 * * * *', $$
    select net.http_post('https://<project>.supabase.co/functions/v1/notify',
      '{"flush":true}'::jsonb, headers => '{"Authorization":"Bearer <service-role-key>","Content-Type":"application/json"}'::jsonb) $$);
  ```
  The `<service-role-key>` lives only inside your database's cron job; never put it in the app or Docker variables.
* **One-click cron (recommended):** in *Settings → Notifications → Automatic sending*, paste the service-role key once (stored in `app_secrets`) and press *Turn on*. `notify_cron_setup()` schedules `dch-notify-flush` (every minute — delivers the queue), `dch-scheduled-messages` (every 5 minutes — custom / birthday / weekly messages), `dch-appointment-reminders` (18:00 IST), `dch-billing-reminders` (09:30 IST — Hospital Comrade renewal reminders to hospital owners; nothing to do on a single-hospital install) and `dch-outbox-cleanup` (weekly, keeps 400 days for the usage report). Enable the **pg_cron** and **pg_net** extensions first (Dashboard → Database → Extensions). The manual SQL above still works if you prefer it.
* **Push / FCM:** deploy `notify` again after upgrading (it now signs Google OAuth tokens from the service-account JSON and sends FCM HTTP v1). Dead device tokens are removed automatically. Browsers need HTTPS; iOS needs the site installed to the home screen.
* Failed sends are retried with back-off (2, 4 and 8 minutes after each failure, tracked in `next_attempt_at`) up to 3 attempts; configuration errors (missing key, no template) are not retried.
* Provider request formats (MSG91, Fast2SMS, Twilio, Meta, Interakt, Resend, SendGrid, webhook) are covered by contract tests with mocked HTTP (`tests/notify/providers.test.ts`). Before launch, use *Send test* on each channel with your real account.
* Once SMS or WhatsApp is connected, the booking OTP is sent to the phone and is no longer shown on screen.
* **India (DLT):** SMS through MSG91 or Fast2SMS needs DLT-approved templates. Paste each template or flow ID into the matching message template.
* **WhatsApp:** outside a 24-hour chat window, only approved templates can be sent.

In demo mode everything can be configured, and test sends are *simulated* and logged. API keys typed in demo mode are **not stored** — only a `••••1234` hint, so the form shows what was entered.

## Deploy with Docker / Coolify

The repo ships a production **multi-stage Dockerfile**. Node builds the app, and **nginx** (Alpine) serves it with SPA routing, gzip, long-lived caching for build assets, security headers and a `/healthz` endpoint.

**Supabase keys are read when the container starts.** On every start, the container writes `/env.js` from its environment variables. The same image works for demo, staging and production; changing a key only needs a restart, not a rebuild.

### Coolify (recommended)

1. **+ New Resource → Public/Private Repository**, then pick this repo and branch.
2. **Build Pack:** `Dockerfile`. Leave Base Directory `/` and Dockerfile Location `/Dockerfile`.
3. **Ports Exposes:** `80`. The image also listens on `3000`, so Coolify's default works too. A wrong port shows up as **502 Bad Gateway** even though the healthcheck passes.
4. **Environment Variables:**
   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your project's anon/public key |

   Plain runtime variables are enough; you don't need to tick "Build Variable". Leave both empty to run in **demo mode**.
5. Set your domain and click **Deploy**. Coolify uses the image's built-in `HEALTHCHECK` (`GET /healthz`).
6. In Supabase: **Authentication → URL Configuration**, add your Coolify domain to *Site URL / Redirect URLs*.

You can also choose the **Docker Compose** build pack. `docker-compose.yml` is ready for it, and the environment variables appear in the Coolify UI automatically.

### Plain Docker

```bash
docker build -t dc-hospital .
docker run -d -p 8080:80 \
  -e VITE_SUPABASE_URL=https://<project>.supabase.co \
  -e VITE_SUPABASE_ANON_KEY=<anon-key> \
  --name dc-hospital dc-hospital
# → http://localhost:8080   (omit the -e flags for demo mode)
```

Or `docker compose up -d --build`; uncomment the `ports` block in `docker-compose.yml` first.

| File | Purpose |
| --- | --- |
| `Dockerfile` | node:22-alpine build → nginx:1.27-alpine runtime, healthcheck |
| `docker/nginx.conf` | SPA fallback, caching, gzip, security headers, `/healthz` |
| `docker/40-runtime-env.sh` | writes `/env.js` from env vars when the container starts |
| `docker-compose.yml` | Compose / Coolify compose deployment |
| `public/sw.js`, `public/manifest.webmanifest` | PWA service worker and manifest (served with `no-cache`) |
| `.dockerignore` | keeps the build context small (no `node_modules`, `.env`, `.git`) |

> The anon key is public by design; Row Level Security in `master.sql` protects the data. **Never** put the `service_role` key in these variables.

## Role permissions

| Module | Owner | Doctor | Receptionist | Accountant | Staff | Patient |
| --- | --- | --- | --- | --- | --- | --- |
| Patients | CRUD | RU | CRU | R | RU | own |
| Appointments | CRUD | CRU (own list) | CRUD | – | R | own (book / reschedule / cancel) |
| Visit feedback | CRUD | R (own) | R | – | – | own (rate once) |
| Prescriptions | CRUD | CRUD | – | – | R | own |
| Lab tests | CRUD | CRU | CR | R | CRU | own |
| Admissions / Beds | CRUD | CRU / RU | CRU / RU | R / – | RU / RU | – |
| Invoices / Payments | CRUD | – | CRU / CR | CRUD | – | own |
| Expenses & Reports | ✔ | – | – | ✔ | – | – |
| Staff | CRUD | – | R | R | – | – |
| Inventory | CRUD | R | – | R | CRU | – |
| Users & Roles | ✔ | – | – | – | – | – |

## Project structure

```
src/
  auth/            AuthProvider, permissions matrix (source of truth for UI + RLS)
  data/            adapter interface, localStorage adapter, Supabase adapter, deterministic seed
  hooks/           React Query hooks with optimistic mutations
  resources/       declarative resource configs (columns, forms, filters, row actions, side effects)
  components/      UI kit, generic ResourcePage (table + drawer form), layout
  pages/           dashboards, patient record, invoice & prescription print views, beds, reports, settings
  i18n/            Hindi / English strings for patient screens
  booking/         online booking API, chatbot glue
  feedback/        visit rating form + API
  lib/pdf.ts       lab report / bill PDFs (lazy jsPDF)
  pwa/             service-worker registration + install prompt
scripts/           master SQL generator + schema (scripts/sql/*.sql)
supabase/master.sql      ← schema + security + demo data (demo / staging)
supabase/production.sql  ← schema + security only (real hospitals)
supabase/functions/      notify (messages), whatsapp-bot (chatbot), _shared (providers, bot engine)
tests/             database (PGlite), provider contract and chatbot tests
.github/workflows/ci.yml  typecheck, SQL freshness, tests, build + bundle budget, Docker build
```

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: type-check and build for production
- `npm run sql:build`: regenerate `supabase/master.sql` and `supabase/production.sql`
- `npm test`: run the database, notification-provider and chatbot tests (Postgres runs in-process via PGlite — no Docker needed)
- `npm run check`: typecheck + SQL build + tests (what CI runs, minus the build)
- `docker build -t dc-hospital .`: build the production image

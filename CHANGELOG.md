# Changelog

## Unreleased: control panel messaging, alerts, broadcasts and live health

- **Messaging page:**
  - Shared SMS, WhatsApp, e-mail and Firebase push accounts, with keys kept in Supabase Vault. Keys are write-only, saving one needs your password, and every change is audited.
  - Template IDs per message, test sends, and a cross-hospital delivery log with Retry.
- **Broadcasts:**
  - Channels: banner, e-mail, WhatsApp, SMS and push.
  - Audience: by plan, status, a hand-picked list of hospitals, and role.
  - Preview with recipient count and cost, schedule option, and a delivery report. The platform pays.
- **Team alerts:**
  - Header bell and an Alerts page.
  - Admin switches per channel and per event, with severity and limits.
  - Personal choices per member (bell, e-mail, browser push, WhatsApp), plus a separate control-panel push service worker.
- **Live health checks:** every 5 minutes, covering site, Auth, Storage, Edge Functions, provider keys, database size, queue, failures and scheduler. Shows uptime, latency, failure history and Check now. Alerts fire when something goes down or recovers.
- **New `ops` Edge Function.** `notify` now reads shared-account keys saved in the control panel (Edge secrets are the fallback).
- **To upgrade:**
  - Re-run `supabase/upgrade-2026-10.sql`.
  - Run `supabase functions deploy notify ops`.
  - Enable the `supabase_vault` extension.

## Unreleased — About us page redesign

- New layout: split hero with buttons and an illustrated card (or your picture), numbers strip, story with a sticky heading and quote, icon mission/vision cards, "who we build for", a comparison table, numbered values, a vertical "how we work" timeline, a commitments band, company details and a "work with us" card.
- All new sections are editable in control panel → Website → About us; empty sections and company rows are hidden.

## Unreleased — richer product website

- New CMS-editable sections, each with built-in default content: before/after problems, "made for India", integrations strip (Home); patient journey timeline and per-role views (Features); "included in every plan" (Pricing); specialities and a go-live plan (Solutions); role access table and FAQs (Security); how we work (About); what happens next and FAQs (Contact).
- More modules, solutions (diagnostic labs, day-care) and FAQ topics (WhatsApp & SMS, support & training, patients, GST invoices).
- Softened claims that the product cannot yet back up.
- Three starter blog articles (OPD no-shows, HMS checklist, DPDP overview), seeded only once — deleting them keeps them deleted.
- Saved CMS pages pick up the new sections automatically (deep-merge over defaults).

## Unreleased — product website & its CMS

- **Separate pages** on the platform domain: Home, Features, Solutions, Pricing (plan comparison, add-ons, pricing
  questions), Security & privacy, About, Contact, FAQ and a **Blog** (topics, scheduled posts). Header navigation,
  a full footer, an optional announcement bar and per-page SEO tags. Old `/#pricing`-style links still work.
- **Legal pages:** five new ones: Cookie Policy, Acceptable Use, Grievance Redressal (IT Rules 2021 / DPDP),
  Disclaimer and Service Levels & Support. There are 11 in all, every one editable. ⚠ Starting text: have a lawyer review it.
- **Control panel → Website:** edit every page, the legal pages and the brand / contact details with forms, save
  drafts, preview them on the live site (`?preview`, platform team only), publish, see the earlier versions and restore
  them, or reset a page to the built-in text. Blog editor with Markdown, cover image, topics, SEO and scheduling. An
  image library (`platform-media` storage bucket). Admins edit; support can look. Every publish is in the audit log.
- A page that was never published shows the built-in text, so the site is never empty. Plan prices still come from
  `src/platform/plans.ts`, because they must match billing.

Existing databases: run `supabase/upgrade-2026-10.sql` again (safe to re-run). The product site only shows when
`TENANCY=multi`.

## Unreleased — control panel: manage every hospital

The Hospital Comrade control panel can now run a hospital's account without opening it (admin = everything,
support = their assigned hospitals without money or deleting, finance = billing). Every action is in the audit log.

- **Details:** website contact (name, address, phones, e-mail, logo link) and legal / GST details (legal name, GSTIN,
  PAN, billing address); hand the hospital to another owner; resend / copy the owner's sign-up link.
- **Users:** every account with search and role filter — change role, block / unblock, e-mail a password reset,
  invite staff (link copied), cancel invitations, remove (admins). A hospital always keeps an owner.
- **Data:** record counts and 30-day figures, read-only look-up of patients / doctors / appointments / bills (each look
  is logged), *Open as admin* (the hospital app with owner access) and *Export ZIP*, CSV import of patients and doctors
  (checked first, duplicates skipped, a bad row never stops the rest).
- **Messaging:** WhatsApp / SMS / e-mail on or off, own or shared account, and a monthly cap on the shared accounts.
- **Domains:** add, check, make primary and remove website addresses from the panel.
- **Billing:** download any tax invoice as PDF, full wallet history, and GST credit notes against paid invoices
  (credit to the wallet or refund; full credit marks the invoice refunded).
- **Announcements:** banners inside the hospital app for chosen hospitals and roles (critical ones can't be dismissed).
- **Hospitals list:** plan filter and CSV export.
- **Sign in as user (admins):** written reason + password, a new tab only (the admin's own sign-in is untouched), amber
  banner with a 30-minute countdown and *End session*; sign-out, password change and "sign out everywhere" are blocked in
  that tab; the session is deleted when it ends or expires; all sessions are listed in the Audit log (and can be ended).
  Patients can't be impersonated. Note: an already-issued access token can live until its expiry (Supabase default 1 h —
  set *JWT expiry* to 1800 s in Supabase → Auth to match the 30 minutes).

Existing databases: run `supabase/upgrade-2026-10.sql` again (safe to re-run), then deploy the new Edge Function:
`supabase functions deploy impersonate`.

## Unreleased — production-readiness audit

- **Security (important):** when no SMS / WhatsApp gateway was connected, the booking OTP was returned to the browser
  (the *show demo OTP* switch defaulted to on). The code is now never sent to the browser; online booking needs SMS or
  WhatsApp switched on for *Booking OTP*, otherwise the booking page asks visitors to call the hospital.
- **Demo mode removed:** the app always uses the database. Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` it shows
  *Database not connected* instead of keeping patient data in one browser's storage. The one-click demo logins, the
  in-browser demo hospitals, the *show demo OTP / demo logins* switches and the product page's *Live demo* links are gone.
  `REQUIRE_BACKEND` is no longer needed. Sample data for staging stays in `master.sql` (`scripts/seed/`).
- **Data integrity (database):** records can't point at another hospital's rows; invoice totals are recomputed from the
  line items; payments can't exceed the balance or be taken on draft / cancelled bills; a bill with payments can't be
  cancelled; a patient can't hold two live admissions and a bed can't hold two patients.
- **Access rules:** doctors sign / change only their own prescriptions and appointments; reception edits only unpaid bills
  and no longer sees the staff directory (salaries are owner / accountant only); a hospital always keeps at least one owner;
  licence dates are no longer readable by the public.
- **Validation:** Indian mobile numbers, no future dates of birth, amounts and quantities with limits, discharge after
  admission — checked in the forms and by the database, with readable error messages.

Existing databases: run `supabase/upgrade-2026-10.sql` again (safe to re-run).

## Hardening after the October 2026 audit

- **Security:** the WhatsApp webhook rejects (401) Twilio / Meta messages when their signing secret is not set, instead of
  accepting them unsigned. Booking and password-reset codes are also limited per internet connection (10/hour, hashed
  address) so one person cannot exhaust a hospital's hourly OTP budget. Website CMS links (social, map, directions, logo)
  only allow http(s)/tel/mailto — a `javascript:` link is hidden.
- **Go-live check:** `npm run preflight` fails when Supabase Auth has *Confirm email* off or sign-ups disabled.
- **Scale:** the owner / accountant dashboards add up revenue in the database (`dashboard_finance()`), not by downloading
  six months of payments.
- **Speed:** the demo store and seed data (~24 kB gzip) loaded only in demo mode (since removed).
  Firebase is now just `@firebase/app` + `@firebase/messaging` (push) — no Firestore/gRPC.
- **Tooling:** Vite 7, Vitest 4, plugin-react 5 — `npm audit` reports 0 vulnerabilities. ESLint 9 (`npm run lint`, in CI
  and `npm run check`).
- **Fixes:** dashboard cards no longer push the page sideways on phones; the control panel shows a friendly card instead
  of a white page if a screen crashes; the service worker trims old cached files; privacy requests give clear errors;
  a date-dependent test no longer fails late in the evening (IST).

Existing databases: run `supabase/upgrade-2026-10.sql` again (safe to re-run).

## v1.0.0 — Hospital Comrade (October 2026)

The single-hospital system becomes **Hospital Comrade**: many hospitals on one database, each on its own domain, with
a control panel for the platform team, subscriptions and a launch kit.

### Hospital app
- Six roles (owner, doctor, receptionist, accountant, staff, patient) with role dashboards, permissions mirrored by
  row-level security, appointments, patient records, prescriptions, lab, admissions and beds, billing with GST,
  expenses and reports, inventory, notice board, audit log.
- Hospital website with a CMS, online booking with OTP, forms and enquiries; Hindi / English; installable app (PWA).
- Messaging on SMS, WhatsApp and e-mail (own keys or the platform's), push notifications, WhatsApp booking bot.
- Server-side pagination and search for large hospitals.

### Multi-hospital platform (phases 0–7)
- Tenancy in the database itself (restrictive `tenant_isolation` policy on every table), hospital picked by domain.
- Custom domains with automatic SSL (Cloudflare for SaaS).
- Plans, free trial, grace and read-only, messaging wallet, Razorpay payments, GST invoices (`HC/YYYY-YY/NNNNNN`).
- Control panel: hospitals, team (admin / support / finance), payments, leads, audit, platform settings.
- Owner billing page; privacy rights, data export, offboarding with notice and purge, incident register, system health,
  retention.

### Phase 8 — launch
- **Legal pages** — Terms, Privacy, Refund & Cancellation, Service Delivery, Data Processing Agreement, Contact on the
  platform domain (`/legal/*`); company details from `PLATFORM_*` variables; consent links at checkout and on forms.
- **Self-service free trial** — `/signup` with Terms + DPA consent (version recorded), rate limits and a honeypot;
  open / closed, review first or instant, trial length — all set in the panel's new **Sign-ups** page; welcome e-mail;
  unclaimed trials closed automatically.
- **Security & monitoring** — Content-Security-Policy and HSTS (`CSP_MODE`, `HSTS`), launch checklist in System health
  (`cp_launch_check`), optional error reporting without personal data (`SENTRY_DSN`), encrypted nightly off-site
  database backup (GitHub Action).
- **Go-live kit** — [docs/GO_LIVE.md](docs/GO_LIVE.md) (Mumbai runbook), `npm run preflight`, and a setup checklist on
  new hospitals' owner dashboards.

### Upgrading an existing database
Run `supabase/upgrade-2026-10.sql` (safe to run again), redeploy the Edge Functions, then switch automatic delivery
off and on once in Settings → Notifications.

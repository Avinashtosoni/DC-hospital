# Changelog

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

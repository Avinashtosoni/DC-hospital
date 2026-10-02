# Hospital Comrade — multi-tenancy design & progress

One codebase, one Supabase database (Mumbai), many hospitals. Each hospital has its own domain, website, users,
settings and sender identity. The Hospital Comrade team works through **provider** accounts.

## Decisions (approved)

| Topic | Decision |
|---|---|
| Hospital URL | **Custom domain only** (manual or Cloudflare for SaaS); no platform subdomains |
| Root `hospital.digitalcomrade.in` | Hospital Comrade product page; the demo hospital moves to its own domain |
| Database | Supabase Cloud, Mumbai region; staging uses a separate project |
| Accounts | One account belongs to **one hospital** (`profiles.tenant_id`). Same e-mail in two hospitals = two e-mails (memberships can be added later) |
| Providers | `admin` (all hospitals) · `support` (assigned; patient records read-only + logged) · `finance` (assigned; billing only). Admin can work in support / finance mode |
| Owner loses (provider-only, per-hospital switch) | Website CMS, Appearance, Notifications & API, Website forms, Security & access, Data & backup, **General & brand, Dashboard widgets** |
| Owner keeps | All modules, Users & accounts, Billing & booking, Enquiries, Wallet / plan, My account |
| Locked module | **Hidden** from the hospital (not just disabled). Single-hospital installs: nothing locked |
| Messaging | Platform master accounts + per-hospital sender identity; BYO keys allowed. WhatsApp: AiSensy, Meta (Tech Provider), MSG91, OpenWA. SMS: MSG91, Fast2SMS |
| Pricing | Clinic ₹999 · Hospital ₹2,999 · Enterprise ₹7,999+ · plus custom plans |
| Deploy | Production = `main`, staging = working branch (see `DEPLOYMENT.md`) |

## How isolation works (database)

* `tenants`, `tenant_domains`, `provider_users`, `provider_assignments`, `provider_audit` — `scripts/sql/tenancy.sql`.
* Every hospital table has `tenant_id` (default `current_tenant()`) and one **restrictive** policy `tenant_isolation`
  (`tenant_id = current_tenant()`), which Postgres ANDs with all role policies.
* `current_tenant()`: internal `app.tenant_id` → provider's chosen hospital (`x-tenant-id`, if allowed) → the signed-in
  user's own hospital (a header can't move them) → the website's hospital for visitors (`x-tenant-id`) → primary hospital.
* `has_role()` / `is_staff()` / `current_app_role()` are per hospital; providers map to owner (admin/support) or accountant (finance).
* Support can't insert/update/delete patients, appointments, prescriptions, lab tests, admissions, feedback.
* Unique names / numbers are per hospital (`departments.name`, `patients.mrn` with the hospital's prefix, `invoices.invoice_number`, …).
* Rows can't be moved between hospitals (`keep_tenant` trigger).
* `tests/sql/tenancy.test.ts` checks **every** table with a `tenant_id` for leaks in both directions, header spoofing,
  cross-hospital writes, per-hospital numbering, sign-up routing and all provider rules.

## Progress

### Phase 0 — safety ✅
- [x] `TENANCY=single|multi` and `APP_ENV=production|staging` runtime variables (staging badge + `noindex`)
- [x] `docs/DEPLOYMENT.md` — production on `main`, staging on the working branch, rollback
- [ ] Owner: merge PR, switch Coolify production to `main`, create the staging app (manual steps in the guide)

### Phase 1 — multi-tenant core + roles + locks
- [x] **1.1 Database core**: tenancy tables, `current_tenant()`, tenant_id + restrictive policy on all 33 tables,
      per-hospital roles, provider roles/modes, support read-only, per-hospital uniques & numbering, sign-up routing,
      `resolve_tenant` / `my_context` / `provider_tenants` / `provider_log`, isolation test suite
- [ ] **1.2 SECURITY DEFINER audit**: every definer RPC/trigger filters by `current_tenant()` (settings & content lookups,
      booking + OTP, password reset by mobile, bot, feedback, invites, admin_* user management, usage, reports);
      cron functions loop over hospitals with `app.tenant_id`
- [ ] **1.3 App**: resolve hospital from the domain (multi mode), send `x-tenant-id` / `x-provider-mode`, `my_context()`
      in the auth provider, provider banner + hospital switcher + mode switch, pass `tenant_id` at sign-up
- [ ] **1.4 Module locks**: hide locked tabs/menu/routes; database triggers stop owners writing locked settings
- [ ] **1.5 Demo mode**: two demo hospitals + provider demo logins in the browser store
- [ ] **1.6 Edge functions**: `notify` / `whatsapp-bot` read settings & secrets of the message's hospital
- [ ] **1.7 Verify**: SQL + E2E across hospitals and providers, upgrade path, docs

### Later phases
2 Per-hospital website & domains · 3 Messaging per hospital · 4 Wallet / Razorpay / license · 5 Provider panel ·
6 Owner billing page · 7 Ops & compliance · 8 Launch

> Until 1.2 – 1.6 are done, keep `TENANCY=single`. Single-hospital installs are unaffected by 1.1 (everything joins the
> primary hospital automatically).

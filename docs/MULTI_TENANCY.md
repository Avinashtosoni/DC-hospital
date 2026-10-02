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

### Phase 1 — multi-tenant core + roles + locks ✅
- [x] **1.1 Database core**: tenancy tables, `current_tenant()`, tenant_id + restrictive policy on all 33 tables,
      per-hospital roles, provider roles/modes, support read-only, per-hospital uniques & numbering, sign-up routing,
      `resolve_tenant` / `my_context` / `provider_tenants` / `provider_log`, isolation test suite
- [x] **1.2 SECURITY DEFINER audit**: every definer RPC/trigger filters by `current_tenant()` — settings / content /
      secrets via `tenant_setting()` · `tenant_content()` · `tenant_secret()`; website doctors + availability, booking
      OTPs + rate limits, password reset by mobile, WhatsApp bot (edge function sends `x-tenant-id`), feedback, staff
      invites (only on their own hospital), website forms, enquiry limits, admin_* user management (`admin_target`),
      message templates + usage, demo cleanup (main hospital only). Cron jobs run every hospital: reminders and
      scheduled messages set `app.tenant_id` per hospital; the scheduler itself is set up once by the main hospital.
      `financial_report` is `security invoker` (RLS). Tenancy tables live in `tenancy_core.sql` (loaded right after
      the schema) so functions can reference `tenant_id` when they are created.
- [x] **1.3 App**: before the app renders, `resolve_tenant(host)` finds the domain's hospital (`src/tenancy/boot.ts`);
      unknown domain → "No hospital at this address", suspended → "temporarily unavailable". Hosts without a mapped
      domain (preview / staging / localhost) can pick one with `?hospital=<slug>` (remembered per tab; a mapped domain
      always wins). Every Supabase request carries `x-tenant-id` (+ `x-provider-mode`) through a fetch wrapper.
      After sign-in `my_context()` gives the role here; one account = one hospital, so a hospital account on another
      hospital's website is signed out with a clear message. Providers get a banner with a hospital switcher and (admins)
      a mode switch — switching is logged and reloads the app. Sign-ups send `tenant_id`. `PLATFORM_NAME` /
      `PLATFORM_DOMAIN` runtime variables. Single mode and demo mode make no extra requests.
- [x] **1.4 Module locks**: `tenants.modules` → `hospital` | `provider` for general, appearance, dashboard,
      notifications, forms, security, data, cms (unlisted = provider-managed; the primary hospital has all `hospital`).
      Locked = hidden: Settings tabs, the Website CMS menu item + route, "Manage forms" link (`src/tenancy/modules.ts`).
      Database: `module_locked()` / `module_guard()`; owner saves keep locked sections of `app_settings` 'app' and
      `site_content` 'settings' unchanged (billing & booking always save); CMS pages, `site_forms`,
      `notification_templates`, credentials, cron setup, "send now" and demo tools refuse a locked hospital.
      Providers (any mode) are never locked. Switching modules per hospital comes with the provider panel (phase 5).
- [x] **1.5 Demo mode**: two demo hospitals + provider demo logins in the browser store
  - `src/tenancy/demo.ts`: DC Hospital (primary, all modules) and City Care Clinic (`?hospital=citycare`, Clinic
    plan, trial, only Dashboard + Website forms unlocked). Each hospital has its own store, settings, website
    content and media (`demoKey()` → `…@citycare`); City's data is built lazily on first visit (`src/data/citySeed.ts`).
  - Hospital accounts only sign in on their own hospital's site (clear error otherwise). Platform logins
    (`admin@` all hospitals, `support@` City only, `finance@` both, all `@hospitalcomrade.demo`) work on any site,
    use the provider banner, can't open unassigned hospitals, and support can't change patient records.
  - Demo mode always runs multi-hospital (no `TENANCY` needed) — single-hospital installs with Supabase are unaffected.
- [x] **1.6 Edge functions**: `notify` / `whatsapp-bot` read settings & secrets of the message's hospital
  - `supabase/functions/_shared/tenant.ts`: signed-in callers → `my_context()` run as the caller with the forwarded
    `x-tenant-id` / `x-provider-mode` (same rules as the database); queue rows → `notification_outbox.tenant_id`;
    webhooks → `?hospital=<slug>` on the address (none = primary). The service role skips RLS, so every table read
    filters on `tenant_id`; bot RPCs run with `x-tenant-id` (trusted only without a signed-in user). CORS now allows
    the two headers (multi mode preflights failed before).
  - **notify**: claimed rows are grouped per hospital and sent with that hospital's settings, credentials, custom
    templates, push devices and name. The scheduler (service key) flushes every hospital; a staff member's "deliver
    now" only their own (`claim_notifications(p_limit, p_tenant)`, moved to `messaging.sql` so the upgrade script gets
    it too); suspended hospitals' messages wait. Tests run as the owner's hospital (providers: the chosen one) and
    log with its `tenant_id`.
  - **whatsapp-bot**: settings, Meta verify token / signatures, Twilio signature (full URL incl. `?hospital`), doctors,
    slots, bookings and chat state (`wa_sessions` per hospital + phone) all come from the address' hospital; unknown
    hospital → 404; a suspended hospital's bot stays quiet; the simulator uses the signed-in user's hospital.
    Settings → WhatsApp chatbot shows each hospital its own webhook address. Non-primary hospitals see "Automatic
    delivery: managed" instead of the cron setup.
  - Tests: `npm run test:edge` runs both real functions in Deno against an in-memory Supabase with two hospitals
    (also in CI); `tests/notify/tenant.test.ts`; SQL test for the per-hospital queue.
  - Deploy: `supabase functions deploy notify` and `supabase functions deploy whatsapp-bot --no-verify-jwt` again
    after applying the SQL (old functions + new SQL keep working; new functions need the new `claim_notifications`).
- [x] **1.7 Verify**: SQL + E2E across hospitals and providers, upgrade path, docs
  - **Upgrade path** (`tests/sql/upgrade.test.ts`): real databases of two older releases (fixtures in
    `tests/sql/fixtures/`) are upgraded twice and compared with a fresh `production.sql` — functions (source, definer,
    settings), function and table grants, policies, triggers, columns, constraints, RLS, indexes: identical. Plus a
    live hospital upgraded with data: rows join the first hospital, numbering continues, a second hospital is isolated.
    Found and fixed: the upgrade did not carry `audit/cms/booking/settings/patient.sql`, so upgraded databases kept
    ~27 definer functions *without* hospital filters (website doctors, booking, bot, sign-up routing); databases from
    before `push_tokens` failed to upgrade; a missing `notices` check.
  - **Grants**: `tenant_secret()` (credentials), `tenant_setting()`, `tenant_content()` and `ensure_tenant_columns()` were
    executable by signed-in users / visitors on fresh installs (master's blanket grant ran after their revoke). Revoked
    at the very end of the build; tested on master, production and upgraded databases.
  - **Onboarding** (`tests/sql/onboarding.test.ts`): `supabase/snippets/add-hospital.sql` and `add-provider.sql` run as
    shipped on a fresh production database. Found and fixed: a new hospital's bootstrap owner e-mail was ignored
    (only the first hospital had one) and a new hospital had no website forms — `seed_hospital_defaults()` now copies
    the built-in forms (from `src/forms/schema.ts`) and the hospital's identity — its name, and blank contacts, GSTIN, PAN,
    registration number and UPI id instead of the sample hospital's (they printed on a new hospital's invoices); the
    Enquiries inbox finds each hospital's own Contact form.
  - **Browser**: every role of both demo hospitals and the three platform logins open every page of their menu —
    (282 page visits) — no error screens, no script errors, no other hospital's names / MRNs / e-mails (demo mode;
    found: the demo clinic's Settings showed the sample legal name → it has its own letterhead now); 1.3's mock E2E
    covers domain routing with Supabase.

### Later phases
2 Per-hospital website & domains · 3 Messaging per hospital · 4 Wallet / Razorpay / license · 5 Provider panel ·
6 Owner billing page · 7 Ops & compliance · 8 Launch

## Going multi-hospital (runbook)

Phase 1 is complete: the database, the app and the Edge Functions keep hospitals apart. Until the provider panel
(phase 5) exists, hospitals and team members are added with SQL snippets.

1. **Database** — new project: run `supabase/production.sql` (first change the owner e-mail on the line marked ✏️). Existing
   single-hospital project (September 2026 or newer): run `supabase/upgrade-2026-10.sql` — everything joins the first
   hospital, nothing changes for it.
2. **Edge Functions** — `supabase functions deploy notify` and `supabase functions deploy whatsapp-bot --no-verify-jwt`
   (after the SQL: the new functions need the new `claim_notifications`).
3. **App** — Coolify → environment: `TENANCY=multi`, `PLATFORM_NAME`, `PLATFORM_DOMAIN`, `REQUIRE_BACKEND=true` → restart.
   With one hospital nothing looks different.
4. **Add a hospital** — Supabase → SQL editor → `supabase/snippets/add-hospital.sql` (edit the ✏️ values). It creates
   the hospital, its address, its built-in website forms and name, and remembers the owner e-mail.
5. **Its address** — DNS for the hospital's domain to the server (Coolify: add the domain to the app). Until a domain
   is ready, `https://<app>/?hospital=<slug>` works.
6. **Its owner** signs up on that address with the owner e-mail → owner of that hospital. The owner then fills in the
   website (if the *Website* module is theirs), settings and staff invites, and their own SMS / WhatsApp / e-mail
   credentials (Settings → Notifications; WhatsApp bot webhook: the address shown there, `…/whatsapp-bot?hospital=<slug>`).
7. **Platform team** — each person signs up once, then `supabase/snippets/add-provider.sql` (admin / support / finance).
8. **Check** — sign in as the owner on the new address (sees an empty hospital), as the first hospital's owner (sees
   nothing of the new one), as support (banner, read-only patients).

Known limits until later phases: a new hospital's website shows the built-in sample texts (doctors, services) until
the owner edits them (phase 2 brings per-hospital website starters and domains via Cloudflare for SaaS); messaging
uses each hospital's own credentials (phase 3 adds platform-paid messaging and wallets); the provider panel (phase 5)
replaces the snippets and must set `app.tenant_move = 'on'` while moving a profile, like `add-provider.sql` does.

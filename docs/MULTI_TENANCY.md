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
      Providers (any mode) are never locked. Switch modules per hospital in the control panel (hospital → Settings).
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

### Phase 2 — per-hospital website & domains ✅
- [x] **2.1 Website starter** — a new hospital's website no longer shows the sample hospital's history, founder, team,
  patient numbers, reviews, map pin or Delhi texts. `src/site/cms/starter.ts` keeps the layout and uses `{name}` /
  `{phone}` tokens; fact-only sections (numbers, reviews, milestones, leadership, accreditations, doctor profiles,
  packages, support services, emergency) start empty or switched off until the hospital fills them in. The primary
  hospital keeps its own content; saved CMS values always win. Pages hide empty blocks; per-hospital offline cache.
- [x] **2.2 Product page** — `PLATFORM_DOMAIN` (and `www.`) with no `?hospital=` shows the Hospital Comrade page
  (features, roles, pricing Clinic ₹999 / Hospital ₹2,999 / Enterprise ₹7,999+ / Custom — edit
  `src/platform/plans.ts`, FAQ, call-back form, demo links). Separate 22 kB chunk, never loaded on hospital sites.
  Leads → `platform_leads` via `submit_platform_lead()` (validated, one per number per 10 min, 60/hour ceiling;
  readable by provider admins only). `?platform` shows the page on any host (previews).
- [x] **2.3 Domains** — `domains` Edge Function + Settings → **Domain**. Provider admins add / remove / make primary;
  the owner sees status and the one CNAME record to add, and can re-check. Cloudflare for SaaS custom hostnames with
  HTTP validation (certificate issued once the CNAME is live), TXT record for zero-downtime moves, adopts hostnames
  Cloudflare already has, "manual" mode when Cloudflare isn't configured; sub-domains of the platform domain need no
  Cloudflare step. Demo mode simulates the flow.
- [x] **2.4 Browser identity** — each hospital gets its own install name / icon (web-app manifest), apple title and
  link-preview tags; with `TENANCY=multi` the container replaces the sample hospital's title in `index.html` with
  neutral text (WhatsApp / Facebook previews don't run JavaScript).
- [x] **2.5 Verified** — 188 unit / SQL tests, 10 Edge Function tests (Cloudflare API mocked), browser: product page
  (desktop + mobile, call-back form), City Care's starter website, Domain tab as owner and as provider admin, manifests.

### Phase 3 — messaging per hospital ✅
- [x] **3.1 Providers** — WhatsApp adds **AiSensy** (API campaigns; campaign name in the template field, OTP copy-code
  button, test campaign) and **MSG91 WhatsApp** (approved templates via the bulk endpoint, free text for test / chatbot).
  Now: SMS MSG91 · Fast2SMS · Twilio · webhook — WhatsApp OpenWA · Meta · AiSensy · MSG91 · Interakt · Twilio · webhook.
- [x] **3.2 Hospital Comrade messaging** — each SMS / WhatsApp / e-mail channel has a **source**: the hospital's own
  account (BYO keys, as before) or Hospital Comrade's shared account. Shared keys are Edge Function secrets
  (`PLATFORM_*`, below), never in the database. Each hospital keeps its identity: its name in every message, its
  e-mail as reply-to, optionally its own DLT header + DLT templates registered under the platform's entity
  (`tenants.messaging`, set by an admin — a hospital can't use another's header). Shared template / DLT IDs:
  `platform_settings` ('messaging'). Every delivered / failed message is counted per hospital, month (IST), channel
  and source in `message_usage` (kept after the outbox clean-up; basis for the phase 4 wallet). Monthly allowance per
  channel (`tenants.messaging.limits`) — OTPs always go out. New hospitals (`seed_hospital_defaults`) start with full
  settings on the shared accounts — before this, a new hospital queued no messages at all. The chatbot needs the
  hospital's own WhatsApp number.
- [x] **3.3 Settings** — Notifications: *Send through* Hospital Comrade (included) / Your own account per channel;
  the shared panel shows availability, sender ID / from-address and this month's usage against the allowance. Platform
  admins get a card for this hospital's sender ID + allowances and the shared template IDs. Delivery log marks
  messages sent "via Hospital Comrade".
- [x] **3.4 Verified** — 205 unit / SQL tests (adapters, routing, allowance, usage RLS, admin-only settings,
  new-hospital defaults), 12 Edge Function tests (shared account with the hospital's sender ID, metering, allowance,
  missing account), browser: owner switches a channel, admin card.

### Phase 4 — licence, wallet & Razorpay ✅
- [x] **4.1 Licence** — `tenants.trial_ends_at` / `paid_until` → `tenant_license()`: **trial → active → grace (7 days,
  everything works, banner) → read_only**; `suspended` stays manual; the primary hospital is always active; a hospital
  with neither date keeps its hand-set status. Computed live (no cron) and returned by `resolve_tenant` / `my_context`
  (+ dates; wallet only for owner / accountant). **Read-only is enforced in the database** by `license_guard()` on every
  hospital table — also inside SECURITY DEFINER RPCs such as online booking (it checks the caller's `role`, not
  `current_user`). Still allowed: reading, sign-in, password reset, devices, logs, billing, the platform team
  (admin / finance), Edge Functions (service role). The WhatsApp bot goes quiet. `add-hospital.sql` starts a 14-day trial.
- [x] **4.2 Wallet** — prepaid ₹ balance (`tenants.wallet_paise`, hidden from visitors / staff by column grants) +
  `wallet_ledger` (top-up / usage / refund / adjustment, one usage row per day and channel). `record_message_usage`
  charges platform messages beyond the plan's included ones (`plans.ts` → `platform_settings('billing')`, per-hospital
  overrides in `tenants.billing`); `notify` stops non-OTP platform messages when the balance can't pay (OTPs may go
  negative). Prices, GST 18 %, trial / grace days, yearly = 10 months, rates (SMS 30 p, WhatsApp 40 p, e-mail 2 p):
  `src/platform/billing.ts` → `platform_settings('billing')` (database copy wins once installed).
- [x] **4.3 Razorpay** — `billing` Edge Function: `order` (price from `billing_quote()`, never the browser) →
  Standard Checkout → `verify` (HMAC of `order_id|payment_id`) → `apply_payment()`; signed webhook as backup.
  `billing_payments` + idempotent `apply_payment()`: plan renewals extend `paid_until` (after the trial / current
  period), top-ups credit the wallet (before GST); GST invoice numbers `HC/2026-27/000001`.
- [x] **4.4 App** — licence banner on every staff page (trial days, renewal due, grace, read-only; patients don't see
  it); Settings → **Plan & wallet** (owner; platform team incl. finance): plan + pay 1 / 12 months, wallet + this
  month's usage + top-up, invoice name / GSTIN, payments + wallet history, team tools (manual payment, wallet
  adjustment; admin: extend trial, custom price, suspend / resume). Read-only errors read as plain sentences (staff)
  or "online requests are paused" (visitors). Demo simulates payments (no money) and can jump to grace / read-only.
- [x] **4.5 Verified** — 232 unit / SQL tests (status transitions, guard incl. definer RPCs, charging, quotes,
  idempotent payments, RLS, column grants, provider tools), 16 Edge Function tests (order / verify / webhook with
  Razorpay mocked, wallet stop), browser: owner pays + tops up, admin → read-only banner.
- Defaults to confirm: 14-day trial, 7-day grace, yearly = 10 months, rates above, included messages in `plans.ts`.
  PDF invoices and the owner's billing page: phase 6 below.

### Phase 5 — control panel ✅
A **separate app** at `https://<PLATFORM_DOMAIN>/control-panel/` (own page `control-panel/index.html`, own bundle; the
hospital app never loads its code, the service worker never caches it, nginx serves it `noindex` and un-framed).
Same container, same `env.js`, same Supabase login (only `provider_users` get in).
- [x] **5.1 SQL** (`scripts/sql/control_panel.sql`, after billing; in the upgrade) — `cp_me`, `cp_overview`, `cp_hospitals`,
  `cp_hospital`, `cp_create_hospital` (replaces `add-hospital.sql`: checks short name / prefix / plan / domain / owner
  e-mail — one account = one hospital), `cp_update_hospital` (name, prefix, notes, **module locks**, owner e-mail until
  the owner signs up), `cp_billing` (pins the hospital and calls `provider_billing`), `cp_team` / `cp_save_provider`
  (replaces `add-provider.sql`; can't remove your own admin), `cp_payments`, `cp_audit`, `cp_settings` /
  `cp_save_billing_settings` (prices, GST, trial / grace, rates, seller; validated, merged). Every function checks the
  caller: admin all · finance assigned hospitals + billing · support assigned hospitals, read-only. All actions →
  `provider_audit`, filed under the hospital.
- [x] **5.2 App** (`control-panel/src`) — Overview (MRR, received 30 days, wallets, needs attention, messages, new
  leads), Hospitals (search / filter, add), hospital page (licence, people, addresses, usage · record payment, wallet
  adjust, plan & special price, extend trial, suspend / resume · module locks & details · activity), Payments (CSV),
  Leads (status + notes, optimistic), Team, Audit log, Platform settings. Menu and routes follow the role.
- [x] **5.3 Demo** — same rules in the browser (`control-panel/src/demo.ts`); the demo hospitals share the app's demo
  billing, and name / prefix / module locks set here apply to the demo app on its next load.
- [x] **5.4 Verified** — 11 SQL tests (access per role, create / edit, billing, overview, team, settings), 5 demo tests,
  browser E2E for admin / support / finance; hospital app unchanged.
- Not yet: deleting a hospital (do it by suspending), domain management stays in the hospital app (Settings → Domain,
  where the Cloudflare check runs), "sudo" re-auth for admin actions.

### Phase 6 — owner billing page ✅
**Billing & plan** (`/billing`, sidebar → Finance) for the owner and accountant (accountant: read-only, can't pay) of
hospitals on the platform; hidden on the platform's own hospital and single installs. Settings → Plan & wallet and the
licence banner now lead here (old `?tab=plan` links redirect).
- [x] **6.1 SQL** (`scripts/sql/billing.sql`, in the upgrade) — `billing_quote` / `my_billing_quote` take a target
  plan (`p_plan`): renewing on another plan is priced at that plan and the plan **switches when the payment arrives**
  (the new period starts after the current one); custom-priced hospitals and "Custom" are refused. `change_trial_plan`
  (owner, trial only, nothing paid): instant switch. `billing_summary` adds `plans`, `custom_price`, `seller`.
  `billing_payments.seller` keeps the seller as it was when the invoice was numbered. `billing_usage_history(months)`
  (owner / accountant). `queue_billing_reminders()` — e-mail + push to the owner 7 / 3 / 1 days before the trial / plan
  ends and once when grace starts (once per milestone and end date), daily 09:30 IST as cron job
  `dch-billing-reminders`. Reminders go out even with an empty wallet (like OTPs) but still count as usage.
  Provider manual payments can name a plan too.
- [x] **6.2 App** (`src/pages/billing/BillingPage.tsx`) — plan + renewal (1 / 12 months), compare plans (switch now
  in the trial, "Renew on …" afterwards, "Talk to us" for Custom), wallet, 6-month usage chart + charges, invoices with
  **PDF tax invoice** (`src/billing/invoicePdf.ts`, lazy jsPDF: seller / buyer GSTIN, place of supply from the buyer's
  GSTIN, CGST + SGST same state / IGST other state, SAC, amount in words), wallet statement **CSV**, invoice details.
  Control panel → Platform settings → seller **SAC code**.
- [x] **6.3 Verified** — 6 new SQL tests + 1 provider check, 5 browser-side tests, 17 Edge Function tests (order on
  another plan, reminders pass the wallet stop), browser E2E: owner trial switch → pay on Hospital → renew on Clinic
  quote → PDF + CSV download; accountant read-only; primary hospital has no Billing.
- To confirm: **SAC 998315** (default; ask your CA), place of supply without a buyer GSTIN = the seller's state.
- Existing installs: apply `supabase/upgrade-2026-10.sql`, then **switch automatic delivery off and on once**
  (Settings → Notifications) so the new cron job is scheduled; the hospital's e-mail channel must be on for reminders.

### Phase 7 — ops & compliance ✅
Privacy rights for patients (copy of data, health-tips consent, correction / erasure answered on `/privacy-requests`),
full data export ZIP for owners (never locked), close → notice period → purge with password re-confirmation,
incident register (72-hour Board clock), system health and nightly retention. Runbook: [OPERATIONS.md](OPERATIONS.md).

### Phase 8 — launch ✅
Legal pages on the platform domain (`/legal/terms`, `privacy`, `refunds`, `delivery`, `dpa`, `contact`; company details
from `PLATFORM_*` env), self-service free trial on `/signup` (open / closed, review first or instant, trial days — panel
→ Sign-ups), CSP + HSTS, the panel's launch checklist (`cp_launch_check`), optional privacy-safe error reporting
(`SENTRY_DSN`), an encrypted nightly backup Action, `npm run preflight` and the owner's setup checklist.
Runbook: [GO_LIVE.md](GO_LIVE.md).

### Later
Help centre, support inbox, landing SEO / marketing pages, public status page.

## Going multi-hospital (runbook)

Hospitals and team members are added in the **control panel** (`https://<PLATFORM_DOMAIN>/control-panel/`). The SQL
snippets in `supabase/snippets/` still work as a fallback (e.g. for the very first admin).

1. **Database** — new project: run `supabase/production.sql` (first change the owner e-mail on the line marked ✏️). Existing
   single-hospital project (September 2026 or newer): run `supabase/upgrade-2026-10.sql` — everything joins the first
   hospital, nothing changes for it.
2. **Edge Functions** — `supabase functions deploy notify`, `supabase functions deploy whatsapp-bot --no-verify-jwt`
   and `supabase functions deploy domains` (after the SQL: the new functions need the new `claim_notifications`).
3. **App** — Coolify → environment: `TENANCY=multi`, `PLATFORM_NAME`, `PLATFORM_DOMAIN`, `REQUIRE_BACKEND=true` → restart.
   With one hospital nothing looks different.
4. **Add a hospital** — control panel → Hospitals → **Add hospital** (name, short name, prefix, owner e-mail, address,
   plan, trial or paid, which settings the hospital may change). It creates the hospital, its address, its built-in
   website forms and name, and remembers the owner e-mail.
5. **Its address** — sign in as a provider admin on any hospital address, pick the hospital in the banner,
   Settings → **Domain** → add `www.theirhospital.in` and send the owner the CNAME shown there (the owner sees it in the
   same tab). With Cloudflare for SaaS set up (below) SSL follows automatically. Until then, `https://<app>/?hospital=<slug>`
   works, and `<slug>.<PLATFORM_DOMAIN>` works straight away if the wildcard below exists.
6. **Its owner** signs up on that address with the owner e-mail → owner of that hospital. The owner then fills in the
   website (if the *Website* module is theirs), settings and staff invites. Messages go out through Hospital Comrade's
   shared accounts from day one; the owner may switch any channel to their own credentials (Settings → Notifications;
   WhatsApp bot webhook: the address shown there, `…/whatsapp-bot?hospital=<slug>` — the bot needs their own number).
7. **Platform team** — the **first admin**: sign up once, then run `supabase/snippets/add-provider.sql` with role `admin`.
   Everyone after that: they sign up once (platform site, a work e-mail not used at any hospital), then control panel →
   Team → **Add member** (admin / support / finance + hospitals).
8. **Check** — sign in as the owner on the new address (sees an empty hospital), as the first hospital's owner (sees
   nothing of the new one), as support (banner, read-only patients).

Plans, trials, payments and wallets: see *Billing (Razorpay)* below and the control panel's hospital page.

### The platform domain and the demo
- `https://<PLATFORM_DOMAIN>` is the Hospital Comrade product page. Never map it (or `www.`) to a hospital.
- Demo: point `demo.<PLATFORM_DOMAIN>` at the same app. In demo mode (no database) any host other than the platform
  domain opens the demo hospital; with a database, map `demo.<PLATFORM_DOMAIN>` to the demo hospital in Settings → Domain.
  The product page's "Live demo" button uses `/?hospital=main` (and `citycare` for the clinic).
- Call-back requests: control panel → **Leads** (admins).
- The control panel lives at `/control-panel/` on every address of the app; only platform team accounts can sign in.

### Cloudflare for SaaS (once, for automatic SSL on hospitals' domains)
1. Cloudflare → the zone of `PLATFORM_DOMAIN` → **SSL/TLS → Custom Hostnames** → enable (100 hostnames included, then
   about $0.10 per hostname per month).
2. Add a proxied DNS record for the **fallback origin**, e.g. `origin.<PLATFORM_DOMAIN>` → the server's IP, and set it
   as *Fallback Origin* on the same page (wait until it says *Active*). SSL/TLS mode **Full** (never *Flexible* — it loops).
3. Add the **CNAME target** hospitals point at: `customers.<PLATFORM_DOMAIN>` CNAME → `origin.<PLATFORM_DOMAIN>` (proxied).
   Optional wildcard for instant sub-domains: `*.<PLATFORM_DOMAIN>` → the same origin.
4. API token: *My Profile → API Tokens → Create* with **Zone → SSL and Certificates → Edit** for that zone. Copy the Zone ID.
5. `supabase secrets set CF_API_TOKEN=… CF_ZONE_ID=… CF_CNAME_TARGET=customers.<PLATFORM_DOMAIN> PLATFORM_DOMAIN=<PLATFORM_DOMAIN>`
   then `supabase functions deploy domains`.
6. Server: every hospital host must reach the app. Coolify/Traefik only routes hosts it knows, so either add each
   hospital domain to the app's *Domains* (simple, a few hospitals) or give the app a catch-all router
   (Traefik v3: ``HostRegexp(`.+`)``, v2: ``HostRegexp(`{host:.+}`)``, lowest priority) so any host Cloudflare forwards is served — the app picks the hospital
   from the host. Cloudflare terminates the visitor's TLS; the origin only needs a certificate for the fallback origin.

Root domains (`theirhospital.in`) can't hold a CNAME at most registrars: use `www.` and let the registrar redirect the
root to it (the Domain tab says so).


### Hospital Comrade messaging (shared accounts)
Set once on the `notify` function (Supabase → Edge Functions → Secrets, or `supabase secrets set …`). Leave a
channel's provider empty to not offer it — hospitals on that channel then see "not available" and messages fail
with a clear reason. Only provider names and the public sender facts ever reach the browser.

| Channel | Secrets |
|---|---|
| SMS | `PLATFORM_SMS_PROVIDER` = `msg91` \| `fast2sms`, `PLATFORM_SMS_SENDER_ID` (DLT header), `PLATFORM_DLT_ENTITY_ID`, `PLATFORM_MSG91_AUTH_KEY` or `PLATFORM_FAST2SMS_API_KEY` |
| WhatsApp | `PLATFORM_WHATSAPP_PROVIDER` = `aisensy` \| `meta` \| `msg91` \| `openwa`, `PLATFORM_WHATSAPP_LANGUAGE` (default `en`), `PLATFORM_WHATSAPP_NUMBER` (shown to hospitals) and — AiSensy: `PLATFORM_AISENSY_API_KEY`, `PLATFORM_AISENSY_TEST_CAMPAIGN` · Meta: `PLATFORM_META_ACCESS_TOKEN`, `PLATFORM_META_PHONE_NUMBER_ID` · MSG91: `PLATFORM_MSG91_AUTH_KEY`, `PLATFORM_MSG91_WA_NUMBER`, `PLATFORM_MSG91_WA_NAMESPACE` · OpenWA: `PLATFORM_OPENWA_URL`, `PLATFORM_OPENWA_API_KEY`, `PLATFORM_OPENWA_SESSION` |
| E-mail | `PLATFORM_EMAIL_PROVIDER` = `resend` \| `sendgrid`, `PLATFORM_EMAIL_FROM` (e.g. `notifications@<PLATFORM_DOMAIN>`, domain verified with the provider), `PLATFORM_RESEND_API_KEY` or `PLATFORM_SENDGRID_API_KEY` |

Then, as a provider admin: Settings → Notifications → **Hospital Comrade messaging** → enter the approved WhatsApp
template (or AiSensy campaign) names with their variables in order — start them with `hospital` so every message
names the hospital — and the DLT template IDs; per hospital set an optional own DLT header (+ its DLT IDs) and the
monthly allowances. India DLT: templates are registered under the platform's principal entity with a `{#var#}` for
the hospital name. Template-only providers (AiSensy, Meta, MSG91, DLT SMS) can't send a hospital's *custom messages*
unless a matching shared template exists; WA CRM / OpenWA sends each hospital's own wording.

### Billing (Razorpay) — once
1. Razorpay Dashboard (Hospital Comrade's own account) → API keys. Webhooks → URL
   `https://<project>.supabase.co/functions/v1/billing?webhook=razorpay`, events `payment.captured`, `payment.failed`,
   `order.paid`, a secret of your choice.
2. `supabase secrets set RAZORPAY_KEY_ID=rzp_live_… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=… PLATFORM_NAME="Hospital Comrade"`
3. `supabase functions deploy billing --no-verify-jwt` (the webhook carries no Supabase token; the function checks
   the caller itself). Without the keys, Plan & wallet says online payment isn't switched on — record bank / UPI
   payments with the team tools.
4. Prices / GST / rates / trial and grace days / seller GSTIN: `update platform_settings set data = data || '{"graceDays": 10}' where key = 'billing'`.
   One hospital: `tenants.billing` (`price`, `included`, `ratesPaise`) or the admin tools in Plan & wallet.

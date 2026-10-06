# Production & staging (Coolify)

Every push to the working branch used to go straight to the live site. From now on there are **two apps in Coolify**:

| | Branch | Domain (example) | Env |
|---|---|---|---|
| **Production** | `main` | `hospital.digitalcomrade.in` | `APP_ENV=production` |
| **Staging** | `arena/01a0e0e7-dc-hospital` | `staging.hospital.digitalcomrade.in` | `APP_ENV=staging` (purple *Staging* badge, `noindex`) |

New work lands on staging first. When it looks right, it is merged into `main` and production updates.

## One-time setup

1. **Merge the open pull request into `main`** (GitHub → Pull requests → #1 → *Merge*). Wait for the CI check to be green first.
2. **Production app** (the one that serves `hospital.digitalcomrade.in` today):
   Coolify → the app → *Configuration → General* → **Branch: `main`** → Save → *Redeploy*.
   Check https://hospital.digitalcomrade.in/version.json shows a fresh `builtAt`.
3. **Staging app**: Coolify → *+ New → Public/Private repository* (same repo) → **Branch: `arena/01a0e0e7-dc-hospital`** →
   Build pack *Docker Compose* (same `docker-compose.yml`) → Domain `https://staging.hospital.digitalcomrade.in` →
   Environment variables: `APP_ENV=staging` (and, later, the staging Supabase URL / anon key) → *Deploy*.
4. **DNS** (Cloudflare): add an `A` record `staging.hospital` → `157.173.109.129`, *DNS only* or *Proxied* with SSL mode **Full (strict)** — never *Flexible* (redirect loop).
5. Turn on *Automatic deployment* (webhook) for both apps.

> Use a **separate Supabase project** for staging (e.g. `hospital-comrade-staging`, Mumbai region) so tests never touch real hospital data.

## Everyday flow

1. Changes are pushed to the working branch → **staging** redeploys automatically.
2. Check staging (log in with each role, try the changed screens).
3. Merge into `main` (pull request) → **production** redeploys.
4. Database changes: run the upgrade SQL on **staging Supabase first**, then on production.

Optional: deploy production from **release tags** (`v1.4.0`) instead of `main` — Coolify → *Branch* → `refs/tags/v*`, then
`git tag v1.4.0 && git push origin v1.4.0` publishes a release.

## Runtime variables

| Variable | Values | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | — | Supabase project — required (empty = *Database not connected* screen) |
| `REQUIRE_BACKEND` | — | no longer needed (there is no demo mode); harmless if still set |
| `TENANCY` | `single` (default) / `multi` | `multi` = Hospital Comrade SaaS: many hospitals on one database, chosen by domain |
| `PLATFORM_NAME` | `Hospital Comrade` (default) | SaaS brand shown on platform screens (multi mode) |
| `PLATFORM_DOMAIN` | `hospital.digitalcomrade.in` (default) | The platform's own domain — shows the Hospital Comrade product page (demo and multi mode); change it here when the domain changes |
| `TENANT_SUBDOMAINS` | off (default) / `on` | multi mode: every hospital at `<slug>.PLATFORM_DOMAIN` — turn on only after wildcard DNS + SSL (docs/MULTI_TENANCY.md) |
| `APP_ENV` | `production` (default) / `staging` | staging badge + `noindex` |
| `PLATFORM_LEGAL_NAME`, `PLATFORM_ADDRESS`, `PLATFORM_EMAIL`, `PLATFORM_PHONE`, `PLATFORM_GRIEVANCE_OFFICER`, `PLATFORM_JURISDICTION` | — | company shown on the platform's legal pages (`/legal/*`) |
| `SENTRY_DSN` | — | optional error reporting (Sentry-compatible; messages scrubbed of personal data) |
| `CSP_MODE` | `enforce` (default) / `report-only` / `off` | Content-Security-Policy header (`CSP_SCRIPT_EXTRA` adds script hosts) |
| `HSTS` | `on` (default) / `off` | Strict-Transport-Security header |

All of them are read when the container starts (`/env.js`), so changing one only needs a restart, not a rebuild.
Going live with paying hospitals: follow [GO_LIVE.md](GO_LIVE.md) and run `npm run preflight -- https://<domain>`.

## Database & Edge Functions

- New Supabase project: `supabase/production.sql` (no demo data). Existing project: `supabase/upgrade-2026-10.sql`
  (safe to run again; oldest supported database: September 2026). Run on staging first.
- Control panel (platform team): `https://<your app>/control-panel/` — served by the same container (nginx `location /control-panel/`).
- After database changes, redeploy the functions: `supabase functions deploy notify`,
  `supabase functions deploy whatsapp-bot --no-verify-jwt`, `supabase functions deploy domains` and
  `supabase functions deploy billing --no-verify-jwt`, `supabase functions deploy impersonate` (Razorpay secrets: see MULTI_TENANCY.md → Billing).
- Hospitals' own domains (Settings → Domain) use Cloudflare for SaaS when the `domains` function has the secrets
  `CF_API_TOKEN`, `CF_ZONE_ID`, `CF_CNAME_TARGET`, `PLATFORM_DOMAIN` — setup in
  [MULTI_TENANCY.md](MULTI_TENANCY.md#cloudflare-for-saas-once-for-automatic-ssl-on-hospitals-domains).
- Hospital Comrade's shared SMS / WhatsApp / e-mail accounts are `PLATFORM_*` secrets on the `notify` function — list in
  [MULTI_TENANCY.md](MULTI_TENANCY.md#hospital-comrade-messaging-shared-accounts).
- Many hospitals on one database (`TENANCY=multi`): see the runbook in [MULTI_TENANCY.md](MULTI_TENANCY.md#going-multi-hospital-runbook).

## Rollback

Coolify → app → *Deployments* → pick the previous successful deployment → *Redeploy*. The database is not touched by a rollback.

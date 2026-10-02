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
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | — | Supabase project (empty = demo mode in the browser) |
| `REQUIRE_BACKEND` | `true` | refuse to fall back to demo mode (set for every real install) |
| `TENANCY` | `single` (default) / `multi` | `multi` = Hospital Comrade SaaS: many hospitals on one database, chosen by domain |
| `PLATFORM_NAME` | `Hospital Comrade` (default) | SaaS brand shown on platform screens (multi mode) |
| `PLATFORM_DOMAIN` | `hospital.digitalcomrade.in` (default) | The platform's own domain — change it here when the domain changes |
| `APP_ENV` | `production` (default) / `staging` | staging badge + `noindex` |

All of them are read when the container starts (`/env.js`), so changing one only needs a restart, not a rebuild.

## Database & Edge Functions

- New Supabase project: `supabase/production.sql` (no demo data). Existing project: `supabase/upgrade-2026-10.sql`
  (safe to run again; oldest supported database: September 2026). Run on staging first.
- After database changes, redeploy the functions: `supabase functions deploy notify` and
  `supabase functions deploy whatsapp-bot --no-verify-jwt`.
- Many hospitals on one database (`TENANCY=multi`): see the runbook in [MULTI_TENANCY.md](MULTI_TENANCY.md#going-multi-hospital-runbook).

## Rollback

Coolify → app → *Deployments* → pick the previous successful deployment → *Redeploy*. The database is not touched by a rollback.

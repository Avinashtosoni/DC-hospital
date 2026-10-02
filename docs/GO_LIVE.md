# Go-live runbook (phase 8)

From a demo deployment to a platform that paying hospitals can use: a new Supabase project in Mumbai, a new domain,
live payments, backups and a checked launch. Work top to bottom; each step says how to verify it. Budget one day for
the setup and a week of soft launch with one or two friendly hospitals before you advertise.

> **First time?** Follow [SETUP_GUIDE.md](SETUP_GUIDE.md) — the same steps in order (Hinglish), with a credentials
> sheet and a hands-on staging test checklist. This file has the details behind each step.

> Two tools check your work: **`npm run preflight -- https://<your-domain>`** (from any laptop, looks at the site the
> way a browser does) and **Control panel → System health → Launch checklist** (looks inside the database and lists
> the manual steps). Launch when both show nothing to fix.

---

## 1. Supabase project (Mumbai)

1. supabase.com → **New project**: region **South Asia (Mumbai) `ap-south-1`**, a strong database password (keep it in a
   password manager), **Pro plan** (daily backups, no pausing; Point-in-Time Recovery is an optional add-on).
2. **Database → Extensions**: enable `pg_cron` and `pg_net`.
3. **SQL editor**: open `supabase/production.sql`, change the owner e-mail on the line marked ✏️ to the e-mail of the
   person who will own the platform's own (main) hospital, run it. It has no demo data and no demo logins.
4. **Auth → URL configuration**: Site URL `https://<your-domain>`; redirect URLs `https://<your-domain>/**` and, for
   hospitals on their own domains, each `https://<their-domain>/**` (add them as hospitals connect).
5. **Auth → SMTP**: your own sender (Resend, Amazon SES, Zoho…). The built-in sender only allows a few e-mails per
   hour — sign-ups and password resets would fail on launch day.
6. **Auth → Providers → Email**: keep "Confirm email" on. Owners, doctors and staff are matched to their hospital by
   e-mail, so with it off anyone could claim an unclaimed hospital with the owner's address. `npm run preflight`
   fails while it is off.
7. Note the **Project URL** and the **anon key** (Settings → API) for step 3, and the **Session pooler** connection
   string (Connect → Session pooler) for backups (step 8).

Verify: SQL editor → `select public.platform_signup_info();` returns `{"enabled": true, …}`.

## 2. Edge Functions

```bash
supabase link --project-ref <ref>
supabase functions deploy notify
supabase functions deploy whatsapp-bot --no-verify-jwt
supabase functions deploy domains
supabase functions deploy billing --no-verify-jwt
```

Secrets (Supabase → Edge Functions → Secrets):

| Function | Secrets |
|---|---|
| `notify` | the shared sender's keys — `PLATFORM_*` list in [MULTI_TENANCY.md](MULTI_TENANCY.md#hospital-comrade-messaging-shared-accounts) |
| `billing` | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PLATFORM_NAME` |
| `domains` | `CF_API_TOKEN`, `CF_ZONE_ID`, `CF_CNAME_TARGET`, `PLATFORM_DOMAIN` |

Verify: `npm run preflight -- https://<your-domain>` shows ✓ for every `Function …` line.

## 3. The app on Coolify

New application from this repository (Dockerfile build), port 80. Environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | from step 1.7 |
| `REQUIRE_BACKEND` | `true` — never fall back to demo data |
| `TENANCY` | `multi` |
| `APP_ENV` | `production` |
| `PLATFORM_NAME` | your brand, e.g. `Hospital Comrade` |
| `PLATFORM_DOMAIN` | your domain without `https://`, e.g. `hospital.digitalcomrade.in` |
| `PLATFORM_LEGAL_NAME`, `PLATFORM_ADDRESS`, `PLATFORM_EMAIL`, `PLATFORM_PHONE`, `PLATFORM_GRIEVANCE_OFFICER`, `PLATFORM_JURISDICTION` | the company on the Terms / Privacy / Refund / DPA pages and invoices' footer |
| `SENTRY_DSN` | optional error reporting (no patient data is sent — see `src/lib/monitoring.ts`) |
| `CSP_MODE` | `enforce` (default). Use `report-only` for a day if you add third-party scripts, then back to `enforce` |
| `HSTS` | `on` (default) |

Everything is read when the container starts — changing a value needs a restart, not a rebuild.

Verify: `https://<your-domain>/healthz` says `ok`; `/env.js` shows your Supabase URL and `"TENANCY": "multi"`.

## 4. Domain & DNS

1. Point `<your-domain>` (A record) at the Coolify server; Coolify issues the certificate.
2. Behind Cloudflare: SSL mode **Full (strict)** — never "Flexible" (it loops).
3. Hospitals' own domains: Cloudflare for SaaS (fallback origin + Custom Hostnames token) — steps in
   [MULTI_TENANCY.md](MULTI_TENANCY.md#cloudflare-for-saas-once-for-automatic-ssl-on-hospitals-domains).
4. An uptime monitor (UptimeRobot, Better Stack…) on `https://<your-domain>/healthz`.

## 5. The platform team and settings

1. The first admin signs up on `https://<your-domain>/?hospital=main` → Create account, then runs
   `supabase/snippets/add-provider.sql` with `v_role := 'admin'` in the SQL editor.
2. **Control panel** (`/control-panel/`):
   - **Team** → add a **second admin** (so the platform is never locked out), then support / finance people.
   - **Platform settings** → **Seller**: legal name, **GSTIN**, address, e-mail (printed on every invoice); check
     prices, GST %, free-trial and grace days, message rates.
   - **Sign-ups** → open or closed, **Review first** or **Create instantly**, trial days, sign-ups per day, when to
     close unclaimed trials, and the product website address (used in the welcome e-mail).
   - **Platform settings** → **Retention**: keep the defaults unless your lawyer says otherwise.
3. The main hospital's owner signs up with the e-mail from step 1.3 and, in **Settings → Notifications**, switches
   automatic delivery **on** — that schedules message delivery, reminders and the nightly clean-up.

## 6. Payments (Razorpay)

1. Finish KYC; switch the dashboard to **Live mode**; generate live keys → `billing` secrets (step 2).
2. Webhooks → `https://<project>.supabase.co/functions/v1/billing?webhook=razorpay`, events `payment.captured`,
   `payment.failed`, `order.paid`; the secret → `RAZORPAY_WEBHOOK_SECRET`.
3. Razorpay asks for your Terms, Privacy, Refund and Contact pages: `https://<your-domain>/legal/terms`, `/legal/privacy`,
   `/legal/refunds`, `/legal/contact` (and `/legal/delivery` for "shipping").
4. Test: create a test hospital, pay ₹1 worth (top up the wallet) with your own UPI, check the invoice PDF, refund it
   from Razorpay.

## 7. Legal

The pages under `/legal/*` are a sound starting point written for an Indian SaaS processing health data (DPDP Act,
IT Act, GST). **Have a lawyer review them before launch.** Edit `src/platform/legal.ts` and bump `LEGAL_VERSION` when the
text changes — every free-trial sign-up records the version it accepted.

## 8. Backups

Supabase Pro keeps daily backups for 7 days. On top of that, `.github/workflows/backup.yml` keeps an **encrypted,
off-site** copy every night (02:30 IST):

1. GitHub → repository → Settings → Secrets → Actions: `SUPABASE_DB_URL` (session pooler string from step 1.7) and
   `BACKUP_PASSPHRASE` (long random text — **store a copy offline**; without it the backups cannot be opened).
   Optional: `BACKUP_S3_URI` + `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` (and `BACKUP_S3_ENDPOINT`
   for Cloudflare R2) to also copy it to your bucket.
2. Actions → **Database backup** → **Run workflow** once; the run's artifact is the backup (kept 30 days).
3. **Test a restore** on a scratch Supabase project before launch:

```bash
gpg --decrypt hospital-comrade-<date>.dump.gpg > db.dump          # asks for BACKUP_PASSPHRASE
pg_restore --no-owner --no-privileges --clean --if-exists -d "<scratch project connection string>" db.dump
```

Uploaded files (logos, photos, reports) live in Supabase Storage, which is not in the dump — download the buckets
monthly or sync them with `rclone`.

## 9. Preflight and the launch checklist

```bash
npm run preflight -- https://<your-domain> --hospital=main
```

Fix every ✗; read every `!`. Then **Control panel → System health → Launch checklist**: the database checks must all be
green (demo logins, admins, seller details, scheduled jobs, row-level security, hospital isolation, clean-up,
sign-up, messages) and every manual step ticked.

## 10. Launch day and the first week

- Soft launch: create one or two friendly hospitals yourself (control panel → Hospitals → Add), watch **System health**
  daily — failed messages, abandoned payments, the nightly clean-up.
- Then open sign-up on the product page. With **Review first**, approve requests within a working day (Sign-ups).
- Every new hospital's owner sees a **setup checklist** on the dashboard (details, doctors, team, first appointment,
  website, domain, plan); it disappears when done.
- Incidents (data leak, wrong person saw data): Control panel → Incidents — the 72-hour clock starts there; see
  [OPERATIONS.md](OPERATIONS.md#74-incidents--breaches).

## Moving from the demo deployment

The current demo (`TENANCY` unset, no Supabase) can stay as a sales demo on its own subdomain (e.g.
`demo.<your-domain>`), with `PLATFORM_DOMAIN` set to the real domain so its links point there. The new production app is
a separate Coolify application with the variables from step 3. Nothing has to be migrated: the demo keeps its data in
visitors' browsers only.

## Rollback

Coolify → the application → Deployments → redeploy the previous one. Database changes are additive and
`upgrade-2026-10.sql` is safe to run again; restore from a backup (step 8) only for data loss.

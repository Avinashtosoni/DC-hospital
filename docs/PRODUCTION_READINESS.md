# Production readiness — audit result, manual items, deploy steps, checklist

Result of the October 2026 end-to-end audit. Step-by-step detail for every item is in [GO_LIVE.md](GO_LIVE.md)
(English) and [SETUP_GUIDE.md](SETUP_GUIDE.md) (Hinglish); this file is the summary. What changed in code: [CHANGELOG.md](../CHANGELOG.md).

## Approved repository remediation tracker

The audit is complete; implementation follows the approved order below. Repository changes and tests only—no live production
configuration, credentials, buckets or data are changed by this work.

| ID | Scope | Status |
|---|---|---|
| PRA-01 | Tenant/app-settings privacy and bootstrap PII | Complete; SQL, fresh/production install and upgrade regressions are in place. |
| PRA-02 | Active-user/session authorization for already-issued JWTs | Complete for database access: check the authenticated user's ban, exact `auth.sessions` row and `not_after` when available; missing `auth.sessions` fails closed. Profile/provider self-rows, avatar writes, OTP and impersonation entry points use the check. |
| PRA-03 | Shared Edge Function manifest and fail-closed preflight | Complete; shared function inventory/policy manifest and fail-closed preflight checks are implemented with regression coverage. |
| PRA-04 | Bind Meta webhooks to their configured receiving phone-number ID | Complete; signed callbacks require Meta configuration and an exact receiver-ID match on every change. |
| PRA-05 | Accepted internal-access risks and non-invasive monitoring | Complete; existing accountant clinical reads and provider-support chart access are unchanged. Best-effort app-route signals are added; see the limits below. |
| PRA-06 | Database and object backup recovery assurance | Pending; repository workflow only, no credentials or bucket changes. |
| PRA-07 | Release dependency checks | Pending. |
| PRA-08 | Production-like tests, readiness monitoring and browser-data minimization | Pending. |

**PRA-02 limit:** [Supabase's session documentation](https://supabase.com/docs/guides/auth/sessions) says sign-out removes `auth.sessions` rows, while time-box and inactivity policy are enforced on refresh and expired rows may be cleaned progressively (up to 24 hours later). This SQL check blocks revoked/removed sessions, bans and `not_after` expiries that Auth exposes; it does not promise an immediate inactivity cutoff before Auth deletes the row. No Auth settings are changed here.

### PRA-05 — accepted internal-access risks and monitoring

- **Access remains unchanged:** accountants retain the existing clinical-table reads, and assigned provider-support users retain read-only patient-chart access. No RLS policy, permission, or route access was narrowed.
- **Provider signals:** successful patient-chart renders emit a best-effort `provider_audit` signal with the provider actor, tenant, time, and internal patient record ID; selected clinical app routes emit a screen label. No chart contents are added to the event.
- **Accountant signals:** selected in-app clinical screens emit a low-cardinality `info` event to optional Sentry when `SENTRY_DSN` is configured. It contains the tenant slug, role, and allow-listed screen label—not a user ID, patient ID, URL, query string, or clinical data. With Sentry unset, this signal is off.
- **Important limit:** these events are initiated by browser navigation, can be lost or disabled, and do not observe direct database/API reads, scripts, or every data request. They are operational signals—not a complete access audit. Existing database audit triggers continue to record changes, not every read.
- **No live configuration or production state is changed.** Public and operator-facing copy was corrected so it no longer promises that every read is logged.

## 1. What the audit fixed

| Area | Fix |
|---|---|
| **Security** | The booking OTP was returned to the browser whenever no SMS/WhatsApp gateway was connected, so anyone could book as any phone number. It is never returned now. Licence dates are no longer public. Staff salaries are visible to owner and accountant only. |
| **Demo mode** | Removed. The app always uses the database and shows *Database not connected* without it, so patient data can never sit in one browser's `localStorage`. Demo logins, browser demo hospitals and *Live demo* links are gone. |
| **Data integrity (DB-enforced)** | No cross-hospital references. Invoice totals are recomputed from items. No overpayment, and no payments on draft or cancelled bills. A bill with payments can't be cancelled. Each patient can have one live admission and each bed one patient. A hospital always keeps at least one owner. |
| **RBAC (DB-enforced)** | Doctors change only their own prescriptions and appointments. Reception edits unpaid bills only and can't see the staff directory. The UI hides edit/delete buttons the database would reject. Policies are generated from `src/auth/permissions.ts`, so the UI and RLS can't drift. |
| **Validation** | Indian mobile numbers, no future birth dates, limits on amounts and quantities, discharge after admission. Checked in forms and in Postgres, with readable messages (`friendlyDbError`). |
| **Migrations** | `upgrade-2026-10.sql` is idempotent. It now carries the integrity and RBAC sections, and a test proves an upgraded DB equals a fresh install. |
| **Tests** | 322 tests: unit, SQL against real Postgres (PGlite) per role, cross-hospital isolation, OTP limits, upgrade drift. Edge functions have Deno tests. |
| **Build** | Main bundle is about 350 KB (CI budget 600 KB). nginx sets CSP, HSTS and security headers, and serves `/healthz`. |

## 2. Things only you can do (credentials and config)

Never paste these in chat or commit them. They go only into Supabase / Coolify / GitHub secret fields.

| # | Where | What |
|---|---|---|
| 1 | Supabase (new project, **Mumbai**, Pro plan) | DB password (password manager). Enable `pg_cron` and `pg_net`. |
| 2 | Supabase → Settings → API | **Project URL** and **anon key** → Coolify. The service-role key is used **only** by Edge Functions (set automatically). |
| 3 | Supabase → Auth | Site URL and redirect URLs (`https://<domain>/**`). **Custom SMTP** (Resend/SES/Zoho). Keep **Confirm email ON**. |
| 4 | Supabase → Edge Functions → Secrets | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PLATFORM_NAME` · `CF_API_TOKEN`, `CF_ZONE_ID`, `CF_CNAME_TARGET`, `PLATFORM_DOMAIN` · messaging `PLATFORM_SMS_*` / `PLATFORM_WHATSAPP_*` / `PLATFORM_EMAIL_*` (list in [MULTI_TENANCY.md](MULTI_TENANCY.md#hospital-comrade-messaging-shared-accounts)) |
| 5 | Coolify → app → Environment | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `TENANCY=multi`, `APP_ENV=production`, `PLATFORM_NAME`, `PLATFORM_DOMAIN`, `PLATFORM_LEGAL_NAME`, `PLATFORM_ADDRESS`, `PLATFORM_EMAIL`, `PLATFORM_PHONE`, `PLATFORM_GRIEVANCE_OFFICER`, `PLATFORM_JURISDICTION`, optional `SENTRY_DSN` |
| 6 | DNS / Cloudflare | A record → Coolify server. SSL **Full (strict)**. Cloudflare for SaaS for hospitals' own domains. |
| 7 | SMS (India) | DLT entity ID, sender ID and approved templates (MSG91 / Fast2SMS). **Needed for online booking.** |
| 8 | WhatsApp | AiSensy / Meta / MSG91 / OpenWA keys and approved templates. |
| 9 | Razorpay | KYC, live keys, webhook `https://<project>.supabase.co/functions/v1/billing?webhook=razorpay`. |
| 10 | GitHub → Settings → Secrets → Actions | `SUPABASE_DB_URL` (session pooler), `BACKUP_PASSPHRASE` (keep an offline copy). **Fix the GitHub billing lock**, because CI and nightly backups don't run until then. |
| 11 | Control panel | Seller **GSTIN** (placeholder today), legal name and address. A second admin. |
| 12 | Legal | Lawyer review of `/legal/*` (DPDP Act, compliance from 14 May 2027). |

## 3. Exact deployment steps

1. **Backup first** (existing DB only): Supabase → Database → Backups, or Actions → *Database backup* → Run.
2. **Database**
   - **New:** run `supabase/production.sql` in the SQL editor after editing the ✏️ private onboarding contact e-mail line.
   - **Existing:** run `supabase/upgrade-2026-10.sql`. It is safe to re-run. If it prints a WARNING about duplicate live admissions, discharge the duplicates and run it again.
   - **Staging with sample data:** run `supabase/master.sql`. Never use it for a real hospital.
3. **Edge Functions**, from a machine with the Supabase CLI:
   ```bash
   supabase link --project-ref <ref>
   npm run functions:deploy
   ```
   The shared [function manifest](../supabase/functions/_shared/manifest.ts) is the canonical inventory and gateway-JWT
   policy; only `billing` and `whatsapp-bot` disable gateway JWT checks because their handlers validate their signed
   webhooks and/or caller identity. Then set the secrets from §2 row 4.
4. **Coolify:** set the variables from §2 row 5, then **Restart** (no rebuild needed). A push to the branch redeploys automatically.
5. **Verify the app:** `https://<domain>/healthz` → `ok`. `/env.js` shows your Supabase URL and `"TENANCY": "multi"`.
6. **First admin:** sign up on `https://<domain>/?hospital=main`, then run `supabase/snippets/add-provider.sql` with `v_role := 'admin'`. Then open the control panel (`/control-panel/`) and add a second admin, the seller details and the sign-up settings.
7. **Main hospital owner:** sign up with the ✏️ e-mail. In Settings → Notifications, connect SMS/WhatsApp, switch automatic delivery **on**, and send a test.
8. **Preflight:** run `npm run preflight -- https://<domain> --hospital=main`. Fix every ✗, then go to Control panel → System health → **Launch checklist**, where everything should be green.
9. **Uptime monitor** on `/healthz`. Optional: Sentry.

**Rollback:** Coolify → Deployments → redeploy the previous build. Schema changes are additive, so the older app keeps working. Restore from backup only for data loss.

## 4. Production checklist

- [ ] Supabase in Mumbai on the Pro plan; `pg_cron` and `pg_net` enabled
- [ ] `production.sql` (or the upgrade) ran without errors
- [ ] Auth: Confirm email ON, custom SMTP, redirect URLs, Site URL
- [ ] All 4 Edge Functions deployed and their secrets set; preflight `Function …` lines ✓
- [ ] Coolify vars set; `/env.js` correct; HTTPS valid; HSTS on; CSP `enforce`
- [ ] SMS or WhatsApp connected and the *Booking OTP* event on. Without it, online booking asks visitors to call.
- [ ] Settings → Notifications → automatic delivery on (reminders and nightly clean-up scheduled)
- [ ] Seller GSTIN, legal name and address in the control panel; hospital GSTIN/PAN in Settings → Billing
- [ ] Two platform admins; the owner uses their own login (no `Demo@123` accounts on production)
- [ ] Backups: GitHub secrets set, one manual run, **one test restore** done; Storage buckets downloaded monthly
- [ ] Razorpay live mode with the webhook tested by a ₹1 top-up and refund
- [ ] Legal pages reviewed; `LEGAL_VERSION` bumped if the text changed
- [ ] Uptime monitor on `/healthz`; System health checked daily in week one
- [ ] Role smoke test on production: owner, doctor, reception, accountant, staff and patient can each sign in and see only their own menus

## 5. Known limits (by decision, not bugs)

- **Deferred features:**
  - Pharmacy dispensing and stock deduction, and lab parameters with PDF reports. The user will scope these later.
  - Refunds and credit notes. Today a bill with payments can't be cancelled, so handle refunds outside the app for now.
  - IPD auto bed charges, online bill pay, insurance/TPA, OPD queue, payroll, telemedicine and patient documents.
- **Access rules:** the accountant can read patients' clinical fields, because the table is shared. Assigned provider-support accounts retain read-only chart access. UI access signals are best-effort and do not audit direct database/API reads. Staff covers pharmacy and lab work; there are no separate roles.
- **Not done yet:** platform phases 8.5–8.8 and the Turnstile captcha.
- **Code quality:** 113 lint warnings (mostly `exhaustive-deps`) and 26 clickable `div`s without a role. These are low-risk.

# Operations & compliance (phase 7)

How to run Hospital Comrade day to day and meet India's **Digital Personal Data Protection Act 2023** and the
**DPDP Rules 2025** (in full force from **14 May 2027**). The database rules live in `scripts/sql/compliance.sql`.

> This is engineering guidance, not legal advice. Have a lawyer review your privacy policy, data processing
> agreement with hospitals, and breach procedure before launch.

## Who is who under the DPDP Act

| Role | Who | What it means |
|---|---|---|
| Data Fiduciary | each **hospital** | decides why patient data is collected; answers patients' requests |
| Data Processor | **Hospital Comrade** (you) | stores and processes data for the hospitals; security, breach notice, deletion on exit |
| Data Principal | **patients** (and staff) | rights to access, correction, erasure, grievance |

Each hospital's website privacy page (Website CMS → Privacy) already has a **Grievance officer** section — make
sure every hospital fills in the name, e-mail and phone.

## 7.1 Patients' privacy rights

Patients use **My Profile → Your data & privacy**:

- **Download** — a JSON file with their profile, visits, prescriptions, lab tests, admissions, bills, payments,
  feedback, consents and requests (`my_data_export()`). Each download is logged as a completed "access" request.
- **Health tips & offers** switch — `patients.marketing_opt_out`; every change is kept in `consent_log`. Custom /
  birthday messages (Settings → Notifications → scheduled messages) skip opted-out and erased patients.
  Appointment, bill and report messages are service messages and still go out.
- **Ask for a correction / to delete my data** — one open request per kind; the owner is e-mailed (event
  `privacy_request`, never blocked by plan limits).

Owners answer on **Privacy requests** (`/privacy-requests`, owner only). Answer **within 30 days** — the page
highlights requests from day 25.

- **Correction**: edit the patient record, then *Mark done* (optional note).
- **Rejection**: needs a reason; the patient sees it.
- **Erasure → Erase patient** (`erase_patient()`): name becomes "Erased patient <MRN>", phone / e-mail / address /
  emergency contact / insurance cleared (allergies stay — they are clinical); the login is deleted; website enquiries, WhatsApp-bot chats
  and OTPs from that phone are deleted; feedback comments removed; audit-log entries about them are redacted.
  **Visits, prescriptions, lab results and bills stay** (medical-records and tax law), without the name.

Privacy actions work on a read-only hospital too (expired plan or closing).

## 7.2 Owners take their data with them

**Settings → Data & backup → Export all hospital data** — a ZIP with one UTF-8 CSV per table (Excel-ready, BOM),
`manifest.json` (row counts) and `README.txt`. Invite tokens and the internal `tenant_id` are left out; API keys
are never in tables. Capped at 200,000 rows per table (the README says if a table was cut — then send them a
database copy). This tab stays visible to owners even when the *Data & backup* module is managed by your team.

## 7.3 Closing a hospital (offboarding)

Control panel → hospital → **Settings → Close this hospital** (admin only):

1. **Close** with a reason and a notice period (7–90 days, default 30). The hospital turns read-only at once,
   online booking stops, the owner is e-mailed (`hospital_closing`) and everyone sees a red banner with a
   *Download data* button (patients are sent to their profile).
2. **Reopen** any time before deletion — nothing was lost.
3. After the notice period: **Delete all data…** — type the short name and re-enter your password. The database
   checks the password sign-in is less than 10 minutes old (`REAUTH_REQUIRED` otherwise). It keeps a tombstone in
   `tenant_purges` (name, counts, who, when, reason) **and the hospital's paid / refunded Hospital Comrade invoices**
   (GST: keep 8 years), deletes every login of the hospital and every row, then the hospital itself.

Backups: deleted data still exists in backups until they expire (Supabase PITR: 7–28 days; your own `pg_dump`s:
your schedule). Say so in your agreement with hospitals.

## 7.4 Incidents & breaches

Control panel → **Incidents** (admin records, support reads):

- Record it **as soon as you find it** — the "found at" time starts the **72-hour** clock for reporting a
  personal-data breach to the **Data Protection Board**. The list shows hours left / overdue.
- Add notes as you go (every change goes on the timeline with time and person), mark *contained* / *resolved*,
  and **Reported to the Board** when done.
- **Notify hospital owners** — sends your notice (e-mail + push, `incident_notice`) to the owners of the affected
  hospitals; the result lists anyone without an e-mail to contact by hand. The hospitals (fiduciaries) must tell
  their patients without delay — help them with the wording.

Keep the incident record for at least a year after it is resolved.

## 7.5 System health

Control panel → **System health** (admin; support sees their hospitals): scheduler jobs and whether they are late
or failing (needs `pg_cron`; message delivery needs `pg_net`), messages sent / failed / stuck in the last 24 hours
per hospital, the latest delivery errors, payments in the last 7 days, database size and the largest tables
(admin), hospitals that are closing, open / overdue privacy requests, open incidents and the last retention run.

The site itself: `/healthz` returns `ok` (Docker health check).

### Live checks, alerts, broadcasts and shared accounts

**Setup (once):**

1. Run `supabase/upgrade-2026-10.sql` again in the SQL editor. It is safe to re-run, and it adds `cp_notify`.
2. Run `npx supabase functions deploy notify ops` and `npx supabase functions deploy billing --no-verify-jwt` (billing now records when the Razorpay webhook was last seen).
3. Enable **Database → Extensions → `supabase_vault`** (encrypts the API keys), plus `pg_cron` and `pg_net` (the scheduler).
4. Make sure the hospital's scheduler is on (Settings → Notifications → automatic delivery). The ops tick runs inside the same
   every-minute job (`notify_cron_flush` → `ops_cron_tick`). It calls the `ops` function next to `notify`.
5. In the control panel, open **Alerts → Settings** and set the **Platform address** (`https://hospital.digitalcomrade.in`).

**Control panel pages:**

- **Platform settings → Integrations** (admin): one card each for **Razorpay**, **SMS**, **WhatsApp**, **E-mail** and **Browser push (Firebase)**.
  - **Status**: Connected / Needs attention / Error / Not set up, from the latest health check, with its detail (e.g. "fast2sms · key accepted · wallet ₹493"). It also says where the keys come from: saved in the panel, Edge Function secrets (fallback), or both.
  - **Check connection** checks that one account right away (no message is sent) and stores the result like a scheduled check. It also runs automatically after you save.
  - **Send test** (SMS, WhatsApp, e-mail, push) sends one real message on the shared account.
  - **Manage keys**: pick the provider (or "Not used" to switch the channel off), fill the fields, remove a saved key.
    - Keys are write-only: you only ever see `••••1234` plus who saved it and when.
    - Changing a key asks for your password and is audited (`messaging:setup`).
    - A value saved here wins over the Edge secret with the same `PLATFORM_*` name.
  - **Razorpay**:
    - Key ID, key secret and webhook secret. Panel keys are used as a pair (both saved), otherwise the `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` Edge secrets. The webhook secret falls back on its own.
    - The card shows test / live mode, whether webhooks are arriving, and the webhook URL to copy. Razorpay events: `payment.captured`, `payment.failed`, `order.paid`.
    - Saved keys reach the `billing` function within a minute.
- **Messaging** (admin):
  - **Templates**: approved WhatsApp template names, their parameter order and DLT IDs, per message.
  - **Delivery log** (admins only): every message from every hospital and from the platform, with **Retry** for failed ones. One-time codes and tests can't be retried.
- **Broadcasts** (admin): in-app banner, e-mail, WhatsApp, SMS and push to all hospitals, or by plan, status or a hand-picked list, sent to the roles you choose.
  - The preview shows the recipient count and estimated cost. You can send now or schedule.
  - The delivery report is per channel.
  - Paid channels go out on the shared accounts at the platform's cost. A hospital's wallet is never charged.
- **Alerts** (bell in the header): sign-ups, call-back requests, payments paid or failed, trial ending, low wallet, incidents, a service down or recovered, and limits crossed.
  - Admins switch channels (bell, e-mail, browser push, WhatsApp) and events on or off, and set severity and limits.
  - Each member picks their own channels in **My notifications**, adds their own WhatsApp number, and turns on push per browser.
  - Repeats are deduplicated, with a cooldown.
- **System health → Live checks**: every 5 minutes the checks cover:
  - the site `/healthz`
  - Auth and Storage
  - every Edge Function (with latency)
  - the database itself (a small read through the API, with response time)
  - the shared provider keys (no message is sent): Resend, SendGrid, Meta, OpenWA, wacrm (`GET /api/v1/me`, key + scopes), Firebase, MSG91 (balance API) and Fast2SMS (wallet API, also shows the balance). AiSensy has no public key-check API, so it shows "configured"
  - database connections against `max_connections`, and file storage used against your plan limit (set **File storage limit** in Alerts → Settings; Supabase Pro = 102400 MB)
  - the Razorpay webhook: when it was last seen, with a warning if online payments came in without a webhook or if signatures are being rejected
  - hospital custom domains: HTTPS works, and for Cloudflare domains the certificate status and expiry (needs `CF_API_TOKEN` and `CF_ZONE_ID` on the ops function too)
  - database size against the limit, queue backlog, delivery failures and the scheduler

  The page shows 24-hour and 7-day uptime, an hourly or daily strip (24 hours / 7 days toggle), a graph button per service (uptime % bars + response-time line), latency, failure history and a **Check now** button.
  A state change raises an alert: "Scheduled job late" for the scheduler, "Message failures spiking" for delivery, and "Service down" / "Limit crossed" for the rest. History is kept for 30 days; older rows are removed once a night (first scheduler tick after 02:00 India time).

**Troubleshooting:**

- "Last run … looks stopped": the scheduler is off, or `ops` isn't deployed. Check `select public.ops_call('{"health":true}')` and look at the Edge Function logs.
- Push "not set up": either the Firebase web config is missing in Platform settings → Integrations, or Push is switched off in Alerts → Settings.

### Message templates and the in-app bell

- **Where:** Control panel → Messaging → **Templates** (admins edit, support can view). Every message has an ID such as
  `APT-002`; hospitals see the same IDs in Settings → Notifications.
- **Order of wording:** catalog default → control-panel edit → the hospital's own wording (ignored when the template is
  **locked**). Off in the panel = never sent, for every hospital; a channel off in the panel stays off for all of them.
- **WhatsApp approval:** "WhatsApp sheet (CSV)" lists every WhatsApp template with `{{1}}…` and sample values. Submit
  them at Meta / your provider, then fill in the approved name, parameters and status in each template.
- **Daily messages** (doctor schedule 07:30 IST, platform digest 08:30, overdue invoices 10:00, owner digest 20:30) run from the
  every-minute tick (`notify_daily_tick()`), once per hospital per day (`notify_once`).
- **Bell:** `public.user_notifications`, 90-day history, read by `my_notifications()` / `read_notifications()`.
- **Deploy:** run `supabase/upgrade-2026-10.sql`, then `npx supabase functions deploy ops notify`.

### Server monitor (CPU, RAM, disk, containers, SSL)

1. Make a long random key (`openssl rand -hex 24`) and save it as the **`SERVER_MONITOR_KEY`** secret of the `ops` Edge
   Function (Supabase → Edge Functions → Secrets). Redeploy `ops`.
2. On the server, as root: copy `scripts/server/hc-monitor.sh` to `/usr/local/bin/hc-monitor` (`chmod +x`), and create
   `/etc/hc-monitor.env` (`chmod 600`) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SERVER_MONITOR_KEY` and
   `SSL_DOMAINS="hospital.digitalcomrade.in airbase.digitalcomrade.in"`.
3. `hc-monitor --dry-run` prints the report; `hc-monitor` sends one (Health → "Server" rows appear).
4. Cron: `echo '*/5 * * * * root /usr/local/bin/hc-monitor >/dev/null 2>&1' > /etc/cron.d/hc-monitor`.

Limits are in Alerts → Settings → thresholds (CPU 85 %, RAM 90 %, disk 85 %, SSL 14 days, silent after 15 minutes).
No report for 15 minutes raises "Server monitor silent" (the agent or the server is down).

### Sign-in verification (OTP)

- **Team:** Platform settings → **Security**. Hospitals: their **Settings → Security**, or control panel → Hospital → **Security**. Booking code on / off is in the same places.
- **Delivery:**
  - Team codes go to `platform_outbox` (kind `otp`), and the panel asks `ops` to send them at once (`{ "deliver_otp": … }`).
  - Hospital codes go to the hospital's own `notification_outbox` (event `login_otp`) and are flushed right away.
  - Both are retried by the every-minute tick.
- **Deploy:**
  - Run `supabase/upgrade-2026-10.sql`, then `npx supabase functions deploy ops notify`.
  - `ops` refuses everything except `deliver_otp` to a team member who hasn't entered this session's code.
- **Locked out** (codes not arriving)? Switch it off in the SQL editor. As the database owner the safety check doesn't apply:

  ```sql
  -- the team's own switch
  update public.platform_settings set data = jsonb_set(data, '{loginOtp,enabled}', 'false') where key = 'security';
  -- one hospital
  update public.app_settings set data = jsonb_set(data, '{security,otp,login,enabled}', 'false')
   where key = 'app' and tenant_id = '<hospital id>';
  ```
- **Audit:** switching is recorded as `settings:security` / `hospital:otp` in the provider log, and as normal settings changes in the hospital's audit log.

## 7.6 Retention

The nightly job **`dch-retention`** (03:00 IST) runs `run_retention()`; replaces the old weekly
`dch-outbox-cleanup`. Control panel → **Platform settings → Data retention** sets the periods; *Run now* runs it.

| Data | Default | Minimum | Note |
|---|---|---|---|
| Hospital audit logs | 1095 days | 365 | |
| Control panel log | 1095 | 365 | |
| Sent messages (outbox) | 400 | 30 | |
| One-time codes | 7 | 1 | booking + password reset |
| Website enquiries | 1095 | 30 | resolved / spam only |
| Sales leads | 1095 | 30 | won / lost only |
| Answered privacy requests | 1095 | 365 | proof you answered |
| WhatsApp bot chats | 30 | 1 | |

Patient records, appointments, prescriptions, lab results, bills and payments are **never** deleted by this job —
they belong to the hospital, which must keep medical records (commonly 3+ years; longer for minors and
medico-legal cases) and accounts (8 years).

## Applying phase 7 to an existing database

1. Run `supabase/upgrade-2026-10.sql` (safe to run again).
2. Switch automatic delivery off and on once in a hospital's Settings → Notifications, so `dch-retention` replaces
   `dch-outbox-cleanup` (Settings → Notifications → scheduler shows the jobs).
3. Redeploy the `notify` function (`supabase functions deploy notify`) — platform notices are exempt from plan limits.
4. Check Control panel → System health.

## Routine checklist

- **Daily**: System health — late jobs, stuck messages, failures.
- **Weekly**: open privacy requests across hospitals (Health → Privacy requests open), payments failed/abandoned.
- **Monthly**: test a restore from backup; review team members and their hospital assignments (Team).
- **Every incident**: record → contain → Board within 72 h → notify hospitals → resolve with a note.

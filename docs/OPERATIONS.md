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

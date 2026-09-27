# DC Hospital · Management System

A full-stack **Hospital Management System** for hospital owners, doctors, receptionists, accountants, staff and patients. It's built with **React + TypeScript + Tailwind** and runs on **Supabase** (Postgres, Auth and Row Level Security).

![stack](https://img.shields.io/badge/React-18-61dafb) ![stack](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ecf8e) ![stack](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

| Area | What's included |
| --- | --- |
| **Auth** | Email/password sign-in and patient self-registration. There are 6 roles, with role-based navigation, page guards and permissions for each action. |
| **Dashboards** | A dashboard for each role: owner KPIs and revenue charts, the doctor's patient queue, front-desk quick actions, accountant cash-flow, the staff task list and a patient portal. |
| **Patients** | Full CRUD, auto-generated MRNs and a health record page with tabs for appointments, prescriptions, labs, admissions and billing. |
| **Appointments** | Book / confirm / check-in / complete / cancel / no-show. Patients book and cancel their own appointments. |
| **Prescriptions** | E-prescriptions with a medicines editor and a printable prescription. |
| **Laboratory** | Test orders tracked from requested → sample collected → in progress → completed, with results. |
| **IPD** | Admissions, bed allocation and discharge. A visual board shows occupancy for every ward and bed. |
| **Billing** | Invoices with line items, discount and GST. Recording a payment updates the balance and status automatically. Invoices are printable. |
| **Finance** | Expenses, a P&L report, revenue by source, expenses by category, top doctors, and CSV export. |
| **Operations** | Pharmacy and inventory (low-stock and expiry alerts, one-click restock), a notice board with audience targeting, users and roles, and settings. |
| **UX** | Skeleton loaders, empty states, **optimistic create/update/delete with rollback**, toasts, responsive layout with a mobile drawer, search, filters, sorting and pagination. |

## Quick start (demo mode, no backend needed)

```bash
npm install
npm run dev          # http://localhost:5173
```

Without Supabase credentials, the app runs in **demo mode**. It loads realistic seed data (80 patients, 14 doctors, 350+ appointments, 800+ invoices, 6 months of finances) and saves every change in your browser's `localStorage`. You can restore the original data from **Settings → Reset demo data**.

### Demo accounts (password `Demo@123`)

| Role | Email |
| --- | --- |
| Hospital Owner | owner@dchospital.com |
| Doctor | doctor@dchospital.com |
| Receptionist | reception@dchospital.com |
| Accountant | accounts@dchospital.com |
| Staff (Head Nurse) | staff@dchospital.com |
| Patient | patient@dchospital.com |

The login screen also has one-click buttons for each account.

## Using Supabase (persistent, multi-user)

1. Create a Supabase project, then open **SQL Editor → New query**.
2. Paste and run **[`supabase/master.sql`](supabase/master.sql)**. This single file creates:
   - all 15 tables, constraints and indexes
   - helper functions (`has_role`, `my_patient_id`, …)
   - triggers: `updated_at`, auto profile + patient record on sign-up, a role-change guard, and admission ↔ bed/patient status sync
   - **Row Level Security policies** for every table and role (generated from `src/auth/permissions.ts`, the same matrix the UI uses)
   - the 6 demo login accounts and all demo data, with dates relative to `current_date` so the data always looks current
3. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Restart `npm run dev` and sign in with a demo account.

> ⚠️ Re-running `master.sql` drops and recreates all DC Hospital tables, replacing their data with the demo data.

New users who sign up become **patients**. The owner promotes them to doctor, receptionist, accountant or staff under **Users & Roles**; only the owner can change roles, and the database enforces this.

### Regenerating the master SQL

The schema lives in `scripts/sql/schema.sql`, the permission matrix in `src/auth/permissions.ts` and the demo data in `src/data/seed.ts`. After changing any of them:

```bash
npm run sql:build    # rewrites supabase/master.sql
```

## Public website

Signed-out visitors get a multi-page, patient-facing hospital website. Signed-in users still land on their dashboard at `/`, and every public page stays reachable while signed in.

| Route | Page |
| --- | --- |
| `/` (guests) · `/welcome` | Home: hero with quick booking, stats, services bento, doctors, testimonials, packages, FAQ |
| `/about` | Story, mission/vision, milestone timeline, values, leadership, accreditations |
| `/services` | Searchable grid of 12 specialities, signature programmes, 24×7 support services |
| `/services/:slug` | Speciality detail: overview, conditions, procedures, technology, that department's doctors, FAQ, sticky booking card |
| `/find-a-doctor` | Doctor directory: search (name, condition, language), department filter, "available today", sort. Filters sync to the URL |
| `/find-a-doctor/:slug` | Doctor profile: credentials, education, weekly OPD schedule, reviews, a 7-day slot picker that hands off to booking, similar doctors |
| `/packages` | Health check-ups with an Individual/Couple toggle, a full comparison table, check-up-day timeline and FAQ |
| `/contact` | Contact channels, validated enquiry form with a reference number, map, hours and directions |
| `/faq` | Searchable, categorised help centre |
| `/privacy` · `/terms` | Legal pages with a sticky, scroll-spy table of contents |
| any unknown URL | Branded 404 (unknown dashboard URLs still send guests to the login page) |

- **Palette:** periwinkle → deep blue (`#CCCCFF`, `#A3A3CC`, `#5C5C99`, `#292966`), exposed as the Tailwind `peri-*` scale. Headings use Plus Jakarta Sans.
- **Shared shell** (`SiteLayout.tsx`): a sticky glass navbar with a Services mega-menu and active-link states, the footer, and a mobile sticky Call/Book bar. Pages set their own `<title>`/meta description and scroll to the top on navigation.
- **Accessibility:** a skip link, breadcrumbs, aria-wired tabs, radios, accordions and form errors, and keyboard-friendly menus. All motion (scroll reveals, counters, parallax) respects `prefers-reduced-motion`. Layouts are tested at 390 px and 1440 px with no horizontal overflow.
- **Code:** in `src/site/`. Page components live in `pages/`, shared blocks in `ui.tsx`/`parts.tsx`, and copy in `content.ts`. Speciality and doctor data live in `data/services.ts` and `data/doctors.ts`, so edit those to change the content. Every page is lazy-loaded as its own small chunk. Images are in `public/landing/`.
- **Contact enquiries** are stored in the browser (`localStorage`, key `dch:enquiries:v1`). To collect them centrally, point `submit()` in `pages/Contact.tsx` at a Supabase table or an email/webhook endpoint.

## Website CMS (Dashboard → Website → Website CMS)

The hospital **owner** can edit every public page without touching code:

| Section | What you can change |
|---|---|
| **Site settings** | Hospital name & tagline, phone / WhatsApp / email / address, opening hours, directions, map, social links, top bar, emergency box, default call-to-action, and **which pages are visible** |
| **Pages** | Home (hero, stats, insurers, features, benefits, steps, section headings, show/hide each section), About, Services, Find a doctor, Packages, Contact, FAQ, Privacy & Terms — including SEO title/description |
| **Collections** | Specialities (each gets its own `/services/:slug` page), support services, doctors (photo, OPD days, fees, education…), health packages + comparison table, FAQs, testimonials |
| **Media library** | Upload images (auto-resized to WebP in the browser), reuse built-in photos |

- **Live preview** — the page updates as you type (desktop / mobile view). Nothing is public until you press **Publish**.
- **Hide, reorder, duplicate, delete** any list item; drafts survive switching dashboard pages.
- **Version history** — every publish/reset keeps the previous version; restore it with one click.
- **Validation** — duplicate/invalid URL slugs are blocked before publishing.
- Headings support `*highlight*` and texts support `{phone}`, `{email}`, `{address}`, `{name}` tokens from Site settings.
- **Contact form → Enquiries**: messages from `/contact` land in *Dashboard → Website → Enquiries* (owner & receptionist) with call/email/status actions.

**Storage.** With Supabase, content lives in `site_content` (one JSONB row per section), history in `site_content_revisions`
(written by a trigger that also stamps who published), images in the public `site-media` storage bucket and enquiries in
`site_enquiries`. RLS: anyone can read content and submit an enquiry; only the owner can write content or upload media.
Sections that were never edited fall back to the defaults in `src/site/cms/defaults.ts`. Re-running `master.sql` resets
the hospital demo data but **keeps your website content, history and images**. In demo mode the same features use
browser storage.

## Deploy with Docker / Coolify

The repo ships a production **multi-stage Dockerfile**. Node builds the app, and **nginx** (Alpine) serves it with SPA routing, gzip, long-lived caching for build assets, security headers and a `/healthz` endpoint.

**Supabase keys are read when the container starts.** On every start, the container writes `/env.js` from its environment variables. The same image works for demo, staging and production; changing a key only needs a restart, not a rebuild.

### Coolify (recommended)

1. **+ New Resource → Public/Private Repository**, then pick this repo and branch.
2. **Build Pack:** `Dockerfile`. Leave Base Directory `/` and Dockerfile Location `/Dockerfile`.
3. **Ports Exposes:** `80`. The image also listens on `3000`, so Coolify's default works too. A wrong port shows up as **502 Bad Gateway** even though the healthcheck passes.
4. **Environment Variables:**
   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your project's anon/public key |

   Plain runtime variables are enough; you don't need to tick "Build Variable". Leave both empty to run in **demo mode**.
5. Set your domain and click **Deploy**. Coolify uses the image's built-in `HEALTHCHECK` (`GET /healthz`).
6. In Supabase: **Authentication → URL Configuration**, add your Coolify domain to *Site URL / Redirect URLs*.

You can also choose the **Docker Compose** build pack. `docker-compose.yml` is ready for it, and the environment variables appear in the Coolify UI automatically.

### Plain Docker

```bash
docker build -t dc-hospital .
docker run -d -p 8080:80 \
  -e VITE_SUPABASE_URL=https://<project>.supabase.co \
  -e VITE_SUPABASE_ANON_KEY=<anon-key> \
  --name dc-hospital dc-hospital
# → http://localhost:8080   (omit the -e flags for demo mode)
```

Or `docker compose up -d --build`; uncomment the `ports` block in `docker-compose.yml` first.

| File | Purpose |
| --- | --- |
| `Dockerfile` | node:22-alpine build → nginx:1.27-alpine runtime, healthcheck |
| `docker/nginx.conf` | SPA fallback, caching, gzip, security headers, `/healthz` |
| `docker/40-runtime-env.sh` | writes `/env.js` from env vars when the container starts |
| `docker-compose.yml` | Compose / Coolify compose deployment |
| `.dockerignore` | keeps the build context small (no `node_modules`, `.env`, `.git`) |

> The anon key is public by design; Row Level Security in `master.sql` protects the data. **Never** put the `service_role` key in these variables.

## Role permissions

| Module | Owner | Doctor | Receptionist | Accountant | Staff | Patient |
| --- | --- | --- | --- | --- | --- | --- |
| Patients | CRUD | RU | CRU | R | RU | own |
| Appointments | CRUD | CRU (own list) | CRUD | – | R | own (book / cancel) |
| Prescriptions | CRUD | CRUD | – | – | R | own |
| Lab tests | CRUD | CRU | CR | R | CRU | own |
| Admissions / Beds | CRUD | CRU / RU | CRU / RU | R / – | RU / RU | – |
| Invoices / Payments | CRUD | – | CRU / CR | CRUD | – | own |
| Expenses & Reports | ✔ | – | – | ✔ | – | – |
| Staff | CRUD | – | R | R | – | – |
| Inventory | CRUD | R | – | R | CRU | – |
| Users & Roles | ✔ | – | – | – | – | – |

## Project structure

```
src/
  auth/            AuthProvider, permissions matrix (source of truth for UI + RLS)
  data/            adapter interface, localStorage adapter, Supabase adapter, deterministic seed
  hooks/           React Query hooks with optimistic mutations
  resources/       declarative resource configs (columns, forms, filters, row actions, side effects)
  components/      UI kit, generic ResourcePage (table + drawer form), layout
  pages/           dashboards, patient record, invoice & prescription print views, beds, reports, settings
scripts/           master SQL generator + schema
supabase/master.sql  ← the single file to run in Supabase
```

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: type-check and build for production
- `npm run sql:build`: regenerate `supabase/master.sql`
- `docker build -t dc-hospital .`: build the production image

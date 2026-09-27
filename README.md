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

-- =====================================================================================================
--  1. EXTENSIONS & RESET
--  Re-running this file DROPS and recreates every DC Hospital table (all app data is replaced by demo data).
-- =====================================================================================================
create extension if not exists pgcrypto with schema extensions;

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.site_enquiries, public.notices, public.inventory, public.expenses, public.payments, public.invoices, public.admissions,
  public.beds, public.wards, public.lab_tests, public.prescriptions, public.appointments, public.patients,
  public.staff, public.doctors, public.departments, public.profiles
cascade;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.protect_profile_role() cascade;
drop function if exists public.sync_admission() cascade;
drop function if exists public.has_role(public.app_role[]) cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.my_patient_id() cascade;
drop function if exists public.current_app_role() cascade;
drop type if exists public.app_role cascade;

-- =====================================================================================================
--  2. TYPES
-- =====================================================================================================
create type public.app_role as enum ('owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient');

-- =====================================================================================================
--  3. TABLES
-- =====================================================================================================
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        public.app_role not null default 'patient',
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  location    text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.doctors (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid unique references public.profiles (id) on delete set null,
  full_name         text not null,
  email             text,
  phone             text,
  department_id     uuid references public.departments (id) on delete set null,
  specialization    text not null,
  qualification     text,
  experience_years  int check (experience_years >= 0),
  consultation_fee  numeric(12,2) not null default 0 check (consultation_fee >= 0),
  available_days    text[] not null default '{}',
  shift             text,
  status            text not null default 'active' check (status in ('active', 'on_leave', 'inactive')),
  bio               text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.staff (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid unique references public.profiles (id) on delete set null,
  full_name      text not null,
  email          text,
  phone          text,
  designation    text not null,
  department_id  uuid references public.departments (id) on delete set null,
  shift          text not null default 'morning' check (shift in ('morning', 'evening', 'night')),
  salary         numeric(12,2) not null default 0 check (salary >= 0),
  join_date      date,
  status         text not null default 'active' check (status in ('active', 'on_leave', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.patients (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid unique references public.profiles (id) on delete set null,
  mrn                      text not null unique,
  full_name                text not null,
  gender                   text not null default 'other' check (gender in ('male', 'female', 'other')),
  date_of_birth            date,
  blood_group              text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')),
  phone                    text,
  email                    text,
  address                  text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  allergies                text,
  insurance_provider       text,
  status                   text not null default 'outpatient' check (status in ('outpatient', 'inpatient', 'discharged')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients (id) on delete cascade,
  doctor_id         uuid not null references public.doctors (id) on delete cascade,
  appointment_date  date not null,
  appointment_time  text not null check (appointment_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  type              text not null default 'consultation' check (type in ('consultation', 'follow_up', 'emergency', 'checkup')),
  status            text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
  reason            text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.prescriptions (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  doctor_id       uuid not null references public.doctors (id) on delete cascade,
  diagnosis       text not null,
  symptoms        text,
  medications     jsonb not null default '[]'::jsonb,
  advice          text,
  follow_up_date  date,
  prescribed_on   date not null default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.lab_tests (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients (id) on delete cascade,
  doctor_id     uuid references public.doctors (id) on delete set null,
  test_name     text not null,
  category      text not null default 'Biochemistry',
  priority      text not null default 'routine' check (priority in ('routine', 'urgent', 'stat')),
  status        text not null default 'requested' check (status in ('requested', 'sample_collected', 'in_progress', 'completed', 'cancelled')),
  result        text,
  price         numeric(12,2) not null default 0 check (price >= 0),
  requested_on  date not null default current_date,
  completed_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.wards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  type        text not null default 'general' check (type in ('general', 'icu', 'private', 'semi_private', 'maternity', 'pediatric', 'emergency')),
  floor       text not null,
  daily_rate  numeric(12,2) not null default 0 check (daily_rate >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.beds (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references public.wards (id) on delete cascade,
  bed_number  text not null unique,
  status      text not null default 'available' check (status in ('available', 'occupied', 'maintenance', 'reserved')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.admissions (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  doctor_id       uuid references public.doctors (id) on delete set null,
  bed_id          uuid references public.beds (id) on delete set null,
  admission_date  date not null default current_date,
  discharge_date  date,
  reason          text,
  status          text not null default 'admitted' check (status in ('admitted', 'discharged')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (discharge_date is null or discharge_date >= admission_date)
);

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null unique,
  patient_id      uuid not null references public.patients (id) on delete cascade,
  issue_date      date not null default current_date,
  due_date        date,
  items           jsonb not null default '[]'::jsonb,
  subtotal        numeric(12,2) not null default 0,
  tax             numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  amount_paid     numeric(12,2) not null default 0 check (amount_paid >= 0),
  status          text not null default 'unpaid' check (status in ('draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  patient_id  uuid not null references public.patients (id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  method      text not null default 'cash' check (method in ('cash', 'card', 'upi', 'insurance', 'bank_transfer')),
  paid_on     date not null default current_date,
  reference   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('salaries', 'supplies', 'utilities', 'equipment', 'maintenance', 'rent', 'other')),
  description   text not null,
  amount        numeric(14,2) not null check (amount >= 0),
  expense_date  date not null default current_date,
  vendor        text,
  status        text not null default 'paid' check (status in ('paid', 'pending')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.inventory (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null default 'medicine' check (category in ('medicine', 'consumable', 'equipment', 'surgical')),
  sku            text not null unique,
  quantity       int not null default 0 check (quantity >= 0),
  unit           text not null default 'units',
  reorder_level  int not null default 0 check (reorder_level >= 0),
  unit_price     numeric(12,2) not null default 0 check (unit_price >= 0),
  supplier       text,
  expiry_date    date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.notices (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  audience      text not null default 'all' check (audience in ('all', 'staff', 'doctors', 'patients')),
  priority      text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  published_on  date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Messages sent from the public website's Contact form (anyone may insert; owner/receptionist manage them)
create table public.site_enquiries (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null default ('DCH-' || lpad((floor(random() * 1000000))::int::text, 6, '0')),
  name        text not null check (char_length(name) between 2 and 120),
  phone       text not null check (char_length(phone) between 6 and 30),
  email       text check (email is null or char_length(email) <= 200),
  topic       text not null default 'General enquiry' check (char_length(topic) <= 80),
  speciality  text check (speciality is null or char_length(speciality) <= 80),
  message     text not null check (char_length(message) between 1 and 2000),
  status      text not null default 'new' check (status in ('new', 'in_progress', 'resolved', 'spam')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes for foreign keys and common filters
create index on public.doctors (department_id);
create index on public.staff (department_id);
create index on public.appointments (patient_id);
create index on public.appointments (doctor_id, appointment_date);
create index on public.appointments (appointment_date);
create index on public.prescriptions (patient_id);
create index on public.prescriptions (doctor_id);
create index on public.lab_tests (patient_id);
create index on public.lab_tests (status);
create index on public.beds (ward_id);
create index on public.admissions (patient_id);
create index on public.admissions (bed_id) where status = 'admitted';
create index on public.invoices (patient_id);
create index on public.invoices (status);
create index on public.payments (invoice_id);
create index on public.payments (patient_id);
create index on public.expenses (expense_date);
create index on public.site_enquiries (status, created_at desc);

-- =====================================================================================================
--  4. HELPER FUNCTIONS (security definer so they can be used inside RLS without recursion)
-- =====================================================================================================
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any (roles))
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role <> 'patient')
$$;

create or replace function public.my_patient_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.patients where profile_id = auth.uid() limit 1
$$;

-- =====================================================================================================
--  5. TRIGGERS
-- =====================================================================================================
-- 5a. keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','departments','doctors','staff','patients','appointments','prescriptions','lab_tests',
                           'wards','beds','admissions','invoices','payments','expenses','inventory','notices','site_enquiries']
  loop
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- 5b. every new auth user gets a profile (+ patient record). Self sign-ups are ALWAYS patients;
--     the hospital owner promotes staff from the "Users & Roles" screen.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  next_mrn int;
  v_name   text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1));
  v_phone  text := nullif(new.raw_user_meta_data ->> 'phone', '');
begin
  insert into public.profiles (id, full_name, email, role, phone)
  values (new.id, v_name, new.email, 'patient', v_phone)
  on conflict (id) do nothing;

  select coalesce(max(nullif(regexp_replace(mrn, '\D', '', 'g'), '')::int), 100000) + 1 into next_mrn from public.patients;
  insert into public.patients (profile_id, mrn, full_name, email, phone, gender, status)
  values (new.id, 'DCH-' || next_mrn, v_name, new.email, v_phone, 'other', 'outpatient')
  on conflict (profile_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5c. only the owner may change roles (SQL editor / service role — auth.uid() is null — is allowed)
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.has_role('owner') then
    raise exception 'Only the hospital owner can change user roles';
  end if;
  if new.email is distinct from old.email and auth.uid() is not null then
    new.email := old.email;
  end if;
  return new;
end $$;

create trigger trg_profiles_protect_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- 5d. admissions keep bed + patient status consistent (idempotent with the client-side updates)
create or replace function public.sync_admission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'admitted' and old.bed_id is not null then
      update public.beds set status = 'available' where id = old.bed_id;
      update public.patients set status = 'outpatient' where id = old.patient_id;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.bed_id is distinct from new.bed_id and old.bed_id is not null then
    update public.beds set status = 'available' where id = old.bed_id;
  end if;
  if new.bed_id is not null then
    update public.beds set status = case when new.status = 'admitted' then 'occupied' else 'available' end where id = new.bed_id;
  end if;
  update public.patients set status = case when new.status = 'admitted' then 'inpatient' else 'discharged' end where id = new.patient_id;
  return new;
end $$;

create trigger trg_admissions_sync after insert or update or delete on public.admissions
  for each row execute function public.sync_admission();

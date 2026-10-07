-- =====================================================================================================
--  19a. MULTI-TENANCY CORE — loaded right after the schema so every later function can call current_tenant()
--  (see tenancy.sql for the full story; that file adds tenant_id + the isolation policy to every table at the end)
-- =====================================================================================================
-- ------------------------------------------------------------------ tables
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null check (char_length(name) between 2 and 120),
  code        text not null default 'HSP' check (code ~ '^[A-Z]{2,6}$'),           -- MRN prefix, e.g. DCH-100001
  status      text not null default 'active' check (status in ('trial', 'active', 'grace', 'read_only', 'suspended')),
  plan        text not null default 'clinic',
  -- module → 'provider' (managed by the Hospital Comrade team, hidden from the hospital) | 'hospital' (owner may edit)
  modules     jsonb not null default '{}'::jsonb,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- phase 7: offboarding — a closing hospital is read-only until the platform team purges it (after purge_after)
alter table public.tenants add column if not exists closing_at timestamptz;
alter table public.tenants add column if not exists purge_after timestamptz;
alter table public.tenants add column if not exists close_reason text;
-- the public demo hospital (demo.sql): at most one; reset every night
alter table public.tenants add column if not exists is_demo boolean not null default false;
create unique index if not exists tenants_one_primary on public.tenants (is_primary) where is_primary;

-- the hospital every existing row belongs to (fixed id so upgrades and seeds agree)
insert into public.tenants (id, slug, name, code, is_primary, modules)
values ('a0000000-0000-4000-8000-000000000001', 'main', 'DC Hospital', 'DCH', true,
        '{"general":"hospital","appearance":"hospital","dashboard":"hospital","notifications":"hospital","forms":"hospital","security":"hospital","data":"hospital","cms":"hospital"}'::jsonb)
on conflict (id) do nothing;

create table if not exists public.tenant_domains (
  domain          text primary key check (domain ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),   -- lower-case host, no port
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  is_primary      boolean not null default false,
  method          text not null default 'manual' check (method in ('manual', 'cloudflare')),
  verified_at     timestamptz,
  ssl_status      text,
  cf_hostname_id  text,
  created_at      timestamptz not null default now()
);
create index if not exists tenant_domains_tenant_idx on public.tenant_domains (tenant_id);
-- phase 2.3 — custom domains through Cloudflare for SaaS (written by the `domains` Edge Function)
alter table public.tenant_domains add column if not exists status       text;          -- Cloudflare hostname status: pending / active / moved / …
alter table public.tenant_domains add column if not exists dns_target   text;          -- what the hospital's CNAME must point to
alter table public.tenant_domains add column if not exists verification jsonb;         -- TXT / HTTP ownership + certificate validation records
alter table public.tenant_domains add column if not exists last_error   text;
alter table public.tenant_domains add column if not exists checked_at   timestamptz;
-- phase 3 — the hospital on Hospital Comrade's shared messaging accounts (set by a Hospital Comrade admin):
--   { "smsSenderId": "CITYCL", "templates": { "<event>": { "smsTemplateId": "…" } }, "limits": { "sms": 1000, "whatsapp": 1000, "email": null } }
alter table public.tenants add column if not exists messaging jsonb not null default '{}'::jsonb;
-- phase 4 — licence and wallet. trial_ends_at / paid_until drive the effective status (tenant_license below); both empty =
-- the status column is used as set by hand (the primary hospital and older rows). billing = per-hospital overrides:
--   { "price": 1499, "included": { "sms": 200 }, "ratesPaise": { "whatsapp": 30 }, "legalName": "…", "gstin": "…" }
alter table public.tenants add column if not exists trial_ends_at timestamptz;
alter table public.tenants add column if not exists paid_until    timestamptz;
alter table public.tenants add column if not exists billing       jsonb not null default '{}'::jsonb;
alter table public.tenants add column if not exists wallet_paise  bigint not null default 0;
-- one primary (canonical) address per hospital
create unique index if not exists tenant_domains_one_primary on public.tenant_domains (tenant_id) where is_primary;

create table if not exists public.provider_users (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  role            text not null check (role in ('admin', 'support', 'finance')),
  active          boolean not null default true,
  elevated_until  timestamptz,                       -- "sudo" window for admin-only actions (provider panel)
  created_at      timestamptz not null default now()
);

create table if not exists public.provider_assignments (
  user_id     uuid not null references public.provider_users (user_id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table if not exists public.provider_audit (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  user_id     uuid,
  user_name   text,
  mode        text,
  tenant_id   uuid,
  action      text not null,
  target      text,
  detail      jsonb
);
create index if not exists provider_audit_at_idx on public.provider_audit (tenant_id, at desc);

-- ------------------------------------------------------------------ request context
create or replace function public.request_header(p_name text)
returns text language sql stable set search_path = public as $$
  select nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> lower(p_name), '')
$$;

-- the visitor's connection, for rate limits on public endpoints (OTPs). Only a hash is kept (no raw IPs stored).
-- cf-connecting-ip / x-real-ip are set by Supabase's edge (a client can't forge them); X-Forwarded-For's first entry is
-- the fallback the Supabase docs use. NULL outside an API request (SQL editor, cron, tests).
create or replace function public.client_ip_hash()
returns text language sql stable set search_path = public as $$
  select case when ip is null then null else encode(extensions.digest('dch-ip:' || ip, 'sha256'), 'hex') end
    from (select nullif(trim(coalesce(public.request_header('cf-connecting-ip'), public.request_header('x-real-ip'),
                                      split_part(coalesce(public.request_header('x-forwarded-for'), ''), ',', 1))), '') as ip) x
$$;

create or replace function public.primary_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.tenants where is_primary limit 1
$$;

-- 'admin' | 'support' | 'finance' | null — the signed-in user's provider role
-- null until a team member has entered their sign-in code, when Platform settings → Security asks for one (otp_verify.sql)
create or replace function public.provider_role()
returns text language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  select role into r from public.provider_users where user_id = auth.uid() and active;
  if r is not null and to_regprocedure('public.login_otp_passed(text,uuid)') is not null and not public.login_otp_passed('team', null) then
    return null;
  end if;
  return r;
end $$;

-- may the signed-in provider manage this hospital?
create or replace function public.provider_can(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tenant is not null and exists (
    select 1 from public.provider_users u
     where u.user_id = auth.uid() and u.active
       and (u.role = 'admin' or exists (select 1 from public.provider_assignments a where a.user_id = u.user_id and a.tenant_id = p_tenant)))
$$;

-- the mode a provider is working in right now: support / finance users always their own; an admin picks one
create or replace function public.provider_mode()
returns text language plpgsql stable security definer set search_path = public as $$
declare r text := public.provider_role(); m text := public.request_header('x-provider-mode');
begin
  if r is null then return null; end if;
  if r <> 'admin' then return r; end if;
  return case when m in ('admin', 'support', 'finance') then m else 'admin' end;
end $$;

create or replace function public.current_tenant()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid; h text; uid uuid := auth.uid();
begin
  h := nullif(current_setting('app.tenant_id', true), '');
  if h is not null then return h::uuid; end if;

  h := public.request_header('x-tenant-id');
  if h is not null and h !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h := null; end if;

  if uid is not null then
    if public.provider_role() is not null then
      return case when public.provider_can(h::uuid) then h::uuid end;   -- no hospital picked → sees nothing
    end if;
    select tenant_id into v from public.profiles where id = uid;
    -- sign-in OTP (Settings → Security): nothing of the hospital is visible until this session entered its code
    if v is not null and to_regprocedure('public.login_otp_passed(text,uuid)') is not null and not public.login_otp_passed('hospital', v) then
      return null;
    end if;
    return v;                                                            -- a header never moves a hospital user
  end if;

  if h is not null and exists (select 1 from public.tenants where id = h::uuid) then return h::uuid; end if;
  return public.primary_tenant();
end $$;


-- ------------------------------------------------------------------ module locks
-- tenants.modules maps a settings module to who manages it: 'hospital' (the owner) or 'provider' (the Hospital Comrade
-- team; the module is hidden from the hospital). Modules: general, appearance, dashboard, notifications, forms, security,
-- data, cms. An unlisted module is provider-managed; the primary hospital (single installs) lists every one as 'hospital'.
create or replace function public.module_locked(p_module text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if public.provider_mode() is not null then return false; end if;   -- the team can always change it
  select modules ->> p_module into v from public.tenants where id = public.current_tenant();
  return coalesce(v, 'provider') <> 'hospital';
end $$;

create or replace function public.module_guard(p_module text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.module_locked(p_module) then
    raise exception 'MODULE_LOCKED: This setting is managed for your hospital by the platform team. Contact support to change it.'
      using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------------ this hospital's settings / content / secrets
-- SECURITY DEFINER functions skip RLS, so they read singletons through these helpers instead of "where key = …"
create or replace function public.tenant_setting(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select data into v from public.app_settings where key = p_key and tenant_id = public.current_tenant();
  return v;
end $$;

create or replace function public.tenant_content(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select data into v from public.site_content where key = p_key and tenant_id = public.current_tenant();
  return v;
end $$;

create or replace function public.tenant_secret(p_key text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select value into v from public.app_secrets where key = p_key and tenant_id = public.current_tenant();
  return v;
end $$;
revoke all on function public.tenant_secret(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ tenant_id columns
-- Called right here (schema tables) and again at the end of the build (tables created later). Idempotent.
-- Existing rows join the primary hospital through a constant default first — no table rewrite, no triggers.
create or replace function public.ensure_tenant_columns()
returns void language plpgsql security definer set search_path = public as $f$
declare
  t text;
  tables text[] := array[
    'profiles', 'departments', 'doctors', 'staff', 'patients', 'appointments', 'prescriptions', 'lab_tests', 'wards', 'beds',
    'admissions', 'invoices', 'payments', 'expenses', 'inventory', 'notices', 'notification_templates', 'site_enquiries',
    'site_forms', 'doctor_leaves', 'holidays', 'audit_log', 'visit_feedback', 'staff_invites', 'wa_sessions', 'booking_otps',
    'password_reset_otps', 'site_content', 'site_content_revisions', 'app_settings', 'app_secrets', 'notification_outbox',
    'push_tokens'];
begin
  foreach t in array tables loop
    continue when to_regclass('public.' || t) is null;
    execute format('alter table public.%I add column if not exists tenant_id uuid default %L references public.tenants (id) on delete cascade',
                   t, 'a0000000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column tenant_id set default public.current_tenant()', t);
    if t <> 'profiles' then   -- provider accounts have a profile without a hospital
      execute format('alter table public.%I alter column tenant_id set not null', t);
    end if;
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
  end loop;
end $f$;
revoke all on function public.ensure_tenant_columns() from public, anon, authenticated;

select public.ensure_tenant_columns();
-- ------------------------------------------------------------------ licence (phase 4)
-- The hospital's effective status right now, from its dates — no scheduler needed:
--   trial (trial_ends_at ahead) → active (paid_until ahead) → grace (ended < graceDays ago: everything works, banner)
--   → read_only (sign-in and reading work, nothing can be added or changed) · suspended (set by hand: site and app closed).
-- The primary hospital is always active; a hospital with neither date keeps the status set by hand.
create or replace function public.tenant_license(p_tenant uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; v_end timestamptz; v_grace int := 7;
begin
  select * into t from public.tenants where id = p_tenant;
  if not found then return null; end if;
  if t.is_primary then return 'active'; end if;
  if t.status = 'suspended' then return 'suspended'; end if;
  if t.closing_at is not null then return 'read_only'; end if;          -- closing (phase 7): export only
  if t.paid_until is null and t.trial_ends_at is null then return t.status; end if;
  if t.paid_until > now() then return 'active'; end if;
  if t.trial_ends_at > now() then return 'trial'; end if;
  if to_regclass('public.platform_settings') is not null then
    execute $q$ select coalesce((data ->> 'graceDays')::int, 7) from public.platform_settings where key = 'billing' $q$ into v_grace;
  end if;
  v_end := greatest(coalesce(t.paid_until, '-infinity'::timestamptz), coalesce(t.trial_ends_at, '-infinity'::timestamptz));
  return case when v_end + make_interval(days => coalesce(v_grace, 7)) > now() then 'grace' else 'read_only' end;
end $$;
-- when the hospital becomes read-only (end of the grace period), for banners
create or replace function public.tenant_license_dates(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; v_grace int := 7; v_end timestamptz;
begin
  select * into t from public.tenants where id = p_tenant;
  if not found then return null; end if;
  if to_regclass('public.platform_settings') is not null then
    execute $q$ select coalesce((data ->> 'graceDays')::int, 7) from public.platform_settings where key = 'billing' $q$ into v_grace;
  end if;
  v_end := nullif(greatest(coalesce(t.paid_until, '-infinity'::timestamptz), coalesce(t.trial_ends_at, '-infinity'::timestamptz)), '-infinity'::timestamptz);
  return jsonb_build_object('status', public.tenant_license(p_tenant), 'trial_ends_at', t.trial_ends_at, 'paid_until', t.paid_until,
    'read_only_from', case when t.closing_at is not null then t.closing_at when t.is_primary or v_end is null then null else v_end + make_interval(days => coalesce(v_grace, 7)) end,
    'closing_at', t.closing_at, 'purge_after', t.purge_after);
end $$;

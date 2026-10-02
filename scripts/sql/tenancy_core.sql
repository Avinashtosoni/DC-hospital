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

create or replace function public.primary_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.tenants where is_primary limit 1
$$;

-- 'admin' | 'support' | 'finance' | null — the signed-in user's provider role
create or replace function public.provider_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.provider_users where user_id = auth.uid() and active
$$;

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
    return v;                                                            -- a header never moves a hospital user
  end if;

  if h is not null and exists (select 1 from public.tenants where id = h::uuid) then return h::uuid; end if;
  return public.primary_tenant();
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

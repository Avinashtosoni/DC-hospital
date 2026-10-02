-- =====================================================================================================
--  19. MULTI-TENANCY — Hospital Comrade (many hospitals on one database) + provider roles
--
--  Every hospital is a row in `tenants`. Every hospital table gets a `tenant_id` column and ONE extra
--  RESTRICTIVE policy, `tenant_isolation`, which Postgres ANDs with all the existing role policies:
--      tenant_id = current_tenant()
--  so nothing written before this section has to know about tenants for direct table access.
--
--  current_tenant() — which hospital this request belongs to:
--    1. app.tenant_id         set only by our own SQL (signup trigger, cron loops over hospitals)
--    2. provider              the hospital picked in the app (x-tenant-id header), if they may manage it
--    3. signed-in user        always their own hospital (profiles.tenant_id) — a header can't move them
--    4. visitor (anon)        the hospital whose website they're on (x-tenant-id header from the domain)
--    5. otherwise             the primary hospital → single-hospital installs keep working unchanged
--
--  Providers (the Hospital Comrade team) are not members of any hospital:
--    admin   everything, every hospital            → acts as owner
--    support assigned hospitals; patient records read-only → acts as owner (clinical writes blocked)
--    finance assigned hospitals; billing only      → acts as accountant
--  An admin can work in support / finance mode (x-provider-mode header) — the lower mode is the default in the app.
--
--  Idempotent: safe on a fresh database (master / production) and on a live one (upgrade).
-- =====================================================================================================

-- (tenants, provider tables and current_tenant() live in tenancy_core.sql, loaded right after the schema)

-- ------------------------------------------------------------------ roles are per hospital
create or replace function public.has_role(variadic roles public.app_role[])
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); m text;
begin
  if t is null then return false; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and tenant_id = t and role = any (roles)) then return true; end if;
  m := public.provider_mode();
  if m is null then return false; end if;
  return (case m when 'finance' then 'accountant' else 'owner' end)::public.app_role = any (roles);
end $$;

create or replace function public.is_staff()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant();
begin
  if t is null then return false; end if;
  return exists (select 1 from public.profiles where id = auth.uid() and tenant_id = t and role <> 'patient')
      or public.provider_mode() is not null;
end $$;

create or replace function public.current_app_role()
returns public.app_role language plpgsql stable security definer set search_path = public as $$
declare m text := public.provider_mode(); r public.app_role;
begin
  if m is not null then return (case m when 'finance' then 'accountant' else 'owner' end)::public.app_role; end if;
  select role into r from public.profiles where id = auth.uid() and tenant_id = public.current_tenant();
  return r;
end $$;

-- ------------------------------------------------------------------ tenant_id on every hospital table + isolation policy
select public.ensure_tenant_columns();   -- tables created after the core section (CMS, settings, forms, messaging…)

do $tenancy$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
            join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('tenant_domains', 'provider_assignments', 'provider_audit')
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    if t = 'profiles' then
      execute 'create policy tenant_isolation on public.profiles as restrictive for all to anon, authenticated
                 using (tenant_id = (select public.current_tenant()) or id = auth.uid())
                 with check (tenant_id = (select public.current_tenant()) or id = auth.uid())';
    else
      execute format('create policy tenant_isolation on public.%I as restrictive for all to anon, authenticated
                        using (tenant_id = (select public.current_tenant()))
                        with check (tenant_id = (select public.current_tenant()))', t);
    end if;
  end loop;
end $tenancy$;

-- (sql functions are checked when created, so these come after the tenant_id columns exist)
create or replace function public.my_doctor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.doctors where profile_id = auth.uid() and tenant_id = public.current_tenant() limit 1
$$;

create or replace function public.my_patient_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.patients where profile_id = auth.uid() and tenant_id = public.current_tenant() limit 1
$$;

-- a hospital's own record can't be moved to another hospital by an update
create or replace function public.keep_tenant()
returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id and current_setting('app.tenant_move', true) is distinct from 'on' then
    raise exception 'Records cannot be moved to another hospital' using errcode = '42501';
  end if;
  return new;
end $$;
do $keep$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
            join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('tenant_domains', 'provider_assignments')
  loop
    execute format('drop trigger if exists trg_keep_tenant on public.%I', t);
    execute format('create trigger trg_keep_tenant before update of tenant_id on public.%I for each row execute function public.keep_tenant()', t);
  end loop;
end $keep$;

-- ------------------------------------------------------------------ uniqueness is per hospital
do $uniq$
declare r record; cols text[];
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, c.contype,
           array_agg(a.attname::text order by k.ord) as cols
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype in ('u', 'p') and c.connamespace = 'public'::regnamespace
       and c.conrelid::regclass::text in ('departments', 'wards', 'beds', 'patients', 'invoices', 'inventory', 'site_forms', 'holidays',
                                          'app_settings', 'site_content', 'app_secrets', 'wa_sessions')
     group by 1, 2, 3
  loop
    continue when 'tenant_id' = any (r.cols) or 'id' = any (r.cols)
               or not (r.cols && array['name', 'bed_number', 'mrn', 'invoice_number', 'sku', 'slug', 'holiday_date', 'key', 'phone']);   -- profile_id etc. stay globally unique
    cols := array_prepend('tenant_id', r.cols);
    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
    if r.contype = 'p' then
      execute format('alter table public.%I add primary key (%s)', r.tbl, (select string_agg(quote_ident(x), ', ') from unnest(cols) x));
    else
      execute format('alter table public.%I add constraint %I unique (%s)', r.tbl, r.conname, (select string_agg(quote_ident(x), ', ') from unnest(cols) x));
    end if;
  end loop;
end $uniq$;

drop index if exists public.staff_invites_one_pending;
create unique index if not exists staff_invites_one_pending_t on public.staff_invites (tenant_id, lower(email)) where status = 'pending';

-- MRN / invoice numbers count per hospital, with the hospital's own prefix
create or replace function public.assign_record_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if tg_table_name = 'patients' then
    perform pg_advisory_xact_lock(hashtext('dch_patient_mrn:' || new.tenant_id));
    if coalesce(new.mrn, '') = '' or exists (select 1 from public.patients where tenant_id = new.tenant_id and mrn = new.mrn) then
      select coalesce(code, 'HSP') into v_code from public.tenants where id = new.tenant_id;
      select v_code || '-' || (coalesce(max(nullif(regexp_replace(mrn, '\D', '', 'g'), '')::bigint), 100000) + 1) into new.mrn
        from public.patients where tenant_id = new.tenant_id;
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('dch_invoice_number:' || new.tenant_id));
    if coalesce(new.invoice_number, '') = '' or exists (select 1 from public.invoices where tenant_id = new.tenant_id and invoice_number = new.invoice_number) then
      select 'INV-' || lpad((coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 10000) + 1)::text, 5, '0')
        into new.invoice_number from public.invoices where tenant_id = new.tenant_id;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ new accounts join the hospital they signed up at
-- Sign-ups arrive from Supabase Auth (no request headers), so the website passes its hospital in the sign-up metadata.
-- The choice is pinned for the rest of the transaction, so the patient record made by handle_new_user lands there too.
create or replace function public.profiles_pick_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_meta text; v uuid;
begin
  if new.tenant_id is null or new.tenant_id = public.primary_tenant() then
    select raw_user_meta_data ->> 'tenant_id' into v_meta from auth.users where id = new.id;
    if v_meta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select id into v from public.tenants where id = v_meta::uuid and status <> 'suspended';
    end if;
    new.tenant_id := coalesce(v, new.tenant_id, public.current_tenant(), public.primary_tenant());
  end if;
  perform set_config('app.tenant_id', new.tenant_id::text, true);
  return new;
end $$;
drop trigger if exists trg_profiles_pick_tenant on public.profiles;
create trigger trg_profiles_pick_tenant before insert on public.profiles for each row execute function public.profiles_pick_tenant();

-- ------------------------------------------------------------------ provider: support may read, not change, patient records
do $clinical$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'prescriptions', 'lab_tests', 'admissions', 'visit_feedback'] loop
    execute format('drop policy if exists provider_support_read_only on public.%I', t);
    execute format('create policy provider_support_read_only on public.%I as restrictive for insert to authenticated
                      with check (public.provider_mode() is distinct from %L)', t, 'support');
    execute format('drop policy if exists provider_support_no_update on public.%I', t);
    execute format('create policy provider_support_no_update on public.%I as restrictive for update to authenticated
                      using (public.provider_mode() is distinct from %L)', t, 'support');
    execute format('drop policy if exists provider_support_no_delete on public.%I', t);
    execute format('create policy provider_support_no_delete on public.%I as restrictive for delete to authenticated
                      using (public.provider_mode() is distinct from %L)', t, 'support');
  end loop;
end $clinical$;

-- ------------------------------------------------------------------ RLS on the tenancy tables
alter table public.tenants enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.provider_users enable row level security;
alter table public.provider_assignments enable row level security;
alter table public.provider_audit enable row level security;
revoke all on public.tenants, public.tenant_domains, public.provider_users, public.provider_assignments, public.provider_audit from anon, authenticated;
grant select on public.tenants to anon, authenticated;
grant select, insert, update, delete on public.tenant_domains, public.provider_users, public.provider_assignments to authenticated;
grant update, insert, delete on public.tenants to authenticated;
grant select on public.provider_audit to authenticated;
grant all on public.tenants, public.tenant_domains, public.provider_users, public.provider_assignments, public.provider_audit to service_role;

drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_admin on public.tenants;
create policy tenants_select on public.tenants for select to anon, authenticated
  using (id = (select public.current_tenant()) or public.provider_can(id));
create policy tenants_admin on public.tenants for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin');

drop policy if exists tenant_domains_select on public.tenant_domains;
drop policy if exists tenant_domains_admin on public.tenant_domains;
create policy tenant_domains_select on public.tenant_domains for select to authenticated
  using (public.provider_can(tenant_id) or (tenant_id = (select public.current_tenant()) and public.has_role('owner')));
create policy tenant_domains_admin on public.tenant_domains for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin');

drop policy if exists provider_users_select on public.provider_users;
drop policy if exists provider_users_admin on public.provider_users;
create policy provider_users_select on public.provider_users for select to authenticated
  using (user_id = auth.uid() or public.provider_mode() = 'admin');
create policy provider_users_admin on public.provider_users for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin' and user_id <> auth.uid());

drop policy if exists provider_assignments_select on public.provider_assignments;
drop policy if exists provider_assignments_admin on public.provider_assignments;
create policy provider_assignments_select on public.provider_assignments for select to authenticated
  using (user_id = auth.uid() or public.provider_mode() = 'admin');
create policy provider_assignments_admin on public.provider_assignments for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin');

drop policy if exists provider_audit_select on public.provider_audit;
create policy provider_audit_select on public.provider_audit for select to authenticated
  using (public.provider_mode() = 'admin' or (user_id = auth.uid()));

-- ------------------------------------------------------------------ RPCs
-- the website asks "which hospital is this domain?" before anything else (multi-tenant mode).
-- A mapped domain always wins; only hosts without a mapping (preview / staging / localhost) may name a
-- hospital by slug (?hospital=city), so a hospital's own domain can never be made to show another one.
drop function if exists public.resolve_tenant(text);
create or replace function public.resolve_tenant(p_host text, p_slug text default null)
returns table (id uuid, slug text, name text, status text, modules jsonb, is_primary boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, public.tenant_license(t.id), t.modules, t.is_primary   -- effective status (licence, phase 4)
    from public.tenants t
   where t.id = coalesce(
           (select d.tenant_id from public.tenant_domains d where d.domain = lower(split_part(trim(coalesce(p_host, '')), ':', 1))),
           (select x.id from public.tenants x where x.slug = lower(trim(coalesce(p_slug, '')))))
$$;

-- who am I here: hospital, my role in it, provider role / mode and which modules the hospital may edit itself
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; v_tid uuid := public.current_tenant();
begin
  select * into t from public.tenants where id = v_tid;
  return jsonb_build_object(
    'tenant', case when t.id is null then null else jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', public.tenant_license(t.id), 'plan', t.plan, 'modules', t.modules, 'is_primary', t.is_primary) end,
    -- licence dates for the banner; the wallet balance only for the people who pay (owner / accountant / platform team)
    'license', case when t.id is null then null else public.tenant_license_dates(t.id)
      || case when public.has_role('owner', 'accountant') then jsonb_build_object('wallet_paise', t.wallet_paise) else '{}'::jsonb end end,
    'role', public.current_app_role(),
    'provider_role', public.provider_role(),
    'provider_mode', public.provider_mode());
end $$;

-- hospitals a provider may open (switcher)
create or replace function public.provider_tenants()
returns table (id uuid, slug text, name text, status text, plan text, domain text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, public.tenant_license(t.id), t.plan,
         (select d.domain from public.tenant_domains d where d.tenant_id = t.id order by d.is_primary desc, d.created_at limit 1)
    from public.tenants t
   where public.provider_can(t.id)
   order by t.is_primary desc, t.name
$$;

-- providers write to the audit log for anything sensitive they open (e.g. a patient chart)
create or replace function public.provider_log(p_action text, p_target text default null, p_detail jsonb default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public.provider_role() is null then return; end if;
  insert into public.provider_audit (user_id, user_name, mode, tenant_id, action, target, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), public.provider_mode(), public.current_tenant(),
          left(p_action, 80), left(p_target, 200), p_detail);
end $$;

revoke all on function public.request_header(text), public.primary_tenant(), public.keep_tenant(), public.profiles_pick_tenant() from public, anon, authenticated;
grant execute on function public.current_tenant(), public.provider_role(), public.provider_can(uuid), public.provider_mode(),
  public.has_role(public.app_role[]), public.is_staff(), public.current_app_role(), public.my_doctor_id(), public.my_patient_id()
  to anon, authenticated, service_role;
grant execute on function public.resolve_tenant(text, text) to anon, authenticated;
grant execute on function public.my_context(), public.provider_tenants(), public.provider_log(text, text, jsonb) to authenticated;
revoke all on function public.my_context(), public.provider_tenants(), public.provider_log(text, text, jsonb) from public, anon;

-- ------------------------------------------------------------------ module locks (phase 1.4)
-- Locked modules are hidden in the app; these triggers make sure a hospital user can't change them through the API
-- either. They only act on direct API writes (current_user = authenticated): RPCs check module_guard() themselves,
-- and the platform (SQL editor, service role, provider modes) is never blocked.

-- settings sections inside the shared rows: app_settings 'app' and site_content 'settings'
create or replace function public.locked_paths(p_table text)
returns text[] language plpgsql stable set search_path = public as $$
declare
  m record; out text[] := '{}';
  map jsonb := case p_table
    when 'app_settings' then '{"appearance": ["appearance", "modules", "announcement"], "dashboard": ["dashboard"],
                               "general": ["locale"], "security": ["security"], "notifications": ["notifications"]}'::jsonb
    else '{"general": ["name", "tagline", "address", "phone", "appointmentsPhone", "whatsapp", "email", "siteUrl", "brand"],
           "security": ["portal"],
           "cms": ["about", "topBar", "emergency", "hours", "directions", "map", "socials", "cta", "pages", "seoDescription"]}'::jsonb
  end;
begin
  for m in select key, value from jsonb_each(map) loop
    if public.module_locked(m.key) then
      out := out || array(select jsonb_array_elements_text(m.value));
    end if;
  end loop;
  return out;
end $$;

-- a locked section keeps its saved value (the owner's save of the other sections still goes through)
create or replace function public.keep_locked_sections()
returns trigger language plpgsql set search_path = public as $$
declare k text; v_paths text[];
begin
  if current_user <> 'authenticated' then return coalesce(new, old); end if;
  if tg_table_name = 'site_content' and coalesce(new.key, old.key) <> 'settings' then
    perform public.module_guard('cms');                      -- the website pages belong to the CMS module
    return coalesce(new, old);
  end if;
  if tg_table_name = 'app_settings' and coalesce(new.key, old.key) <> 'app' then return coalesce(new, old); end if;
  v_paths := public.locked_paths(tg_table_name);
  if cardinality(v_paths) = 0 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'MODULE_LOCKED: Some of these settings are managed for your hospital by the platform team.' using errcode = '42501';
  end if;
  foreach k in array v_paths loop
    if tg_op = 'UPDATE' and old.data ? k then
      new.data := jsonb_set(new.data, array[k], old.data -> k);
    else
      new.data := new.data - k;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_app_settings_locked on public.app_settings;
create trigger trg_app_settings_locked before insert or update or delete on public.app_settings
  for each row execute function public.keep_locked_sections();
drop trigger if exists trg_site_content_locked on public.site_content;
create trigger trg_site_content_locked before insert or update or delete on public.site_content
  for each row execute function public.keep_locked_sections();

-- whole tables that belong to one module
create or replace function public.guard_locked_table()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then perform public.module_guard(tg_argv[0]); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_site_forms_locked on public.site_forms;
create trigger trg_site_forms_locked before insert or update or delete on public.site_forms
  for each row execute function public.guard_locked_table('forms');
drop trigger if exists trg_notification_templates_locked on public.notification_templates;
create trigger trg_notification_templates_locked before insert or update or delete on public.notification_templates
  for each row execute function public.guard_locked_table('notifications');

revoke all on function public.keep_locked_sections(), public.guard_locked_table() from public, anon, authenticated;
grant execute on function public.module_locked(text) to anon, authenticated;

-- ------------------------------------------------------------------ internal helpers stay internal (phase 1.7)
-- master.sql grants EXECUTE on every function to authenticated after tenancy_core.sql ran, and new functions are
-- executable by PUBLIC by default — so the revokes are repeated here, at the very end. Only SECURITY DEFINER
-- functions call these (they run as the owner). tenant_secret reads credentials; tenant_setting the hospital's
-- private settings (gateway URLs, sessions); ensure_tenant_columns changes the schema.
revoke all on function public.tenant_secret(text), public.tenant_setting(text), public.tenant_content(text),
  public.ensure_tenant_columns() from public, anon, authenticated;

-- ------------------------------------------------------------------ a new hospital's starting point (phase 1.7)
-- Platform only (SQL editor / provider panel): the built-in website forms (Contact, Review — from src/forms/schema.ts)
-- and the hospital's identity on its website and invoices. Safe to run again; keeps whatever the hospital already changed.
create or replace function public.seed_hospital_defaults(p_tenant uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants;
begin
  select * into t from public.tenants where id = p_tenant;
  if not found then raise exception 'No hospital with id %', p_tenant; end if;
  insert into public.site_forms (tenant_id, slug, name, description, kind, enabled, fields, settings, sort)
  select p_tenant, v.slug, v.name, v.description, v.kind, v.enabled::boolean, v.fields::jsonb, v.settings::jsonb, v.sort::int
    from (values
@@DEFAULT_FORM_VALUES@@
    ) as v (id, slug, name, description, kind, enabled, fields, settings, sort)
   where not exists (select 1 from public.site_forms f where f.tenant_id = p_tenant and f.slug = v.slug);
  -- the hospital's identity: its own name, and none of the sample hospital's contacts, tax / registration numbers or
  -- UPI id (they would print on its invoices); the owner fills them in under Settings → General / Billing
  insert into public.site_content (tenant_id, key, data)
  values (p_tenant, 'settings', jsonb_build_object(
    'name', t.name, 'tagline', '', 'about', '', 'address', '', 'phone', '', 'appointmentsPhone', '', 'whatsapp', '', 'email', '',
    'seoDescription', t.name, 'brand', jsonb_build_object('shortName', left(t.name, 30)),
    'booking', jsonb_build_object('showDemoOtp', false),
    'billing', jsonb_build_object('legalName', t.name, 'gstin', '', 'regNo', '', 'pan', '', 'upiId', '')))
  on conflict (tenant_id, key) do nothing;
  -- default settings (phase 3): without this row nothing is ever queued for the hospital. SMS, WhatsApp and e-mail
  -- start on Hospital Comrade messaging (included in the plan); the owner can switch any channel to their own account.
  insert into public.app_settings (tenant_id, key, data)
  values (p_tenant, 'app', $json$@@NEW_HOSPITAL_SETTINGS@@$json$::jsonb)
  on conflict (tenant_id, key) do nothing;
end $$;
revoke all on function public.seed_hospital_defaults(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ product page leads (phase 2.2)
-- "Talk to us" form on the Hospital Comrade product page (the platform domain). Platform-level: no tenant_id, only
-- Hospital Comrade admins can read or update them; visitors can only add one through submit_platform_lead().
create table if not exists public.platform_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null check (char_length(name) between 2 and 100),
  organisation  text not null check (char_length(organisation) between 2 and 150),
  phone         text not null check (phone ~ '^\+?[0-9]{10,13}$'),
  email         text check (email is null or char_length(email) <= 150),
  city          text check (city is null or char_length(city) <= 80),
  plan          text check (plan is null or plan in ('clinic', 'hospital', 'enterprise', 'custom', 'unsure')),
  message       text check (message is null or char_length(message) <= 2000),
  source        text check (source is null or char_length(source) <= 255),
  status        text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  notes         text
);
create index if not exists platform_leads_created_idx on public.platform_leads (created_at desc);
alter table public.platform_leads enable row level security;
revoke all on public.platform_leads from anon, authenticated;
grant select, update, delete on public.platform_leads to authenticated;
grant all on public.platform_leads to service_role;
drop policy if exists platform_leads_admin on public.platform_leads;
create policy platform_leads_admin on public.platform_leads for all to authenticated
  using (public.provider_role() = 'admin') with check (public.provider_role() = 'admin');

create or replace function public.submit_platform_lead(
  p_name text, p_organisation text, p_phone text, p_email text default null, p_city text default null,
  p_plan text default null, p_message text default null, p_source text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
        v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Please enter your name.'; end if;
  if char_length(trim(coalesce(p_organisation, ''))) < 2 then raise exception 'Please enter your hospital or clinic name.'; end if;
  if v_phone !~ '^\+?[0-9]{10,13}$' then raise exception 'Please enter a valid mobile number.'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Please enter a valid email or leave it empty.'; end if;
  -- spam guard: one request per number every 10 minutes, and a ceiling for the whole form
  if exists (select 1 from public.platform_leads where phone = v_phone and created_at > now() - interval '10 minutes') then
    return;   -- already received — quietly accept the repeat
  end if;
  if (select count(*) from public.platform_leads where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are receiving a lot of requests right now. Please try again in a few minutes.';
  end if;
  insert into public.platform_leads (name, organisation, phone, email, city, plan, message, source)
  values (left(trim(p_name), 100), left(trim(p_organisation), 150), v_phone, left(v_email, 150), nullif(left(trim(coalesce(p_city, '')), 80), ''),
          case when p_plan in ('clinic', 'hospital', 'enterprise', 'custom', 'unsure') then p_plan end,
          nullif(left(trim(coalesce(p_message, '')), 2000), ''), left(p_source, 255));
end $$;
revoke all on function public.submit_platform_lead(text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_platform_lead(text, text, text, text, text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------------ Hospital Comrade messaging (phase 3)
-- Platform-wide settings, no tenant_id. 'messaging' = approved template / DLT IDs for the shared accounts:
--   { "templates": { "<event>": { "waTemplate": "…", "waParams": "name,date", "smsTemplateId": "…" } } }
-- (the shared accounts' credentials are Edge Function secrets — PLATFORM_* — never stored here).
-- Only Hospital Comrade admins read or change it; the notify function reads it with the service role.
create table if not exists public.platform_settings (
  key         text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select, insert, update on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;
drop policy if exists platform_settings_admin on public.platform_settings;
create policy platform_settings_admin on public.platform_settings for all to authenticated
  using (public.provider_role() = 'admin') with check (public.provider_role() = 'admin');
insert into public.platform_settings (key, data) values ('messaging', '{"templates": {}}'::jsonb) on conflict (key) do nothing;

-- record_message_usage(): see billing.sql (it also charges the wallet, phase 4)

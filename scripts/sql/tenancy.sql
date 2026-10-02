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
  select t.id, t.slug, t.name, t.status, t.modules, t.is_primary
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
    'tenant', case when t.id is null then null else jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan', t.plan, 'modules', t.modules, 'is_primary', t.is_primary) end,
    'role', public.current_app_role(),
    'provider_role', public.provider_role(),
    'provider_mode', public.provider_mode());
end $$;

-- hospitals a provider may open (switcher)
create or replace function public.provider_tenants()
returns table (id uuid, slug text, name text, status text, plan text, domain text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, t.status, t.plan,
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

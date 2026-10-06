-- =====================================================================================================
--  Demo hospital (Hospital Comrade): one hospital — the original DC Hospital — is a public demo.
--
--  • tenants.is_demo marks it (at most one). supabase/demo-hospital.sql turns the primary hospital into the demo,
--    installs the demo data (demo_seed_data(), generated from scripts/seed) and runs the first reset.
--  • demo_reset(): deletes everything visitors added (patients, bookings, sign-ups, messages …) and loads the demo
--    data again, with dates relative to today. Settings and website content come back from the saved baseline
--    (control panel → Platform settings → Demo → "Save current setup as baseline"), else the defaults.
--    Every night at 03:00 IST (pg_cron) and from the control panel button.
--  • Messages: platform_settings 'demo' decides — otp 'screen' (codes are shown on screen, nothing is sent) or 'real';
--    every other message (confirmations, reminders, invites …) is skipped unless messages = true.
--  • Visitors can't save provider keys or connect domains there. Billing never applies (it is the primary hospital).
--  • Every other hospital is real: none of this touches it.
-- =====================================================================================================

alter table public.tenants add column if not exists is_demo boolean not null default false;
create unique index if not exists tenants_one_demo on public.tenants (is_demo) where is_demo;

create or replace function public.demo_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.tenants where is_demo limit 1
$$;

create or replace function public.is_demo_tenant(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_demo from public.tenants where id = p_tenant), false)
$$;

-- { otp: 'screen' | 'real', messages: false, logins: true, nightly: true } (+ last_reset_at …, never the baseline)
create or replace function public.demo_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('otp', 'screen', 'messages', false, 'logins', true, 'nightly', true)
         || coalesce((select data - 'baseline' from public.platform_settings where key = 'demo'), '{}'::jsonb)
$$;

-- in the demo hospital, are one-time codes shown on screen instead of being sent?
create or replace function public.demo_otp_screen(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_demo_tenant(p_tenant) and coalesce(public.demo_config() ->> 'otp', 'screen') <> 'real'
$$;

-- ------------------------------------------------------------------ messages from the demo hospital
create or replace function public.demo_outbox_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if new.status <> 'pending' or not public.is_demo_tenant(new.tenant_id) then return new; end if;
  c := public.demo_config();
  if new.event in ('otp', 'login_otp') then
    if c ->> 'otp' = 'real' then return new; end if;
    new.status := 'skipped'; new.error := 'Demo hospital: the code is shown on screen, nothing is sent';
    return new;
  end if;
  if coalesce((c ->> 'messages')::boolean, false) then return new; end if;
  new.status := 'skipped'; new.error := 'Demo hospital: messages are not sent';
  return new;
end $$;
drop trigger if exists trg_demo_outbox on public.notification_outbox;
create trigger trg_demo_outbox before insert on public.notification_outbox for each row execute function public.demo_outbox_guard();

-- ------------------------------------------------------------------ things visitors must not change there
-- provider keys (app_secrets) and custom domains: only the platform team (or the database itself) in the demo hospital
create or replace function public.demo_guard_locked()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_t uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if auth.uid() is not null and public.provider_role() is null and public.is_demo_tenant(v_t) then
    raise exception 'This is not available in the demo hospital.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_demo_locked on public.app_secrets;
create trigger trg_demo_locked before insert or update or delete on public.app_secrets for each row execute function public.demo_guard_locked();
drop trigger if exists trg_demo_locked on public.tenant_domains;
create trigger trg_demo_locked before insert or update or delete on public.tenant_domains for each row execute function public.demo_guard_locked();

-- ------------------------------------------------------------------ reset
-- tables that keep their rows: the hospital itself, platform records about it, keys, domains, people (handled
-- through auth.users so the platform team's own profiles stay)
create or replace function public.demo_keep_tables()
returns text[] language sql immutable as $$
  select array['tenants', 'provider_audit', 'provider_assignments', 'tenant_domains', 'billing_payments', 'billing_credit_notes',
               'wallet_ledger', 'message_usage', 'app_secrets', 'profiles']
$$;

create or replace function public.demo_reset()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v       uuid := public.demo_tenant();
  v_tabs  text[];
  v_left  text[];
  tab     text;
  v_pass  int := 0;
  b       jsonb;
  v_users int;
  v_by    text := (select full_name from public.profiles where id = auth.uid());
  v_sub   text := current_setting('request.jwt.claim.sub', true);
  v_jwt   text := current_setting('request.jwt.claims', true);
begin
  if v is null then raise exception 'No demo hospital is set up. Run supabase/demo-hospital.sql once.'; end if;
  if to_regprocedure('public.demo_seed_data()') is null then
    raise exception 'DEMO_SEED_MISSING: Run supabase/demo-hospital.sql once in the SQL editor (it installs the demo data).';
  end if;
  perform set_config('app.tenant_id', v::text, true);
  perform set_config('app.skip_audit', 'on', true);
  -- run as the database itself (like the SQL editor): role guards and the sign-in OTP gate are for people.
  -- Put back before returning.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- everyone who signed up there (and the demo accounts, recreated below) — never the platform team
  with gone as (
    delete from auth.users where id in (select id from public.profiles where tenant_id = v)
      and id not in (select user_id from public.provider_users) returning id)
  select count(*) into v_users from gone;
  delete from public.login_otps where hospital_id = v and scope = 'hospital';

  select array_agg(c.table_name::text order by c.table_name) into v_tabs
    from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> all (public.demo_keep_tables());
  -- children first: retry what a foreign key still holds
  v_left := coalesce(v_tabs, '{}');
  while array_length(v_left, 1) > 0 and v_pass < 8 loop
    v_pass := v_pass + 1;
    v_tabs := v_left; v_left := '{}';
    foreach tab in array v_tabs loop
      begin
        execute format('delete from public.%I where tenant_id = $1', tab) using v;
      exception when foreign_key_violation or restrict_violation then v_left := v_left || tab;
      end;
    end loop;
  end loop;
  if array_length(v_left, 1) > 0 then raise exception 'Could not empty: %', array_to_string(v_left, ', '); end if;

  perform public.demo_seed_data();

  -- settings + website content as saved by the team (else the built-in defaults)
  b := (select data -> 'baseline' from public.platform_settings where key = 'demo');
  if jsonb_typeof(b -> 'app_settings') = 'array' then
    insert into public.app_settings (tenant_id, key, data, updated_at)
    select v, e ->> 'key', coalesce(e -> 'data', '{}'::jsonb), now() from jsonb_array_elements(b -> 'app_settings') e
    on conflict (tenant_id, key) do update set data = excluded.data, updated_at = now();
  end if;
  if jsonb_typeof(b -> 'site_content') = 'array' then
    insert into public.site_content (tenant_id, key, data, updated_at)
    select v, e ->> 'key', coalesce(e -> 'data', '{}'::jsonb), now() from jsonb_array_elements(b -> 'site_content') e
    on conflict (tenant_id, key) do update set data = excluded.data, updated_at = now();
  end if;

  insert into public.platform_settings (key, data, updated_at) values ('demo', jsonb_build_object('last_reset_at', now()), now())
  on conflict (key) do update set data = public.platform_settings.data || jsonb_build_object('last_reset_at', now(),
    'last_reset_by', v_by), updated_at = now();
  perform set_config('app.skip_audit', '', true);
  perform set_config('app.tenant_id', '', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_jwt, ''), true);
  return jsonb_build_object('ok', true, 'removed_accounts', v_users, 'at', now());
end $$;

-- the nightly job: only when there is a demo hospital, its data is installed and the team left "every night" on
create or replace function public.demo_reset_nightly()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public.demo_tenant() is null or to_regprocedure('public.demo_seed_data()') is null then return; end if;
  if coalesce((public.demo_config() ->> 'nightly')::boolean, true) is not true then return; end if;
  perform public.demo_reset();
end $$;

-- ------------------------------------------------------------------ what the demo website shows
-- anon: on the demo hospital's own site, its one-click logins (when the team allows) and the reset time
create or replace function public.public_demo_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb; v_logins jsonb := '[]'::jsonb;
begin
  if not public.is_demo_tenant(public.current_tenant()) then return null; end if;
  c := public.demo_config();
  if coalesce((c ->> 'logins')::boolean, true) and to_regprocedure('public.demo_logins()') is not null then
    execute 'select public.demo_logins()' into v_logins;
  end if;
  return jsonb_build_object('demo', true, 'otp', c ->> 'otp', 'nightly', coalesce((c ->> 'nightly')::boolean, true),
    'resets_at', '03:00 IST', 'last_reset_at', c ->> 'last_reset_at', 'logins', coalesce(v_logins -> 'logins', '[]'::jsonb),
    'password', case when jsonb_array_length(coalesce(v_logins -> 'logins', '[]'::jsonb)) > 0 then v_logins ->> 'password' end);
end $$;

-- ------------------------------------------------------------------ control panel → Platform settings → Demo
create or replace function public.cp_demo()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; s jsonb; v_logins jsonb;
begin
  perform public.cp_require(array['admin']);
  select * into t from public.tenants where is_demo limit 1;
  select data into s from public.platform_settings where key = 'demo';
  if to_regprocedure('public.demo_logins()') is not null then execute 'select public.demo_logins()' into v_logins; end if;
  return jsonb_build_object(
    'hospital', case when t.id is null then null else jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name) end,
    'seed_installed', to_regprocedure('public.demo_seed_data()') is not null,
    'config', public.demo_config() - 'last_reset_at' - 'last_reset_by' - 'baseline_at' - 'baseline_by',
    'last_reset_at', s ->> 'last_reset_at', 'last_reset_by', s ->> 'last_reset_by',
    'baseline', case when s ? 'baseline' then jsonb_build_object('at', s ->> 'baseline_at', 'by', s ->> 'baseline_by',
      'settings', jsonb_array_length(coalesce(s -> 'baseline' -> 'app_settings', '[]')), 'pages', jsonb_array_length(coalesce(s -> 'baseline' -> 'site_content', '[]'))) end,
    'logins', coalesce(v_logins -> 'logins', '[]'::jsonb), 'password', v_logins ->> 'password',
    'scheduled', exists (select 1 from pg_extension where extname = 'pg_cron'));
end $$;

create or replace function public.cp_save_demo(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare nxt jsonb := '{}'::jsonb; k text;
begin
  perform public.cp_require(array['admin']);
  if jsonb_typeof(p) <> 'object' then raise exception 'Demo settings must be an object'; end if;
  if p ? 'otp' then
    if p ->> 'otp' not in ('screen', 'real') then raise exception 'otp must be screen or real'; end if;
    nxt := nxt || jsonb_build_object('otp', p ->> 'otp');
  end if;
  foreach k in array array['messages', 'logins', 'nightly'] loop
    continue when not p ? k;
    if jsonb_typeof(p -> k) <> 'boolean' then raise exception '% must be true or false', k; end if;
    nxt := nxt || jsonb_build_object(k, p -> k);
  end loop;
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('demo', nxt, now(), auth.uid())
  on conflict (key) do update set data = public.platform_settings.data || nxt, updated_at = now(), updated_by = auth.uid();
  if coalesce((p ->> 'clearBaseline')::boolean, false) then
    update public.platform_settings set data = data - 'baseline' - 'baseline_at' - 'baseline_by' where key = 'demo';
  end if;
  perform public.provider_log('settings:demo', null, p);
  return public.cp_demo();
end $$;

create or replace function public.cp_demo_reset()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.cp_require(array['admin']);
  r := public.demo_reset();
  perform public.provider_log('demo:reset', null, r);
  return public.cp_demo();
end $$;

-- keep the demo hospital's current settings + website content; every reset restores them
create or replace function public.cp_demo_save_baseline()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v uuid := public.demo_tenant(); b jsonb;
begin
  perform public.cp_require(array['admin']);
  if v is null then raise exception 'No demo hospital is set up.'; end if;
  b := jsonb_build_object(
    'app_settings', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'data', data)) from public.app_settings where tenant_id = v and key <> 'bootstrap'), '[]'::jsonb),
    'site_content', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'data', data)) from public.site_content where tenant_id = v), '[]'::jsonb));
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('demo', '{}'::jsonb, now(), auth.uid()) on conflict (key) do nothing;
  update public.platform_settings set data = data || jsonb_build_object('baseline', b, 'baseline_at', now(),
    'baseline_by', (select full_name from public.profiles where id = auth.uid())), updated_at = now(), updated_by = auth.uid() where key = 'demo';
  perform public.provider_log('demo:baseline', null, jsonb_build_object('settings', jsonb_array_length(b -> 'app_settings'), 'pages', jsonb_array_length(b -> 'site_content')));
  return public.cp_demo();
end $$;

revoke all on function public.demo_tenant(), public.is_demo_tenant(uuid), public.demo_config(), public.demo_otp_screen(uuid),
  public.demo_reset(), public.demo_reset_nightly(), public.demo_keep_tables() from public, anon, authenticated;
grant execute on function public.demo_reset(), public.demo_reset_nightly() to service_role;
revoke all on function public.public_demo_info() from public;
grant execute on function public.public_demo_info() to anon, authenticated;
revoke all on function public.cp_demo(), public.cp_save_demo(jsonb), public.cp_demo_reset(), public.cp_demo_save_baseline() from public, anon;
grant execute on function public.cp_demo(), public.cp_save_demo(jsonb), public.cp_demo_reset(), public.cp_demo_save_baseline() to authenticated;

-- every night at 03:00 IST (21:30 UTC), when pg_cron is on
do $$
declare j bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in execute $q$ select jobid from cron.job where jobname = 'dch-demo-reset' $q$ loop
      execute 'select cron.unschedule($1)' using j;
    end loop;
    execute $c$ select cron.schedule('dch-demo-reset', '30 21 * * *', 'select public.demo_reset_nightly()') $c$;
  end if;
exception when others then null;   -- no permission for cron here: the control panel button still works
end $$;

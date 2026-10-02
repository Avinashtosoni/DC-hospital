-- =====================================================================================================
--  PHASE 8.3 — LAUNCH CHECK (control panel → System health → Launch checklist)
-- =====================================================================================================
--  cp_launch_check() looks at what the database can see and answers ok / warn / fail per item:
--  demo logins left over, platform admins, seller details on invoices, scheduled jobs, row-level security on every
--  table, the nightly clean-up, sign-up settings, failing messages. Things outside the database (Razorpay live keys,
--  SMTP, backups, DNS) are listed by the panel as manual checks — see docs/GO_LIVE.md.
-- =====================================================================================================

create or replace function public.cp_launch_check()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out     jsonb := '[]'::jsonb;
  b       jsonb := public.billing_config();
  s       jsonb := public.signup_config();
  v_cron  boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  v_jobs  text[] := '{}';
  v_miss  text[];
  v_list  text;
  v_n     bigint;
  v_m     bigint;
  v_at    timestamptz;
begin
  perform public.cp_require(array['admin']);

  -- 1. sample logins (master.sql) must not exist on a live platform
  select string_agg(email, ', ' order by email), count(*) into v_list, v_n from auth.users
   where lower(email) like '%@dchospital.com' or lower(email) like '%@citycare.demo' or lower(email) like '%@hospitalcomrade.demo';
  out := out || jsonb_build_object('id', 'demo_logins', 'title', 'No demo logins', 'status', case when v_n = 0 then 'ok' else 'fail' end,
    'detail', case when v_n = 0 then 'No sample accounts (Demo@123) exist.' else v_n || ' sample account(s) with the public password Demo@123: ' || left(v_list, 300) || ' — install with production.sql or delete them.' end);

  -- 2. the City Care sample hospital
  select count(*) into v_n from public.tenants where id = 'b0000000-0000-4000-8000-000000000002';
  out := out || jsonb_build_object('id', 'demo_hospital', 'title', 'No sample hospital', 'status', case when v_n = 0 then 'ok' else 'warn' end,
    'detail', case when v_n = 0 then 'The City Care sample clinic is not installed.' else 'The City Care sample clinic is installed — close and delete it before you invite customers.' end);

  -- 3. platform admins (two, so nobody gets locked out)
  select count(*) into v_n from public.provider_users where active and role = 'admin';
  out := out || jsonb_build_object('id', 'admins', 'title', 'Platform admins', 'status', case when v_n >= 2 then 'ok' when v_n = 1 then 'warn' else 'fail' end,
    'detail', case when v_n >= 2 then v_n || ' active admins.' when v_n = 1 then 'Only one admin — add a second one (Team) so the platform is never locked out.' else 'No active admin.' end);

  -- 4. seller details printed on every invoice
  v_miss := array_remove(array[
    case when coalesce(b -> 'seller' ->> 'name', '') = '' then 'legal name' end,
    case when coalesce(b -> 'seller' ->> 'gstin', '') = '' then 'GSTIN' end,
    case when coalesce(b -> 'seller' ->> 'address', '') = '' then 'address' end,
    case when coalesce(b -> 'seller' ->> 'email', '') = '' then 'e-mail' end], null);
  out := out || jsonb_build_object('id', 'seller', 'title', 'Invoice details (seller)', 'status', case when cardinality(v_miss) = 0 then 'ok' else 'fail' end,
    'detail', case when cardinality(v_miss) = 0 then 'Printed on invoices as ' || (b -> 'seller' ->> 'name') || ', GSTIN ' || (b -> 'seller' ->> 'gstin') || '.'
                   else 'Missing: ' || array_to_string(v_miss, ', ') || ' — Platform settings → Seller.' end);

  -- 5. scheduled jobs (reminders, message delivery, nightly clean-up)
  if v_cron then
    execute $q$ select coalesce(array_agg(jobname::text), '{}') from cron.job where active and jobname like 'dch-%' $q$ into v_jobs;
  end if;
  v_miss := array(select j from unnest(array['dch-notify-flush', 'dch-appointment-reminders', 'dch-billing-reminders', 'dch-retention']) j where not (j = any (v_jobs)));
  out := out || jsonb_build_object('id', 'jobs', 'title', 'Scheduled jobs', 'status', case when not v_cron then 'fail' when cardinality(v_miss) = 0 then 'ok' else 'fail' end,
    'detail', case when not v_cron then 'pg_cron is not enabled (Supabase → Database → Extensions).'
                   when cardinality(v_miss) = 0 then 'Message delivery, reminders and the nightly clean-up are scheduled.'
                   else 'Not scheduled: ' || array_to_string(v_miss, ', ') || ' — switch automatic delivery off and on once in the main hospital''s Settings → Notifications.' end);

  -- 6. pg_net (the database calls the notify / billing functions)
  out := out || jsonb_build_object('id', 'pg_net', 'title', 'Outgoing calls (pg_net)', 'status', case when exists (select 1 from pg_extension where extname = 'pg_net') then 'ok' else 'fail' end,
    'detail', case when exists (select 1 from pg_extension where extname = 'pg_net') then 'Enabled.' else 'Enable pg_net (Supabase → Database → Extensions) — messages are not delivered without it.' end);

  -- 7. row-level security on every table
  select string_agg(c.relname, ', ' order by c.relname), count(*) into v_list, v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  out := out || jsonb_build_object('id', 'rls', 'title', 'Row-level security', 'status', case when v_n = 0 then 'ok' else 'fail' end,
    'detail', case when v_n = 0 then 'Every table is protected.' else 'Without RLS: ' || left(v_list, 300) end);

  -- 8. every per-hospital table keeps hospitals apart
  select string_agg(c.table_name, ', ' order by c.table_name), count(*) into v_list, v_n from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('tenants', 'tenant_domains', 'provider_audit', 'provider_assignments')
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name and p.policyname = 'tenant_isolation');
  out := out || jsonb_build_object('id', 'isolation', 'title', 'Hospital isolation', 'status', case when v_n = 0 then 'ok' else 'fail' end,
    'detail', case when v_n = 0 then 'Every per-hospital table has the tenant_isolation policy.' else 'Missing tenant_isolation: ' || left(v_list, 300) || ' — run supabase/upgrade-2026-10.sql again.' end);

  -- 9. nightly clean-up actually ran
  v_at := (public.retention_config() -> 'last_run' ->> 'at')::timestamptz;
  out := out || jsonb_build_object('id', 'retention', 'title', 'Nightly clean-up', 'status', case when v_at > now() - interval '2 days' then 'ok' else 'warn' end,
    'detail', case when v_at is null then 'Has never run yet — it runs at 03:00 IST once jobs are scheduled.' when v_at > now() - interval '2 days' then 'Last ran ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' IST.'
                   else 'Last ran ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ' — check System health → Scheduled jobs.' end);

  -- 10. free-trial sign-up
  out := out || jsonb_build_object('id', 'signup', 'title', 'Free-trial sign-up', 'status',
      case when not coalesce((s ->> 'enabled')::boolean, false) then 'ok' when coalesce(s ->> 'platformUrl', '') = '' then 'warn' else 'ok' end,
    'detail', case when not coalesce((s ->> 'enabled')::boolean, false) then 'Closed — people use the contact form.'
                   when coalesce(s ->> 'platformUrl', '') = '' then 'Open, but the product website address is empty — the welcome e-mail''s link will be relative. Set it in Sign-ups.'
                   else 'Open (' || case when s ->> 'mode' = 'instant' then 'created instantly' else 'reviewed first' end || ', ' || (s ->> 'trialDays') || ' days).' end);

  -- 11. messages failing in the last 24 hours
  select count(*) filter (where status = 'failed'), count(*) into v_n, v_m from public.notification_outbox where created_at > now() - interval '24 hours';
  out := out || jsonb_build_object('id', 'messages', 'title', 'Messages delivered', 'status', case when v_m = 0 or v_n * 5 <= v_m then 'ok' else 'warn' end,
    'detail', case when v_m = 0 then 'No messages in the last 24 hours.' else v_n || ' of ' || v_m || ' failed in the last 24 hours' || case when v_n * 5 > v_m then ' — see System health → Recent failures.' else '.' end end);

  -- 12. the platform's own hospital has its owner
  select count(*) into v_n from public.profiles p join public.tenants t on t.id = p.tenant_id where t.is_primary and p.role = 'owner';
  out := out || jsonb_build_object('id', 'primary_owner', 'title', 'Main hospital owner', 'status', case when v_n > 0 then 'ok' else 'warn' end,
    'detail', case when v_n > 0 then 'The main hospital has an owner account.' else 'Nobody has signed up as the main hospital''s owner yet (the bootstrap e-mail in production.sql).' end);

  return jsonb_build_object('at', now(), 'checks', out);
end $$;

revoke all on function public.cp_launch_check() from public, anon;
grant execute on function public.cp_launch_check() to authenticated;

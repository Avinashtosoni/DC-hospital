-- =====================================================================================================
--  22. HOSPITAL COMRADE CONTROL PANEL — phase 5 (the separate /control-panel/ app; loaded after billing.sql)
-- =====================================================================================================
--  Every function checks the caller itself (SECURITY DEFINER, explicit provider checks):
--    admin   — every hospital; create / edit hospitals, team, platform settings, audit
--    finance — assigned hospitals; billing actions (manual payments, wallet) and payments
--    support — assigned hospitals; read-only here
--  Acting on one hospital reuses the hospital-scoped functions (provider_billing) with that hospital pinned in the
--  transaction (app.tenant_id), so the same rules and the same provider audit apply.

create or replace function public.cp_require(p_roles text[] default array['admin', 'support', 'finance'])
returns text language plpgsql stable security definer set search_path = public as $$
declare r text := public.provider_role();
begin
  if r is null or not (r = any (p_roles)) then
    raise exception 'Only the Hospital Comrade team (%) can do this.', array_to_string(p_roles, ' / ') using errcode = '42501';
  end if;
  return r;
end $$;

-- who is signed in to the panel (null = not a platform team member)
create or replace function public.cp_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user_id', u.user_id, 'role', u.role, 'email', a.email, 'full_name', coalesce(p.full_name, split_part(a.email, '@', 1)))
    from public.provider_users u join auth.users a on a.id = u.user_id left join public.profiles p on p.id = u.user_id
   where u.user_id = auth.uid() and u.active
$$;

-- ------------------------------------------------------------------ hospitals
create or replace function public.cp_hospitals(p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg     jsonb := public.billing_config();
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  r       jsonb;
begin
  perform public.cp_require();
  select coalesce(jsonb_agg(h order by h ->> 'is_primary' desc, h ->> 'name'), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'code', t.code, 'plan', t.plan, 'is_primary', t.is_primary, 'notes', t.notes,
      'created_at', t.created_at, 'modules', t.modules, 'license', public.tenant_license_dates(t.id), 'wallet_paise', t.wallet_paise,
      'price', coalesce((t.billing ->> 'price')::numeric, (cfg -> 'plans' -> t.plan ->> 'price')::numeric), 'billing', t.billing,
      'domain', (select d.domain from public.tenant_domains d where d.tenant_id = t.id order by d.is_primary desc, d.created_at limit 1),
      'staff', (select count(*) from public.profiles p where p.tenant_id = t.id and p.role <> 'patient'),
      'patients', (select count(*) from public.patients x where x.tenant_id = t.id),
      'owner_joined', exists (select 1 from public.profiles p where p.tenant_id = t.id and p.role = 'owner'),
      'owner_email', coalesce((select p.email from public.profiles p where p.tenant_id = t.id and p.role = 'owner' order by p.created_at limit 1),
                              (select s.data ->> 'owner_email' from public.app_settings s where s.tenant_id = t.id and s.key = 'bootstrap')),
      'messages', (select coalesce(sum(m.sent), 0) from public.message_usage m where m.tenant_id = t.id and m.month = v_month)
    ) h
    from public.tenants t
    where public.provider_can(t.id) and (p_id is null or t.id = p_id)
  ) q;
  return r;
end $$;

-- one hospital with its domains, team, payments and this month's messages
create or replace function public.cp_hospital(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  h       jsonb;
  v_role  text := public.cp_require();
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  h := public.cp_hospitals(p_id) -> 0;
  if h is null then raise exception 'Hospital not found or not assigned to you.'; end if;
  return h || jsonb_build_object(
    'domains', coalesce((select jsonb_agg(jsonb_build_object('domain', d.domain, 'is_primary', d.is_primary, 'method', d.method, 'status', d.status, 'ssl_status', d.ssl_status, 'verified_at', d.verified_at)
                                          order by d.is_primary desc, d.created_at) from public.tenant_domains d where d.tenant_id = p_id), '[]'::jsonb),
    'team', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'role', u.role, 'name', coalesce(p.full_name, a.email)) order by u.role)
                        from public.provider_users u join auth.users a on a.id = u.user_id left join public.profiles p on p.id = u.user_id
                       where u.active and (u.role = 'admin' or exists (select 1 from public.provider_assignments x where x.user_id = u.user_id and x.tenant_id = p_id))), '[]'::jsonb),
    'usage', coalesce((select jsonb_object_agg(m.channel || ':' || m.source, m.sent) from public.message_usage m where m.tenant_id = p_id and m.month = v_month), '{}'::jsonb),
    'payments', case when v_role = 'support' then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(b) - 'tenant_id' - 'buyer' order by b.created_at desc)
                  from (select * from public.billing_payments where tenant_id = p_id and status <> 'created' order by created_at desc limit 20) b), '[]'::jsonb) end);
end $$;

-- a new hospital: tenants row, address, owner e-mail (first sign-up with it becomes the owner), default settings
--   { slug, name, code, plan, owner_email, domain?, status: trial|active, trial_days?, months? (active), modules?, notes? }
create or replace function public.cp_create_hospital(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  cfg     jsonb := public.billing_config();
  v_slug  text := lower(trim(coalesce(p ->> 'slug', '')));
  v_name  text := trim(coalesce(p ->> 'name', ''));
  v_code  text := upper(trim(coalesce(p ->> 'code', '')));
  v_plan  text := coalesce(nullif(p ->> 'plan', ''), 'clinic');
  v_owner text := lower(trim(coalesce(p ->> 'owner_email', '')));
  v_dom   text := lower(trim(regexp_replace(coalesce(p ->> 'domain', ''), '^https?://|/.*$', '', 'g')));
  v_stat  text := coalesce(nullif(p ->> 'status', ''), 'trial');
  v_days  int := coalesce((p ->> 'trial_days')::int, (cfg ->> 'trialDays')::int, 14);
  v_mod   jsonb := coalesce(p -> 'modules', '{"dashboard": "hospital", "forms": "hospital", "notifications": "hospital", "security": "hospital"}'::jsonb);
  v_id    uuid;
begin
  perform public.cp_require(array['admin']);
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' then raise exception 'Short name: 2–40 characters, a-z, 0-9 and -, e.g. citycare'; end if;
  if char_length(v_name) not between 2 and 120 then raise exception 'Enter the hospital''s name.'; end if;
  if v_code !~ '^[A-Z]{2,6}$' then raise exception 'Record prefix: 2–6 capital letters, e.g. CCC'; end if;
  if not (cfg -> 'plans' ? v_plan) then raise exception 'Unknown plan %', v_plan; end if;
  if v_owner !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the owner''s e-mail.'; end if;
  if v_stat not in ('trial', 'active') then raise exception 'Start as trial or active.'; end if;
  if v_days not between 1 and 90 then raise exception 'Trial: 1 to 90 days.'; end if;
  if v_dom <> '' and v_dom !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' then raise exception 'That address does not look like a domain (e.g. citycareclinic.in).'; end if;
  if exists (select 1 from public.tenants where slug = v_slug) then raise exception 'The short name % is taken.', v_slug; end if;
  if v_dom <> '' and exists (select 1 from public.tenant_domains where domain = v_dom) then raise exception '% already belongs to a hospital.', v_dom; end if;
  if exists (select 1 from public.profiles where lower(email) = v_owner and tenant_id is not null and role <> 'patient')
     or exists (select 1 from public.provider_users u join auth.users a on a.id = u.user_id where lower(a.email) = v_owner) then
    raise exception '% is already used by another hospital or the platform team — one account = one hospital, please use another e-mail.', v_owner;
  end if;
  if exists (select 1 from jsonb_each_text(v_mod) m where m.key not in ('general', 'appearance', 'dashboard', 'notifications', 'forms', 'security', 'data', 'cms')
                                                         or m.value not in ('hospital', 'provider')) then
    raise exception 'Unknown module setting';
  end if;

  insert into public.tenants (slug, name, code, plan, status, modules, notes, trial_ends_at, paid_until)
  values (v_slug, v_name, v_code, v_plan, v_stat, v_mod, nullif(trim(coalesce(p ->> 'notes', '')), ''),
          case when v_stat = 'trial' then now() + make_interval(days => v_days) end,
          case when v_stat = 'active' then now() + make_interval(months => greatest(1, least(36, coalesce((p ->> 'months')::int, 12)))) end)
  returning id into v_id;
  perform set_config('app.tenant_id', v_id::text, true);   -- everything below (and its audit trail) belongs to the new hospital
  if v_dom <> '' then insert into public.tenant_domains (domain, tenant_id, is_primary) values (v_dom, v_id, true); end if;
  insert into public.app_settings (tenant_id, key, data) values (v_id, 'bootstrap', jsonb_build_object('owner_email', v_owner));
  perform public.seed_hospital_defaults(v_id);
  perform public.provider_log('hospital:create', v_slug, jsonb_build_object('plan', v_plan, 'status', v_stat, 'owner', v_owner, 'domain', nullif(v_dom, '')));
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'domain', nullif(v_dom, ''), 'owner_email', v_owner);
end $$;

-- edit a hospital: { name?, code?, notes?, modules?, owner_email? (until the owner has signed up) }
create or replace function public.cp_update_hospital(p_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants; v_owner text;
begin
  perform public.cp_require(array['admin']);
  select * into t from public.tenants where id = p_id for update;
  if not found then raise exception 'Hospital not found'; end if;
  perform set_config('app.tenant_id', p_id::text, true);
  if p ? 'name' and char_length(trim(p ->> 'name')) not between 2 and 120 then raise exception 'Enter the hospital''s name.'; end if;
  if p ? 'code' and upper(trim(p ->> 'code')) !~ '^[A-Z]{2,6}$' then raise exception 'Record prefix: 2–6 capital letters'; end if;
  if p ? 'modules' and (jsonb_typeof(p -> 'modules') <> 'object' or exists (select 1 from jsonb_each_text(p -> 'modules') m
       where m.key not in ('general', 'appearance', 'dashboard', 'notifications', 'forms', 'security', 'data', 'cms') or m.value not in ('hospital', 'provider'))) then
    raise exception 'Unknown module setting';
  end if;
  update public.tenants set
    name = coalesce(trim(p ->> 'name'), name),
    code = coalesce(upper(trim(p ->> 'code')), code),
    notes = case when p ? 'notes' then nullif(trim(p ->> 'notes'), '') else notes end,
    modules = coalesce(p -> 'modules', modules),
    updated_at = now()
  where id = p_id;
  if p ? 'owner_email' then
    v_owner := lower(trim(p ->> 'owner_email'));
    if v_owner !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the owner''s e-mail.'; end if;
    if exists (select 1 from public.profiles where tenant_id = p_id and role = 'owner') then raise exception 'The owner has already signed up — change owners in the hospital''s Users & accounts.'; end if;
    insert into public.app_settings (tenant_id, key, data) values (p_id, 'bootstrap', jsonb_build_object('owner_email', v_owner))
    on conflict (tenant_id, key) do update set data = excluded.data;
  end if;
  perform public.provider_log('hospital:update', t.slug, p);
  return public.cp_hospitals(p_id) -> 0;
end $$;

-- plan, trial, wallet, manual payments, suspend for one hospital — the same function the hospital app uses
create or replace function public.cp_billing(p_id uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'finance']);
  if not public.provider_can(p_id) then raise exception 'Hospital not found or not assigned to you.' using errcode = '42501'; end if;
  perform set_config('app.tenant_id', p_id::text, true);
  return public.provider_billing(p_action, coalesce(p_args, '{}'::jsonb));
end $$;

-- ------------------------------------------------------------------ overview
create or replace function public.cp_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role  text := public.cp_require();
  h       jsonb := public.cp_hospitals();
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  return jsonb_build_object(
    'hospitals', jsonb_array_length(h),
    'by_status', coalesce((select jsonb_object_agg(s, n) from (select x -> 'license' ->> 'status' s, count(*) n from jsonb_array_elements(h) x where not (x ->> 'is_primary')::boolean group by 1) q), '{}'::jsonb),
    'by_plan', coalesce((select jsonb_object_agg(s, n) from (select x ->> 'plan' s, count(*) n from jsonb_array_elements(h) x where not (x ->> 'is_primary')::boolean group by 1) q), '{}'::jsonb),
    -- monthly recurring revenue: paying hospitals' monthly price (₹, before GST)
    'mrr', coalesce((select sum((x ->> 'price')::numeric) from jsonb_array_elements(h) x where x -> 'license' ->> 'status' = 'active' and not (x ->> 'is_primary')::boolean and x -> 'license' ->> 'paid_until' is not null), 0),
    'wallet_paise', coalesce((select sum((x ->> 'wallet_paise')::bigint) from jsonb_array_elements(h) x where not (x ->> 'is_primary')::boolean), 0),
    'attention', coalesce((select jsonb_agg(jsonb_build_object('id', x -> 'id', 'name', x -> 'name', 'status', x -> 'license' ->> 'status',
                              'until', coalesce(x -> 'license' ->> 'paid_until', x -> 'license' ->> 'trial_ends_at'), 'read_only_from', x -> 'license' ->> 'read_only_from'))
                          from jsonb_array_elements(h) x
                         where not (x ->> 'is_primary')::boolean and (x -> 'license' ->> 'status' in ('grace', 'read_only')
                            or (x -> 'license' ->> 'status' in ('trial', 'active')
                                and coalesce((x -> 'license' ->> 'paid_until')::timestamptz, (x -> 'license' ->> 'trial_ends_at')::timestamptz) < now() + interval '7 days'))), '[]'::jsonb),
    'payments_30d_paise', case when v_role = 'support' then null else
      (select coalesce(sum(total_paise), 0) from public.billing_payments where status = 'paid' and paid_at > now() - interval '30 days' and public.provider_can(tenant_id)) end,
    'messages', coalesce((select jsonb_object_agg(channel, n) from (select m.channel, sum(m.sent) n from public.message_usage m
                           where m.month = v_month and m.source = 'platform' and public.provider_can(m.tenant_id) group by 1) q), '{}'::jsonb),
    'leads_new', case when v_role = 'admin' then (select count(*) from public.platform_leads where status = 'new') end);
end $$;

-- ------------------------------------------------------------------ team
create or replace function public.cp_team()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id, 'email', a.email, 'name', coalesce(p.full_name, split_part(a.email, '@', 1)), 'role', u.role, 'active', u.active, 'since', u.created_at,
      'hospitals', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) from public.provider_assignments x join public.tenants t on t.id = x.tenant_id where x.user_id = u.user_id), '[]'::jsonb),
      'last_action', (select max(at) from public.provider_audit pa where pa.user_id = u.user_id)) order by u.active desc, u.role, a.email)
    from public.provider_users u join auth.users a on a.id = u.user_id left join public.profiles p on p.id = u.user_id), '[]'::jsonb);
end $$;

-- add / change a team member: { email, role, active, hospitals: [tenant id…] }. They sign up once first (any address).
create or replace function public.cp_save_provider(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_email  text := lower(trim(coalesce(p ->> 'email', '')));
  v_role   text := coalesce(p ->> 'role', 'support');
  v_active boolean := coalesce((p ->> 'active')::boolean, true);
  v_user   uuid;
  v_hosp   text;
begin
  perform public.cp_require(array['admin']);
  if v_role not in ('admin', 'support', 'finance') then raise exception 'Role: admin, support or finance'; end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then raise exception 'No account with % yet — ask them to create one first (Sign up on the platform site), then add them here.', v_email; end if;
  if v_user = auth.uid() and (v_role <> 'admin' or not v_active) then raise exception 'You can''t remove your own admin access — ask another admin.'; end if;
  if not exists (select 1 from public.provider_users where user_id = v_user) then
    select t.name into v_hosp from public.profiles pr join public.tenants t on t.id = pr.tenant_id where pr.id = v_user and pr.role <> 'patient';
    if v_hosp is not null then raise exception '% is a staff account at % — one account = one hospital, please use another e-mail.', v_email, v_hosp; end if;
    -- a platform account belongs to no hospital (its sign-up created a patient record there — removed)
    perform set_config('app.tenant_id', coalesce((select tenant_id::text from public.profiles where id = v_user), ''), true);   -- audit trail stays with that hospital
    perform set_config('app.tenant_move', 'on', true);
    update public.profiles set tenant_id = null, role = 'patient' where id = v_user;
    delete from public.patients where profile_id = v_user;
    perform set_config('app.tenant_move', '', true);
    perform set_config('app.tenant_id', '', true);
  end if;
  insert into public.provider_users (user_id, role, active) values (v_user, v_role, v_active)
  on conflict (user_id) do update set role = excluded.role, active = excluded.active;
  delete from public.provider_assignments where user_id = v_user;
  if v_role <> 'admin' then
    insert into public.provider_assignments (user_id, tenant_id)
    select v_user, t.id from public.tenants t where t.id::text in (select jsonb_array_elements_text(coalesce(p -> 'hospitals', '[]'::jsonb)));
  end if;
  perform public.provider_log('team:save', v_email, jsonb_build_object('role', v_role, 'active', v_active, 'hospitals', p -> 'hospitals'));
  return jsonb_build_object('user_id', v_user);
end $$;

-- ------------------------------------------------------------------ money, audit, settings
create or replace function public.cp_payments(p_tenant uuid default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'finance']);
  return coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from (
    select bp.id, bp.created_at, bp.tenant_id, t.name as hospital, bp.kind, bp.plan, bp.months, bp.base_paise, bp.gst_paise, bp.total_paise,
           bp.status, bp.provider, bp.method, bp.payment_id, bp.order_id, bp.paid_at, bp.invoice_no, bp.period_from, bp.period_to, bp.buyer
      from public.billing_payments bp join public.tenants t on t.id = bp.tenant_id
     where public.provider_can(bp.tenant_id) and (p_tenant is null or bp.tenant_id = p_tenant) and bp.status <> 'created'
     order by bp.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) b), '[]'::jsonb);
end $$;

create or replace function public.cp_audit(p_tenant uuid default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (
    select pa.id, pa.at, pa.user_name, pa.mode, pa.tenant_id, t.name as hospital, pa.action, pa.target, pa.detail
      from public.provider_audit pa left join public.tenants t on t.id = pa.tenant_id
     where p_tenant is null or pa.tenant_id = p_tenant
     order by pa.at desc limit least(greatest(coalesce(p_limit, 300), 1), 2000)) a), '[]'::jsonb);
end $$;

create or replace function public.cp_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return jsonb_build_object('billing', public.billing_config());
end $$;

-- prices, GST, trial / grace days, message rates, seller details (merged into platform_settings 'billing')
create or replace function public.cp_save_billing_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare k text; n numeric;
begin
  perform public.cp_require(array['admin']);
  if jsonb_typeof(p) <> 'object' then raise exception 'Settings must be an object'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('gstPercent', 'trialDays', 'graceDays', 'yearlyMonths', 'minTopup', 'maxTopup', 'ratesPaise', 'plans', 'seller') then raise exception 'Unknown setting %', k; end if;
  end loop;
  foreach k in array array['gstPercent', 'trialDays', 'graceDays', 'yearlyMonths', 'minTopup', 'maxTopup'] loop
    if p ? k then
      n := (p ->> k)::numeric;
      if n is null or n < 0 or (k = 'gstPercent' and n > 40) or (k in ('trialDays', 'graceDays') and n > 90) or (k = 'yearlyMonths' and (n < 1 or n > 12)) then
        raise exception 'The value for % is out of range.', k;
      end if;
    end if;
  end loop;
  if (p ? 'minTopup' or p ? 'maxTopup')
     and coalesce((p ->> 'minTopup')::numeric, (public.billing_config() ->> 'minTopup')::numeric) > coalesce((p ->> 'maxTopup')::numeric, (public.billing_config() ->> 'maxTopup')::numeric) then
    raise exception 'The minimum top-up is above the maximum.';
  end if;
  if p ? 'ratesPaise' and exists (select 1 from jsonb_each(p -> 'ratesPaise') r where r.key not in ('sms', 'whatsapp', 'email') or jsonb_typeof(r.value) <> 'number' or (r.value)::text::numeric not between 0 and 1000) then
    raise exception 'Message rates: paise per message, 0–1000.';
  end if;
  if p ? 'plans' and exists (select 1 from jsonb_each(p -> 'plans') x where not (public.billing_config() -> 'plans' ? x.key)) then
    raise exception 'Unknown plan';
  end if;
  update public.platform_settings set data = data
    || (p - 'plans' - 'ratesPaise' - 'seller')
    || case when p ? 'ratesPaise' then jsonb_build_object('ratesPaise', coalesce(data -> 'ratesPaise', '{}'::jsonb) || (p -> 'ratesPaise')) else '{}'::jsonb end
    || case when p ? 'seller' then jsonb_build_object('seller', coalesce(data -> 'seller', '{}'::jsonb) || (p -> 'seller')) else '{}'::jsonb end
    || case when p ? 'plans' then jsonb_build_object('plans', (select jsonb_object_agg(e.key, case when p -> 'plans' ? e.key then e.value || (p -> 'plans' -> e.key) else e.value end)
                                                                 from jsonb_each(data -> 'plans') e)) else '{}'::jsonb end
   where key = 'billing';
  perform public.provider_log('settings:billing', null, p);
  return public.billing_config();
end $$;

-- ------------------------------------------------------------------ who may call what
revoke all on function public.cp_require(text[]) from public, anon, authenticated;
revoke all on function public.cp_me(), public.cp_hospitals(uuid), public.cp_hospital(uuid), public.cp_create_hospital(jsonb), public.cp_update_hospital(uuid, jsonb),
  public.cp_billing(uuid, text, jsonb), public.cp_overview(), public.cp_team(), public.cp_save_provider(jsonb), public.cp_payments(uuid, int),
  public.cp_audit(uuid, int), public.cp_settings(), public.cp_save_billing_settings(jsonb) from public, anon;
grant execute on function public.cp_me(), public.cp_hospitals(uuid), public.cp_hospital(uuid), public.cp_create_hospital(jsonb), public.cp_update_hospital(uuid, jsonb),
  public.cp_billing(uuid, text, jsonb), public.cp_overview(), public.cp_team(), public.cp_save_provider(jsonb), public.cp_payments(uuid, int),
  public.cp_audit(uuid, int), public.cp_settings(), public.cp_save_billing_settings(jsonb) to authenticated;

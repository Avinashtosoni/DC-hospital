-- =====================================================================================================
--  PLANS CATALOGUE — Control Panel → Plans & billing
-- =====================================================================================================
--  Plans live in platform_settings 'billing' → plans: { id: { name, price, suffix, tagline, features[], highlight, cta,
--  included{sms,whatsapp,email}, public, archived, signup, order, notice } }. The product site, sign-up, the hospital's
--  Billing page and invoices all read them from here (platform_plans()), so a change shows everywhere at once.
--  • cp_save_plan()      add / edit one plan. A price change asks what happens to hospitals already on the plan:
--                        'apply' (new price from their next renewal) or 'keep' (they keep today's price as their own).
--                        Owners on the plan are told (in-app bell + e-mail, event plan_updated) unless p_notify = false.
--  • cp_delete_plan()    only when no hospital / pending sign-up uses it (otherwise archive it).
--  • cp_reorder_plans()  pricing-page order.
--  • cp_plan_history()   who changed what (provider_audit).

-- older databases saved only { price, included } per plan: fill in the rest from the built-in plans (saved values win)
with d as (select $json$@@PLAN_DEFAULTS@@$json$::jsonb as j)
update public.platform_settings s
   set data = jsonb_set(s.data, '{plans}', (
         select jsonb_object_agg(e.key, coalesce(d.j -> e.key, jsonb_build_object('name', initcap(replace(e.key, '-', ' ')), 'features', '[]'::jsonb,
                                                 'public', true, 'archived', false, 'order', 50)) || e.value)
           from jsonb_each(s.data -> 'plans') e)),
       updated_at = now()
  from d
 where s.key = 'billing' and jsonb_typeof(s.data -> 'plans') = 'object'
   and exists (select 1 from jsonb_each(s.data -> 'plans') e where not (e.value ? 'name') or not (e.value ? 'order'));

-- ------------------------------------------------------------------ read (anyone)
-- visitors and hospitals: plans on the website + the caller's own hospital's plan; the platform team: every plan
create or replace function public.platform_plans()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg  jsonb := public.billing_config();
  team boolean := public.provider_role() is not null;
  mine text;
begin
  if auth.uid() is not null then select plan into mine from public.tenants where id = public.current_tenant(); end if;
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', e.key) || e.value order by coalesce((e.value ->> 'order')::int, 999), e.key)
                         from jsonb_each(coalesce(cfg -> 'plans', '{}'::jsonb)) e
                        where team or e.key = mine
                           or (coalesce((e.value ->> 'public')::boolean, true) and not coalesce((e.value ->> 'archived')::boolean, false))), '[]'::jsonb),
    'gstPercent', coalesce((cfg ->> 'gstPercent')::numeric, 18), 'yearlyMonths', coalesce((cfg ->> 'yearlyMonths')::int, 12),
    'trialDays', coalesce((public.signup_config() ->> 'trialDays')::int, (cfg ->> 'trialDays')::int, 14));
end $$;
revoke all on function public.platform_plans() from public;
grant execute on function public.platform_plans() to anon, authenticated, service_role;

-- ------------------------------------------------------------------ helpers
create or replace function public.plan_money(p numeric)
returns text language sql immutable set search_path = public as $$
  select case when p is null then 'custom pricing' else '₹' || trim(to_char(p, 'FM99,99,99,99,990')) end
$$;

-- checks one plan's fields and returns only the known ones
create or replace function public.plan_clean(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare k text; out jsonb := '{}'::jsonb; f jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'A plan must be an object.'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('name', 'price', 'suffix', 'tagline', 'features', 'highlight', 'cta', 'included', 'public', 'archived', 'signup', 'order') then
      raise exception 'Unknown plan field %', k;
    end if;
  end loop;
  if p ? 'name' then
    if char_length(trim(coalesce(p ->> 'name', ''))) not between 1 and 40 then raise exception 'Plan name: 1 to 40 characters.'; end if;
    out := out || jsonb_build_object('name', trim(p ->> 'name'));
  end if;
  if p ? 'price' then
    if jsonb_typeof(p -> 'price') = 'null' then out := out || '{"price": null}'::jsonb;
    elsif jsonb_typeof(p -> 'price') <> 'number' or (p ->> 'price')::numeric < 0 or (p ->> 'price')::numeric > 10000000 then
      raise exception 'Price: ₹0 to ₹1,00,00,000 a month (leave empty for "talk to us").';
    else out := out || jsonb_build_object('price', round((p ->> 'price')::numeric, 2)); end if;
  end if;
  if p ? 'suffix' then
    if char_length(coalesce(p ->> 'suffix', '')) > 3 then raise exception 'Price suffix: up to 3 characters (e.g. +).'; end if;
    out := out || jsonb_build_object('suffix', coalesce(p ->> 'suffix', ''));
  end if;
  if p ? 'tagline' then
    if char_length(coalesce(p ->> 'tagline', '')) > 160 then raise exception 'Tagline: up to 160 characters.'; end if;
    out := out || jsonb_build_object('tagline', trim(coalesce(p ->> 'tagline', '')));
  end if;
  if p ? 'cta' then
    if char_length(trim(coalesce(p ->> 'cta', ''))) not between 1 and 40 then raise exception 'Button text: 1 to 40 characters.'; end if;
    out := out || jsonb_build_object('cta', trim(p ->> 'cta'));
  end if;
  if p ? 'features' then
    f := p -> 'features';
    if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) > 25
       or exists (select 1 from jsonb_array_elements(f) x where jsonb_typeof(x) <> 'string' or char_length(trim(x #>> '{}')) not between 1 and 140) then
      raise exception 'Features: up to 25 lines of 1 to 140 characters.';
    end if;
    out := out || jsonb_build_object('features', (select coalesce(jsonb_agg(trim(x #>> '{}')), '[]'::jsonb) from jsonb_array_elements(f) x));
  end if;
  if p ? 'included' then
    f := p -> 'included';
    if jsonb_typeof(f) <> 'object' or exists (select 1 from jsonb_each(f) x where x.key not in ('sms', 'whatsapp', 'email')
         or jsonb_typeof(x.value) <> 'number' or (x.value #>> '{}')::numeric < 0 or (x.value #>> '{}')::numeric > 10000000 or (x.value #>> '{}')::numeric <> trunc((x.value #>> '{}')::numeric)) then
      raise exception 'Included messages: whole numbers from 0 to 1,00,00,000 for sms, whatsapp and email.';
    end if;
    out := out || jsonb_build_object('included', jsonb_build_object('sms', coalesce((f ->> 'sms')::int, 0), 'whatsapp', coalesce((f ->> 'whatsapp')::int, 0), 'email', coalesce((f ->> 'email')::int, 0)));
  end if;
  foreach k in array array['highlight', 'public', 'archived', 'signup'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'boolean' then raise exception '%: true or false', k; end if;
      out := out || jsonb_build_object(k, p -> k);
    end if;
  end loop;
  if p ? 'order' then
    if jsonb_typeof(p -> 'order') <> 'number' then raise exception 'order: a number'; end if;
    out := out || jsonb_build_object('order', (p ->> 'order')::int);
  end if;
  return out;
end $$;

-- ------------------------------------------------------------------ write (platform admin)
-- p_existing: what happens to hospitals already on the plan when the price changes — 'apply' | 'keep'
create or replace function public.cp_save_plan(p_id text, p jsonb, p_existing text default 'apply', p_notify boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  cfg      jsonb := public.billing_config();
  old      jsonb := cfg -> 'plans' -> p_id;
  isnew    boolean := (cfg -> 'plans' -> p_id) is null;
  clean    jsonb;
  v        jsonb;
  oprice   numeric;
  nprice   numeric;
  pchanged boolean;
  price_ln text := '';
  other_ln text := '';
  ch       text;
  kept     int := 0;
  told     int := 0;
  t        record;
  msg      text;
begin
  perform public.cp_require(array['admin']);
  if coalesce(p_id, '') !~ '^[a-z][a-z0-9-]{1,31}$' or p_id = 'unsure' then
    raise exception 'Plan ID: 2 to 32 lower-case letters, digits or dashes, starting with a letter.';
  end if;
  if p_existing not in ('apply', 'keep') then raise exception 'Existing hospitals: apply or keep.'; end if;
  clean := public.plan_clean(coalesce(p, '{}'::jsonb));
  if isnew then
    if (select count(*) from jsonb_object_keys(coalesce(cfg -> 'plans', '{}'::jsonb))) >= 20 then raise exception 'Up to 20 plans.'; end if;
    if not (clean ? 'name') then raise exception 'Give the plan a name.'; end if;
    v := jsonb_build_object('price', null, 'suffix', '', 'tagline', '', 'features', '[]'::jsonb, 'highlight', false, 'cta', 'Get started',
                            'included', jsonb_build_object('sms', 0, 'whatsapp', 0, 'email', 0), 'public', true, 'archived', false, 'signup', false,
                            'order', coalesce((select max((e.value ->> 'order')::int) + 1 from jsonb_each(cfg -> 'plans') e), 0))
         || clean;
  else
    v := old || clean;
  end if;
  if coalesce((v ->> 'archived')::boolean, false) then v := v || '{"highlight": false}'::jsonb; end if;

  -- what changed, in words, for the hospitals on this plan
  if not isnew then
    oprice := (old ->> 'price')::numeric; nprice := (v ->> 'price')::numeric;
    pchanged := oprice is distinct from nprice;
    if pchanged then
      price_ln := 'Price: ' || public.plan_money(oprice) || ' → ' || public.plan_money(nprice) || case when nprice is null then '' else ' a month + GST' end
               || ', from your next renewal.';
    end if;
    foreach ch in array array['whatsapp', 'sms', 'email'] loop
      if coalesce((old -> 'included' ->> ch)::int, 0) <> coalesce((v -> 'included' ->> ch)::int, 0) then
        other_ln := other_ln || case when other_ln = '' then '' else ' ' end
                 || case ch when 'whatsapp' then 'WhatsApp' when 'sms' then 'SMS' else 'E-mail' end || ' messages included each month: '
                 || trim(to_char(coalesce((old -> 'included' ->> ch)::int, 0), 'FM99,99,99,990')) || ' → '
                 || trim(to_char(coalesce((v -> 'included' ->> ch)::int, 0), 'FM99,99,99,990')) || '.';
      end if;
    end loop;
    if (old ->> 'name') is distinct from (v ->> 'name') then
      other_ln := other_ln || case when other_ln = '' then '' else ' ' end || 'The plan is now called ' || (v ->> 'name') || '.';
    end if;
    if coalesce((v ->> 'archived')::boolean, false) and not coalesce((old ->> 'archived')::boolean, false) then
      other_ln := other_ln || case when other_ln = '' then '' else ' ' end || 'It is no longer offered to new hospitals — you can stay on it.';
    end if;

    -- grandfather: hospitals on the plan keep today's price as their own agreed price
    if pchanged and p_existing = 'keep' and oprice is not null then
      update public.tenants set billing = coalesce(billing, '{}'::jsonb) || jsonb_build_object('price', oprice), updated_at = now()
       where plan = p_id and (billing ->> 'price') is null and not is_primary;
      get diagnostics kept = row_count;
    end if;

    if price_ln <> '' or other_ln <> '' then
      v := v || jsonb_build_object('notice', jsonb_build_object('at', now(),
             'text', trim(case when p_existing = 'apply' then price_ln else '' end || ' ' || other_ln),
             'others', nullif(other_ln, '')));
      if p_notify then
        for t in select id, (billing ->> 'price') is not null as own_price from public.tenants
                  where plan = p_id and not is_primary and not coalesce(is_demo, false) and closing_at is null loop
          msg := trim(case when p_existing = 'apply' and not t.own_price then price_ln else '' end || ' ' || other_ln);
          if msg <> '' then
            told := told + case when public.notify_owner_platform(t.id, 'plan_updated', jsonb_build_object('plan', v ->> 'name', 'changes', msg,
                      'link', public.notify_tenant_url(t.id, '/billing'))) > 0 then 1 else 0 end;
          end if;
        end loop;
      end if;
    end if;
  end if;

  update public.platform_settings
     set data = jsonb_set(data, '{plans}',
                  (select coalesce(jsonb_object_agg(e.key, case when coalesce((v ->> 'highlight')::boolean, false) and e.key <> p_id then e.value || '{"highlight": false}'::jsonb else e.value end), '{}'::jsonb)
                     from jsonb_each(coalesce(data -> 'plans', '{}'::jsonb)) e) || jsonb_build_object(p_id, v)),
         updated_at = now()
   where key = 'billing';
  perform public.provider_log(case when isnew then 'plan:create' else 'plan:update' end, p_id,
    jsonb_build_object('before', old, 'after', v, 'existing', case when pchanged then p_existing end, 'kept', kept, 'notified', told));
  return jsonb_build_object('billing', public.billing_config(), 'kept', kept, 'notified', told);
end $$;

create or replace function public.cp_delete_plan(p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cfg jsonb := public.billing_config(); n int;
begin
  perform public.cp_require(array['admin']);
  if not (cfg -> 'plans' ? coalesce(p_id, '')) then raise exception 'Unknown plan %', p_id; end if;
  select count(*) into n from public.tenants where plan = p_id;
  if n > 0 then raise exception '% hospital(s) are on the % plan — move them to another plan first, or archive it instead.', n, public.plan_name(p_id); end if;
  if exists (select 1 from public.platform_signups where plan = p_id and status = 'pending') then
    raise exception 'A sign-up waiting for approval asked for this plan — approve or reject it first, or archive the plan.';
  end if;
  if public.signup_config() ->> 'plan' = p_id then raise exception 'This is the sign-up page''s default plan — pick another default in Sign-ups first.'; end if;
  if (select count(*) from jsonb_object_keys(cfg -> 'plans')) <= 1 then raise exception 'Keep at least one plan.'; end if;
  update public.platform_settings set data = jsonb_set(data, '{plans}', (data -> 'plans') - p_id), updated_at = now() where key = 'billing';
  perform public.provider_log('plan:delete', p_id, jsonb_build_object('before', cfg -> 'plans' -> p_id));
  return jsonb_build_object('billing', public.billing_config());
end $$;

create or replace function public.cp_reorder_plans(p_ids text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cfg jsonb := public.billing_config();
begin
  perform public.cp_require(array['admin']);
  if p_ids is null or exists (select 1 from unnest(p_ids) x where not (cfg -> 'plans' ? x)) then raise exception 'Unknown plan in the list.'; end if;
  update public.platform_settings
     set data = jsonb_set(data, '{plans}', (select jsonb_object_agg(e.key, e.value || jsonb_build_object('order',
                  coalesce(array_position(p_ids, e.key) - 1, cardinality(p_ids) + coalesce((e.value ->> 'order')::int, 0))))
                  from jsonb_each(data -> 'plans') e)),
         updated_at = now()
   where key = 'billing';
  perform public.provider_log('plan:reorder', null, to_jsonb(p_ids));
  return jsonb_build_object('billing', public.billing_config());
end $$;

create or replace function public.cp_plan_history(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (
    select pa.id, pa.at, pa.user_name, pa.action, pa.target, pa.detail
      from public.provider_audit pa
     where pa.action like 'plan:%' or pa.action = 'settings:billing'
     order by pa.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) a), '[]'::jsonb);
end $$;

revoke all on function public.plan_money(numeric), public.plan_clean(jsonb), public.cp_save_plan(text, jsonb, text, boolean),
  public.cp_delete_plan(text), public.cp_reorder_plans(text[]), public.cp_plan_history(int) from public, anon;
grant execute on function public.cp_save_plan(text, jsonb, text, boolean), public.cp_delete_plan(text), public.cp_reorder_plans(text[]),
  public.cp_plan_history(int) to authenticated;
grant execute on function public.plan_money(numeric), public.plan_clean(jsonb) to authenticated, service_role;

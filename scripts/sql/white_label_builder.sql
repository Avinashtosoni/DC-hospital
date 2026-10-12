-- =====================================================================================================
--  WHITE-LABEL SITE BUILDER, PERSISTED ONBOARDING AND AI PAGE ASSISTANCE
--  Loaded after the platform messaging, plans, control-panel and sign-up modules.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- CMS public data: never disclose draft tenant pages to an unauthenticated website visitor.
create or replace function public.site_content_public_data(p_key text, p_data jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare v_items jsonb;
begin
  if p_key = 'settings' and jsonb_typeof(p_data) = 'object' then
    return public.site_content_public_json(p_data - 'billing');
  elsif p_key = 'packages' and jsonb_typeof(p_data) = 'object' then
    select coalesce(jsonb_agg(case when x.value @> '{"hidden":true}'::jsonb then '{"hidden":true}'::jsonb
                                   else public.site_content_public_json(x.value) end order by x.ord), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(case when jsonb_typeof(p_data -> 'items') = 'array' then p_data -> 'items' else '[]'::jsonb end)
           with ordinality as x(value, ord);
    return jsonb_set(public.site_content_public_json(p_data - 'items'), '{items}', v_items, true);
  elsif p_key = 'customPages' and jsonb_typeof(p_data) = 'object' then
    select coalesce(jsonb_agg(public.site_content_public_json(x.value) order by x.ord), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(case when jsonb_typeof(p_data -> 'items') = 'array' then p_data -> 'items' else '[]'::jsonb end)
           with ordinality as x(value, ord)
     where x.value ->> 'status' = 'published';
    return jsonb_set(public.site_content_public_json(p_data - 'items'), '{items}', v_items, true);
  end if;
  return public.site_content_public_json(p_data);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Public self-sign-up draft store: an unguessable UUID owned by the browser keeps guided progress across reloads.
-- It stores only the form fields needed to resume sign-up, never verification codes or passwords; drafts expire in 30 days.
create table if not exists public.platform_signup_drafts (
  id             uuid primary key,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 days',
  ip_hash        text,
  current_step   text not null default 'hospital' check (current_step in ('hospital','contact','review')),
  reached_steps  text[] not null default array['hospital'],
  followup_consent boolean not null default false,
  data           jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object')
);
create index if not exists platform_signup_drafts_expiry_idx on public.platform_signup_drafts(expires_at);
alter table public.platform_signup_drafts enable row level security;
revoke all on public.platform_signup_drafts from anon,authenticated;
grant all on public.platform_signup_drafts to service_role;

create or replace function public.save_platform_signup_draft(p_id uuid,p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_org text; v_name text; v_mail text; v_phone text; v_city text; v_plan text; v_step text; v_steps text[] := '{}';
  v_consent boolean := false; v_ip text; v_hash text; v_data jsonb; c jsonb := public.signup_config();
begin
  if p_id is null or not coalesce((c->>'enabled')::boolean,false) then raise exception 'Online sign-up is not available.'; end if;
  if jsonb_typeof(coalesce(p,'{}'::jsonb))<>'object' then raise exception 'Sign-up draft must be an object.'; end if;
  v_org:=left(trim(regexp_replace(coalesce(p->>'organisation',''),'\s+',' ','g')),120);
  v_name:=left(trim(regexp_replace(coalesce(p->>'name',''),'\s+',' ','g')),100);
  v_mail:=left(lower(trim(coalesce(p->>'email',''))),150);
  v_phone:=left(regexp_replace(coalesce(p->>'phone',''),'[^0-9+]','','g'),20);
  v_city:=left(trim(coalesce(p->>'city','')),80);
  v_plan:=left(trim(coalesce(p->>'plan','')),32);
  v_step:=coalesce(p->>'current_step','hospital');
  if v_step not in ('hospital','contact','review') then raise exception 'Unknown sign-up step.'; end if;
  if p ? 'reached_steps' then
    if jsonb_typeof(p->'reached_steps')<>'array' or jsonb_array_length(p->'reached_steps')>3
      or exists(select 1 from jsonb_array_elements_text(p->'reached_steps') x where x not in ('hospital','contact','review')) then raise exception 'Invalid reached steps.'; end if;
    select coalesce(array_agg(distinct x),'{}') into v_steps from jsonb_array_elements_text(p->'reached_steps') x;
  end if;
  if not ('hospital'=any(v_steps)) or (v_step in ('contact','review') and not ('contact'=any(v_steps)))
    or (v_step='review' and not ('review'=any(v_steps))) then raise exception 'Complete each sign-up step in order.'; end if;
  if p ? 'followup_consent' then
    if jsonb_typeof(p->'followup_consent')<>'boolean' then raise exception 'Follow-up consent must be true or false.'; end if;
    v_consent:=(p->>'followup_consent')::boolean;
  end if;
  if v_org<>'' and char_length(v_org)<2 then raise exception 'Hospital name is too short.'; end if;
  if v_name<>'' and char_length(v_name)<2 then raise exception 'Name is too short.'; end if;
  if v_mail<>'' and v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then raise exception 'E-mail address is invalid.'; end if;
  if v_phone<>'' and v_phone !~ '^\+?[0-9]{10,13}$' then raise exception 'Mobile number is invalid.'; end if;
  begin
    v_ip:=nullif(trim(split_part(coalesce(nullif(current_setting('request.headers',true),'')::json->>'cf-connecting-ip',
      nullif(current_setting('request.headers',true),'')::json->>'x-forwarded-for',''),',',1)),'');
  exception when others then v_ip:=null; end;
  v_hash:=case when v_ip is null then null else md5('hc-signup-draft:'||v_ip) end;
  if v_hash is not null and (select count(*) from public.platform_signup_drafts where ip_hash=v_hash and updated_at>now()-interval '1 hour' and id<>p_id)>=150 then
    raise exception 'Too many saved sign-up changes from this network. Please wait a little and retry.';
  end if;
  v_data:=jsonb_build_object('organisation',v_org,'name',v_name,'email',v_mail,'phone',v_phone,'city',v_city,'plan',v_plan);
  insert into public.platform_signup_drafts(id,ip_hash,current_step,reached_steps,followup_consent,data,updated_at,expires_at)
  values(p_id,v_hash,v_step,v_steps,v_consent,v_data,now(),now()+interval '30 days')
  on conflict(id) do update set ip_hash=coalesce(excluded.ip_hash,public.platform_signup_drafts.ip_hash),current_step=excluded.current_step,
    reached_steps=excluded.reached_steps,followup_consent=excluded.followup_consent,data=excluded.data,updated_at=now(),expires_at=now()+interval '30 days';
  return jsonb_build_object('id',p_id,'current_step',v_step,'reached_steps',to_jsonb(v_steps),'followup_consent',v_consent,'updated_at',now());
end $$;

create or replace function public.get_platform_signup_draft(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.platform_signup_drafts;
begin
  if p_id is null then return null; end if;
  select * into d from public.platform_signup_drafts where id=p_id and expires_at>now();
  if not found then return null; end if;
  return jsonb_build_object('id',d.id,'data',d.data,'current_step',d.current_step,'reached_steps',to_jsonb(d.reached_steps),
    'followup_consent',d.followup_consent,'updated_at',d.updated_at);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Tenant onboarding progress + follow-up consent.
alter table public.tenants add column if not exists ai_assistance_override boolean;

-- Contact records created through imports or Control Panel forms may contain spaces or punctuation. Keep a canonical
-- E.164-like value for delivery, and store an empty value rather than rejecting unrelated account setup on bad data.
create or replace function public.onboarding_normalized_phone(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when char_length(digits) between 10 and 13
    then (case when left(trim(coalesce(p,'')),1)='+' then '+' else '' end) || digits else '' end
    from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') digits) q
$$;
revoke all on function public.onboarding_normalized_phone(text) from public,anon,authenticated;

create table if not exists public.tenant_onboarding (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  last_activity_at     timestamptz not null default now(),
  current_step         text not null default 'account' check (current_step in ('account','details','doctors','team','appointment','website','domain','plan','complete')),
  completed_steps      text[] not null default '{}',
  owner_name           text not null default '' check (char_length(owner_name) <= 100),
  owner_email          text not null default '' check (char_length(owner_email) <= 150),
  owner_phone          text not null default '' check (owner_phone = '' or owner_phone ~ '^\+?[0-9]{10,13}$'),
  city                 text not null default '' check (char_length(city) <= 80),
  followup_consent     boolean not null default false,
  consent_source       text not null default 'system' check (consent_source in ('system','signup','control_panel','hospital_owner')),
  consent_updated_at   timestamptz,
  reminder_count       smallint not null default 0 check (reminder_count between 0 and 3),
  last_reminded_at     timestamptz,
  next_followup_at     timestamptz,
  completed_at         timestamptz
);
create index if not exists tenant_onboarding_followup_idx on public.tenant_onboarding(next_followup_at)
  where next_followup_at is not null and completed_at is null;
alter table public.tenant_onboarding enable row level security;
revoke all on public.tenant_onboarding from anon, authenticated;
grant all on public.tenant_onboarding to service_role;

-- No direct table writes: tenant and platform progress is exposed only through carefully scoped RPCs.
create or replace function public.tenant_onboarding_seed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_onboarding (tenant_id, owner_email, current_step, completed_steps, next_followup_at)
  values (new.id, '', 'account', '{}', now() + interval '1 day')
  on conflict (tenant_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_tenant_onboarding_seed on public.tenants;
create trigger trg_tenant_onboarding_seed after insert on public.tenants
  for each row execute function public.tenant_onboarding_seed();
insert into public.tenant_onboarding (tenant_id, owner_email, current_step, completed_steps, next_followup_at)
select t.id, '', 'account', '{}', now() + interval '1 day' from public.tenants t
on conflict (tenant_id) do nothing;

create or replace function public.tenant_onboarding_owner_joined()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null or new.role <> 'owner' then return new; end if;
  insert into public.tenant_onboarding (tenant_id, current_step, completed_steps, owner_name, owner_email, owner_phone, last_activity_at, next_followup_at)
  values (new.tenant_id, 'details', array['account'], left(coalesce(new.full_name, ''), 100), left(coalesce(new.email, ''), 150), public.onboarding_normalized_phone(new.phone), now(), now() + interval '1 day')
  on conflict (tenant_id) do update set
    current_step = case when public.tenant_onboarding.completed_at is null then 'details' else public.tenant_onboarding.current_step end,
    completed_steps = array(select distinct s from unnest(public.tenant_onboarding.completed_steps || array['account']) s),
    owner_name = case when excluded.owner_name <> '' then excluded.owner_name else public.tenant_onboarding.owner_name end,
    owner_email = case when excluded.owner_email <> '' then excluded.owner_email else public.tenant_onboarding.owner_email end,
    owner_phone = case when excluded.owner_phone <> '' then excluded.owner_phone else public.tenant_onboarding.owner_phone end,
    last_activity_at = now(), reminder_count = 0,
    next_followup_at = case when public.tenant_onboarding.completed_at is null then now() + interval '1 day' else null end,
    updated_at = now();
  return new;
end $$;
drop trigger if exists trg_tenant_onboarding_owner_joined on public.profiles;
create trigger trg_tenant_onboarding_owner_joined after insert or update of tenant_id, role on public.profiles
  for each row when (new.role = 'owner') execute function public.tenant_onboarding_owner_joined();

-- hospital_create() stores the onboarding contact and consent on its bootstrap row. This trigger syncs them to the
-- private onboarding record and handles legacy CP owner-e-mail edits without erasing existing contact/consent fields.
create or replace function public.tenant_onboarding_sync_bootstrap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_consent boolean;
begin
  if new.key <> 'bootstrap' then return new; end if;
  if jsonb_typeof(new.data -> 'followup_consent') = 'boolean' then v_consent := (new.data ->> 'followup_consent')::boolean; end if;
  insert into public.tenant_onboarding (tenant_id, owner_name, owner_email, owner_phone, city, followup_consent, consent_source, consent_updated_at,
    current_step, completed_steps, next_followup_at)
  values (new.tenant_id, left(coalesce(new.data ->> 'owner_name',''),100), left(coalesce(new.data ->> 'owner_email',''),150),
    public.onboarding_normalized_phone(new.data ->> 'owner_phone'), left(coalesce(new.data ->> 'city',''),80), coalesce(v_consent,false),
    case when jsonb_typeof(new.data -> 'followup_consent') = 'boolean' then coalesce(nullif(new.data ->> 'consent_source',''), 'control_panel') else 'system' end,
    case when v_consent is null then null else now() end, 'account', '{}', now() + interval '1 day')
  on conflict (tenant_id) do update set
    owner_name = coalesce(nullif(left(new.data ->> 'owner_name',100),''), public.tenant_onboarding.owner_name),
    owner_email = coalesce(nullif(left(new.data ->> 'owner_email',150),''), public.tenant_onboarding.owner_email),
    owner_phone = coalesce(nullif(public.onboarding_normalized_phone(new.data ->> 'owner_phone'),''), public.tenant_onboarding.owner_phone),
    city = coalesce(nullif(left(new.data ->> 'city',80),''), public.tenant_onboarding.city),
    followup_consent = case when jsonb_typeof(new.data -> 'followup_consent') = 'boolean' then (new.data ->> 'followup_consent')::boolean else public.tenant_onboarding.followup_consent end,
    consent_source = case when jsonb_typeof(new.data -> 'followup_consent') = 'boolean' then coalesce(nullif(new.data ->> 'consent_source',''), 'control_panel') else public.tenant_onboarding.consent_source end,
    consent_updated_at = case when jsonb_typeof(new.data -> 'followup_consent') = 'boolean' then now() else public.tenant_onboarding.consent_updated_at end,
    next_followup_at = case when public.tenant_onboarding.completed_at is null then coalesce(public.tenant_onboarding.next_followup_at, now() + interval '1 day') else null end,
    updated_at = now();
  if new.data ? 'ai_assistance_override' then
    update public.tenants set ai_assistance_override = case when jsonb_typeof(new.data -> 'ai_assistance_override') = 'boolean'
      then (new.data ->> 'ai_assistance_override')::boolean else null end where id = new.tenant_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_tenant_onboarding_bootstrap on public.app_settings;
create trigger trg_tenant_onboarding_bootstrap after insert or update of data on public.app_settings
  for each row when (new.key = 'bootstrap') execute function public.tenant_onboarding_sync_bootstrap();

create or replace function public.my_onboarding()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); o public.tenant_onboarding;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can manage setup progress.' using errcode = '42501'; end if;
  select * into o from public.tenant_onboarding where tenant_id = v_tenant;
  if not found then raise exception 'Onboarding record not found.'; end if;
  return to_jsonb(o) - 'tenant_id';
end $$;

create or replace function public.save_onboarding_progress(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  o public.tenant_onboarding;
  allowed constant text[] := array['account','details','doctors','team','appointment','website','domain','plan'];
  v_steps text[] := '{}'; v_step text; v_next text; v_consent boolean; v_complete boolean;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can update setup progress.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p,'{}'::jsonb)) <> 'object' then raise exception 'Setup progress must be an object.'; end if;
  if p ? 'completed_steps' then
    if jsonb_typeof(p -> 'completed_steps') <> 'array' or jsonb_array_length(p -> 'completed_steps') > 8 then raise exception 'Invalid setup steps.'; end if;
    select coalesce(array_agg(distinct x), '{}') into v_steps from jsonb_array_elements_text(p -> 'completed_steps') x;
    if exists (select 1 from unnest(v_steps) x where not (x = any (allowed))) then raise exception 'Unknown setup step.'; end if;
  end if;
  if p ? 'current_step' and p ->> 'current_step' not in ('account','details','doctors','team','appointment','website','domain','plan','complete') then raise exception 'Unknown current setup step.'; end if;
  if p ? 'followup_consent' and jsonb_typeof(p -> 'followup_consent') <> 'boolean' then raise exception 'Follow-up consent must be true or false.'; end if;
  select * into o from public.tenant_onboarding where tenant_id = v_tenant for update;
  if not found then raise exception 'Onboarding record not found.'; end if;
  if not (p ? 'completed_steps') then v_steps := o.completed_steps; end if;
  v_steps := array(select distinct s from unnest(v_steps || array['account']) s);
  v_complete := array['details','doctors','team','appointment','website','plan'] <@ v_steps;
  select x into v_next from unnest(array['details','doctors','team','appointment','website','plan']) with ordinality q(x,n)
    where not (x = any(v_steps)) order by n limit 1;
  v_next := coalesce(v_next, 'complete');
  v_consent := case when p ? 'followup_consent' then (p ->> 'followup_consent')::boolean else o.followup_consent end;
  update public.tenant_onboarding set
    completed_steps = v_steps, current_step = v_next, followup_consent = v_consent,
    consent_source = case when p ? 'followup_consent' then 'hospital_owner' else consent_source end,
    consent_updated_at = case when p ? 'followup_consent' then now() else consent_updated_at end,
    last_activity_at = now(), reminder_count = case when v_complete then reminder_count else 0 end,
    next_followup_at = case when v_complete then null else now() + interval '1 day' end,
    completed_at = case when v_complete then coalesce(completed_at, now()) else null end,
    updated_at = now()
  where tenant_id = v_tenant returning * into o;
  return to_jsonb(o) - 'tenant_id';
end $$;

create table if not exists public.platform_onboarding_help (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references public.tenants(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  owner_name    text not null default '' check (char_length(owner_name) <= 100),
  owner_email   text not null default '' check (char_length(owner_email) <= 150),
  message       text not null check (char_length(message) between 5 and 2000),
  status        text not null default 'open' check (status in ('open','handled')),
  handled_at    timestamptz,
  handled_by    uuid
);
create index if not exists platform_onboarding_help_status_idx on public.platform_onboarding_help(status, created_at desc);
alter table public.platform_onboarding_help enable row level security;
revoke all on public.platform_onboarding_help from anon, authenticated;
grant all on public.platform_onboarding_help to service_role;

create or replace function public.request_onboarding_help(p_message text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant(); v_id uuid; t public.tenants; p public.profiles; v_message text := trim(coalesce(p_message,''));
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can contact setup support.' using errcode = '42501'; end if;
  if char_length(v_message) not between 5 and 2000 then raise exception 'Please describe what you need help with (5–2,000 characters).'; end if;
  if (select count(*) from public.platform_onboarding_help where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Please wait before sending another setup request.';
  end if;
  select * into t from public.tenants where id = v_tenant;
  select * into p from public.profiles where id = auth.uid();
  insert into public.platform_onboarding_help (hospital_id, owner_id, owner_name, owner_email, message)
  values (v_tenant, auth.uid(), left(coalesce(p.full_name,''),100), left(coalesce(p.email,''),150), v_message) returning id into v_id;
  perform public.raise_platform_alert_safe('onboarding_help', 'Setup help requested: ' || t.name, left(v_message, 1000), '/onboarding', 'onboarding-help:' || v_id, 1, 'info');
  return jsonb_build_object('id', v_id, 'status', 'open');
end $$;

create or replace function public.cp_onboarding()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin','support']);
  return jsonb_build_object(
    'hospitals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'plan', t.plan, 'created_at', t.created_at,
      'owner_joined', exists(select 1 from public.profiles p where p.tenant_id=t.id and p.role='owner'),
      'owner_name', o.owner_name, 'owner_email', coalesce(nullif(o.owner_email,''), (select s.data ->> 'owner_email' from public.app_settings s where s.tenant_id=t.id and s.key='bootstrap')),
      'owner_phone', o.owner_phone, 'city', o.city, 'current_step', o.current_step, 'completed_steps', to_jsonb(o.completed_steps),
      'followup_consent', o.followup_consent, 'reminder_count', o.reminder_count, 'last_activity_at', o.last_activity_at, 'next_followup_at', o.next_followup_at,
      'ai_assistance_override', t.ai_assistance_override,
      'ai_assistance_enabled', coalesce(t.ai_assistance_override, coalesce((public.billing_config() -> 'plans' -> t.plan ->> 'aiAssistance')::boolean,false))
    ) order by (o.completed_at is not null), o.last_activity_at asc, t.name)
      from public.tenants t join public.tenant_onboarding o on o.tenant_id=t.id where not t.is_primary and t.closing_at is null), '[]'::jsonb),
    'help', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'hospital_id', h.hospital_id, 'hospital', t.name,
      'owner_name', h.owner_name, 'owner_email', h.owner_email, 'message', h.message, 'status', h.status, 'created_at', h.created_at)
      order by (h.status='open') desc, h.created_at desc) from public.platform_onboarding_help h join public.tenants t on t.id=h.hospital_id
      where public.provider_can(h.hospital_id) and h.created_at > now() - interval '180 days'), '[]'::jsonb));
end $$;

create or replace function public.cp_onboarding_help_update(p_id uuid, p_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h public.platform_onboarding_help;
begin
  perform public.cp_require(array['admin','support']);
  if p_status not in ('open','handled') then raise exception 'Status must be open or handled.'; end if;
  update public.platform_onboarding_help set status=p_status, handled_at=case when p_status='handled' then now() else null end,
    handled_by=case when p_status='handled' then auth.uid() else null end where id=p_id and public.provider_can(hospital_id) returning * into h;
  if not found then raise exception 'Setup request not found or not assigned to you.'; end if;
  return jsonb_build_object('id',h.id,'status',h.status,'handled_at',h.handled_at);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Consent-gated progress reminders. In-app reminders are local to the tenant; e-mail / WhatsApp / FCM are sent only
-- when the owner explicitly opted in and a configured account, address or push token exists.
create or replace function public.onboarding_external_channels(p_env jsonb)
returns text[] language plpgsql stable set search_path = public as $$
declare v text; out text[] := '{}';
begin
  v := lower(coalesce(p_env ->> 'PLATFORM_EMAIL_PROVIDER',''));
  if (v='resend' and coalesce(p_env ->> 'PLATFORM_RESEND_API_KEY','')<>'' and coalesce(p_env ->> 'PLATFORM_EMAIL_FROM','')<>'')
     or (v='sendgrid' and coalesce(p_env ->> 'PLATFORM_SENDGRID_API_KEY','')<>'' and coalesce(p_env ->> 'PLATFORM_EMAIL_FROM','')<>'') then
    out := array_append(out,'email');
  end if;
  v := lower(coalesce(p_env ->> 'PLATFORM_WHATSAPP_PROVIDER',''));
  if v='openwa' and coalesce(p_env ->> 'PLATFORM_OPENWA_URL','')<>'' and coalesce(p_env ->> 'PLATFORM_OPENWA_SESSION','')<>'' and coalesce(p_env ->> 'PLATFORM_OPENWA_API_KEY','')<>'' then
    out := array_append(out,'whatsapp');
  elsif v='wacrm' and coalesce(p_env ->> 'PLATFORM_WACRM_URL','')<>'' and coalesce(p_env ->> 'PLATFORM_WACRM_API_KEY','')<>''
        and coalesce((select data -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate' from public.platform_settings where key='messaging'),'')<>'' then
    out := array_append(out,'whatsapp');
  elsif v='meta' and coalesce(p_env ->> 'PLATFORM_META_PHONE_NUMBER_ID','')<>'' and coalesce(p_env ->> 'PLATFORM_META_ACCESS_TOKEN','')<>''
        and coalesce((select data -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate' from public.platform_settings where key='messaging'),'')<>'' then
    out := array_append(out,'whatsapp');
  elsif v in ('aisensy','interakt','msg91') and coalesce((select data -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate' from public.platform_settings where key='messaging'),'')<>'' then
    out := array_append(out,'whatsapp');
  end if;
  return out;
end $$;

create or replace function public.process_onboarding_reminders()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r public.tenant_onboarding;
  v_env jsonb := public.platform_env();
  v_external text[] := public.onboarding_external_channels(v_env);
  v_app jsonb; v_n jsonb; v_email_cfg jsonb; v_wa_cfg jsonb; v_push_cfg jsonb;
  v_channels text[]; v_profile uuid; v_email text; v_phone text; v_name text; v_tenant_name text;
  v_email_ready boolean; v_wa_ready boolean; v_push_ready boolean;
  v_sent int; v_done int := 0; v_previous text := current_setting('app.tenant_id', true);
  v_step text; v_link text; v_next timestamptz;
begin
  for r in select o.* from public.tenant_onboarding o join public.tenants t on t.id=o.tenant_id
    where not t.is_primary and t.closing_at is null and o.completed_at is null and o.next_followup_at <= now() and o.reminder_count < 3
    order by o.next_followup_at, o.tenant_id limit 100 for update of o skip locked
  loop
    begin
      perform set_config('app.tenant_id', r.tenant_id::text, true);
      v_app := public.tenant_setting('app');
      v_n := coalesce(v_app -> 'notifications','{}'::jsonb);
      v_email_cfg := coalesce(v_n -> 'email','{}'::jsonb);
      v_wa_cfg := coalesce(v_n -> 'whatsapp','{}'::jsonb);
      v_push_cfg := coalesce(v_n -> 'push','{}'::jsonb);
      select p.id, coalesce(nullif(p.email,''),r.owner_email), coalesce(nullif(p.phone,''),r.owner_phone), coalesce(nullif(p.full_name,''),r.owner_name)
        into v_profile, v_email, v_phone, v_name
        from public.profiles p where p.tenant_id=r.tenant_id and p.role='owner' order by p.created_at limit 1;
      if not found then
        v_profile := null;
        v_email := coalesce(nullif(r.owner_email,''),(select s.data ->> 'owner_email' from public.app_settings s where s.tenant_id=r.tenant_id and s.key='bootstrap'));
        v_phone := r.owner_phone; v_name := r.owner_name;
      end if;
      v_phone := public.onboarding_normalized_phone(v_phone);
      select name into v_tenant_name from public.tenants where id=r.tenant_id;
      v_channels := '{}';
      if r.followup_consent then
        v_email_ready := coalesce((v_email_cfg ->> 'enabled')::boolean,false) and v_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' and
          ((v_email_cfg ->> 'source'='platform' and 'email'=any(v_external)) or
           (v_email_cfg ->> 'source'='own' and case lower(coalesce(v_email_cfg ->> 'provider',''))
             when 'resend' then coalesce(public.tenant_secret('resend_api_key'),'')<>'' and coalesce(v_email_cfg ->> 'fromEmail','')<>''
             when 'sendgrid' then coalesce(public.tenant_secret('sendgrid_api_key'),'')<>'' and coalesce(v_email_cfg ->> 'fromEmail','')<>''
             when 'smtp' then coalesce(public.tenant_secret('smtp_password'),'')<>'' and coalesce(v_email_cfg ->> 'smtpHost','')<>'' and coalesce(v_email_cfg ->> 'smtpUser','')<>''
             else false end));
        v_wa_ready := coalesce((v_wa_cfg ->> 'enabled')::boolean,false) and coalesce(v_phone,'') ~ '^\+?[0-9]{10,13}$' and
          ((v_wa_cfg ->> 'source'='platform' and 'whatsapp'=any(v_external)) or
           (v_wa_cfg ->> 'source'='own' and case lower(coalesce(v_wa_cfg ->> 'provider',''))
             when 'openwa' then coalesce(v_wa_cfg ->> 'openwaUrl','')<>'' and coalesce(v_wa_cfg ->> 'openwaSession','')<>'' and coalesce(public.tenant_secret('openwa_api_key'),'')<>''
             when 'wacrm' then coalesce(v_wa_cfg ->> 'wacrmUrl','')<>'' and coalesce(public.tenant_secret('wacrm_api_key'),'')<>'' and coalesce(v_n -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate','')<>''
             when 'meta' then coalesce(v_wa_cfg ->> 'phoneNumberId','')<>'' and coalesce(public.tenant_secret('meta_access_token'),'')<>'' and coalesce(v_n -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate','')<>''
             when 'aisensy' then coalesce(public.tenant_secret('aisensy_api_key'),'')<>'' and coalesce(v_n -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate','')<>''
             when 'msg91' then coalesce(public.tenant_secret('msg91_auth_key'),'')<>'' and coalesce(v_wa_cfg ->> 'msg91Number','')<>''
               and coalesce(v_n -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate','')<>''
             when 'interakt' then coalesce(public.tenant_secret('interakt_api_key'),'')<>'' and coalesce(v_n -> 'templates' -> 'onboarding_reminder' ->> 'waTemplate','')<>''
             when 'twilio' then coalesce(v_wa_cfg ->> 'twilioAccountSid','')<>'' and coalesce(v_wa_cfg ->> 'twilioFrom','')<>''
               and coalesce(public.tenant_secret('twilio_auth_token'),'')<>''
             when 'webhook' then coalesce(v_wa_cfg ->> 'webhookUrl','') ~ '^https://'
             else false end));
        if v_email_ready then v_channels:=array_append(v_channels,'email'); end if;
        if v_wa_ready then v_channels:=array_append(v_channels,'whatsapp'); end if;
        v_push_ready := coalesce((v_push_cfg ->> 'enabled')::boolean,false) and coalesce(v_push_cfg ->> 'apiKey','')<>''
          and coalesce(v_push_cfg ->> 'projectId','')<>'' and coalesce(v_push_cfg ->> 'appId','')<>''
          and coalesce(v_push_cfg ->> 'vapidKey','')<>'' and coalesce(v_push_cfg ->> 'messagingSenderId','')<>'' and v_profile is not null
          and exists(select 1 from public.push_tokens pt where pt.tenant_id=r.tenant_id and pt.profile_id=v_profile);
        if v_push_ready then v_channels:=array_append(v_channels,'push'); end if;
      end if;
      if v_profile is not null then v_channels := array_append(v_channels,'inapp'); end if;
      v_channels := array(select distinct x from unnest(v_channels) x);
      v_step := case coalesce(nullif(r.current_step,''),'account')
        when 'account' then 'create your owner account' when 'details' then 'add hospital details'
        when 'doctors' then 'add your doctors' when 'team' then 'invite your team'
        when 'appointment' then 'book a first appointment' when 'website' then 'review your website'
        when 'domain' then 'connect a custom domain (optional)' when 'plan' then 'choose a plan'
        else 'finish your hospital setup' end;
      v_link := public.notify_tenant_url(r.tenant_id, case when v_profile is null then '/register' else '/login' end);
      v_sent := public.notify_enqueue('onboarding_reminder', v_phone, v_email,
        jsonb_build_object('name',coalesce(nullif(v_name,''),'there'),'hospital',v_tenant_name,'step',v_step,
          'link',v_link,'days', greatest(1,ceil(extract(epoch from (now()-r.created_at))/86400)::int)),
        'tenants', r.tenant_id, v_channels, v_profile);
      if v_sent > 0 then
        v_next := case when r.reminder_count=0 then greatest(r.created_at+interval '3 days',now()+interval '1 day')
                       when r.reminder_count=1 then greatest(r.created_at+interval '7 days',now()+interval '1 day') else null end;
        update public.tenant_onboarding set reminder_count=reminder_count+1,last_reminded_at=now(),next_followup_at=v_next,updated_at=now()
          where tenant_id=r.tenant_id;
      else
        -- No address, eligible channel or enabled in-app notification: do not spend an attempt; retry tomorrow.
        update public.tenant_onboarding set next_followup_at=now()+interval '1 day',updated_at=now() where tenant_id=r.tenant_id;
      end if;
      v_done := v_done+1;
    exception when others then
      update public.tenant_onboarding set next_followup_at=now()+interval '6 hours',updated_at=now() where tenant_id=r.tenant_id;
      raise warning 'onboarding reminder for %: %',r.tenant_id,sqlerrm;
    end;
  end loop;
  perform set_config('app.tenant_id',coalesce(v_previous,''),true);
  return jsonb_build_object('processed',v_done);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Plan / per-hospital AI entitlement and private provider configuration.
insert into public.platform_settings(key,data) values ('ai_builder',
  '{"enabled":false,"dailyLimit":25,"maxOutputTokens":900,"providers":[{"id":"openai","model":"gpt-4o-mini","enabled":false},{"id":"anthropic","model":"claude-3-5-haiku-latest","enabled":false},{"id":"gemini","model":"gemini-2.5-flash-lite","enabled":false}]}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.ai_builder_usage (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  actor_id       uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  request_hash   text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status         text not null default 'reserved' check (status in ('reserved','success','failed')),
  provider       text check (provider is null or provider in ('openai','anthropic','gemini')),
  model          text check (char_length(model) <= 120),
  input_tokens   int not null default 0 check (input_tokens >= 0),
  output_tokens  int not null default 0 check (output_tokens >= 0),
  error_code     text check (error_code is null or error_code ~ '^[a-z0-9_-]{1,40}$')
);
create index if not exists ai_builder_usage_tenant_day_idx on public.ai_builder_usage(tenant_id,created_at desc);
alter table public.ai_builder_usage enable row level security;
revoke all on public.ai_builder_usage from public,anon,authenticated;
grant all on public.ai_builder_usage to service_role;

-- These tables are created after the core tenancy, billing and integrity passes have already enumerated tenant tables.
-- Apply the same isolation, immovable-tenant and read-only license protections now so a fresh install and an in-place
-- upgrade (including a second idempotent run) have identical security metadata.
do $white_label_tenant_security$
declare t text;
begin
  foreach t in array array['tenant_onboarding','ai_builder_usage'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists tenant_isolation on public.%I',t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to anon, authenticated
      using (tenant_id = (select public.current_tenant())) with check (tenant_id = (select public.current_tenant()))',t);
    execute format('drop trigger if exists trg_keep_tenant on public.%I',t);
    execute format('create trigger trg_keep_tenant before update of tenant_id on public.%I for each row execute function public.keep_tenant()',t);
    execute format('drop trigger if exists trg_license_guard on public.%I',t);
    execute format('create trigger trg_license_guard before insert or update or delete on public.%I for each row execute function public.license_guard()',t);
  end loop;
end $white_label_tenant_security$;

create or replace function public.ai_builder_tenant_entitled(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(t.ai_assistance_override,coalesce((public.billing_config() -> 'plans' -> t.plan ->> 'aiAssistance')::boolean,false))
  from public.tenants t where t.id=p_tenant
$$;

create or replace function public.my_ai_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; cfg jsonb := coalesce((select data from public.platform_settings where key='ai_builder'),'{}'::jsonb);
  v_entitled boolean; v_available boolean; v_ready jsonb;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can use AI page assistance.' using errcode='42501'; end if;
  select * into t from public.tenants where id=public.current_tenant();
  if not found then raise exception 'Hospital not found.'; end if;
  v_entitled := public.ai_builder_tenant_entitled(t.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.value->>'id','model',p.value->>'model') order by p.ord),'[]'::jsonb) into v_ready
  from jsonb_array_elements(coalesce(cfg->'providers','[]'::jsonb)) with ordinality p(value,ord)
  where coalesce((p.value->>'enabled')::boolean,false) and exists(select 1 from public.platform_secrets s
    where s.key='PLATFORM_AI_'||upper(p.value->>'id')||'_API_KEY' and nullif(public.platform_secret_value(s),'') is not null);
  v_available := jsonb_array_length(v_ready)>0;
  return jsonb_build_object('plan',t.plan,'override',t.ai_assistance_override,'entitled',v_entitled,'providersAvailable',v_available,
    'enabled',v_entitled and coalesce((cfg->>'enabled')::boolean,false) and v_available,
    'reason',case when not v_entitled then 'AI assistance is not included in the current plan.'
                  when not coalesce((cfg->>'enabled')::boolean,false) or not v_available then 'AI page assistance has not been configured by the platform administrator.' else '' end,
    'dailyLimit',coalesce((cfg->>'dailyLimit')::int,25));
end $$;

create or replace function public.cp_ai_builder_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb := coalesce((select data from public.platform_settings where key='ai_builder'),'{}'::jsonb);
begin
  perform public.cp_require(array['admin']);
  return cfg || jsonb_build_object('secrets',coalesce((select jsonb_agg(jsonb_build_object('key',key,'hint',hint,'updated_at',updated_at,'updated_by_name',updated_by_name) order by key)
    from public.platform_secrets where key in ('PLATFORM_AI_OPENAI_API_KEY','PLATFORM_AI_ANTHROPIC_API_KEY','PLATFORM_AI_GEMINI_API_KEY')),'[]'::jsonb),
    'usage',jsonb_build_object('requests',(select count(*) from public.ai_builder_usage where created_at>now()-interval '30 days'),
      'tokens',(select coalesce(sum(input_tokens+output_tokens),0) from public.ai_builder_usage where created_at>now()-interval '30 days'),
      'failures',(select count(*) from public.ai_builder_usage where status='failed' and created_at>now()-interval '30 days')));
end $$;

create or replace function public.cp_save_ai_builder_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cfg jsonb := coalesce((select data from public.platform_settings where key='ai_builder'),'{}'::jsonb);
  k text; x jsonb; v_providers jsonb := '[]'::jsonb; seen text[] := '{}'; v_id text; v_model text; v_enabled boolean;
begin
  perform public.cp_require(array['admin']);
  if jsonb_typeof(coalesce(p,'{}'::jsonb))<>'object' then raise exception 'AI settings must be an object.'; end if;
  for k in select jsonb_object_keys(p) loop if k not in ('enabled','dailyLimit','maxOutputTokens','providers') then raise exception 'Unknown AI setting %',k; end if; end loop;
  if p ? 'enabled' and jsonb_typeof(p->'enabled')<>'boolean' then raise exception 'AI enabled must be true or false.'; end if;
  if p ? 'dailyLimit' and coalesce((p->>'dailyLimit')::int,0) not between 1 and 100 then raise exception 'Daily request limit must be 1–100.'; end if;
  if p ? 'maxOutputTokens' and coalesce((p->>'maxOutputTokens')::int,0) not between 200 and 2000 then raise exception 'Maximum output must be 200–2,000 tokens.'; end if;
  if p ? 'providers' then
    if jsonb_typeof(p->'providers')<>'array' or jsonb_array_length(p->'providers')>3 then raise exception 'Choose up to three AI providers in priority order.'; end if;
    for x in select value from jsonb_array_elements(p->'providers') loop
      if jsonb_typeof(x)<>'object' then raise exception 'Each provider must be an object.'; end if;
      v_id:=x->>'id'; v_model:=trim(coalesce(x->>'model','')); v_enabled:=coalesce((x->>'enabled')::boolean,false);
      if v_id not in ('openai','anthropic','gemini') or v_id=any(seen) then raise exception 'Unknown or repeated provider %.',v_id; end if;
      if char_length(v_model) not between 1 and 120 or v_model !~ '^[A-Za-z0-9._:-]+$' then raise exception 'Provider model names must be 1–120 letters, numbers, dots, underscores or dashes.'; end if;
      seen:=array_append(seen,v_id);
      v_providers:=v_providers||jsonb_build_array(jsonb_build_object('id',v_id,'model',v_model,'enabled',v_enabled));
    end loop;
  end if;
  cfg:=cfg|| (p-'providers') || case when p?'providers' then jsonb_build_object('providers',v_providers) else '{}'::jsonb end;
  update public.platform_settings set data=cfg,updated_at=now(),updated_by=auth.uid() where key='ai_builder';
  insert into public.provider_audit(user_id,user_name,mode,action,target,detail) values(auth.uid(),(select full_name from public.profiles where id=auth.uid()),'admin','ai:builder-settings','AI page builder',jsonb_build_object('enabled',cfg->'enabled','providers',cfg->'providers'));
  return public.cp_ai_builder_settings();
end $$;

create or replace function public.cp_ai_assistance(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tenants;
begin
  perform public.cp_require(array['admin','support']);
  if not public.provider_can(p_tenant) then raise exception 'Hospital not found or not assigned to you.'; end if;
  select * into t from public.tenants where id=p_tenant;
  return jsonb_build_object('tenant_id',t.id,'plan',t.plan,'plan_includes',coalesce((public.billing_config()->'plans'->t.plan->>'aiAssistance')::boolean,false),
    'override',t.ai_assistance_override,'enabled',public.ai_builder_tenant_entitled(t.id));
end $$;

create or replace function public.cp_set_ai_assistance(p_tenant uuid,p_override boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants;
begin
  perform public.cp_require(array['admin']);
  select * into t from public.tenants where id=p_tenant for update;
  if not found then raise exception 'Hospital not found.'; end if;
  update public.tenants set ai_assistance_override=p_override,updated_at=now() where id=p_tenant;
  perform public.provider_log('hospital:ai-assistance',t.slug,jsonb_build_object('override',p_override,'plan',t.plan));
  return public.cp_ai_assistance(p_tenant);
end $$;

-- Edge-only atomic daily allowance reservation. Prompt content is never stored; request_hash is a random-salted per-request digest.
create or replace function public.ai_builder_reserve(p_tenant uuid,p_actor uuid,p_request_hash text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cfg jsonb := coalesce((select data from public.platform_settings where key='ai_builder'),'{}'::jsonb); v_id uuid; v_limit int;
begin
  if not public.ai_builder_tenant_entitled(p_tenant) or not coalesce((cfg->>'enabled')::boolean,false) then raise exception 'AI_NOT_ENTITLED'; end if;
  if not exists(select 1 from public.profiles where id=p_actor and tenant_id=p_tenant and role='owner') then raise exception 'AI_ACTOR_NOT_OWNER'; end if;
  if p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'AI_BAD_REQUEST_HASH'; end if;
  perform pg_advisory_xact_lock(hashtext('hc_ai_builder:'||p_tenant::text));
  v_limit:=greatest(1,least(coalesce((cfg->>'dailyLimit')::int,25),100));
  if (select count(*) from public.ai_builder_usage where tenant_id=p_tenant and created_at>now()-interval '24 hours')>=v_limit then raise exception 'AI_DAILY_LIMIT'; end if;
  if (select count(*) from public.ai_builder_usage where tenant_id=p_tenant and actor_id=p_actor and created_at>now()-interval '24 hours')>=least(v_limit,10) then raise exception 'AI_ACTOR_LIMIT'; end if;
  insert into public.ai_builder_usage(tenant_id,actor_id,request_hash) values(p_tenant,p_actor,p_request_hash) returning id into v_id;
  return jsonb_build_object('id',v_id,'dailyLimit',v_limit);
end $$;

create or replace function public.ai_builder_finish(p_id uuid,p_status text,p_provider text default null,p_model text default null,
  p_input_tokens int default 0,p_output_tokens int default 0,p_error_code text default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if p_status not in ('success','failed') or (p_provider is not null and p_provider not in ('openai','anthropic','gemini'))
     or greatest(coalesce(p_input_tokens,0),coalesce(p_output_tokens,0))>100000 then raise exception 'AI_USAGE_INVALID'; end if;
  update public.ai_builder_usage set status=p_status,provider=p_provider,model=left(p_model,120),input_tokens=greatest(0,coalesce(p_input_tokens,0)),
    output_tokens=greatest(0,coalesce(p_output_tokens,0)),error_code=case when p_error_code ~ '^[a-z0-9_-]{1,40}$' then p_error_code else null end
   where id=p_id and status='reserved';
  return found;
end $$;

create or replace function public.cp_ai_builder_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return jsonb_build_object('requests',(select count(*) from public.ai_builder_usage where created_at>now()-interval '30 days'),
    'tokens',(select coalesce(sum(input_tokens+output_tokens),0) from public.ai_builder_usage where created_at>now()-interval '30 days'),
    'failures',(select count(*) from public.ai_builder_usage where status='failed' and created_at>now()-interval '30 days'),
    'providers',coalesce((select jsonb_object_agg(provider,n) from (select provider,count(*) n from public.ai_builder_usage where created_at>now()-interval '30 days' and status='success' group by provider) q),'{}'::jsonb));
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Internal grants: owner-facing RPCs, Control Panel controls, and service-role-only AI accounting.
revoke all on function public.tenant_onboarding_seed(), public.tenant_onboarding_owner_joined(), public.tenant_onboarding_sync_bootstrap(),
  public.onboarding_external_channels(jsonb), public.ai_builder_tenant_entitled(uuid), public.ai_builder_reserve(uuid,uuid,text),
  public.ai_builder_finish(uuid,text,text,text,int,int,text), public.process_onboarding_reminders() from public,anon,authenticated;
revoke all on function public.my_onboarding(),public.save_onboarding_progress(jsonb),public.request_onboarding_help(text),public.get_platform_signup_draft(uuid) from public;
revoke all on function public.save_platform_signup_draft(uuid,jsonb) from public;
revoke all on function public.cp_onboarding(),public.cp_onboarding_help_update(uuid,text),public.cp_ai_builder_settings(),public.cp_save_ai_builder_settings(jsonb),
  public.cp_ai_assistance(uuid),public.cp_set_ai_assistance(uuid,boolean),public.cp_ai_builder_usage() from public,anon;
grant execute on function public.my_onboarding(),public.save_onboarding_progress(jsonb),public.request_onboarding_help(text),public.get_platform_signup_draft(uuid) to authenticated,anon;
grant execute on function public.save_platform_signup_draft(uuid,jsonb) to authenticated,anon;
grant execute on function public.cp_onboarding(),public.cp_onboarding_help_update(uuid,text),public.cp_ai_builder_settings(),public.cp_save_ai_builder_settings(jsonb),
  public.cp_ai_assistance(uuid),public.cp_set_ai_assistance(uuid,boolean),public.cp_ai_builder_usage() to authenticated;
grant execute on function public.my_ai_access() to authenticated;
grant execute on function public.ai_builder_reserve(uuid,uuid,text),public.ai_builder_finish(uuid,text,text,text,int,int,text),public.process_onboarding_reminders() to service_role;

-- Scheduled alongside the existing control-panel delivery / health tasks.
create or replace function public.ops_cron_tick()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_min int := extract(minute from now())::int;
begin
  perform public.process_onboarding_reminders();
  if extract(minute from now())::int = 0 then delete from public.platform_signup_drafts where expires_at <= now(); end if;
  perform public.run_due_broadcasts();
  if v_min = 7 then perform public.run_platform_hourly_alerts(); end if;
  perform public.ops_nightly_cleanup();
  if exists (select 1 from public.platform_outbox where status = 'pending' and next_attempt_at <= now()) then perform public.ops_call('{"flush": true}'::jsonb); end if;
  if v_min % 5 = 0 and coalesce((public.ops_config() #>> '{health,enabled}')::boolean, true) then perform public.ops_call('{"health": true}'::jsonb); end if;
exception when others then
  raise warning 'ops tick: %', sqlerrm;
end $$;
revoke all on function public.ops_cron_tick() from public,anon,authenticated;

-- Used by owner/provider websites, signup and Edge Functions; no unauthenticated caller can read private onboarding.
revoke all on function public.my_ai_access() from public,anon;

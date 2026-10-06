-- =====================================================================================================
--  NOTIFICATION TEMPLATE LIBRARY — every message with an ID, platform-wide control, in-app bell, new events,
--  daily digests and the server monitor (loaded after cp_notify.sql / otp_verify.sql).
--
--  * public.notify_catalog()       every template (src/notify/catalog.ts, written in by scripts/build-master-sql.ts)
--  * public.platform_templates     the control panel's edits: on/off per event and per channel, lock, wording,
--                                  WhatsApp / DLT registration, custom templates (control panel → Messaging → Templates)
--  * notify_enqueue()              hospital events: catalog default ⊕ platform edit ⊕ the hospital's own wording
--                                  (unless locked); channels from Settings → Notifications (catalog defaults for new events)
--  * notify_enqueue_raw()          + platform switch / wording for platform messages, + the in-app channel
--  * public.user_notifications     the bell in the hospital app (staff, doctors, patients)
--  * triggers                      appointments, admissions, prescriptions, lab, invoices, leave, invites, privacy,
--                                  hospital status / plan / trial, platform payments, domains, "sign in as user"
--  * notify_daily_tick()           every minute from notify_cron_flush(): doctor schedules, follow-ups, birthdays,
--                                  overdue bills, wallet / quota warnings, owner digest, platform digest, server watchdog
--  * record_server_metrics()       CPU / RAM / disk / containers / SSL from scripts/server/hc-monitor.sh (via the ops function)
--
--  Checked by tests/sql/notify_catalog.test.ts.
-- =====================================================================================================

-- ------------------------------------------------------------------ 1. the catalog
create or replace function public.notify_catalog()
returns jsonb language sql immutable as $$ select $catalog$@@NOTIFY_CATALOG@@$catalog$::jsonb $$;

-- ------------------------------------------------------------------ 2. the control panel's edits (platform-wide, no tenant_id)
create table if not exists public.platform_templates (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  enabled     boolean not null default true,
  locked      boolean not null default false,
  channels    jsonb not null default '{}'::jsonb,     -- {"sms": false, …}: false = off for everyone; true = on (platform messages)
  tpl         jsonb not null default '{}'::jsonb,     -- {subject, text, waText, pushText, waParams, waTemplate, waCategory, waStatus, smsTemplateId}
  custom      boolean not null default false,         -- added in the control panel (Broadcasts use them)
  meta        jsonb not null default '{}'::jsonb,     -- custom only: {label, group, audience, hint, channels}
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
alter table public.platform_templates enable row level security;
revoke all on public.platform_templates from anon, authenticated;
grant all on public.platform_templates to service_role;

create or replace function public.platform_template(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) - 'updated_by' from public.platform_templates t where t.key = p_key
$$;

create or replace function public.platform_brand()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(public.billing_config() -> 'seller' ->> 'name', ''), 'Hospital Comrade')
$$;

-- the wording a hospital event goes out with: catalog ⊕ platform edit ⊕ the hospital's own wording. A hospital field
-- counts as its own only when it differs from the catalog default (saved settings hold a copy of the defaults).
create or replace function public.notify_resolve_template(p_event text, p_hosp jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cat  jsonb := public.notify_catalog() -> p_event;
  pt   jsonb := public.platform_template(p_event);
  base jsonb;
  f    text;
  v    text;
begin
  if cat is null then return p_hosp; end if;
  base := coalesce(cat -> 'copy', '{}'::jsonb);
  if pt is not null then
    foreach f in array array['subject', 'text', 'waText', 'pushText', 'waParams'] loop
      v := pt -> 'tpl' ->> f;
      if coalesce(trim(v), '') <> '' then base := base || jsonb_build_object(f, v); end if;
    end loop;
  end if;
  if jsonb_typeof(p_hosp) = 'object' then
    if not coalesce((pt ->> 'locked')::boolean, false) then
      foreach f in array array['subject', 'text', 'waText', 'pushText'] loop
        v := p_hosp ->> f;
        if coalesce(trim(v), '') <> '' and v is distinct from (cat -> 'copy' ->> f) then base := base || jsonb_build_object(f, v); end if;
      end loop;
    end if;
    -- the hospital's own WhatsApp template / DLT registration (used on its own accounts)
    foreach f in array array['waTemplate', 'waParams', 'smsTemplateId'] loop
      v := p_hosp ->> f;
      if coalesce(trim(v), '') <> '' then base := base || jsonb_build_object(f, v); end if;
    end loop;
  end if;
  return base;
end $$;

-- is this hospital event switched on for at least one channel? (cheap check before a daily loop)
create or replace function public.notify_event_on(p_event text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  n   jsonb := public.tenant_setting('app') -> 'notifications';
  cat jsonb := public.notify_catalog() -> p_event;
  pt  jsonb := public.platform_template(p_event);
  fl  jsonb;
begin
  if n is null or cat is null or not coalesce((pt ->> 'enabled')::boolean, true) then return false; end if;
  fl := coalesce(cat -> 'defaults', '{}'::jsonb) || coalesce(n -> 'events' -> p_event, '{}'::jsonb);
  return exists (select 1 from jsonb_array_elements_text(cat -> 'channels') c
                  where coalesce((fl ->> c)::boolean, false) and coalesce((pt -> 'channels' ->> c)::boolean, true)
                    and (c in ('inapp', 'push') or coalesce((n -> c ->> 'enabled')::boolean, false)));
end $$;

-- ------------------------------------------------------------------ 3. the in-app bell
create table if not exists public.user_notifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  event          text not null,
  title          text not null check (char_length(title) <= 200),
  body           text not null default '' check (char_length(body) <= 2000),
  link           text check (char_length(link) <= 500),
  related_table  text,
  related_id     uuid,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists user_notifications_profile_idx on public.user_notifications (profile_id, created_at desc);
create index if not exists user_notifications_unread_idx on public.user_notifications (profile_id) where read_at is null;
create index if not exists user_notifications_tenant_idx on public.user_notifications (tenant_id);
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;
drop policy if exists user_notifications_own on public.user_notifications;
create policy user_notifications_own on public.user_notifications for select to authenticated
  using (profile_id = auth.uid() and tenant_id = public.current_tenant());

-- the bell: newest first + the unread count
create or replace function public.my_notifications(p_limit int default 30, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.user_notifications where profile_id = auth.uid() and tenant_id = public.current_tenant() and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'event', n.event, 'title', n.title, 'body', n.body, 'link', n.link,
                                                            'read', n.read_at is not null, 'created_at', n.created_at) order by n.created_at desc)
                         from (select * from public.user_notifications
                                where profile_id = auth.uid() and tenant_id = public.current_tenant() and (p_before is null or created_at < p_before)
                                order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) n), '[]'::jsonb));
end $$;

-- mark read: these ids, or everything (null)
create or replace function public.read_notifications(p_ids uuid[] default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update public.user_notifications set read_at = now()
   where profile_id = auth.uid() and tenant_id = public.current_tenant() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v = row_count;
  return v;
end $$;

-- ------------------------------------------------------------------ 4. the queue (replaces messaging.sql's versions)
-- One message per channel. p_tpl = {text, subject, waText, pushText}. Never raises.
-- Platform messages (anything not resolved by notify_enqueue): the control panel may switch the event / a channel off,
-- add a channel, or reword it. 'inapp' writes the bell row directly (no provider, nothing to meter).
create or replace function public.notify_enqueue_raw(p_event text, p_tpl jsonb, p_channels text[], p_phone text, p_email text, p_profile uuid,
  p_vars jsonb, p_related_table text default null, p_related_id uuid default null, p_template uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n        jsonb := (public.tenant_setting('app') -> 'notifications');
  site     jsonb := public.tenant_content('settings');
  cat      jsonb;
  pt       jsonb;
  v_tpl    jsonb := p_tpl;
  v_chs    text[] := coalesce(p_channels, '{}');
  ch       text;
  f        text;
  v_to     text;
  v_body   text;
  v_subj   text;
  v_vars   jsonb;
  k        text;
  v_count  int := 0;
  v_limit  int;
  v_used   bigint;
begin
  if n is null or p_tpl is null then return 0; end if;
  if current_setting('app.notify_off', true) = 'on' then return 0; end if;
  if coalesce((v_tpl ->> '_resolved')::boolean, false) then
    v_tpl := v_tpl - '_resolved';
  elsif p_event !~ '^(tpl:|test$)' then
    cat := public.notify_catalog() -> p_event;
    pt := public.platform_template(p_event);
    if pt is not null then
      if not coalesce((pt ->> 'enabled')::boolean, true) then return 0; end if;
      foreach f in array array['subject', 'text', 'waText', 'pushText'] loop
        continue when f = 'text' and coalesce((cat ->> 'freeText')::boolean, false);
        if coalesce(trim(pt -> 'tpl' ->> f), '') <> '' then v_tpl := v_tpl || jsonb_build_object(f, pt -> 'tpl' ->> f); end if;
      end loop;
      -- channels the control panel added (only ones the template allows) or switched off
      v_chs := array(select distinct c from unnest(v_chs || array(select key from jsonb_each_text(coalesce(pt -> 'channels', '{}'::jsonb))
                                                                 where value = 'true' and (cat is null or cat -> 'channels' ? key))) c
                      where coalesce((pt -> 'channels' ->> c)::boolean, true));
    end if;
  end if;
  v_vars := jsonb_build_object(
      'hospital', coalesce(nullif(site ->> 'name', ''), 'DC Hospital'),
      'hospital_phone', coalesce(nullif(site ->> 'appointmentsPhone', ''), site ->> 'phone', ''),
      'address', coalesce(site ->> 'address', ''),
      'site_url', rtrim(coalesce(site ->> 'siteUrl', ''), '/'),
      'platform', public.platform_brand())
    || coalesce(p_vars, '{}'::jsonb);

  foreach ch in array array['sms', 'whatsapp', 'email', 'push', 'inapp'] loop
    continue when not (ch = any (v_chs));
    if ch = 'inapp' then
      continue when p_profile is null or not exists (select 1 from public.profiles where id = p_profile);
      v_body := coalesce(nullif(v_tpl ->> 'pushText', ''), v_tpl ->> 'text', '');
      v_subj := coalesce(nullif(v_tpl ->> 'subject', ''), '{hospital}');
      continue when v_body = '';
      for k in select jsonb_object_keys(v_vars) loop
        v_body := replace(v_body, '{' || k || '}', coalesce(v_vars ->> k, ''));
        v_subj := replace(v_subj, '{' || k || '}', coalesce(v_vars ->> k, ''));
      end loop;
      insert into public.user_notifications (profile_id, event, title, body, link, related_table, related_id)
      values (p_profile, p_event, left(v_subj, 200), left(v_body, 2000), nullif(left(coalesce(v_vars ->> 'link', ''), 500), ''), p_related_table, p_related_id);
      v_count := v_count + 1;
      continue;
    end if;
    continue when coalesce((n -> ch ->> 'enabled')::boolean, false) is not true;
    if ch = 'email' then
      v_to := nullif(lower(trim(coalesce(p_email, ''))), '');
      continue when v_to is null or v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
    elsif ch = 'push' then
      continue when p_profile is null or not exists (select 1 from public.push_tokens where profile_id = p_profile);
      v_to := p_profile::text;
    else
      v_to := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
      continue when v_to !~ '^[6-9][0-9]{9}$';
    end if;
    v_body := case
      when ch = 'whatsapp' and coalesce(v_tpl ->> 'waText', '') <> '' then v_tpl ->> 'waText'
      when ch = 'push' and coalesce(v_tpl ->> 'pushText', '') <> '' then v_tpl ->> 'pushText'
      else coalesce(v_tpl ->> 'text', '') end;
    v_subj := coalesce(nullif(v_tpl ->> 'subject', ''), case when ch = 'push' then '{hospital}' else '' end);
    continue when v_body = '';
    -- monthly cap on the shared (platform) accounts, set by the platform team (control panel → Messaging)
    if ch <> 'push' and coalesce(n -> ch ->> 'source', 'own') = 'platform' then
      select (t.billing -> 'monthlyLimit' ->> ch)::int into v_limit from public.tenants t where t.id = public.current_tenant();
      if v_limit is not null then
        select coalesce(sum(u.sent), 0) into v_used from public.message_usage u
         where u.tenant_id = public.current_tenant() and u.channel = ch and u.source = 'platform'
           and u.month = date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
        v_used := v_used + (select count(*) from public.notification_outbox o
                             where o.tenant_id = public.current_tenant() and o.channel = ch and o.status in ('pending', 'sending'));
        continue when v_used >= v_limit;
      end if;
    end if;
    for k in select jsonb_object_keys(v_vars) loop
      v_body := replace(v_body, '{' || k || '}', coalesce(v_vars ->> k, ''));
      v_subj := replace(v_subj, '{' || k || '}', coalesce(v_vars ->> k, ''));
    end loop;
    insert into public.notification_outbox (event, channel, recipient, subject, body, vars, related_table, related_id, profile_id, template_id)
    values (p_event, ch, v_to, nullif(v_subj, ''), left(v_body, 4000), v_vars, p_related_table, p_related_id, p_profile, p_template);
    v_count := v_count + 1;
  end loop;
  return v_count;
exception when others then
  raise warning 'notify_enqueue_raw(%) failed: %', p_event, sqlerrm;
  return 0;
end $$;
revoke all on function public.notify_enqueue_raw(text, jsonb, text[], text, text, uuid, jsonb, text, uuid, uuid) from public, anon, authenticated;

-- Hospital events: switches from Settings → Notifications (catalog defaults for events the hospital never saved),
-- minus whatever the control panel switched off; wording from notify_resolve_template().
create or replace function public.notify_enqueue(p_event text, p_phone text, p_email text, p_vars jsonb, p_related_table text default null,
  p_related_id uuid default null, p_only text[] default null, p_profile uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n    jsonb := (public.tenant_setting('app') -> 'notifications');
  cat  jsonb := public.notify_catalog() -> p_event;
  pt   jsonb := public.platform_template(p_event);
  fl   jsonb;
  chs  text[];
begin
  if n is null or (cat is null and n -> 'events' -> p_event is null) then return 0; end if;
  if not coalesce((pt ->> 'enabled')::boolean, true) then return 0; end if;
  fl := coalesce(cat -> 'defaults', '{}'::jsonb) || coalesce(n -> 'events' -> p_event, '{}'::jsonb);
  select coalesce(array_agg(c), '{}') into chs from unnest(array['sms', 'whatsapp', 'email', 'push', 'inapp']) c
   where coalesce((fl ->> c)::boolean, false)
     and (cat is null or cat -> 'channels' ? c)
     and coalesce((pt -> 'channels' ->> c)::boolean, true)
     and (p_only is null or c = any (p_only));
  if cardinality(chs) = 0 then return 0; end if;
  return public.notify_enqueue_raw(p_event, public.notify_resolve_template(p_event, n -> 'templates' -> p_event) || '{"_resolved": true}'::jsonb,
    chs, p_phone, p_email, p_profile, p_vars, p_related_table, p_related_id, null);
end $$;
revoke all on function public.notify_enqueue(text, text, text, jsonb, text, uuid, text[], uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ 5. recipients
create or replace function public.notify_profile(p_event text, p_profile uuid, p_vars jsonb, p_related_table text default null, p_related_id uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_profile;
  if not found then return 0; end if;
  return public.notify_enqueue(p_event, p.phone, p.email,
    jsonb_build_object('name', split_part(coalesce(p.full_name, 'there'), ' ', 1)) || coalesce(p_vars, '{}'::jsonb), p_related_table, p_related_id, null, p.id);
end $$;

-- everyone in this hospital with one of these roles (reception falls back to the owner when there is no receptionist)
create or replace function public.notify_role(p_event text, p_roles text[], p_vars jsonb, p_related_table text default null, p_related_id uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare r record; v int := 0; v_roles text[] := p_roles;
begin
  if 'receptionist' = any (v_roles) and not exists (select 1 from public.profiles where tenant_id = public.current_tenant() and role = 'receptionist') then
    v_roles := v_roles || 'owner'::text;
  end if;
  for r in select id from public.profiles where tenant_id = public.current_tenant() and role::text = any (v_roles) order by created_at limit 50 loop
    v := v + public.notify_profile(p_event, r.id, p_vars, p_related_table, p_related_id);
  end loop;
  return v;
end $$;

-- a doctor: their account when linked (push / bell), otherwise the phone / e-mail on the doctor record
create or replace function public.notify_doctor(p_event text, p_doctor uuid, p_vars jsonb, p_related_table text default null, p_related_id uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare d public.doctors; p public.profiles;
begin
  select * into d from public.doctors where id = p_doctor;
  if not found then return 0; end if;
  if d.profile_id is not null then select * into p from public.profiles where id = d.profile_id; end if;
  return public.notify_enqueue(p_event, coalesce(p.phone, d.phone), coalesce(p.email, d.email),
    jsonb_build_object('name', d.full_name) || coalesce(p_vars, '{}'::jsonb), p_related_table, p_related_id, null, p.id);
end $$;

create or replace function public.notify_patient(p_event text, p_patient uuid, p_vars jsonb, p_related_table text default null, p_related_id uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare p public.patients;
begin
  select * into p from public.patients where id = p_patient;
  if not found or p.erased_at is not null then return 0; end if;
  return public.notify_enqueue(p_event, p.phone, p.email,
    jsonb_build_object('name', split_part(p.full_name, ' ', 1), 'patient', p.full_name, 'mrn', p.mrn) || coalesce(p_vars, '{}'::jsonb),
    p_related_table, p_related_id, null, p.profile_id);
end $$;

-- the hospital's app address (custom domain → website address → the platform address with ?hospital=)
create or replace function public.notify_tenant_url(p_tenant uuid, p_path text default '/')
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'https://' || d.domain || p_path from public.tenant_domains d where d.tenant_id = p_tenant and d.verified_at is not null
      order by d.is_primary desc, d.created_at limit 1),
    nullif(rtrim(coalesce((select c.data ->> 'siteUrl' from public.site_content c where c.tenant_id = p_tenant and c.key = 'settings'), ''), '/'), '') || p_path,
    nullif(rtrim(coalesce(public.signup_config() ->> 'platformUrl', ''), '/'), '') || p_path || '?hospital=' || (select slug from public.tenants where id = p_tenant),
    p_path)
$$;

-- a platform message to a hospital's owner(s), in that hospital's context (its channels / wording)
create or replace function public.notify_owner_platform(p_tenant uuid, p_event text, p_vars jsonb, p_related_table text default null, p_related_id uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  cat   jsonb := public.notify_catalog() -> p_event;
  prev  text := current_setting('app.tenant_id', true);
  o     record;
  v     int := 0;
  chs   text[];
  hname text;
begin
  if cat is null then return 0; end if;
  chs := array(select key from jsonb_each_text(coalesce(cat -> 'defaults', '{}'::jsonb)) where value = 'true');
  perform set_config('app.tenant_id', p_tenant::text, true);
  select coalesce(nullif(c.data ->> 'name', ''), t.name) into hname
    from public.tenants t left join public.site_content c on c.tenant_id = t.id and c.key = 'settings' where t.id = p_tenant;
  for o in select p.id, p.full_name, p.email, p.phone from public.profiles p where p.tenant_id = p_tenant and p.role = 'owner' order by p.created_at limit 5 loop
    v := v + public.notify_enqueue_raw(p_event, coalesce(cat -> 'copy', '{}'::jsonb), chs, o.phone, o.email, o.id,
      jsonb_build_object('name', split_part(coalesce(o.full_name, 'there'), ' ', 1), 'hospital', hname) || coalesce(p_vars, '{}'::jsonb), p_related_table, p_related_id, null);
  end loop;
  if v = 0 and not exists (select 1 from public.profiles where tenant_id = p_tenant and role = 'owner') then
    v := public.notify_enqueue_raw(p_event, coalesce(cat -> 'copy', '{}'::jsonb), array(select c from unnest(chs) c where c = 'email'), null,
      (select s.data ->> 'owner_email' from public.app_settings s where s.tenant_id = p_tenant and s.key = 'bootstrap'), null,
      jsonb_build_object('name', 'there', 'hospital', hname) || coalesce(p_vars, '{}'::jsonb), p_related_table, p_related_id, null);
  end if;
  perform set_config('app.tenant_id', coalesce(prev, ''), true);
  return v;
exception when others then
  perform set_config('app.tenant_id', coalesce(prev, ''), true);
  raise warning 'notify_owner_platform(%): %', p_event, sqlerrm;
  return 0;
end $$;

-- run something at most once (per hospital + key): daily jobs, monthly warnings
create table if not exists public.notify_once (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  key         text not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);
alter table public.notify_once enable row level security;
revoke all on public.notify_once from anon, authenticated;
grant all on public.notify_once to service_role;
create or replace function public.notify_claim(p_tenant uuid, p_key text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v int;
begin
  insert into public.notify_once (tenant_id, key) values (p_tenant, left(p_key, 200)) on conflict do nothing;
  get diagnostics v = row_count;
  return v = 1;
end $$;

-- ------------------------------------------------------------------ 6. hospital triggers
create or replace function public.notify_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.patients;
  d public.doctors;
  v_event text;
  v_vars jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into p from public.patients where id = new.patient_id;
  select * into d from public.doctors where id = new.doctor_id;
  v_vars := jsonb_build_object('doctor', d.full_name, 'patient', p.full_name,
    'date', to_char(new.appointment_date, 'Dy, DD Mon YYYY'), 'time', public.fmt_appt_time(new.appointment_time),
    'ref', coalesce(new.booking_ref, upper(left(new.id::text, 8))), 'type', replace(new.type, '_', ' '), 'source', new.source,
    'link', nullif(public.site_url(), '') || '/book');
  if tg_op = 'INSERT' then
    if new.status = 'cancelled' or new.appointment_date < v_today then return new; end if;
    perform public.notify_patient('appointment_booked', new.patient_id, v_vars, 'appointments', new.id);
    perform public.notify_doctor('doctor_new_appointment', new.doctor_id, v_vars - 'link', 'appointments', new.id);
    if new.source in ('website', 'portal', 'whatsapp') then
      perform public.notify_role('online_booking_alert', array['receptionist'], v_vars - 'link', 'appointments', new.id);
    end if;
    return new;
  end if;
  v_event := case
    when new.status = 'cancelled' and old.status is distinct from 'cancelled' then 'appointment_cancelled'
    when new.status <> 'cancelled' and (new.appointment_date, new.appointment_time) is distinct from (old.appointment_date, old.appointment_time) then 'appointment_rescheduled'
    when new.status = 'confirmed' and old.status = 'scheduled' then 'appointment_confirmed'
    when new.status = 'checked_in' and old.status is distinct from 'checked_in' then 'appointment_checked_in'
    when new.status = 'no_show' and old.status is distinct from 'no_show' then 'appointment_no_show'
  end;
  if v_event is null then return new; end if;
  if new.appointment_date < v_today and v_event <> 'appointment_no_show' then return new; end if;   -- back-dated entry
  if v_event = 'appointment_no_show' and new.appointment_date < v_today - 2 then return new; end if;  -- tidying old records
  perform public.notify_patient(v_event, new.patient_id, v_vars, 'appointments', new.id);
  return new;
exception when others then
  raise warning 'notify_appointment: %', sqlerrm;
  return new;
end $$;

create or replace function public.notify_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv text;
begin
  select invoice_number into v_inv from public.invoices where id = new.invoice_id;
  perform public.notify_patient('payment_received', new.patient_id, jsonb_build_object('invoice', coalesce(v_inv, ''),
    'amount', '₹' || trim(to_char(new.amount, 'FM99,99,99,990.00')), 'method', initcap(replace(new.method, '_', ' '))), 'payments', new.id);
  return new;
exception when others then
  raise warning 'notify_payment: %', sqlerrm;
  return new;
end $$;

create or replace function public.notify_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('unpaid', 'partial', 'overdue') then return new; end if;
  perform public.notify_patient('invoice_created', new.patient_id, jsonb_build_object('invoice', new.invoice_number,
    'amount', '₹' || trim(to_char(new.total, 'FM99,99,99,990.00')), 'due_date', coalesce(to_char(new.due_date, 'DD Mon YYYY'), 'on receipt'),
    'link', nullif(public.site_url(), '') || '/portal'), 'invoices', new.id);
  return new;
exception when others then
  raise warning 'notify_invoice: %', sqlerrm;
  return new;
end $$;

create or replace function public.notify_invoice_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and old.status <> 'draft' then
    perform public.notify_patient('invoice_cancelled', new.patient_id, jsonb_build_object('invoice', new.invoice_number,
      'amount', '₹' || trim(to_char(new.total, 'FM99,99,99,990.00'))), 'invoices', new.id);
  elsif new.status = 'partial' and new.amount_paid > old.amount_paid then
    perform public.notify_patient('invoice_balance_due', new.patient_id, jsonb_build_object('invoice', new.invoice_number,
      'paid', '₹' || trim(to_char(new.amount_paid, 'FM99,99,99,990.00')),
      'balance', '₹' || trim(to_char(new.total - new.amount_paid, 'FM99,99,99,990.00'))), 'invoices', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_invoice_change: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_invoices_notify_change on public.invoices;
create trigger trg_invoices_notify_change after update of status, amount_paid on public.invoices
  for each row execute function public.notify_invoice_change();

create or replace function public.notify_lab()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_patient text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'requested' then
      perform public.notify_patient('lab_test_ordered', new.patient_id, jsonb_build_object('test', new.test_name, 'priority', new.priority), 'lab_tests', new.id);
    end if;
    return new;
  end if;
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  perform public.notify_patient('lab_report_ready', new.patient_id, jsonb_build_object('test', new.test_name,
    'link', nullif(public.site_url(), '') || '/portal'), 'lab_tests', new.id);
  if new.doctor_id is not null then
    select full_name into v_patient from public.patients where id = new.patient_id;
    perform public.notify_doctor('lab_result_doctor', new.doctor_id, jsonb_build_object('patient', v_patient, 'test', new.test_name,
      'priority', initcap(new.priority)), 'lab_tests', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_lab: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_lab_tests_notify_insert on public.lab_tests;
create trigger trg_lab_tests_notify_insert after insert on public.lab_tests
  for each row execute function public.notify_lab();

create or replace function public.notify_patient_registered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- self sign-ups already get "Account created"
  if new.profile_id is not null then return new; end if;
  perform public.notify_patient('patient_registered', new.id, jsonb_build_object('link', nullif(public.site_url(), '') || '/portal'), 'patients', new.id);
  return new;
exception when others then
  raise warning 'notify_patient_registered: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_patients_notify on public.patients;
create trigger trg_patients_notify after insert on public.patients
  for each row execute function public.notify_patient_registered();

create or replace function public.notify_admission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ward text; v_bed text; v_doc text; v_patient text; v_vars jsonb;
begin
  select w.name, b.bed_number into v_ward, v_bed from public.beds b join public.wards w on w.id = b.ward_id where b.id = new.bed_id;
  select full_name into v_doc from public.doctors where id = new.doctor_id;
  select full_name into v_patient from public.patients where id = new.patient_id;
  v_vars := jsonb_build_object('ward', coalesce(v_ward, '—'), 'bed', coalesce(v_bed, '—'), 'doctor', coalesce(v_doc, 'the duty doctor'),
    'patient', v_patient, 'reason', coalesce(nullif(new.reason, ''), '—'), 'date', to_char(coalesce(new.discharge_date, new.admission_date), 'DD Mon YYYY'),
    'link', nullif(public.site_url(), '') || '/portal');
  if tg_op = 'INSERT' then
    if new.status <> 'admitted' then return new; end if;
    perform public.notify_patient('admission_created', new.patient_id, v_vars, 'admissions', new.id);
    if new.doctor_id is not null then perform public.notify_doctor('doctor_new_admission', new.doctor_id, v_vars - 'date' - 'link', 'admissions', new.id); end if;
  elsif new.status = 'discharged' and old.status = 'admitted' then
    perform public.notify_patient('patient_discharged', new.patient_id, v_vars, 'admissions', new.id);
  elsif new.status = 'admitted' and new.bed_id is distinct from old.bed_id and new.bed_id is not null then
    perform public.notify_patient('bed_transferred', new.patient_id, v_vars, 'admissions', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_admission: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_admissions_notify on public.admissions;
create trigger trg_admissions_notify after insert or update of status, bed_id on public.admissions
  for each row execute function public.notify_admission();

create or replace function public.notify_prescription()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc text;
begin
  select full_name into v_doc from public.doctors where id = new.doctor_id;
  perform public.notify_patient('prescription_issued', new.patient_id, jsonb_build_object('doctor', v_doc, 'diagnosis', new.diagnosis,
    'follow_up', coalesce(to_char(new.follow_up_date, 'DD Mon YYYY'), 'as needed'), 'link', nullif(public.site_url(), '') || '/portal'), 'prescriptions', new.id);
  return new;
exception when others then
  raise warning 'notify_prescription: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_prescriptions_notify on public.prescriptions;
create trigger trg_prescriptions_notify after insert on public.prescriptions
  for each row execute function public.notify_prescription();

-- leave: owners hear about requests; the doctor hears the answer; booked patients hear that the doctor is away
create or replace function public.notify_leave()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc text; v_vars jsonb; a record;
begin
  select full_name into v_doc from public.doctors where id = new.doctor_id;
  v_vars := jsonb_build_object('doctor', v_doc, 'kind', replace(new.kind, '_', ' '), 'from', to_char(new.start_date, 'DD Mon YYYY'),
    'to', to_char(new.end_date, 'DD Mon YYYY') || coalesce(' (' || new.start_time || '–' || new.end_time || ')', ''),
    'reason', coalesce(nullif(new.reason, ''), '—'), 'link', nullif(public.site_url(), '') || '/doctors');
  if tg_op = 'INSERT' then
    if new.status = 'pending' then perform public.notify_role('leave_requested', array['owner'], v_vars, 'doctor_leaves', new.id); end if;
    if new.status <> 'approved' then return new; end if;
  else
    if new.status is not distinct from old.status then return new; end if;
    if new.status = 'rejected' then perform public.notify_doctor('leave_rejected', new.doctor_id, v_vars - 'doctor', 'doctor_leaves', new.id); end if;
    if new.status <> 'approved' then return new; end if;
    perform public.notify_doctor('leave_approved', new.doctor_id, v_vars - 'doctor', 'doctor_leaves', new.id);
  end if;
  -- approved (now, or entered as approved): every patient booked in that time
  begin
    for a in select ap.* from public.appointments ap
              where ap.doctor_id = new.doctor_id and ap.status in ('scheduled', 'confirmed')
                and ap.appointment_date between greatest(new.start_date, (now() at time zone 'Asia/Kolkata')::date) and new.end_date
                and (new.start_time is null or ap.appointment_time >= new.start_time and ap.appointment_time < new.end_time)
              order by ap.appointment_date, ap.appointment_time limit 200 loop
      perform public.notify_patient('doctor_unavailable', a.patient_id, jsonb_build_object('doctor', v_doc,
        'date', to_char(a.appointment_date, 'Dy, DD Mon YYYY'), 'time', public.fmt_appt_time(a.appointment_time),
        'ref', coalesce(a.booking_ref, upper(left(a.id::text, 8)))), 'appointments', a.id);
    end loop;
  end;
  return new;
exception when others then
  raise warning 'notify_leave: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_doctor_leaves_notify on public.doctor_leaves;
create trigger trg_doctor_leaves_notify after insert or update of status on public.doctor_leaves
  for each row execute function public.notify_leave();

create or replace function public.notify_invite_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    perform public.notify_role('staff_joined', array['owner'], jsonb_build_object('member', new.full_name, 'role', public.role_label(new.role::text),
      'link', nullif(public.site_url(), '') || '/settings?tab=users'), 'staff_invites', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_invite_accepted: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_staff_invites_notify on public.staff_invites;
create trigger trg_staff_invites_notify after update of status on public.staff_invites
  for each row execute function public.notify_invite_accepted();

create or replace function public.notify_privacy_resolved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('done', 'rejected') and old.status = 'open' and new.profile_id is not null then
    perform public.notify_profile('privacy_request_resolved', new.profile_id, jsonb_build_object('kind', new.kind,
      'status', case new.status when 'done' then 'completed' else 'declined' end, 'resolution', coalesce(new.resolution, '')), 'privacy_requests', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_privacy_resolved: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_privacy_requests_notify on public.privacy_requests;
create trigger trg_privacy_requests_notify after update of status on public.privacy_requests
  for each row execute function public.notify_privacy_resolved();

-- ------------------------------------------------------------------ 7. new-device sign-in
create table if not exists public.known_devices (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  device_hash  text not null,
  tenant_id    uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  label        text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (profile_id, device_hash)
);
alter table public.known_devices enable row level security;
revoke all on public.known_devices from anon, authenticated;
grant all on public.known_devices to service_role;

-- called by the app after a sign-in with a random id kept in the browser; true = a device not seen before
create or replace function public.note_sign_in(p_device text, p_label text default null)
returns boolean language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_hash text; v_had boolean; v_new int;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if char_length(coalesce(p_device, '')) < 16 then raise exception 'Invalid device id'; end if;
  v_hash := encode(extensions.digest('dch-device:' || p_device, 'sha256'), 'hex');
  v_had := exists (select 1 from public.known_devices where profile_id = auth.uid());
  insert into public.known_devices (profile_id, device_hash, label) values (auth.uid(), v_hash, left(nullif(trim(coalesce(p_label, '')), ''), 120))
  on conflict (profile_id, device_hash) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    update public.known_devices set last_seen = now() where profile_id = auth.uid() and device_hash = v_hash;
    return false;
  end if;
  delete from public.known_devices where profile_id = auth.uid() and device_hash not in
    (select device_hash from public.known_devices where profile_id = auth.uid() order by last_seen desc limit 20);
  -- the very first device is the sign-up itself, not news
  if v_had then
    perform public.notify_profile('new_device_signin', auth.uid(), jsonb_build_object('device', coalesce(nullif(trim(coalesce(p_label, '')), ''), 'a new device'),
      'time', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), 'link', nullif(public.site_url(), '') || '/profile'), 'profiles', auth.uid());
  end if;
  return v_had;
end $$;

-- ------------------------------------------------------------------ 8. platform → hospital owner, and team alerts
create or replace function public.notify_tenant_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_demo or new.is_primary then return new; end if;
  if new.status = 'suspended' and old.status is distinct from 'suspended' then
    perform public.notify_owner_platform(new.id, 'tenant_suspended', jsonb_build_object('support',
      coalesce(nullif(public.billing_config() -> 'seller' ->> 'email', ''), 'our support team')), 'tenants', new.id);
    perform public.raise_platform_alert_safe('tenant_status', new.name || ' suspended', 'Status changed from ' || old.status || ' to suspended.', '/hospitals/' || new.id);
  elsif old.status = 'suspended' and new.status <> 'suspended' then
    perform public.notify_owner_platform(new.id, 'tenant_reactivated', jsonb_build_object('link', public.notify_tenant_url(new.id, '/login')), 'tenants', new.id);
    perform public.raise_platform_alert_safe('tenant_status', new.name || ' restored', 'Status changed from suspended to ' || new.status || '.', '/hospitals/' || new.id);
  end if;
  if new.plan is distinct from old.plan then
    perform public.notify_owner_platform(new.id, 'plan_changed', jsonb_build_object('plan', initcap(new.plan), 'old_plan', initcap(old.plan),
      'link', public.notify_tenant_url(new.id, '/settings?tab=billing')), 'tenants', new.id);
  end if;
  if new.trial_ends_at is not null and old.trial_ends_at is not null and new.trial_ends_at > old.trial_ends_at + interval '1 hour' then
    perform public.notify_owner_platform(new.id, 'trial_extended', jsonb_build_object('date', to_char(new.trial_ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')), 'tenants', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_tenant_change: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_tenants_notify on public.tenants;
create trigger trg_tenants_notify after update of status, plan, trial_ends_at on public.tenants
  for each row execute function public.notify_tenant_change();

create or replace function public.notify_billing_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_what text; v_until timestamptz;
begin
  if new.status not in ('paid', 'failed') then return new; end if;
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
  end if;
  v_what := case when new.kind = 'wallet' then 'a message wallet top-up'
                 else 'the ' || initcap(coalesce(new.plan, 'current')) || ' plan' || coalesce(' (' || new.months || case when new.months = 1 then ' month)' else ' months)' end, '') end;
  if new.status = 'paid' then
    select paid_until into v_until from public.tenants where id = new.tenant_id;
    perform public.notify_owner_platform(new.tenant_id, 'subscription_payment_success', jsonb_build_object(
      'amount', '₹' || trim(to_char(new.total_paise / 100.0, 'FM99,99,99,990.00')), 'what', v_what, 'invoice_no', coalesce(new.invoice_no, '—'),
      'until', case when new.kind = 'plan' and v_until is not null then 'Your plan now runs until ' || to_char(v_until at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.' else '' end,
      'link', public.notify_tenant_url(new.tenant_id, '/settings?tab=billing')), 'billing_payments', new.id);
  else
    perform public.notify_owner_platform(new.tenant_id, 'subscription_payment_failed', jsonb_build_object(
      'amount', '₹' || trim(to_char(new.total_paise / 100.0, 'FM99,99,99,990.00')), 'what', v_what,
      'link', public.notify_tenant_url(new.tenant_id, '/settings?tab=billing')), 'billing_payments', new.id);
  end if;
  return new;
exception when others then
  raise warning 'notify_billing_payment: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_billing_payments_notify on public.billing_payments;
create trigger trg_billing_payments_notify after insert or update of status on public.billing_payments
  for each row execute function public.notify_billing_payment();

create or replace function public.notify_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from public.tenants where id = new.tenant_id;
  if tg_op = 'INSERT' then
    perform public.raise_platform_alert_safe('domain_added', new.domain || ' added', v_name || ' connected a custom domain (' || new.method || ').', '/hospitals/' || new.tenant_id);
  elsif new.verified_at is not null and old.verified_at is null then
    perform public.notify_owner_platform(new.tenant_id, 'domain_verified', jsonb_build_object('domain', new.domain), 'tenant_domains', null);
  end if;
  return new;
exception when others then
  raise warning 'notify_domain: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_tenant_domains_notify on public.tenant_domains;
create trigger trg_tenant_domains_notify after insert or update of verified_at on public.tenant_domains
  for each row execute function public.notify_domain();

create or replace function public.notify_impersonation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.raise_platform_alert_safe('impersonation', coalesce(new.admin_name, 'A team member') || ' signed in as ' || coalesce(new.target_email, 'a user'),
    'Hospital: ' || coalesce((select name from public.tenants where id = new.hospital_id), '?') || ' · role ' || coalesce(new.target_role, '?') || ' · reason: ' || new.reason,
    '/audit');
  return new;
exception when others then
  raise warning 'notify_impersonation: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_impersonations_notify on public.impersonations;
create trigger trg_impersonations_notify after insert on public.impersonations
  for each row execute function public.notify_impersonation();

-- ------------------------------------------------------------------ 9. daily jobs (from notify_cron_flush, every minute)
-- doctors' day lists + follow-up reminders (07:30 IST)
create or replace function public.notify_morning_jobs()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_t uuid; d record; r record; v int := 0;
begin
  for v_t in select id from public.tenants where status <> 'suspended' order by created_at loop
    perform set_config('app.tenant_id', v_t::text, true);
    if public.notify_event_on('doctor_daily_schedule') then
      for d in select a.doctor_id, count(*) as n, min(a.appointment_time) as first_t,
                      string_agg(public.fmt_appt_time(a.appointment_time) || ' — ' || p.full_name, E'\n' order by a.appointment_time) as list
                 from public.appointments a join public.patients p on p.id = a.patient_id
                where a.tenant_id = v_t and a.appointment_date = v_today and a.status in ('scheduled', 'confirmed', 'checked_in')
                group by a.doctor_id loop
        v := v + public.notify_doctor('doctor_daily_schedule', d.doctor_id, jsonb_build_object('date', to_char(v_today, 'Dy, DD Mon YYYY'),
          'count', d.n, 'first_time', public.fmt_appt_time(d.first_t), 'list', left(d.list, 1500)), 'doctors', d.doctor_id);
      end loop;
    end if;
    if public.notify_event_on('followup_reminder') then
      for r in select rx.id, rx.patient_id, rx.doctor_id, rx.follow_up_date, dr.full_name as doc from public.prescriptions rx
                 join public.doctors dr on dr.id = rx.doctor_id
                where rx.tenant_id = v_t and rx.follow_up_date = v_today + 1
                  and not exists (select 1 from public.appointments a where a.patient_id = rx.patient_id and a.doctor_id = rx.doctor_id
                                    and a.appointment_date = rx.follow_up_date and a.status <> 'cancelled')
                limit 500 loop
        v := v + public.notify_patient('followup_reminder', r.patient_id, jsonb_build_object('doctor', r.doc,
          'date', to_char(r.follow_up_date, 'Dy, DD Mon YYYY'), 'link', nullif(public.site_url(), '') || '/book'), 'prescriptions', r.id);
      end loop;
    end if;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return v;
end $$;

-- birthdays, overdue bills, wallet / monthly-limit warnings (10:00 IST)
create or replace function public.notify_midday_jobs()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  t record; r record; v int := 0; ch text; v_lim int; v_used bigint;
  v_low bigint := coalesce((public.ops_config() #>> '{thresholds,walletLowPaise}')::bigint, 20000);
begin
  for t in select * from public.tenants where status <> 'suspended' order by created_at loop
    perform set_config('app.tenant_id', t.id::text, true);
    if public.notify_event_on('patient_birthday') then
      for r in select id from public.patients where tenant_id = t.id and erased_at is null and not marketing_opt_out
                 and date_of_birth is not null and extract(month from date_of_birth) = extract(month from v_today)
                 and extract(day from date_of_birth) = extract(day from v_today) limit 500 loop
        v := v + public.notify_patient('patient_birthday', r.id, '{}'::jsonb, 'patients', r.id);
      end loop;
    end if;
    if public.notify_event_on('invoice_overdue') then
      for r in select i.* from public.invoices i where i.tenant_id = t.id and i.status in ('unpaid', 'partial', 'overdue')
                 and i.due_date in (v_today - 1, v_today - 7) and i.total - i.amount_paid > 0 limit 500 loop
        continue when not public.notify_claim(t.id, 'overdue:' || r.id || ':' || (v_today - r.due_date));
        v := v + public.notify_patient('invoice_overdue', r.patient_id, jsonb_build_object('invoice', r.invoice_number,
          'balance', '₹' || trim(to_char(r.total - r.amount_paid, 'FM99,99,99,990.00')), 'due_date', to_char(r.due_date, 'DD Mon YYYY'),
          'days', v_today - r.due_date), 'invoices', r.id);
      end loop;
    end if;
    continue when t.is_primary or t.is_demo;
    -- the shared-account wallet (at most once a week)
    if t.wallet_paise is not null and t.wallet_paise < v_low
       and public.notify_claim(t.id, 'wallet:' || to_char(v_today, 'IYYY-IW')) then
      v := v + public.notify_owner_platform(t.id, 'wallet_low_owner', jsonb_build_object('balance', '₹' || trim(to_char(t.wallet_paise / 100.0, 'FM99,99,99,990.00')),
        'link', public.notify_tenant_url(t.id, '/settings?tab=billing')), 'tenants', t.id);
    end if;
    -- 80% of a monthly allowance on the shared accounts (once a month per channel)
    foreach ch in array array['sms', 'whatsapp', 'email'] loop
      v_lim := nullif(t.billing -> 'monthlyLimit' ->> ch, '')::int;
      continue when v_lim is null or v_lim <= 0;
      select coalesce(sum(u.sent), 0) into v_used from public.message_usage u where u.tenant_id = t.id and u.channel = ch and u.source = 'platform' and u.month = v_month;
      continue when v_used < v_lim * 0.8 or not public.notify_claim(t.id, 'quota:' || to_char(v_month, 'YYYY-MM') || ':' || ch);
      v := v + public.notify_owner_platform(t.id, 'message_quota_warning', jsonb_build_object('channel', case ch when 'sms' then 'SMS' when 'whatsapp' then 'WhatsApp' else 'e-mail' end,
        'used', v_used, 'limit', v_lim, 'link', public.notify_tenant_url(t.id, '/settings?tab=billing')), 'tenants', t.id);
    end loop;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return v;
end $$;

-- the owner's evening summary (20:30 IST); quiet days are skipped
create or replace function public.notify_owner_digests()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_t uuid; s record; v int := 0;
begin
  for v_t in select id from public.tenants where status <> 'suspended' and not is_demo order by created_at loop
    perform set_config('app.tenant_id', v_t::text, true);
    continue when not public.notify_event_on('owner_daily_digest');
    select (select count(*) from public.appointments where tenant_id = v_t and appointment_date = v_today) as appts,
           (select count(*) from public.appointments where tenant_id = v_t and appointment_date = v_today and status = 'completed') as done,
           (select count(*) from public.appointments where tenant_id = v_t and appointment_date = v_today and status = 'cancelled') as cancelled,
           (select count(*) from public.appointments where tenant_id = v_t and appointment_date = v_today and status = 'no_show') as no_show,
           (select count(*) from public.patients where tenant_id = v_t and (created_at at time zone 'Asia/Kolkata')::date = v_today) as new_patients,
           (select count(*) from public.admissions where tenant_id = v_t and admission_date = v_today) as adm,
           (select count(*) from public.admissions where tenant_id = v_t and discharge_date = v_today) as dis,
           (select coalesce(sum(amount), 0) from public.payments where tenant_id = v_t and paid_on = v_today) as collected,
           (select coalesce(sum(total - amount_paid), 0) from public.invoices where tenant_id = v_t and status in ('unpaid', 'partial', 'overdue')) as outstanding
      into s;
    continue when s.appts = 0 and s.new_patients = 0 and s.collected = 0 and s.adm = 0 and s.dis = 0;
    v := v + public.notify_role('owner_daily_digest', array['owner'], jsonb_build_object('date', to_char(v_today, 'Dy, DD Mon YYYY'),
      'appointments', s.appts, 'completed', s.done, 'cancelled', s.cancelled, 'no_show', s.no_show, 'new_patients', s.new_patients,
      'admissions', s.adm, 'discharges', s.dis, 'collected', '₹' || trim(to_char(s.collected, 'FM99,99,99,990')),
      'outstanding', '₹' || trim(to_char(s.outstanding, 'FM99,99,99,990')), 'link', nullif(public.site_url(), '') || '/dashboard'));
  end loop;
  perform set_config('app.tenant_id', '', true);
  return v;
end $$;

-- the platform team's morning summary (08:30 IST): the last 24 hours
create or replace function public.notify_platform_digest()
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_body text;
begin
  v_body := 'Hospitals: ' || (select count(*) from public.tenants where not is_primary and not is_demo and status <> 'suspended') || ' live, '
    || (select count(*) from public.tenants where not is_primary and created_at > v_since) || ' new'
    || E'\nSign-ups: ' || (select count(*) from public.platform_signups where created_at > v_since)
    || ' · Call-back requests: ' || (select count(*) from public.platform_leads where created_at > v_since)
    || E'\nPayments: ₹' || trim(to_char(coalesce((select sum(total_paise) from public.billing_payments where status = 'paid' and paid_at > v_since), 0) / 100.0, 'FM99,99,99,990'))
    || ' from ' || (select count(*) from public.billing_payments where status = 'paid' and paid_at > v_since) || ' payment(s)'
    || ', ' || (select count(*) from public.billing_payments where status = 'failed' and created_at > v_since) || ' failed'
    || E'\nMessages: ' || (select count(*) from public.notification_outbox where status = 'sent' and created_at > v_since) || ' sent, '
    || (select count(*) from public.notification_outbox where status = 'failed' and created_at > v_since) || ' failed'
    || E'\nTrials ending in 3 days: ' || (select count(*) from public.tenants where not is_primary and status = 'trial' and trial_ends_at between now() and now() + interval '3 days')
    || E'\nHealth: ' || coalesce((select string_agg(label || ' ' || status, ', ') from public.platform_health_state where status in ('fail', 'warn')), 'all checks passing');
  return public.raise_platform_alert('platform_digest', 'Daily summary — ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY'), v_body, '/',
    'digest:' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 1440);
end $$;

-- the server monitor stopped reporting → "Server monitor is down" (record_health raises the alert)
create or replace function public.server_watchdog()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_last timestamptz; v_stale int := coalesce((public.ops_config() #>> '{thresholds,serverStaleMin}')::int, 15);
begin
  select last_at into v_last from public.platform_heartbeats where key = 'server_monitor';
  if v_last is null or v_last > now() - make_interval(mins => v_stale) then return; end if;
  if exists (select 1 from public.platform_health_state where service = 'server:agent' and status = 'fail') then return; end if;
  perform public.record_health(jsonb_build_array(jsonb_build_object('service', 'server:agent', 'label', 'Server monitor', 'group', 'Server', 'status', 'fail',
    'detail', 'No report from the server for ' || round(extract(epoch from now() - v_last) / 60) || ' minutes — the server may be down or the monitor stopped.')));
end $$;

-- every minute; each slot runs once a day, the first tick after its time (India time)
create or replace function public.notify_daily_tick()
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_now  timestamp := now() at time zone 'Asia/Kolkata';
  v_mins int := extract(hour from v_now)::int * 60 + extract(minute from v_now)::int;
  s      record;
  v_last timestamptz;
begin
  for s in select * from (values ('notify_morning', 450), ('notify_platform_digest', 510), ('notify_midday', 600), ('notify_owner_digest', 1230)) x(key, at_min) loop
    continue when v_mins < s.at_min;
    select last_at into v_last from public.platform_heartbeats where key = s.key;
    continue when v_last is not null and (v_last at time zone 'Asia/Kolkata')::date >= v_now::date;
    perform public.note_heartbeat(s.key, null);   -- first: a failing job must not retry every minute
    begin
      case s.key
        when 'notify_morning' then perform public.notify_morning_jobs();
        when 'notify_platform_digest' then perform public.notify_platform_digest();
        when 'notify_midday' then perform public.notify_midday_jobs();
        when 'notify_owner_digest' then perform public.notify_owner_digests();
      end case;
    exception when others then
      raise warning 'notify_daily_tick %: %', s.key, sqlerrm;
    end;
  end loop;
  perform public.server_watchdog();
  -- the bell keeps 90 days
  if extract(minute from v_now) = 17 and extract(hour from v_now) = 3 then
    delete from public.user_notifications where created_at < now() - interval '90 days';
  end if;
exception when others then
  raise warning 'notify_daily_tick: %', sqlerrm;
end $$;

-- ------------------------------------------------------------------ 10. server monitor (scripts/server/hc-monitor.sh → ops function)
-- p = {host, cpu, load1, cores, ram, disk, disks: [{mount, pct}], containers: {total, running, down: [names]}, ssl: [{domain, days}], uptime}
create or replace function public.record_server_metrics(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  th    jsonb := public.ops_config() -> 'thresholds';
  host  text := left(coalesce(nullif(p ->> 'host', ''), 'server'), 60);
  res   jsonb := '[]'::jsonb;
  v_cpu numeric := nullif(p ->> 'cpu', '')::numeric;
  v_ram numeric := nullif(p ->> 'ram', '')::numeric;
  v_dsk numeric := nullif(p ->> 'disk', '')::numeric;
  v_down jsonb := coalesce(p -> 'containers' -> 'down', '[]'::jsonb);
  s     jsonb;
  st    text;
  lvl   numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Expected a JSON object'; end if;
  if v_cpu is not null then
    lvl := coalesce((th ->> 'cpuPct')::numeric, 85);
    res := res || jsonb_build_object('service', 'server:cpu', 'label', 'Server CPU', 'group', 'Server',
      'status', case when v_cpu >= 97 then 'fail' when v_cpu >= lvl then 'warn' else 'ok' end,
      'detail', host || ': CPU ' || round(v_cpu) || '%' || coalesce(' · load ' || (p ->> 'load1') || coalesce(' on ' || (p ->> 'cores') || ' cores', ''), '')
        || ' (alert at ' || lvl || '%)');
  end if;
  if v_ram is not null then
    lvl := coalesce((th ->> 'ramPct')::numeric, 90);
    res := res || jsonb_build_object('service', 'server:ram', 'label', 'Server memory', 'group', 'Server',
      'status', case when v_ram >= 98 then 'fail' when v_ram >= lvl then 'warn' else 'ok' end,
      'detail', host || ': RAM ' || round(v_ram) || '% used (alert at ' || lvl || '%)');
  end if;
  if v_dsk is not null then
    lvl := coalesce((th ->> 'diskPct')::numeric, 85);
    res := res || jsonb_build_object('service', 'server:disk', 'label', 'Server disk', 'group', 'Server',
      'status', case when v_dsk >= 95 then 'fail' when v_dsk >= lvl then 'warn' else 'ok' end,
      'detail', host || ': disk ' || round(v_dsk) || '% full' || coalesce(' (' || (select string_agg((d ->> 'mount') || ' ' || (d ->> 'pct') || '%', ', ')
          from jsonb_array_elements(case when jsonb_typeof(p -> 'disks') = 'array' then p -> 'disks' else '[]'::jsonb end) d) || ')', '') || ' · alert at ' || lvl || '%');
  end if;
  if p ? 'containers' then
    res := res || jsonb_build_object('service', 'server:containers', 'label', 'Server containers', 'group', 'Server',
      'status', case when jsonb_typeof(v_down) = 'array' and jsonb_array_length(v_down) > 0 then 'warn' else 'ok' end,
      'detail', coalesce(p -> 'containers' ->> 'running', '?') || ' of ' || coalesce(p -> 'containers' ->> 'total', '?') || ' running'
        || case when jsonb_typeof(v_down) = 'array' and jsonb_array_length(v_down) > 0
                then ' · stopped / unhealthy: ' || (select string_agg(x, ', ') from (select jsonb_array_elements_text(v_down) x limit 8) q) else '' end);
  end if;
  for s in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'ssl') = 'array' then p -> 'ssl' else '[]'::jsonb end) limit 20 loop
    continue when coalesce(s ->> 'domain', '') !~ '^[a-z0-9.*-]+$';
    st := case when (s ->> 'days')::int <= 0 then 'fail' when (s ->> 'days')::int < coalesce((th ->> 'sslDays')::int, 14) then 'warn' else 'ok' end;
    res := res || jsonb_build_object('service', left('server:ssl:' || (s ->> 'domain'), 60), 'label', 'SSL ' || (s ->> 'domain'), 'group', 'Server', 'status', st,
      'detail', 'Certificate expires in ' || (s ->> 'days') || ' days');
  end loop;
  res := res || jsonb_build_object('service', 'server:agent', 'label', 'Server monitor', 'group', 'Server', 'status', 'ok',
    'detail', host || ' reporting' || coalesce(' · up ' || nullif(p ->> 'uptime', ''), ''));
  perform public.note_heartbeat('server_monitor', host);
  return public.record_health(res);
end $$;

-- ------------------------------------------------------------------ 11. control panel: the template manager
-- every template: catalog + saved edit (+ custom ones). admin / support read; admin writes.
create or replace function public.cp_templates()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'support']);
  return jsonb_build_object(
    'saved', coalesce((select jsonb_object_agg(t.key, to_jsonb(t) - 'updated_by' || jsonb_build_object('updated_by_name',
                (select a.email from auth.users a where a.id = t.updated_by)))
              from public.platform_templates t), '{}'::jsonb),
    -- how many hospitals reworded each event (their own wording wins unless the template is locked)
    'overrides', coalesce((select jsonb_object_agg(e.key, e.n) from (
        select k.key, count(*) as n from public.app_settings s, jsonb_each(coalesce(s.data -> 'notifications' -> 'templates', '{}'::jsonb)) k
         where s.key = 'app' and jsonb_typeof(k.value) = 'object'
           and (public.notify_catalog() -> k.key) is not null
           and ((nullif(k.value ->> 'text', '') is distinct from nullif(public.notify_catalog() -> k.key -> 'copy' ->> 'text', '') and coalesce(k.value ->> 'text', '') <> '')
             or (nullif(k.value ->> 'subject', '') is distinct from nullif(public.notify_catalog() -> k.key -> 'copy' ->> 'subject', '') and coalesce(k.value ->> 'subject', '') <> ''))
         group by k.key) e), '{}'::jsonb),
    'sent30', coalesce((select jsonb_object_agg(o.event, o.n) from (select event, count(*) as n from public.notification_outbox
              where created_at > now() - interval '30 days' and status = 'sent' group by event) o), '{}'::jsonb));
end $$;

create or replace function public.cp_save_template(p_key text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  cat  jsonb := public.notify_catalog() -> p_key;
  v_custom boolean;
  v_tpl jsonb := '{}'::jsonb;
  v_ch  jsonb := '{}'::jsonb;
  f text;
  k text;
  ids jsonb;
begin
  perform public.cp_require(array['admin']);
  if coalesce(p_key, '') !~ '^[a-z][a-z0-9_]{1,59}$' then raise exception 'Use lower-case letters, digits and _ for the key.'; end if;
  v_custom := cat is null;
  if v_custom and p_key !~ '^custom_' then raise exception 'Custom template keys start with custom_'; end if;
  if v_custom and coalesce(trim(p -> 'meta' ->> 'label'), '') = '' then raise exception 'Give the template a name.'; end if;
  foreach f in array array['subject', 'text', 'waText', 'pushText', 'waParams', 'waTemplate', 'waCategory', 'waStatus', 'smsTemplateId'] loop
    if coalesce(trim(p -> 'tpl' ->> f), '') <> '' then
      v_tpl := v_tpl || jsonb_build_object(f, left(p -> 'tpl' ->> f, case when f in ('text', 'waText') then 4000 else 300 end));
    end if;
  end loop;
  if v_tpl ->> 'waCategory' is not null and v_tpl ->> 'waCategory' not in ('UTILITY', 'AUTHENTICATION', 'MARKETING') then raise exception 'Unknown WhatsApp category'; end if;
  if v_tpl ->> 'waStatus' is not null and v_tpl ->> 'waStatus' not in ('draft', 'submitted', 'approved', 'rejected') then raise exception 'Unknown WhatsApp status'; end if;
  if v_custom and coalesce(v_tpl ->> 'text', '') = '' then raise exception 'Write the message text.'; end if;
  for k in select key from jsonb_each(coalesce(p -> 'channels', '{}'::jsonb)) loop
    continue when k not in ('sms', 'whatsapp', 'email', 'push', 'inapp');
    continue when jsonb_typeof(p -> 'channels' -> k) <> 'boolean';
    continue when not v_custom and not (cat -> 'channels' ? k);
    v_ch := v_ch || jsonb_build_object(k, (p -> 'channels' ->> k)::boolean);
  end loop;
  insert into public.platform_templates (key, enabled, locked, channels, tpl, custom, meta, updated_at, updated_by)
  values (p_key, coalesce((p ->> 'enabled')::boolean, true), coalesce((p ->> 'locked')::boolean, false), v_ch, v_tpl, v_custom,
          case when v_custom then jsonb_build_object('label', left(trim(p -> 'meta' ->> 'label'), 120), 'group', left(coalesce(p -> 'meta' ->> 'group', 'Custom'), 40),
                                                     'audience', left(coalesce(p -> 'meta' ->> 'audience', 'owner'), 20), 'hint', left(coalesce(p -> 'meta' ->> 'hint', ''), 300))
               else '{}'::jsonb end, now(), auth.uid())
  on conflict (key) do update set enabled = excluded.enabled, locked = excluded.locked, channels = excluded.channels, tpl = excluded.tpl,
    meta = excluded.meta, updated_at = now(), updated_by = auth.uid();
  -- the shared accounts read approved WhatsApp / DLT IDs from platform_settings 'messaging' (notify / ops functions)
  ids := jsonb_strip_nulls(jsonb_build_object('waTemplate', v_tpl ->> 'waTemplate', 'waParams', v_tpl ->> 'waParams', 'smsTemplateId', v_tpl ->> 'smsTemplateId'));
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('messaging', jsonb_build_object('templates', jsonb_build_object(p_key, ids)), now(), auth.uid())
  on conflict (key) do update set data = jsonb_set(coalesce(public.platform_settings.data, '{}'::jsonb), '{templates}',
    (coalesce(public.platform_settings.data -> 'templates', '{}'::jsonb) - p_key) || case when ids = '{}'::jsonb then '{}'::jsonb else jsonb_build_object(p_key, ids) end),
    updated_at = now(), updated_by = auth.uid();
  perform public.provider_log('template:save', p_key, jsonb_build_object('enabled', coalesce((p ->> 'enabled')::boolean, true), 'locked', coalesce((p ->> 'locked')::boolean, false), 'channels', v_ch));
  return public.platform_template(p_key);
end $$;

-- custom: deleted; built-in: back to the catalog default (switches, wording and IDs)
create or replace function public.cp_delete_template(p_key text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  delete from public.platform_templates where key = p_key;
  update public.platform_settings set data = jsonb_set(data, '{templates}', coalesce(data -> 'templates', '{}'::jsonb) - p_key), updated_at = now(), updated_by = auth.uid()
   where key = 'messaging';
  perform public.provider_log(case when public.notify_catalog() ? p_key then 'template:reset' else 'template:delete' end, p_key, '{}'::jsonb);
end $$;

-- what a hospital's Settings → Notifications needs to know: switched-off events / channels, locks, platform wording
create or replace function public.notify_platform_overrides()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.key, jsonb_build_object('enabled', t.enabled, 'locked', t.locked, 'channels', t.channels,
           'tpl', t.tpl - 'waTemplate' - 'waCategory' - 'waStatus' - 'smsTemplateId' - 'waParams')), '{}'::jsonb)
    from public.platform_templates t where not t.custom
$$;

-- ------------------------------------------------------------------ grants
revoke all on function public.notify_catalog(), public.platform_template(text), public.platform_brand(), public.notify_resolve_template(text, jsonb),
  public.notify_event_on(text), public.notify_profile(text, uuid, jsonb, text, uuid), public.notify_role(text, text[], jsonb, text, uuid),
  public.notify_doctor(text, uuid, jsonb, text, uuid), public.notify_patient(text, uuid, jsonb, text, uuid), public.notify_tenant_url(uuid, text),
  public.notify_owner_platform(uuid, text, jsonb, text, uuid), public.notify_claim(uuid, text), public.notify_morning_jobs(), public.notify_midday_jobs(),
  public.notify_owner_digests(), public.notify_platform_digest(), public.server_watchdog(), public.notify_daily_tick(), public.record_server_metrics(jsonb)
  from public, anon, authenticated;
grant execute on function public.notify_catalog() to authenticated;
grant execute on function public.record_server_metrics(jsonb) to service_role;
revoke all on function public.my_notifications(int, timestamptz), public.read_notifications(uuid[]), public.note_sign_in(text, text),
  public.cp_templates(), public.cp_save_template(text, jsonb), public.cp_delete_template(text), public.notify_platform_overrides() from public, anon;
grant execute on function public.my_notifications(int, timestamptz), public.read_notifications(uuid[]), public.note_sign_in(text, text),
  public.cp_templates(), public.cp_save_template(text, jsonb), public.cp_delete_template(text), public.notify_platform_overrides() to authenticated;

-- ------------------------------------------------------------------ hospital isolation for this module's tables
-- (tenancy.sql / integrity.sql add the same on their next run; here so a fresh install matches an upgraded one.
--  No licence guard: the bell, sign-in devices and daily bookkeeping keep working while a hospital is read-only.)
do $notify_rls$
declare t text;
begin
  foreach t in array array['user_notifications', 'notify_once', 'known_devices'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to anon, authenticated
                      using (tenant_id = (select public.current_tenant()))
                      with check (tenant_id = (select public.current_tenant()))', t);
    execute format('drop trigger if exists trg_keep_tenant on public.%I', t);
    execute format('create trigger trg_keep_tenant before update of tenant_id on public.%I for each row execute function public.keep_tenant()', t);
  end loop;
end $notify_rls$;
drop trigger if exists trg_zz_same_tenant on public.user_notifications;
create trigger trg_zz_same_tenant before insert or update on public.user_notifications
  for each row execute function public.enforce_same_tenant('profile_id', 'profiles');
drop trigger if exists trg_zz_same_tenant on public.known_devices;
create trigger trg_zz_same_tenant before insert or update on public.known_devices
  for each row execute function public.enforce_same_tenant('profile_id', 'profiles');

-- =====================================================================================================
--  18. MESSAGING: PUSH (FCM) · ACCOUNT MESSAGES · CUSTOM & SCHEDULED MESSAGES · SUPABASE CRON · USAGE · USER ADMIN
--      (idempotent; also shipped in supabase/upgrade-2026-10.sql)
--
--    push_tokens                     browsers / phones that allowed push notifications (Firebase Cloud Messaging)
--    notify_enqueue(… , p_profile)   now also queues a push message for the person's devices
--    account_created / account_updated / account_deleted / password_changed / notice_published   new automatic messages
--    notification_templates          custom messages written by the owner: send now, once, daily, weekly, monthly or on
--                                    a patient's birthday — run_scheduled_notifications() is called by Supabase cron
--    notify_cron_setup(on, url)      schedules the jobs with pg_cron + pg_net (Settings → Notifications → Automatic delivery)
--    notification_usage(from, to)    messages per day / channel / event / status for the owner and the accountant
--    admin_create_user / admin_update_user / admin_set_user_password / admin_set_user_active / admin_delete_user
--                                    owner-only account management (Settings → Users & accounts)
-- =====================================================================================================

-- ------------------------------------------------------------------ notice board columns (older databases)
alter table public.notices add column if not exists pinned boolean not null default false;
alter table public.notices add column if not exists expires_on date;
alter table public.notices add column if not exists author_name text;

create or replace function public.stamp_notice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.author_name is null then
    new.author_name := (select full_name from public.profiles where id = auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists trg_notices_stamp on public.notices;
create trigger trg_notices_stamp before insert on public.notices for each row execute function public.stamp_notice();
revoke all on function public.stamp_notice() from public, anon, authenticated;

-- ------------------------------------------------------------------ custom message templates (older databases)
create table if not exists public.notification_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 2 and 80),
  description     text,
  channels        text[] not null default array['sms']::text[] check (channels <@ array['sms', 'whatsapp', 'email', 'push']::text[] and cardinality(channels) > 0),
  subject         text check (subject is null or char_length(subject) <= 200),
  text            text not null check (char_length(text) between 1 and 2000),
  wa_text         text check (wa_text is null or char_length(wa_text) <= 2000),
  wa_template     text,
  wa_params       text,
  sms_template_id text,
  audience        text not null default 'patients' check (audience in ('patients', 'staff', 'everyone', 'roles')),
  roles           text[] not null default '{}'::text[],
  schedule        text not null default 'manual' check (schedule in ('manual', 'once', 'daily', 'weekly', 'monthly', 'birthday')),
  send_at         timestamptz,
  time_of_day     text not null default '10:00' check (time_of_day ~ '^[0-2][0-9]:[0-5][0-9]$'),
  weekday         int check (weekday between 0 and 6),
  month_day       int check (month_day between 1 and 28),
  enabled         boolean not null default false,
  last_run_at     timestamptz,
  last_run_count  int,
  next_run_at     timestamptz,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_notification_templates_updated_at on public.notification_templates;
create trigger trg_notification_templates_updated_at before update on public.notification_templates
  for each row execute function public.set_updated_at();
alter table public.notification_templates enable row level security;
drop policy if exists notification_templates_select on public.notification_templates;
drop policy if exists notification_templates_insert on public.notification_templates;
drop policy if exists notification_templates_update on public.notification_templates;
drop policy if exists notification_templates_delete on public.notification_templates;
create policy notification_templates_select on public.notification_templates for select to authenticated using (public.has_role('owner'));
create policy notification_templates_insert on public.notification_templates for insert to authenticated with check (public.has_role('owner'));
create policy notification_templates_update on public.notification_templates for update to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));
create policy notification_templates_delete on public.notification_templates for delete to authenticated using (public.has_role('owner'));
grant select, insert, update, delete on public.notification_templates to authenticated;

-- ------------------------------------------------------------------ outbox: push channel + who / which template
alter table public.notification_outbox drop constraint if exists notification_outbox_channel_check;
alter table public.notification_outbox add constraint notification_outbox_channel_check check (channel in ('sms', 'whatsapp', 'email', 'push'));
alter table public.notification_outbox add column if not exists profile_id uuid;
alter table public.notification_outbox add column if not exists template_id uuid;
create index if not exists notification_outbox_usage_idx on public.notification_outbox (created_at, channel);
grant select (profile_id, template_id) on public.notification_outbox to authenticated;

-- ------------------------------------------------------------------ push devices (FCM registration tokens)
create table if not exists public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  token         text not null unique check (char_length(token) between 20 and 4096),
  platform      text not null default 'web' check (platform in ('web', 'android', 'ios')),
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists push_tokens_profile_idx on public.push_tokens (profile_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;
drop policy if exists push_tokens_own_read on public.push_tokens;
drop policy if exists push_tokens_own_delete on public.push_tokens;
create policy push_tokens_own_read on public.push_tokens for select to authenticated using (profile_id = auth.uid() or public.has_role('owner'));
create policy push_tokens_own_delete on public.push_tokens for delete to authenticated using (profile_id = auth.uid());

-- tables created by this section get their hospital column right away (functions below refer to it)
select public.ensure_tenant_columns();

-- a device belongs to whoever signed in on it last (shared reception PCs)
create or replace function public.register_push_token(p_token text, p_platform text default 'web', p_user_agent text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(coalesce(p_token, '')) < 20 then raise exception 'Invalid device token'; end if;
  insert into public.push_tokens (profile_id, token, platform, user_agent)
  values (auth.uid(), p_token, case when p_platform in ('web', 'android', 'ios') then p_platform else 'web' end, left(p_user_agent, 300))
  on conflict (token) do update set profile_id = excluded.profile_id, platform = excluded.platform, user_agent = excluded.user_agent, last_seen_at = now();
  -- keep at most 10 devices per person
  delete from public.push_tokens where profile_id = auth.uid() and id not in
    (select id from public.push_tokens where profile_id = auth.uid() order by last_seen_at desc limit 10);
end $$;
revoke all on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- ------------------------------------------------------------------ settings defaults for the new events
-- (adds missing events / templates to a saved Settings row; anything the owner already changed is kept)
-- @@NOTIFY_DEFAULTS@@

-- ------------------------------------------------------------------ queue
-- One message per channel. p_tpl = {text, subject, waText, pushText}. Never raises.
create or replace function public.notify_enqueue_raw(p_event text, p_tpl jsonb, p_channels text[], p_phone text, p_email text, p_profile uuid,
  p_vars jsonb, p_related_table text default null, p_related_id uuid default null, p_template uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n        jsonb := (public.tenant_setting('app') -> 'notifications');
  site     jsonb := public.tenant_content('settings');
  ch       text;
  v_to     text;
  v_body   text;
  v_subj   text;
  v_vars   jsonb;
  k        text;
  v_count  int := 0;
begin
  if n is null or p_tpl is null then return 0; end if;
  v_vars := jsonb_build_object(
      'hospital', coalesce(nullif(site ->> 'name', ''), 'DC Hospital'),
      'hospital_phone', coalesce(nullif(site ->> 'appointmentsPhone', ''), site ->> 'phone', ''),
      'address', coalesce(site ->> 'address', ''),
      'site_url', rtrim(coalesce(site ->> 'siteUrl', ''), '/'))
    || coalesce(p_vars, '{}'::jsonb);

  foreach ch in array array['sms', 'whatsapp', 'email', 'push'] loop
    continue when not (ch = any (coalesce(p_channels, '{}')));
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
      when ch = 'whatsapp' and coalesce(p_tpl ->> 'waText', '') <> '' then p_tpl ->> 'waText'
      when ch = 'push' and coalesce(p_tpl ->> 'pushText', '') <> '' then p_tpl ->> 'pushText'
      else coalesce(p_tpl ->> 'text', '') end;
    v_subj := coalesce(nullif(p_tpl ->> 'subject', ''), case when ch = 'push' then '{hospital}' else '' end);
    continue when v_body = '';
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

-- Built-in events: wording + channels from Settings → Notifications. Same arguments as before plus p_profile (push).
drop function if exists public.notify_enqueue(text, text, text, jsonb, text, uuid, text[]) cascade;
create or replace function public.notify_enqueue(p_event text, p_phone text, p_email text, p_vars jsonb, p_related_table text default null,
  p_related_id uuid default null, p_only text[] default null, p_profile uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n    jsonb := (public.tenant_setting('app') -> 'notifications');
  chs  text[];
begin
  if n is null or n -> 'events' -> p_event is null then return 0; end if;
  select coalesce(array_agg(c), '{}') into chs from unnest(array['sms', 'whatsapp', 'email', 'push']) c
   where coalesce((n -> 'events' -> p_event ->> c)::boolean, false) and (p_only is null or c = any (p_only));
  return public.notify_enqueue_raw(p_event, n -> 'templates' -> p_event, chs, p_phone, p_email, p_profile, p_vars, p_related_table, p_related_id, null);
end $$;
revoke all on function public.notify_enqueue(text, text, text, jsonb, text, uuid, text[], uuid) from public, anon, authenticated;

create or replace function public.role_label(r text)
returns text language sql immutable as $$
  select case r when 'owner' then 'Hospital Owner' when 'receptionist' then 'Receptionist' when 'accountant' then 'Accountant'
                when 'doctor' then 'Doctor' when 'staff' then 'Staff' when 'patient' then 'Patient' else initcap(coalesce(r, '')) end
$$;

-- ------------------------------------------------------------------ account messages
-- welcome: checked at the end of the transaction, so an account created by the owner already has its final role
create or replace function public.notify_account_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = new.id;
  if not found then return null; end if;
  perform public.notify_enqueue('account_created', p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'role', public.role_label(p.role::text), 'email', p.email,
    'link', public.site_url() || '/login'), 'profiles', p.id, null, p.id);
  return null;
exception when others then
  raise warning 'notify_account_created: %', sqlerrm;
  return null;
end $$;
drop trigger if exists trg_profiles_notify_created on public.profiles;
create constraint trigger trg_profiles_notify_created after insert on public.profiles
  deferrable initially deferred for each row execute function public.notify_account_created();

create or replace function public.notify_account_updated()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_changes text[] := '{}';
begin
  if new.role is distinct from old.role then v_changes := v_changes || ('role: ' || public.role_label(new.role::text)); end if;
  if lower(new.email) is distinct from lower(old.email) then v_changes := v_changes || ('e-mail: ' || new.email); end if;
  if coalesce(new.phone, '') is distinct from coalesce(old.phone, '') then v_changes := v_changes || ('mobile: ' || coalesce(new.phone, 'removed')); end if;
  if cardinality(v_changes) = 0 then return new; end if;
  -- tell both the old and the new address when the contact details change
  perform public.notify_enqueue('account_updated', coalesce(new.phone, old.phone), new.email, jsonb_build_object(
    'name', split_part(new.full_name, ' ', 1), 'role', public.role_label(new.role::text), 'changes', array_to_string(v_changes, ', '),
    'link', public.site_url() || '/profile'), 'profiles', new.id, null, new.id);
  if lower(new.email) is distinct from lower(old.email) then
    perform public.notify_enqueue('account_updated', null, old.email, jsonb_build_object(
      'name', split_part(new.full_name, ' ', 1), 'role', public.role_label(new.role::text), 'changes', array_to_string(v_changes, ', '),
      'link', public.site_url() || '/profile'), 'profiles', new.id, array['email'], null);
  end if;
  return new;
exception when others then
  raise warning 'notify_account_updated: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_profiles_notify_updated on public.profiles;
create trigger trg_profiles_notify_updated after update on public.profiles
  for each row execute function public.notify_account_updated();

create or replace function public.notify_account_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_enqueue('account_deleted', old.phone, old.email, jsonb_build_object(
    'name', split_part(old.full_name, ' ', 1), 'role', public.role_label(old.role::text), 'email', old.email), 'profiles', old.id,
    array['sms', 'whatsapp', 'email'], null);
  return old;
exception when others then
  raise warning 'notify_account_deleted: %', sqlerrm;
  return old;
end $$;
drop trigger if exists trg_profiles_notify_deleted on public.profiles;
create trigger trg_profiles_notify_deleted before delete on public.profiles
  for each row execute function public.notify_account_deleted();

-- security alert whenever a password changes (self-service, reset link, mobile OTP or the owner)
create or replace function public.notify_password_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if coalesce(old.encrypted_password, '') = '' or new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
  select * into p from public.profiles where id = new.id;
  if not found then return new; end if;
  perform public.notify_enqueue('password_changed', p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'time', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'),
    'link', public.site_url() || '/forgot-password'), 'profiles', p.id, null, p.id);
  return new;
exception when others then
  raise warning 'notify_password_changed: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_auth_users_password_notify on auth.users;
create trigger trg_auth_users_password_notify after update of encrypted_password on auth.users
  for each row execute function public.notify_password_changed();

-- a new notice on the board reaches its audience (push by default; e-mail / SMS / WhatsApp if switched on)
create or replace function public.notify_notice()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.published_on > public.today_ist() then return new; end if;
  for r in
    select p.id, p.full_name, p.phone, p.email from public.profiles p
    where (new.audience = 'all'
        or (new.audience = 'staff' and p.role <> 'patient')
        or (new.audience = 'doctors' and p.role = 'doctor')
        or (new.audience = 'patients' and p.role = 'patient'))
      and p.tenant_id = new.tenant_id
      and p.id is distinct from auth.uid()
    limit 5000
  loop
    perform public.notify_enqueue('notice_published', r.phone, r.email, jsonb_build_object(
      'name', split_part(r.full_name, ' ', 1), 'title', new.title, 'notice', left(new.body, 300),
      'priority', initcap(new.priority), 'link', public.site_url() || '/notices'), 'notices', new.id, null, r.id);
  end loop;
  return new;
exception when others then
  raise warning 'notify_notice: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_notices_notify on public.notices;
create trigger trg_notices_notify after insert on public.notices for each row execute function public.notify_notice();

revoke all on function public.notify_account_created() from public, anon, authenticated;
revoke all on function public.notify_account_updated() from public, anon, authenticated;
revoke all on function public.notify_account_deleted() from public, anon, authenticated;
revoke all on function public.notify_password_changed() from public, anon, authenticated;
revoke all on function public.notify_notice() from public, anon, authenticated;

-- ------------------------------------------------------------------ custom & scheduled messages
-- next time a template is due (India time), strictly after p_after; null = nothing more to send
create or replace function public.notify_next_run(t public.notification_templates, p_after timestamptz default now())
returns timestamptz language plpgsql stable as $$
declare
  v_local timestamp := p_after at time zone 'Asia/Kolkata';
  v_time  time := t.time_of_day::time;
  v_day   date := v_local::date;
  v_cand  timestamp;
  i       int;
begin
  if not t.enabled then return null; end if;
  case t.schedule
    when 'manual' then return null;
    when 'once' then return case when t.send_at > p_after then t.send_at else null end;
    when 'daily', 'birthday' then
      v_cand := v_day + v_time;
      if v_cand <= v_local then v_cand := v_cand + interval '1 day'; end if;
    when 'weekly' then
      for i in 0..7 loop
        v_cand := (v_day + i) + v_time;
        exit when extract(dow from v_day + i)::int = coalesce(t.weekday, 1) and v_cand > v_local;
      end loop;
    when 'monthly' then
      v_cand := (date_trunc('month', v_day)::date + (coalesce(t.month_day, 1) - 1)) + v_time;
      if v_cand <= v_local then v_cand := (date_trunc('month', v_day)::date + interval '1 month')::date + (coalesce(t.month_day, 1) - 1) + v_time; end if;
    else return null;
  end case;
  return v_cand at time zone 'Asia/Kolkata';
end $$;

create or replace function public.stamp_notification_template()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by_name := coalesce(new.created_by_name, (select full_name from public.profiles where id = auth.uid())); end if;
  if new.audience = 'roles' and cardinality(new.roles) = 0 then raise exception 'Pick at least one role to send to.'; end if;
  if new.schedule = 'once' and new.enabled and new.send_at is null then raise exception 'Pick when to send it.'; end if;
  if tg_op = 'INSERT' or new.enabled is distinct from old.enabled or new.schedule is distinct from old.schedule or new.send_at is distinct from old.send_at
     or new.time_of_day is distinct from old.time_of_day or new.weekday is distinct from old.weekday or new.month_day is distinct from old.month_day then
    new.next_run_at := public.notify_next_run(new, now());
  end if;
  return new;
end $$;
drop trigger if exists trg_notification_templates_stamp on public.notification_templates;
create trigger trg_notification_templates_stamp before insert or update on public.notification_templates
  for each row execute function public.stamp_notification_template();
revoke all on function public.stamp_notification_template() from public, anon, authenticated;

-- who a template goes to (one row per mobile / e-mail; birthdays = patients born on this day)
create or replace function public.notify_template_recipients(t public.notification_templates)
returns table (profile_id uuid, full_name text, phone text, email text)
language sql stable security definer set search_path = public as $$
  with people as (
    select p.profile_id, p.full_name, p.phone, p.email, 1 as pri from public.patients p
     where p.tenant_id = t.tenant_id
       and (t.audience in ('patients', 'everyone') or t.schedule = 'birthday' or (t.audience = 'roles' and 'patient' = any (t.roles)))
       and (t.schedule <> 'birthday' or to_char(p.date_of_birth, 'MM-DD') = to_char(now() at time zone 'Asia/Kolkata', 'MM-DD'))
    union all
    select pr.id, pr.full_name, pr.phone, pr.email, 2 from public.profiles pr
     where pr.tenant_id = t.tenant_id and t.schedule <> 'birthday' and pr.role <> 'patient'
       and (t.audience in ('staff', 'everyone') or (t.audience = 'roles' and pr.role::text = any (t.roles)))
  )
  select distinct on (coalesce(right(regexp_replace(phone, '\D', '', 'g'), 10), lower(email), profile_id::text))
         profile_id, full_name, phone, email
    from people
   order by coalesce(right(regexp_replace(phone, '\D', '', 'g'), 10), lower(email), profile_id::text), pri
   limit 5000
$$;
revoke all on function public.notify_template_recipients(public.notification_templates) from public, anon, authenticated;

create or replace function public.notify_run_template(t public.notification_templates)
returns int language plpgsql volatile security definer set search_path = public as $$
declare r record; v_count int := 0; v_tpl jsonb;
begin
  v_tpl := jsonb_build_object('text', t.text, 'subject', coalesce(t.subject, ''), 'waText', coalesce(t.wa_text, ''));
  for r in select * from public.notify_template_recipients(t) loop
    v_count := v_count + public.notify_enqueue_raw('tpl:' || t.id, v_tpl, t.channels, r.phone, r.email, r.profile_id,
      jsonb_build_object('name', split_part(coalesce(r.full_name, ''), ' ', 1), 'full_name', coalesce(r.full_name, '')),
      'notification_templates', t.id, t.id);
  end loop;
  update public.notification_templates set last_run_at = now(), last_run_count = v_count where id = t.id;
  return v_count;
end $$;
revoke all on function public.notify_run_template(public.notification_templates) from public, anon, authenticated;

-- "Send now" (owner) and the recipient preview
create or replace function public.notify_send_template(p_id uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare t public.notification_templates;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can send messages'; end if;
  perform public.module_guard('notifications');
  select * into t from public.notification_templates where id = p_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Message not found'; end if;
  return public.notify_run_template(t);
end $$;
create or replace function public.notify_template_audience(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.notification_templates;
begin
  if not public.has_role('owner') then raise exception 'Not allowed'; end if;
  select * into t from public.notification_templates where id = p_id and tenant_id = public.current_tenant();
  if not found then return jsonb_build_object('total', 0); end if;
  return (select jsonb_build_object('total', count(*), 'phone', count(*) filter (where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$'),
            'email', count(*) filter (where email ~ '@'), 'push', count(*) filter (where exists (select 1 from public.push_tokens k where k.profile_id = r.profile_id)))
          from public.notify_template_recipients(t) r);
end $$;
revoke all on function public.notify_send_template(uuid) from public, anon;
revoke all on function public.notify_template_audience(uuid) from public, anon;
grant execute on function public.notify_send_template(uuid) to authenticated;
grant execute on function public.notify_template_audience(uuid) to authenticated;

-- every few minutes (Supabase cron): send whatever is due and work out the next run
create or replace function public.run_scheduled_notifications()
returns int language plpgsql volatile security definer set search_path = public as $$
declare t public.notification_templates; v_total int := 0; v_all boolean;
begin
  if auth.uid() is not null and not public.has_role('owner') then raise exception 'Not allowed'; end if;
  -- the cron job serves every hospital; an owner's "run now" only their own
  v_all := auth.uid() is null and nullif(current_setting('app.tenant_id', true), '') is null;
  for t in select * from public.notification_templates where enabled and next_run_at is not null and next_run_at <= now()
             and (v_all or tenant_id = public.current_tenant())
           order by next_run_at limit 50 for update skip locked loop
    if v_all then perform set_config('app.tenant_id', t.tenant_id::text, true); end if;   -- messages queue under that hospital
    v_total := v_total + public.notify_run_template(t);
    update public.notification_templates
       set next_run_at = public.notify_next_run(t, greatest(now(), t.next_run_at)),
           enabled = case when t.schedule = 'once' then false else enabled end
     where id = t.id;
  end loop;
  if v_all then perform set_config('app.tenant_id', '', true); end if;
  return v_total;
end $$;
revoke all on function public.run_scheduled_notifications() from public, anon;
grant execute on function public.run_scheduled_notifications() to authenticated, service_role;

-- ------------------------------------------------------------------ usage report (owner + accountant)
create or replace function public.notification_usage(p_from date, p_to date)
returns table (day date, channel text, event text, status text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('owner', 'accountant') then raise exception 'Only the owner and the accountant can see messaging usage'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Pick a range of up to 400 days'; end if;
  return query
    select (o.created_at at time zone 'Asia/Kolkata')::date, o.channel,
           case when o.event like 'tpl:%' then 'custom' else o.event end, o.status, count(*)
      from public.notification_outbox o
     where o.tenant_id = public.current_tenant()
       and o.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
       and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
     group by 1, 2, 3, 4
     order by 1;
end $$;
revoke all on function public.notification_usage(date, date) from public, anon;
grant execute on function public.notification_usage(date, date) to authenticated;

-- ------------------------------------------------------------------ the queue for the notify Edge Function
-- Used by the Edge Function (service role) to take a batch of messages to deliver.
-- p_tenant: only that hospital's queue (a staff member's "deliver now"); null = every hospital (the scheduler).
-- Suspended hospitals' messages wait (they go out if the hospital is reactivated, or expire with the cleanup job).
drop function if exists public.claim_notifications(int) cascade;
drop function if exists public.claim_notifications(int, uuid) cascade;
create function public.claim_notifications(p_limit int default 25, p_tenant uuid default null)
returns setof public.notification_outbox language plpgsql volatile security definer set search_path = public as $$
begin
  -- give up on messages that got stuck mid-delivery three times
  update public.notification_outbox set status = 'failed', error = coalesce(error, 'Delivery timed out')
  where status = 'sending' and attempts >= 3 and coalesce(last_attempt_at, created_at) < now() - interval '10 minutes';

  return query
    update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1, last_attempt_at = now()
    where o.id in (
      select x.id from public.notification_outbox x
      where ((x.status = 'pending' and x.next_attempt_at <= now())
          or (x.status = 'sending' and x.attempts < 3 and coalesce(x.last_attempt_at, x.created_at) < now() - interval '10 minutes'))
        and (p_tenant is null or x.tenant_id = p_tenant)
        and not exists (select 1 from public.tenants t where t.id = x.tenant_id and t.status = 'suspended')
      order by x.created_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
    returning o.*;
end $$;
revoke all on function public.claim_notifications(int, uuid) from public, anon, authenticated;
grant execute on function public.claim_notifications(int, uuid) to service_role;

-- ------------------------------------------------------------------ Supabase cron (pg_cron + pg_net)
-- The job calls the `notify` Edge Function with the service-role key the owner saved (write-only, like every credential).
create or replace function public.notify_cron_flush()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from public.notification_outbox where status = 'pending' and next_attempt_at <= now()) then return; end if;
  v_url := public.tenant_secret('notify_function_url');
  v_key := public.tenant_secret('service_role_key');
  if v_url is null or v_key is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    using v_url, jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'), '{"flush":true}'::jsonb;
end $$;
revoke all on function public.notify_cron_flush() from public, anon, authenticated;

create or replace function public.notify_cron_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cron boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
        v_net boolean := exists (select 1 from pg_extension where extname = 'pg_net');
        v_jobs jsonb := '[]'::jsonb;
begin
  if not public.has_role('owner') then raise exception 'Not allowed'; end if;
  if v_cron then
    execute $q$ select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
              'last_run', d.start_time, 'last_status', d.status, 'last_message', left(d.return_message, 200)) order by j.jobname), '[]'::jsonb)
           from cron.job j
           left join lateral (select start_time, status, return_message from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true
          where j.jobname like 'dch-%' $q$ into v_jobs;
  end if;
  return jsonb_build_object('pg_cron', v_cron, 'pg_net', v_net, 'jobs', v_jobs,
    'url_set', public.tenant_secret('notify_function_url') is not null,
    'key_set', public.tenant_secret('service_role_key') is not null,
    'pending', (select count(*) from public.notification_outbox where status = 'pending' and tenant_id = public.current_tenant()),
    'scheduled', (select count(*) from public.notification_templates where enabled and next_run_at is not null and tenant_id = public.current_tenant()));
end $$;

create or replace function public.notify_cron_setup(p_enable boolean, p_url text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare j record;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can change automatic delivery'; end if;
  perform public.module_guard('notifications');
  -- one scheduler serves every hospital, using the main hospital's notify address and key
  if public.current_tenant() is distinct from public.primary_tenant() then
    raise exception 'Automatic delivery is managed by the platform — it already runs for your hospital.';
  end if;
  if p_url is not null and p_url <> '' then
    if p_url !~ '^https://[^ ]+/functions/v1/notify$' then raise exception 'The address should look like https://<project>.supabase.co/functions/v1/notify'; end if;
    insert into public.app_secrets (key, value, updated_at, updated_by_name) values ('notify_function_url', p_url, now(), (select full_name from public.profiles where id = auth.uid()))
    on conflict (tenant_id, key) do update set value = excluded.value, updated_at = now(), updated_by_name = excluded.updated_by_name;
  end if;
  if p_enable then
    -- Supabase lets the database owner switch these on; otherwise: Dashboard → Database → Extensions
    begin execute 'create extension if not exists pg_cron'; exception when others then null; end;
    begin execute 'create extension if not exists pg_net'; exception when others then null; end;
    if not exists (select 1 from pg_extension where extname = 'pg_cron') then raise exception 'CRON_MISSING: Turn on the pg_cron extension (Supabase → Database → Extensions) and try again.'; end if;
    if not exists (select 1 from pg_extension where extname = 'pg_net') then raise exception 'CRON_MISSING: Turn on the pg_net extension (Supabase → Database → Extensions) and try again.'; end if;
    if not public.tenant_secret('service_role_key') is not null then raise exception 'Save the service-role key first (it lets the scheduler call the notify function).'; end if;
    if not public.tenant_secret('notify_function_url') is not null then raise exception 'Save the notify function address first.'; end if;
    execute $c$ select cron.schedule('dch-notify-flush', '* * * * *', 'select public.notify_cron_flush()') $c$;
    execute $c$ select cron.schedule('dch-scheduled-messages', '*/5 * * * *', 'select public.run_scheduled_notifications()') $c$;
    execute $c$ select cron.schedule('dch-appointment-reminders', '30 12 * * *', 'select public.queue_appointment_reminders()') $c$;  -- 18:00 IST
    execute $c$ select cron.schedule('dch-outbox-cleanup', '15 21 * * 0', $d$delete from public.notification_outbox where created_at < now() - interval '400 days'$d$) $c$;
  elsif exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in execute $q$ select jobid from cron.job where jobname like 'dch-%' $q$ loop
      execute 'select cron.unschedule($1)' using j.jobid;
    end loop;
  end if;
  return public.notify_cron_status();
end $$;
revoke all on function public.notify_cron_status() from public, anon;
revoke all on function public.notify_cron_setup(boolean, text) from public, anon;
grant execute on function public.notify_cron_status() to authenticated;
grant execute on function public.notify_cron_setup(boolean, text) to authenticated;

-- ------------------------------------------------------------------ user administration (owner only)
-- profiles.email follows auth.users; signed-in users can't change it directly — except through admin_update_user()
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.has_role('owner') then
    raise exception 'Only the hospital owner can change user roles';
  end if;
  if new.email is distinct from old.email and auth.uid() is not null and coalesce(current_setting('dch.admin_email', true), '') <> 'on' then
    new.email := old.email;
  end if;
  return new;
end $$;

create or replace function public.admin_guard()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can manage user accounts'; end if;
end $$;

-- the account must belong to the hospital the owner is managing
create or replace function public.admin_target(p_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_id and tenant_id = public.current_tenant()) then
    raise exception 'User not found';
  end if;
end $$;
revoke all on function public.admin_target(uuid) from public, anon, authenticated;

create or replace function public.admin_create_user(p_email text, p_full_name text, p_role text, p_phone text default null, p_password text default null)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_pass  text := coalesce(nullif(p_password, ''), encode(gen_random_bytes(18), 'base64'));
begin
  perform public.admin_guard();
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid e-mail address'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter the full name'; end if;
  if p_role not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient') then raise exception 'Choose a role'; end if;
  if p_password is not null and p_password <> '' and char_length(p_password) < 8 then raise exception 'Use at least 8 characters for the password'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'An account with this e-mail already exists'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, crypt(v_pass, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', trim(p_full_name), 'phone', nullif(trim(coalesce(p_phone, '')), ''), 'tenant_id', public.current_tenant()),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id, 'email', v_email, 'email_verified', true), 'email', null, now(), now());

  -- handle_new_user() made a patient profile; give it the chosen role
  update public.profiles set role = p_role::public.app_role, full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone, '')), '') where id = v_id;
  if p_role <> 'patient' then
    delete from public.patients where profile_id = v_id;
    if p_role = 'doctor' then update public.doctors set profile_id = v_id where lower(email) = v_email and profile_id is null and tenant_id = public.current_tenant();
    else update public.staff set profile_id = v_id where lower(email) = v_email and profile_id is null and tenant_id = public.current_tenant(); end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_update_user(p_id uuid, p_full_name text, p_role text, p_phone text default null, p_email text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles; v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform public.admin_guard();
  select * into p from public.profiles where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'User not found'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter the full name'; end if;
  if p_role not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient') then raise exception 'Choose a role'; end if;
  if p.role = 'owner' and p_role <> 'owner' and (p_id = auth.uid() or (select count(*) from public.profiles where role = 'owner' and tenant_id = public.current_tenant()) <= 1) then
    raise exception 'You can''t remove your own owner access or the last owner';
  end if;
  if v_email <> '' and v_email <> lower(p.email) then
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid e-mail address'; end if;
    if exists (select 1 from auth.users where lower(email) = v_email and id <> p_id) then raise exception 'Another account already uses this e-mail'; end if;
    update auth.users set email = v_email, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = p_id;
  else
    v_email := p.email;
  end if;
  perform set_config('dch.admin_email', 'on', true);
  update public.profiles set full_name = trim(p_full_name), role = p_role::public.app_role, phone = nullif(trim(coalesce(p_phone, '')), ''), email = v_email
   where id = p_id;
  perform set_config('dch.admin_email', '', true);
end $$;

create or replace function public.admin_set_user_password(p_id uuid, p_password text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  perform public.admin_guard();
  if char_length(coalesce(p_password, '')) < 8 then raise exception 'Use at least 8 characters'; end if;
  perform public.admin_target(p_id);
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_id;
  if not found then raise exception 'User not found'; end if;
end $$;

-- disabled accounts can't sign in (Supabase honours banned_until); their records stay
create or replace function public.admin_set_user_active(p_id uuid, p_active boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.admin_guard();
  if p_id = auth.uid() then raise exception 'You can''t disable your own account'; end if;
  perform public.admin_target(p_id);
  update auth.users set banned_until = case when p_active then null else 'infinity'::timestamptz end, updated_at = now() where id = p_id;
  if not found then raise exception 'User not found'; end if;
  if not p_active and to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_id; end if;
end $$;

drop function if exists public.admin_user_status();
create or replace function public.admin_user_status(p_ids uuid[])
returns table (id uuid, disabled boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_guard();
  return query execute
    case when exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at')
         then 'select u.id, coalesce(u.banned_until > now(), false), u.last_sign_in_at from auth.users u where u.id = any ($1)'
         else 'select u.id, coalesce(u.banned_until > now(), false), null::timestamptz from auth.users u where u.id = any ($1)' end
    using array(select x.id from public.profiles x where x.id = any (p_ids[1:200]) and x.tenant_id = public.current_tenant());
end $$;

-- deletes the login; patient / doctor / staff records and their history stay (they are unlinked)
create or replace function public.admin_delete_user(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles;
begin
  perform public.admin_guard();
  if p_id = auth.uid() then raise exception 'You can''t delete your own account'; end if;
  select * into p from public.profiles where id = p_id and tenant_id = public.current_tenant();
  if not found then raise exception 'User not found'; end if;
  if p.role = 'owner' and (select count(*) from public.profiles where role = 'owner' and tenant_id = public.current_tenant()) <= 1 then raise exception 'You can''t delete the last owner'; end if;
  delete from public.profiles where id = p_id;   -- fires the account_deleted message while the details still exist
  delete from auth.users where id = p_id;
end $$;

revoke all on function public.admin_guard() from public, anon, authenticated;
revoke all on function public.admin_create_user(text, text, text, text, text) from public, anon;
revoke all on function public.admin_update_user(uuid, text, text, text, text) from public, anon;
revoke all on function public.admin_set_user_password(uuid, text) from public, anon;
revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
revoke all on function public.admin_user_status(uuid[]) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_create_user(text, text, text, text, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_user_status(uuid[]) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

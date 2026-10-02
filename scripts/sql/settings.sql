-- =====================================================================================================
--  11. HOSPITAL SETTINGS · CREDENTIALS · NOTIFICATIONS (SMS / WhatsApp / Email)
--
--    app_settings          one row ('app') with the dashboard settings JSON. Everyone signed in can read it
--                          (theme, date format…); only the owner can change it.
--    app_secrets           API keys / passwords. WRITE-ONLY from the browser: the owner sets them through
--                          set_app_secret() and only sees a masked hint (app_secret_status()). The Edge Function
--                          `notify` reads them with the service-role key.
--    notification_outbox   messages queued by triggers (appointment booked, reminder, invoice, lab report…)
--                          and by the booking OTP. The Edge Function claims and delivers them.
--
--  These tables are NOT dropped when this file is re-run, so saved settings and credentials survive.
--  Deploy the sender once:   supabase functions deploy notify
--  Optional automatic delivery + reminders with pg_cron + pg_net (Database → Extensions), e.g.:
--    select cron.schedule('notify-flush', '* * * * *', $c$ select net.http_post(
--      url := 'https://<project-ref>.supabase.co/functions/v1/notify',
--      headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>', 'Content-Type', 'application/json'),
--      body := '{"flush":true}'::jsonb) $c$);
--    select cron.schedule('appointment-reminders', '30 12 * * *', $c$ select public.queue_appointment_reminders() $c$);  -- 18:00 IST
-- =====================================================================================================

-- ------------------------------------------------------------------ settings
create table if not exists public.app_settings (
  key              text primary key,
  data             jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
grant select, insert, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

drop policy if exists app_settings_read on public.app_settings;
drop policy if exists app_settings_owner_insert on public.app_settings;
drop policy if exists app_settings_owner_update on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy app_settings_owner_insert on public.app_settings for insert to authenticated with check (public.has_role('owner'));
create policy app_settings_owner_update on public.app_settings for update to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

drop function if exists public.app_settings_stamp() cascade;
create function public.app_settings_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb := '{}'::jsonb;
  k text;
  v_name text := (select full_name from public.profiles where id = auth.uid());
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce(v_name, 'Database');
  -- audit: which sections changed
  for k in select jsonb_object_keys(new.data) loop
    if tg_op = 'INSERT' or (new.data -> k) is distinct from (old.data -> k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', case when tg_op = 'UPDATE' then old.data -> k end, 'to', new.data -> k));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    insert into public.audit_log (table_name, record_id, action, actor_id, actor_name, actor_role, summary, changes)
    values ('app_settings', null, lower(tg_op), auth.uid(), coalesce(v_name, 'System'),
            coalesce((select role::text from public.profiles where id = auth.uid()), 'system'), 'Hospital settings', v_changes);
  end if;
  return new;
end $$;
create trigger trg_app_settings_stamp before insert or update on public.app_settings
  for each row execute function public.app_settings_stamp();

-- ------------------------------------------------------------------ credentials (write-only)
create table if not exists public.app_secrets (
  key              text primary key check (key ~ '^[a-z0-9_]{2,64}$'),
  value            text not null,
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
alter table public.app_secrets enable row level security;   -- no policies: unreachable through the API
revoke all on public.app_secrets from anon, authenticated;
grant all on public.app_secrets to service_role;

drop function if exists public.app_secret_status() cascade;
create function public.app_secret_status()
returns table (key text, hint text, updated_at timestamptz, updated_by_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('owner') then
    raise exception 'Only the hospital owner can view credentials';
  end if;
  return query
    select s.key, '••••' || case when length(s.value) >= 12 then right(s.value, 4) else '' end, s.updated_at, s.updated_by_name
    from public.app_secrets s order by s.key;
end $$;

drop function if exists public.set_app_secret(text, text) cascade;
create function public.set_app_secret(p_key text, p_value text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_name text := (select full_name from public.profiles where id = auth.uid());
begin
  if not public.has_role('owner') then
    raise exception 'Only the hospital owner can change credentials';
  end if;
  if p_key !~ '^[a-z0-9_]{2,64}$' then
    raise exception 'Invalid credential name';
  end if;
  if nullif(trim(coalesce(p_value, '')), '') is null then
    delete from public.app_secrets where key = p_key;
  else
    insert into public.app_secrets (key, value, updated_at, updated_by_name)
    values (p_key, trim(p_value), now(), v_name)
    on conflict (tenant_id, key) do update set value = excluded.value, updated_at = now(), updated_by_name = excluded.updated_by_name;
  end if;
  insert into public.audit_log (table_name, record_id, action, actor_id, actor_name, actor_role, summary, changes)
  values ('app_secrets', null, case when nullif(trim(coalesce(p_value, '')), '') is null then 'delete' else 'update' end,
          auth.uid(), coalesce(v_name, 'System'), 'owner', 'Credential ' || p_key,
          jsonb_build_object(p_key, jsonb_build_object('to', case when nullif(trim(coalesce(p_value, '')), '') is null then 'removed' else 'updated (hidden)' end)));
end $$;

revoke all on function public.app_secret_status() from public, anon;
revoke all on function public.set_app_secret(text, text) from public, anon;
grant execute on function public.app_secret_status() to authenticated;
grant execute on function public.set_app_secret(text, text) to authenticated;

-- ------------------------------------------------------------------ outbox
create table if not exists public.notification_outbox (
  id             uuid primary key default gen_random_uuid(),
  event          text not null,
  channel        text not null check (channel in ('sms', 'whatsapp', 'email')),
  recipient      text not null,
  subject        text,
  body           text not null default '',
  vars           jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts       int not null default 0,
  error          text,
  provider_ref   text,
  related_table  text,
  related_id     uuid,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
-- retry bookkeeping (added later; `if not exists` keeps re-runs safe)
alter table public.notification_outbox add column if not exists last_attempt_at timestamptz;
alter table public.notification_outbox add column if not exists next_attempt_at timestamptz not null default now();
create index if not exists notification_outbox_queue_idx on public.notification_outbox (status, created_at);
create index if not exists notification_outbox_related_idx on public.notification_outbox (related_id, event);

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
-- the delivery log is visible to the owner, but never the message body (it can contain an OTP)
grant select (id, event, channel, recipient, status, attempts, error, provider_ref, related_table, related_id, created_at, sent_at)
  on public.notification_outbox to authenticated;
grant all on public.notification_outbox to service_role;
drop policy if exists notification_outbox_owner_read on public.notification_outbox;
create policy notification_outbox_owner_read on public.notification_outbox for select to authenticated using (public.has_role('owner'));

-- Queue one message per enabled channel for an event. Never raises (a failed notification must not
-- roll back the booking / invoice that triggered it).
drop function if exists public.notify_enqueue(text, text, text, jsonb, text, uuid) cascade;
drop function if exists public.notify_enqueue(text, text, text, jsonb, text, uuid, text[]) cascade;
drop function if exists public.notify_enqueue(text, text, text, jsonb, text, uuid, text[], uuid) cascade;  -- section 18 version (re-run safety)
-- p_only: restrict to these channels (e.g. the booking OTP channel the visitor picked); null = every enabled channel
create function public.notify_enqueue(p_event text, p_phone text, p_email text, p_vars jsonb, p_related_table text default null, p_related_id uuid default null, p_only text[] default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n        jsonb := (select data -> 'notifications' from public.app_settings where key = 'app');
  site     jsonb := (select data from public.site_content where key = 'settings');
  tpl      jsonb;
  ch       text;
  v_to     text;
  v_body   text;
  v_subj   text;
  v_vars   jsonb;
  k        text;
  v_count  int := 0;
begin
  if n is null or n -> 'events' -> p_event is null then return 0; end if;
  tpl := n -> 'templates' -> p_event;
  v_vars := jsonb_build_object(
      'hospital', coalesce(nullif(site ->> 'name', ''), 'DC Hospital'),
      'hospital_phone', coalesce(nullif(site ->> 'appointmentsPhone', ''), site ->> 'phone', ''),
      'address', coalesce(site ->> 'address', ''),
      'site_url', rtrim(coalesce(site ->> 'siteUrl', ''), '/'))
    || coalesce(p_vars, '{}'::jsonb);

  foreach ch in array array['sms', 'whatsapp', 'email'] loop
    continue when coalesce((n -> 'events' -> p_event ->> ch)::boolean, false) is not true;
    continue when coalesce((n -> ch ->> 'enabled')::boolean, false) is not true;
    continue when p_only is not null and not (ch = any (p_only));
    if ch = 'email' then
      v_to := nullif(lower(trim(coalesce(p_email, ''))), '');
      continue when v_to is null or v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
    else
      v_to := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
      continue when v_to !~ '^[6-9][0-9]{9}$';
    end if;
    -- WhatsApp may have its own wording (bold, emoji, line breaks); otherwise the shared text is used
    v_body := case when ch = 'whatsapp' and coalesce(tpl ->> 'waText', '') <> '' then tpl ->> 'waText' else coalesce(tpl ->> 'text', '') end;
    v_subj := coalesce(tpl ->> 'subject', '');
    continue when v_body = '';
    for k in select jsonb_object_keys(v_vars) loop
      v_body := replace(v_body, '{' || k || '}', coalesce(v_vars ->> k, ''));
      v_subj := replace(v_subj, '{' || k || '}', coalesce(v_vars ->> k, ''));
    end loop;
    insert into public.notification_outbox (event, channel, recipient, subject, body, vars, related_table, related_id)
    values (p_event, ch, v_to, nullif(v_subj, ''), v_body, v_vars, p_related_table, p_related_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
exception when others then
  raise warning 'notify_enqueue(%) failed: %', p_event, sqlerrm;
  return 0;
end $$;
revoke all on function public.notify_enqueue(text, text, text, jsonb, text, uuid, text[]) from public, anon, authenticated;

create or replace function public.fmt_appt_time(t text)
returns text language sql immutable as $$ select trim(to_char(t::time, 'FMHH12:MI AM')) $$;

-- ------------------------------------------------------------------ event triggers
drop function if exists public.notify_appointment() cascade;
create function public.notify_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.patients;
  d public.doctors;
  v_event text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'cancelled' then return new; end if;
    v_event := 'appointment_booked';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_event := 'appointment_cancelled';
  elsif new.status <> 'cancelled' and (new.appointment_date, new.appointment_time) is distinct from (old.appointment_date, old.appointment_time) then
    v_event := 'appointment_rescheduled';
  else
    return new;
  end if;
  if new.appointment_date < (now() at time zone 'Asia/Kolkata')::date then return new; end if;  -- back-dated entry
  select * into p from public.patients where id = new.patient_id;
  select * into d from public.doctors where id = new.doctor_id;
  perform public.notify_enqueue(v_event, p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'patient', p.full_name, 'doctor', d.full_name,
    'date', to_char(new.appointment_date, 'Dy, DD Mon YYYY'), 'time', public.fmt_appt_time(new.appointment_time),
    'ref', coalesce(new.booking_ref, upper(left(new.id::text, 8)))), 'appointments', new.id);
  return new;
exception when others then
  raise warning 'notify_appointment: %', sqlerrm;
  return new;
end $$;
create trigger trg_appointments_notify after insert or update on public.appointments
  for each row execute function public.notify_appointment();

drop function if exists public.notify_invoice() cascade;
create function public.notify_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.patients;
begin
  if new.status not in ('unpaid', 'partial', 'overdue') then return new; end if;
  select * into p from public.patients where id = new.patient_id;
  perform public.notify_enqueue('invoice_created', p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'invoice', new.invoice_number,
    'amount', '₹' || trim(to_char(new.total, 'FM99,99,99,990.00')),
    'due_date', coalesce(to_char(new.due_date, 'DD Mon YYYY'), 'on receipt')), 'invoices', new.id);
  return new;
exception when others then
  raise warning 'notify_invoice: %', sqlerrm;
  return new;
end $$;
create trigger trg_invoices_notify after insert on public.invoices
  for each row execute function public.notify_invoice();

drop function if exists public.notify_payment() cascade;
create function public.notify_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.patients; v_inv text;
begin
  select * into p from public.patients where id = new.patient_id;
  select invoice_number into v_inv from public.invoices where id = new.invoice_id;
  perform public.notify_enqueue('payment_received', p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'invoice', coalesce(v_inv, ''),
    'amount', '₹' || trim(to_char(new.amount, 'FM99,99,99,990.00')),
    'method', initcap(replace(new.method, '_', ' '))), 'payments', new.id);
  return new;
exception when others then
  raise warning 'notify_payment: %', sqlerrm;
  return new;
end $$;
create trigger trg_payments_notify after insert on public.payments
  for each row execute function public.notify_payment();

drop function if exists public.notify_lab() cascade;
create function public.notify_lab()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.patients;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  select * into p from public.patients where id = new.patient_id;
  perform public.notify_enqueue('lab_report_ready', p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'test', new.test_name), 'lab_tests', new.id);
  return new;
exception when others then
  raise warning 'notify_lab: %', sqlerrm;
  return new;
end $$;
create trigger trg_lab_tests_notify after update on public.lab_tests
  for each row execute function public.notify_lab();

-- Queue tomorrow's reminders (idempotent). Run daily with pg_cron, or from Settings → Notifications.
drop function if exists public.queue_appointment_reminders() cascade;
create function public.queue_appointment_reminders()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
  v_day date := (now() at time zone 'Asia/Kolkata')::date + 1;
begin
  if auth.uid() is not null and not public.has_role('owner', 'receptionist') then
    raise exception 'Not allowed';
  end if;
  for r in
    select a.*, p.full_name as p_name, p.phone as p_phone, p.email as p_email, d.full_name as d_name
    from public.appointments a
    join public.patients p on p.id = a.patient_id
    join public.doctors d on d.id = a.doctor_id
    where a.appointment_date = v_day and a.status in ('scheduled', 'confirmed')
      and not exists (select 1 from public.notification_outbox o where o.related_id = a.id and o.event = 'appointment_reminder')
  loop
    v_count := v_count + public.notify_enqueue('appointment_reminder', r.p_phone, r.p_email, jsonb_build_object(
      'name', split_part(r.p_name, ' ', 1), 'patient', r.p_name, 'doctor', r.d_name,
      'date', to_char(r.appointment_date, 'Dy, DD Mon YYYY'), 'time', public.fmt_appt_time(r.appointment_time),
      'ref', coalesce(r.booking_ref, upper(left(r.id::text, 8)))), 'appointments', r.id);
  end loop;
  return v_count;
end $$;
revoke all on function public.queue_appointment_reminders() from public, anon;
grant execute on function public.queue_appointment_reminders() to authenticated, service_role;

-- Used by the Edge Function (service role) to take a batch of messages to deliver.
drop function if exists public.claim_notifications(int) cascade;
create function public.claim_notifications(p_limit int default 25)
returns setof public.notification_outbox language plpgsql volatile security definer set search_path = public as $$
begin
  -- give up on messages that got stuck mid-delivery three times
  update public.notification_outbox set status = 'failed', error = coalesce(error, 'Delivery timed out')
  where status = 'sending' and attempts >= 3 and coalesce(last_attempt_at, created_at) < now() - interval '10 minutes';

  return query
    update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1, last_attempt_at = now()
    where o.id in (
      select x.id from public.notification_outbox x
      where (x.status = 'pending' and x.next_attempt_at <= now())
         or (x.status = 'sending' and x.attempts < 3 and coalesce(x.last_attempt_at, x.created_at) < now() - interval '10 minutes')
      order by x.created_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
    returning o.*;
end $$;

-- Deliver specific fresh messages right away (e.g. the OTP a visitor just requested). Used by the notify
-- function for callers that may not flush the whole queue (anonymous visitors, patients).
drop function if exists public.claim_notifications_for(uuid[]) cascade;
create function public.claim_notifications_for(p_ids uuid[])
returns setof public.notification_outbox language plpgsql volatile security definer set search_path = public as $$
begin
  return query
    update public.notification_outbox o set status = 'sending', attempts = o.attempts + 1, last_attempt_at = now()
    where o.id in (
      select x.id from public.notification_outbox x
      where x.status = 'pending' and x.attempts = 0 and x.created_at > now() - interval '15 minutes'
        and (x.id = any (p_ids) or x.related_id = any (p_ids))
      order by x.created_at
      limit 10
      for update skip locked)
    returning o.*;
end $$;
revoke all on function public.claim_notifications_for(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_notifications_for(uuid[]) to service_role;

revoke all on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;

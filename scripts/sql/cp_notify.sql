-- =====================================================================================================
-- Control panel → Messaging & alerts, Broadcasts and System health (live checks)
--
--  1. Shared accounts   platform_settings 'messaging_accounts' (provider names, sender IDs, from-address — not secret)
--                       + platform_secrets (API keys; encrypted in Supabase Vault when the extension is on, write-only).
--                       Keys use the PLATFORM_* names the Edge Functions already know; a key saved here wins over the
--                       Edge secret of the same name. platform_env() hands the merged set to the Edge Functions only.
--  2. platform_outbox   messages sent on the shared accounts that belong to no hospital's queue: team alerts,
--                       broadcasts to hospital staff (e-mail / SMS / WhatsApp) and control-panel test messages.
--                       Delivered by the `ops` Edge Function (pg_cron → ops_cron_tick → ops { flush }).
--  3. Alerts            raise_platform_alert(): one alert → bell inbox + e-mail / WhatsApp / browser push per member,
--                       limited by the channels and events an admin switched on (platform_settings 'ops') and each
--                       member's own choices (platform_alert_prefs). Repeats are folded with a dedupe key.
--  4. Broadcasts        to hospital staff by hospital / plan / status / role: in-app banner (platform_announcements),
--                       e-mail / SMS / WhatsApp (platform accounts, never the hospital's wallet) and push (the
--                       hospital's own Firebase devices, through its notification queue).
--  5. Health            the `ops` function checks the site, database, auth, storage, every Edge Function and the
--                       shared providers every 5 minutes; record_health() adds the database's own checks, keeps 30 days
--                       of history and raises alerts when a service goes down, crosses a limit or recovers.
-- Checked by tests/sql/cp_notify.test.ts.
-- =====================================================================================================

-- ------------------------------------------------------------------ settings
create or replace function public.ops_defaults()
returns jsonb language sql immutable as $$
  select '{
    "channels":   {"bell": true, "email": true, "push": false, "whatsapp": false},
    "events":     {},
    "thresholds": {"queueBacklog": 200, "failurePct": 10, "dbPct": 80, "dbLimitMb": 8192, "latencyMs": 3000, "walletLowPaise": 20000, "trialDays": 3,
                   "connPct": 80, "storagePct": 80, "storageLimitMb": 102400, "webhookHours": 24, "sslDays": 14},
    "health":     {"enabled": true, "siteUrl": ""}
  }'::jsonb
$$;

-- what can raise an alert, who receives it by default and how loud it is
create or replace function public.ops_alert_catalog()
returns jsonb language sql immutable as $$
  select '[
    {"key": "signup_new",       "label": "New sign-up",                              "group": "Sales",  "severity": "info",     "roles": ["admin"]},
    {"key": "lead_new",         "label": "New call-back request",                    "group": "Sales",  "severity": "info",     "roles": ["admin"]},
    {"key": "trial_ending",     "label": "Trial ending soon",                        "group": "Sales",  "severity": "info",     "roles": ["admin"]},
    {"key": "payment_paid",     "label": "Payment received",                         "group": "Money",  "severity": "info",     "roles": ["admin", "finance"]},
    {"key": "payment_failed",   "label": "Payment failed",                           "group": "Money",  "severity": "warning",  "roles": ["admin", "finance"]},
    {"key": "wallet_low",       "label": "Hospital wallet running low",              "group": "Money",  "severity": "warning",  "roles": ["admin", "finance"]},
    {"key": "incident_new",     "label": "Incident logged",                          "group": "Safety", "severity": "critical", "roles": ["admin", "support"]},
    {"key": "health_down",      "label": "Service down",                             "group": "System", "severity": "critical", "roles": ["admin", "support"]},
    {"key": "job_late",         "label": "Scheduled job late or failing",            "group": "System", "severity": "warning",  "roles": ["admin", "support"]},
    {"key": "delivery_spike",   "label": "Message failures spiking",                 "group": "System", "severity": "warning",  "roles": ["admin", "support"]},
    {"key": "threshold",        "label": "Limit crossed (queue, database, storage, SSL…)", "group": "System", "severity": "warning",  "roles": ["admin", "support"]},
    {"key": "health_recovered", "label": "Service back to normal",                   "group": "System", "severity": "info",     "roles": ["admin", "support"]}
  ]'::jsonb
$$;

insert into public.platform_settings (key, data) values ('ops', '{}'::jsonb), ('messaging_accounts', '{}'::jsonb) on conflict (key) do nothing;

-- saved 'ops' settings over the defaults (one level deep, so a new default threshold appears automatically)
create or replace function public.ops_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb := public.ops_defaults(); s jsonb := coalesce((select data from public.platform_settings where key = 'ops'), '{}'::jsonb); k text;
begin
  for k in select jsonb_object_keys(d) loop
    if jsonb_typeof(s -> k) = 'object' then d := jsonb_set(d, array[k], (d -> k) || (s -> k)); end if;
  end loop;
  return d;
end $$;

-- ------------------------------------------------------------------ 1. shared accounts
create table if not exists public.platform_secrets (
  key              text primary key check (key ~ '^PLATFORM_[A-Z0-9_]{2,60}$'),
  value            text,          -- only when Supabase Vault is not available
  vault_id         uuid,          -- vault.secrets.id
  hint             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text
);
alter table public.platform_secrets enable row level security;   -- no policies: unreachable through the API
revoke all on public.platform_secrets from anon, authenticated;
grant all on public.platform_secrets to service_role;

create or replace function public.platform_vault_on()
returns boolean language sql stable as $$ select exists (select 1 from pg_extension where extname = 'supabase_vault') $$;

create or replace function public.platform_secret_value(p public.platform_secrets)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p.vault_id is not null and public.platform_vault_on() then
    execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into v using p.vault_id;
    return v;
  end if;
  return p.value;
end $$;

create or replace function public.cp_messaging_setup()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return jsonb_build_object(
    'settings', coalesce((select data from public.platform_settings where key = 'messaging_accounts'), '{}'::jsonb),
    'secrets', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'hint', hint, 'updated_at', updated_at, 'updated_by_name', updated_by_name) order by key)
                           from public.platform_secrets), '[]'::jsonb),
    'templates', coalesce((select data -> 'templates' from public.platform_settings where key = 'messaging'), '{}'::jsonb),
    'vault', public.platform_vault_on());
end $$;

-- p_settings: { "PLATFORM_SMS_PROVIDER": "msg91", … } ('' removes) · p_secrets: { "PLATFORM_MSG91_AUTH_KEY": "…" } ('' removes)
create or replace function public.cp_save_messaging_setup(p_settings jsonb default '{}'::jsonb, p_secrets jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := (select full_name from public.profiles where id = auth.uid());
  s jsonb := coalesce((select data from public.platform_settings where key = 'messaging_accounts'), '{}'::jsonb);
  k text; v text; r public.platform_secrets; v_vault uuid; v_changed text[] := '{}';
begin
  perform public.cp_require(array['admin']);
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_secrets, '{}'::jsonb)) <> 'object' then raise exception 'Settings must be an object.'; end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_secrets, '{}'::jsonb)) x) and not public.recent_reauth(600) then
    raise exception 'REAUTH_REQUIRED: confirm your password to change API keys.' using errcode = '42501';
  end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_settings, '{}'::jsonb)) loop
    if k !~ '^PLATFORM_[A-Z0-9_]{2,60}$' then raise exception 'Unknown setting %', k; end if;
    if char_length(coalesce(v, '')) > 500 then raise exception '% is too long.', k; end if;
    if exists (select 1 from public.platform_secrets where key = k) then raise exception '% is an API key — save it as a key.', k; end if;
    s := case when coalesce(trim(v), '') = '' then s - k else s || jsonb_build_object(k, trim(v)) end;
    v_changed := v_changed || k;
  end loop;
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('messaging_accounts', s, now(), auth.uid())
  on conflict (key) do update set data = excluded.data, updated_at = now(), updated_by = auth.uid();

  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_secrets, '{}'::jsonb)) loop
    if k !~ '^PLATFORM_[A-Z0-9_]{2,60}$' then raise exception 'Unknown key %', k; end if;
    if char_length(coalesce(v, '')) > 8000 then raise exception '% is too long.', k; end if;
    select * into r from public.platform_secrets where key = k;
    if coalesce(v, '') = '' then
      if r.vault_id is not null and public.platform_vault_on() then execute 'delete from vault.secrets where id = $1' using r.vault_id; end if;
      delete from public.platform_secrets where key = k;
    else
      v_vault := r.vault_id;
      if public.platform_vault_on() then
        if v_vault is null then
          execute 'select id from vault.secrets where name = $1' into v_vault using 'hc_' || lower(k);
        end if;
        if v_vault is null then execute 'select vault.create_secret($1, $2, $3)' into v_vault using v, 'hc_' || lower(k), 'Hospital Comrade shared account';
        else execute 'select vault.update_secret($1, $2)' using v_vault, v; end if;
      end if;
      insert into public.platform_secrets (key, value, vault_id, hint, updated_at, updated_by, updated_by_name)
      values (k, case when v_vault is null then v end, v_vault, '••••' || case when char_length(v) >= 12 then right(v, 4) else '' end, now(), auth.uid(), v_name)
      on conflict (key) do update set value = excluded.value, vault_id = excluded.vault_id, hint = excluded.hint, updated_at = now(),
        updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
      s := s - k;   -- a key is never also kept as a plain setting
    end if;
    v_changed := v_changed || k;
  end loop;
  update public.platform_settings set data = s where key = 'messaging_accounts';
  if array_length(v_changed, 1) > 0 then
    insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
    values (auth.uid(), v_name, 'admin', 'messaging:setup', 'shared accounts', jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  return public.cp_messaging_setup();
end $$;

-- approved WhatsApp template / DLT IDs on the shared accounts, per event (same shape as before: platform_settings 'messaging')
create or replace function public.cp_save_platform_templates(p_templates jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t jsonb := '{}'::jsonb; k text; v jsonb;
begin
  perform public.cp_require(array['admin']);
  if jsonb_typeof(coalesce(p_templates, '{}'::jsonb)) <> 'object' then raise exception 'Templates must be an object.'; end if;
  for k, v in select key, value from jsonb_each(coalesce(p_templates, '{}'::jsonb)) loop
    if k !~ '^[a-z0-9_:-]{2,64}$' then raise exception 'Unknown event %', k; end if;
    v := jsonb_strip_nulls(jsonb_build_object('waTemplate', nullif(trim(v ->> 'waTemplate'), ''), 'waParams', nullif(trim(v ->> 'waParams'), ''),
                                              'smsTemplateId', nullif(trim(v ->> 'smsTemplateId'), '')));
    if v <> '{}'::jsonb then t := t || jsonb_build_object(k, v); end if;
  end loop;
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('messaging', jsonb_build_object('templates', t), now(), auth.uid())
  on conflict (key) do update set data = public.platform_settings.data || jsonb_build_object('templates', t), updated_at = now(), updated_by = auth.uid();
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'admin', 'messaging:templates', 'shared templates', jsonb_build_object('events', (select jsonb_agg(x) from jsonb_object_keys(t) x)));
  return t;
end $$;

-- settings + decrypted keys, for the Edge Functions (service role only)
create or replace function public.platform_env()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb := coalesce((select data from public.platform_settings where key = 'messaging_accounts'), '{}'::jsonb); r public.platform_secrets; v text;
begin
  for r in select * from public.platform_secrets loop
    v := public.platform_secret_value(r);
    if v is not null then out := out || jsonb_build_object(r.key, v); end if;
  end loop;
  return out;
end $$;

-- ------------------------------------------------------------------ 2. platform outbox + control-panel devices
create table if not exists public.platform_outbox (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('alert', 'broadcast', 'test')),
  ref_id           uuid,
  channel          text not null check (channel in ('email', 'sms', 'whatsapp', 'push')),
  recipient        text not null check (char_length(recipient) between 3 and 200),
  user_id          uuid,
  hospital_id      uuid references public.tenants (id) on delete cascade,   -- not tenant_id: this is no hospital's own data
  subject          text,
  body             text not null default '',
  vars             jsonb not null default '{}'::jsonb,
  status           text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts         int not null default 0,
  error            text,
  provider_ref     text,
  next_attempt_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index if not exists platform_outbox_due_idx on public.platform_outbox (next_attempt_at) where status = 'pending';
create index if not exists platform_outbox_ref_idx on public.platform_outbox (ref_id);
create index if not exists platform_outbox_created_idx on public.platform_outbox (created_at desc);
alter table public.platform_outbox enable row level security;
revoke all on public.platform_outbox from anon, authenticated;
grant all on public.platform_outbox to service_role;

create or replace function public.claim_platform_outbox(p_limit int default 25)
returns setof public.platform_outbox language plpgsql volatile security definer set search_path = public as $$
begin
  -- messages stuck in "sending" for 10 minutes (a crashed run) go back to the queue
  update public.platform_outbox set status = 'pending' where status = 'sending' and next_attempt_at < now() - interval '10 minutes';
  return query
    update public.platform_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
     where o.id in (select x.id from public.platform_outbox x where x.status = 'pending' and x.next_attempt_at <= now()
                     order by x.created_at limit greatest(1, least(p_limit, 100)) for update skip locked)
    returning o.*;
end $$;

create table if not exists public.cp_push_tokens (
  token         text primary key check (char_length(token) between 20 and 4096),
  user_id       uuid not null references auth.users (id) on delete cascade,
  user_agent    text check (char_length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists cp_push_tokens_user_idx on public.cp_push_tokens (user_id);
alter table public.cp_push_tokens enable row level security;
revoke all on public.cp_push_tokens from anon, authenticated;
grant all on public.cp_push_tokens to service_role;

create or replace function public.cp_register_push(p_token text, p_user_agent text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require();
  if char_length(coalesce(p_token, '')) not between 20 and 4096 then raise exception 'Invalid device token.'; end if;
  insert into public.cp_push_tokens (token, user_id, user_agent) values (p_token, auth.uid(), left(p_user_agent, 300))
  on conflict (token) do update set user_id = auth.uid(), user_agent = excluded.user_agent, last_seen_at = now();
  return (select count(*)::int from public.cp_push_tokens where user_id = auth.uid());
end $$;

create or replace function public.cp_unregister_push(p_token text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require();
  delete from public.cp_push_tokens where user_id = auth.uid() and (p_token is null or token = p_token);
  return (select count(*)::int from public.cp_push_tokens where user_id = auth.uid());
end $$;

-- the Firebase web settings the control panel needs to ask for browser notifications (public values only)
create or replace function public.cp_push_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb := coalesce((select data from public.platform_settings where key = 'messaging_accounts'), '{}'::jsonb);
begin
  perform public.cp_require();
  if not coalesce((public.ops_config() #>> '{channels,push}')::boolean, false) or coalesce(s ->> 'PLATFORM_FCM_PROJECT_ID', '') = '' then return null; end if;
  return jsonb_build_object('apiKey', s ->> 'PLATFORM_FCM_API_KEY', 'projectId', s ->> 'PLATFORM_FCM_PROJECT_ID', 'messagingSenderId', s ->> 'PLATFORM_FCM_SENDER_ID',
    'appId', s ->> 'PLATFORM_FCM_APP_ID', 'vapidKey', s ->> 'PLATFORM_FCM_VAPID_KEY',
    'devices', (select count(*) from public.cp_push_tokens where user_id = auth.uid()));
end $$;

-- ------------------------------------------------------------------ 3. alerts
create table if not exists public.platform_alerts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event       text not null,
  severity    text not null check (severity in ('info', 'warning', 'critical')),
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 2000),
  link        text check (char_length(link) <= 300),
  dedupe_key  text,
  data        jsonb not null default '{}'::jsonb
);
create index if not exists platform_alerts_created_idx on public.platform_alerts (created_at desc);
create index if not exists platform_alerts_dedupe_idx on public.platform_alerts (dedupe_key, created_at desc) where dedupe_key is not null;
alter table public.platform_alerts enable row level security;
revoke all on public.platform_alerts from anon, authenticated;
grant all on public.platform_alerts to service_role;

create table if not exists public.platform_alert_inbox (
  alert_id  uuid not null references public.platform_alerts (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  read_at   timestamptz,
  primary key (alert_id, user_id)
);
create index if not exists platform_alert_inbox_user_idx on public.platform_alert_inbox (user_id, read_at);
alter table public.platform_alert_inbox enable row level security;
revoke all on public.platform_alert_inbox from anon, authenticated;
grant all on public.platform_alert_inbox to service_role;

create table if not exists public.platform_alert_prefs (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  events      jsonb not null default '{}'::jsonb,    -- { "<event>": ["bell", "email", "push", "whatsapp"] }
  whatsapp    text check (whatsapp is null or whatsapp ~ '^[0-9]{10}$'),
  updated_at  timestamptz not null default now()
);
alter table public.platform_alert_prefs enable row level security;
revoke all on public.platform_alert_prefs from anon, authenticated;
grant all on public.platform_alert_prefs to service_role;

create or replace function public.ops_default_channels(p_severity text)
returns text[] language sql immutable as $$ select case when p_severity in ('critical', 'warning') then array['bell', 'email'] else array['bell'] end $$;

create or replace function public.raise_platform_alert(p_event text, p_title text, p_body text default '', p_link text default null,
  p_dedupe text default null, p_dedupe_minutes int default 60, p_severity text default null, p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  cfg jsonb := public.ops_config();
  ev jsonb := (select e from jsonb_array_elements(public.ops_alert_catalog()) e where e ->> 'key' = p_event);
  v_sev text; v_id uuid; u record; v_ch text[]; v_subject text; v_text text;
begin
  if ev is null then raise exception 'Unknown alert %', p_event; end if;
  if not coalesce((cfg #>> array['events', p_event, 'enabled'])::boolean, true) then return null; end if;
  v_sev := coalesce(nullif(p_severity, ''), nullif(cfg #>> array['events', p_event, 'severity'], ''), ev ->> 'severity');
  if v_sev not in ('info', 'warning', 'critical') then v_sev := ev ->> 'severity'; end if;
  if p_dedupe is not null and exists (select 1 from public.platform_alerts where dedupe_key = p_dedupe
                                        and created_at > now() - make_interval(mins => greatest(coalesce(p_dedupe_minutes, 60), 1))) then
    return null;
  end if;
  insert into public.platform_alerts (event, severity, title, body, link, dedupe_key, data)
  values (p_event, v_sev, left(p_title, 200), left(coalesce(p_body, ''), 2000), left(p_link, 300), p_dedupe, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  v_subject := case v_sev when 'critical' then '[Critical] ' when 'warning' then '[Warning] ' else '' end || left(p_title, 180);
  v_text := p_title || case when coalesce(p_body, '') <> '' then E'\n\n' || p_body else '' end;
  for u in select pu.user_id, pu.role, a.email, pr.events as pevents, pr.whatsapp
             from public.provider_users pu join auth.users a on a.id = pu.user_id
             left join public.platform_alert_prefs pr on pr.user_id = pu.user_id
            where pu.active and (pu.role = 'admin' or pu.role in (select jsonb_array_elements_text(ev -> 'roles'))) loop
    v_ch := case when jsonb_typeof(u.pevents -> p_event) = 'array' then array(select jsonb_array_elements_text(u.pevents -> p_event)) else public.ops_default_channels(v_sev) end;
    v_ch := array(select c from unnest(v_ch) c where coalesce((cfg #>> array['channels', c])::boolean, false));
    if 'bell' = any (v_ch) then insert into public.platform_alert_inbox (alert_id, user_id) values (v_id, u.user_id) on conflict do nothing; end if;
    if 'email' = any (v_ch) and coalesce(u.email, '') <> '' then
      insert into public.platform_outbox (kind, ref_id, channel, recipient, user_id, subject, body, vars)
      values ('alert', v_id, 'email', u.email, u.user_id, v_subject, v_text, jsonb_build_object('title', p_title, 'body', coalesce(p_body, ''), 'link', coalesce(p_link, ''), 'severity', v_sev));
    end if;
    if 'whatsapp' = any (v_ch) and coalesce(u.whatsapp, '') <> '' then
      insert into public.platform_outbox (kind, ref_id, channel, recipient, user_id, subject, body, vars)
      values ('alert', v_id, 'whatsapp', u.whatsapp, u.user_id, v_subject, v_text, jsonb_build_object('title', p_title, 'body', coalesce(p_body, ''), 'link', coalesce(p_link, ''), 'severity', v_sev));
    end if;
    if 'push' = any (v_ch) and exists (select 1 from public.cp_push_tokens t where t.user_id = u.user_id) then
      insert into public.platform_outbox (kind, ref_id, channel, recipient, user_id, subject, body, vars)
      values ('alert', v_id, 'push', u.user_id::text, u.user_id, v_subject, coalesce(nullif(p_body, ''), p_title), jsonb_build_object('title', p_title, 'link', coalesce(p_link, ''), 'severity', v_sev));
    end if;
  end loop;
  return v_id;
end $$;

-- a broken alert must never block the sign-up / payment / lead that caused it
create or replace function public.raise_platform_alert_safe(p_event text, p_title text, p_body text default '', p_link text default null,
  p_dedupe text default null, p_dedupe_minutes int default 60, p_severity text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.raise_platform_alert(p_event, p_title, p_body, p_link, p_dedupe, p_dedupe_minutes, p_severity);
exception when others then
  raise warning 'platform alert % not raised: %', p_event, sqlerrm;
end $$;

create or replace function public.ops_alert_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hosp text;
begin
  if tg_table_name = 'platform_signups' then
    perform public.raise_platform_alert_safe('signup_new', 'New sign-up: ' || new.organisation,
      new.contact_name || ' · ' || new.plan || ' plan' || coalesce(' · ' || nullif(new.city, ''), '') || case when new.status = 'pending' then ' · waiting for approval' else '' end, '/signups');
  elsif tg_table_name = 'platform_leads' then
    perform public.raise_platform_alert_safe('lead_new', 'Call-back request: ' || new.organisation,
      new.name || ' · ' || new.phone || coalesce(' · ' || nullif(new.city, ''), '') || coalesce(' · ' || nullif(new.plan, ''), ''), '/leads');
  elsif tg_table_name = 'billing_payments' then
    if new.status is distinct from coalesce(old.status, '') and new.status in ('paid', 'failed') then
      v_hosp := (select name from public.tenants where id = new.tenant_id);
      perform public.raise_platform_alert_safe(case new.status when 'paid' then 'payment_paid' else 'payment_failed' end,
        case new.status when 'paid' then 'Payment received: ' else 'Payment failed: ' end || coalesce(v_hosp, 'hospital'),
        '₹' || to_char(new.total_paise / 100.0, 'FM99,99,99,990.00') || ' · ' || case new.kind when 'plan' then coalesce(new.plan, '') || ' plan' else 'wallet top-up' end,
        '/hospitals/' || new.tenant_id, 'payment:' || new.id || ':' || new.status, 1440);
    end if;
  elsif tg_table_name = 'platform_incidents' then
    perform public.raise_platform_alert_safe('incident_new', 'Incident: ' || new.title,
      initcap(new.severity) || ' severity' || case when new.personal_data then ' · personal data involved' else '' end, '/incidents', null, 60,
      case when new.severity in ('high', 'critical') then 'critical' else 'warning' end);
  end if;
  return new;
end $$;

drop trigger if exists trg_ops_alert on public.platform_signups;
create trigger trg_ops_alert after insert on public.platform_signups for each row execute function public.ops_alert_trigger();
drop trigger if exists trg_ops_alert on public.platform_leads;
create trigger trg_ops_alert after insert on public.platform_leads for each row execute function public.ops_alert_trigger();
drop trigger if exists trg_ops_alert on public.billing_payments;
create trigger trg_ops_alert after insert or update of status on public.billing_payments for each row execute function public.ops_alert_trigger();
drop trigger if exists trg_ops_alert on public.platform_incidents;
create trigger trg_ops_alert after insert on public.platform_incidents for each row execute function public.ops_alert_trigger();

-- hourly: trials ending soon and wallets running low (each at most once a day per hospital)
create or replace function public.run_platform_hourly_alerts()
returns int language plpgsql volatile security definer set search_path = public as $$
declare cfg jsonb := public.ops_config(); t record; n int := 0;
        v_days int := greatest(coalesce((cfg #>> '{thresholds,trialDays}')::int, 3), 1);
        v_low bigint := greatest(coalesce((cfg #>> '{thresholds,walletLowPaise}')::bigint, 0), 0);
begin
  for t in select id, name, trial_ends_at from public.tenants
            where not is_primary and closing_at is null and trial_ends_at between now() and now() + make_interval(days => v_days)
              and coalesce(paid_until, '-infinity'::timestamptz) < trial_ends_at loop
    if public.raise_platform_alert('trial_ending', 'Trial ending: ' || t.name,
         'The free trial ends on ' || to_char(t.trial_ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ' and no plan has been paid yet.',
         '/hospitals/' || t.id, 'trial:' || t.id || ':' || current_date, 1440) is not null then n := n + 1; end if;
  end loop;
  if v_low > 0 then
    for t in select id, name, wallet_paise from public.tenants
              where not is_primary and closing_at is null and status in ('active', 'grace', 'trial') and wallet_paise < v_low loop
      if public.raise_platform_alert('wallet_low', 'Wallet low: ' || t.name,
           'Balance ₹' || to_char(t.wallet_paise / 100.0, 'FM99,99,99,990.00') || ' — messages beyond the plan stop when it runs out.',
           '/hospitals/' || t.id, 'wallet:' || t.id || ':' || current_date, 1440) is not null then n := n + 1; end if;
    end loop;
  end if;
  return n;
end $$;

-- the signed-in member's bell
create or replace function public.cp_alerts(p_limit int default 30, p_unread_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require();
  return jsonb_build_object(
    'unread', (select count(*) from public.platform_alert_inbox where user_id = auth.uid() and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'created_at', x.created_at, 'event', x.event, 'severity', x.severity,
                         'title', x.title, 'body', x.body, 'link', x.link, 'read_at', x.read_at) order by x.created_at desc)
                         from (select a.*, i.read_at from public.platform_alert_inbox i join public.platform_alerts a on a.id = i.alert_id
                                where i.user_id = auth.uid() and (not p_unread_only or i.read_at is null)
                                order by a.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 200))) x), '[]'::jsonb));
end $$;

create or replace function public.cp_alerts_read(p_ids uuid[] default null)
returns int language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require();
  update public.platform_alert_inbox set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or alert_id = any (p_ids));
  return (select count(*)::int from public.platform_alert_inbox where user_id = auth.uid() and read_at is null);
end $$;

-- the member's own choices, limited to the events their role receives and the channels an admin switched on
create or replace function public.cp_alert_prefs()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text := public.cp_require(); cfg jsonb := public.ops_config(); pr public.platform_alert_prefs;
begin
  select * into pr from public.platform_alert_prefs where user_id = auth.uid();
  return jsonb_build_object(
    'channels', cfg -> 'channels',
    'events', coalesce((select jsonb_agg(e || jsonb_build_object(
                  'enabled', coalesce((cfg #>> array['events', e ->> 'key', 'enabled'])::boolean, true),
                  'severity', coalesce(nullif(cfg #>> array['events', e ->> 'key', 'severity'], ''), e ->> 'severity'),
                  'mine', case when jsonb_typeof(pr.events -> (e ->> 'key')) = 'array' then pr.events -> (e ->> 'key')
                               else to_jsonb(public.ops_default_channels(coalesce(nullif(cfg #>> array['events', e ->> 'key', 'severity'], ''), e ->> 'severity'))) end))
                 from jsonb_array_elements(public.ops_alert_catalog()) e where v_role = 'admin' or e -> 'roles' ? v_role), '[]'::jsonb),
    'whatsapp', pr.whatsapp,
    'devices', (select count(*) from public.cp_push_tokens where user_id = auth.uid()));
end $$;

create or replace function public.cp_save_alert_prefs(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_ev jsonb := '{}'::jsonb; k text; v jsonb; v_wa text := nullif(regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'), '');
begin
  perform public.cp_require();
  if v_wa is not null then v_wa := right(v_wa, 10); if char_length(v_wa) <> 10 then raise exception 'Enter a 10-digit WhatsApp number.'; end if; end if;
  for k, v in select key, value from jsonb_each(coalesce(p -> 'events', '{}'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(public.ops_alert_catalog()) e where e ->> 'key' = k) then raise exception 'Unknown alert %', k; end if;
    if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements_text(v) c where c not in ('bell', 'email', 'push', 'whatsapp')) then
      raise exception 'Unknown channel for %', k;
    end if;
    v_ev := v_ev || jsonb_build_object(k, v);
  end loop;
  insert into public.platform_alert_prefs (user_id, events, whatsapp, updated_at) values (auth.uid(), v_ev, v_wa, now())
  on conflict (user_id) do update set events = excluded.events, whatsapp = excluded.whatsapp, updated_at = now();
  return public.cp_alert_prefs();
end $$;

-- admin: which channels / events exist platform-wide, limits and the address used for health checks and links
create or replace function public.cp_ops_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return public.ops_config() || jsonb_build_object('catalog', public.ops_alert_catalog());
end $$;

create or replace function public.cp_save_ops_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cur jsonb := public.ops_config(); out jsonb := '{}'::jsonb; v_url text;
begin
  perform public.cp_require(array['admin']);
  p := coalesce(p, '{}'::jsonb);
  -- a section left out keeps its current values
  out := jsonb_build_object('channels', (select jsonb_object_agg(c, coalesce((p #>> array['channels', c])::boolean, (cur #>> array['channels', c])::boolean))
                                          from jsonb_object_keys(cur -> 'channels') c));
  out := out || jsonb_build_object('events', coalesce((select jsonb_object_agg(e ->> 'key', jsonb_build_object(
            'enabled', coalesce((p #>> array['events', e ->> 'key', 'enabled'])::boolean, (cur #>> array['events', e ->> 'key', 'enabled'])::boolean, true),
            'severity', case when p #>> array['events', e ->> 'key', 'severity'] in ('info', 'warning', 'critical') then p #>> array['events', e ->> 'key', 'severity']
                             when cur #>> array['events', e ->> 'key', 'severity'] in ('info', 'warning', 'critical') then cur #>> array['events', e ->> 'key', 'severity']
                             else e ->> 'severity' end))
           from jsonb_array_elements(public.ops_alert_catalog()) e), '{}'::jsonb));
  out := out || jsonb_build_object('thresholds', (select jsonb_object_agg(t, greatest(0, coalesce(nullif(p #>> array['thresholds', t], '')::numeric, (cur #>> array['thresholds', t])::numeric)))
                                                   from jsonb_object_keys(cur -> 'thresholds') t));
  if (out #>> '{thresholds,dbPct}')::numeric > 100 or (out #>> '{thresholds,failurePct}')::numeric > 100 then raise exception 'Percentages must be 100 or less.'; end if;
  v_url := trim(both '/' from trim(coalesce(case when p -> 'health' ? 'siteUrl' then p #>> '{health,siteUrl}' else cur #>> '{health,siteUrl}' end, '')));
  if v_url <> '' and v_url !~ '^https://[a-z0-9.-]+(:[0-9]+)?(/[^ ]*)?$' then raise exception 'Platform address must start with https://'; end if;
  out := out || jsonb_build_object('health', jsonb_build_object('enabled', coalesce((p #>> '{health,enabled}')::boolean, (cur #>> '{health,enabled}')::boolean, true), 'siteUrl', v_url));
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('ops', out, now(), auth.uid())
  on conflict (key) do update set data = excluded.data, updated_at = now(), updated_by = auth.uid();
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'admin', 'ops:settings', 'alerts & health', out);
  return public.cp_ops_settings();
end $$;

-- ------------------------------------------------------------------ 4. broadcasts
create table if not exists public.platform_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 3 and 120),
  body             text not null default '' check (char_length(body) <= 2000),
  link             text check (link is null or (link ~ '^https://' and char_length(link) <= 300)),
  level            text not null default 'info' check (level in ('info', 'warning', 'critical')),
  channels         text[] not null default array['inapp'],
  audience         jsonb not null default '{}'::jsonb,   -- { hospitals: [ids]|null, plans: [], statuses: [], roles: [] }
  status           text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'cancelled')),
  scheduled_at     timestamptz,
  sent_at          timestamptz,
  announcement_id  uuid references public.platform_announcements (id) on delete set null,
  stats            jsonb not null default '{}'::jsonb,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (channels <@ array['inapp', 'email', 'sms', 'whatsapp', 'push'] and cardinality(channels) > 0)
);
alter table public.platform_broadcasts enable row level security;
revoke all on public.platform_broadcasts from anon, authenticated;
grant all on public.platform_broadcasts to service_role;

-- hospital staff matching an audience (hospitals that are closing are left out)
create or replace function public.broadcast_recipients(p_audience jsonb)
returns table (tenant_id uuid, hospital text, profile_id uuid, role text, full_name text, email text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare
  a jsonb := coalesce(p_audience, '{}'::jsonb);
  v_ids uuid[] := case when jsonb_typeof(a -> 'hospitals') = 'array' and jsonb_array_length(a -> 'hospitals') > 0
                       then (select array_agg(x::uuid) from jsonb_array_elements_text(a -> 'hospitals') x) end;
  v_plans text[] := case when jsonb_typeof(a -> 'plans') = 'array' and jsonb_array_length(a -> 'plans') > 0 then (select array_agg(x) from jsonb_array_elements_text(a -> 'plans') x) end;
  v_statuses text[] := case when jsonb_typeof(a -> 'statuses') = 'array' and jsonb_array_length(a -> 'statuses') > 0 then (select array_agg(x) from jsonb_array_elements_text(a -> 'statuses') x) end;
  v_roles text[] := coalesce(case when jsonb_typeof(a -> 'roles') = 'array' and jsonb_array_length(a -> 'roles') > 0 then (select array_agg(x) from jsonb_array_elements_text(a -> 'roles') x) end, array['owner']);
begin
  if exists (select 1 from unnest(v_roles) x where x not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff')) then raise exception 'Broadcasts go to staff roles only.'; end if;
  return query
    select t.id, t.name, p.id, p.role::text, p.full_name, coalesce(nullif(p.email, ''), u.email), nullif(right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10), '')
      from public.tenants t
      join public.profiles p on p.tenant_id = t.id and p.role::text = any (v_roles)
      left join auth.users u on u.id = p.id
     where t.closing_at is null
       and (v_ids is null or t.id = any (v_ids))
       and (v_plans is null or t.plan = any (v_plans))
       and (v_statuses is null or t.status = any (v_statuses))
       and coalesce(u.banned_until, '-infinity'::timestamptz) < now();
end $$;

create or replace function public.cp_broadcast_preview(p_audience jsonb, p_channels text[] default array['inapp'])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return (select jsonb_build_object(
      'hospitals', count(distinct r.tenant_id), 'people', count(*),
      'email', count(*) filter (where coalesce(r.email, '') ~ '@'),
      'sms', count(*) filter (where char_length(coalesce(r.phone, '')) = 10),
      'whatsapp', count(*) filter (where char_length(coalesce(r.phone, '')) = 10),
      'push', count(*) filter (where exists (select 1 from public.push_tokens k where k.profile_id = r.profile_id)),
      'sample', coalesce((select jsonb_agg(distinct x.hospital) from (select hospital from public.broadcast_recipients(p_audience) limit 50) x), '[]'::jsonb))
    from public.broadcast_recipients(p_audience) r);
end $$;

create or replace function public.cp_save_broadcast(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; r public.platform_broadcasts; v_ch text[]; v_aud jsonb;
begin
  perform public.cp_require(array['admin']);
  v_ch := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p -> 'channels', '["inapp"]'::jsonb)) x), array['inapp']);
  v_aud := jsonb_build_object('hospitals', coalesce(p #> '{audience,hospitals}', 'null'::jsonb), 'plans', coalesce(p #> '{audience,plans}', '[]'::jsonb),
                              'statuses', coalesce(p #> '{audience,statuses}', '[]'::jsonb), 'roles', coalesce(p #> '{audience,roles}', '["owner"]'::jsonb));
  perform 1 from public.broadcast_recipients(v_aud) limit 1;   -- validates roles
  if v_id is null then
    insert into public.platform_broadcasts (title, body, link, level, channels, audience, created_by, created_by_name)
    values (trim(coalesce(p ->> 'title', '')), trim(coalesce(p ->> 'body', '')), nullif(trim(coalesce(p ->> 'link', '')), ''), coalesce(nullif(p ->> 'level', ''), 'info'),
            v_ch, v_aud, auth.uid(), (select full_name from public.profiles where id = auth.uid()))
    returning * into r;
  else
    update public.platform_broadcasts set title = trim(coalesce(p ->> 'title', title)), body = trim(coalesce(p ->> 'body', body)),
           link = nullif(trim(coalesce(p ->> 'link', '')), ''), level = coalesce(nullif(p ->> 'level', ''), level), channels = v_ch, audience = v_aud, updated_at = now()
     where id = v_id and status in ('draft', 'scheduled') returning * into r;
    if not found then raise exception 'Only drafts and scheduled broadcasts can be changed.'; end if;
  end if;
  return to_jsonb(r);
end $$;

-- queue a broadcast on every chosen channel (called right away, or by the scheduler when its time comes)
create or replace function public.broadcast_dispatch(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.platform_broadcasts; v_ann uuid; v_ids uuid[]; st jsonb := '{}'::jsonb; n int; v_text text;
begin
  select * into b from public.platform_broadcasts where id = p_id for update;
  if not found or b.status not in ('draft', 'scheduled') then raise exception 'This broadcast was already sent or cancelled.'; end if;
  v_text := b.title || case when b.body <> '' then E'\n\n' || b.body else '' end || case when b.link is not null then E'\n\n' || b.link else '' end;
  create temporary table if not exists _bc_people (tenant_id uuid, hospital text, profile_id uuid, role text, full_name text, email text, phone text) on commit drop;
  truncate _bc_people;
  insert into _bc_people select * from public.broadcast_recipients(b.audience);
  if 'inapp' = any (b.channels) then
    v_ids := (select array_agg(distinct tenant_id) from _bc_people);
    insert into public.platform_announcements (title, body, level, hospital_ids, roles, starts_at, ends_at, active, created_by, created_by_name)
    values (left(b.title, 120), left(b.body, 1000), b.level,
            case when jsonb_typeof(b.audience -> 'hospitals') = 'array' or jsonb_array_length(coalesce(b.audience -> 'plans', '[]')) > 0 or jsonb_array_length(coalesce(b.audience -> 'statuses', '[]')) > 0
                 then coalesce(v_ids, array[]::uuid[]) end,
            array(select jsonb_array_elements_text(coalesce(b.audience -> 'roles', '["owner"]'))), now(), now() + interval '14 days', true, b.created_by, b.created_by_name)
    returning id into v_ann;
    st := st || jsonb_build_object('inapp', coalesce(array_length(v_ids, 1), 0));
  end if;
  if 'email' = any (b.channels) then
    insert into public.platform_outbox (kind, ref_id, channel, recipient, hospital_id, subject, body, vars)
    select distinct on (lower(email)) 'broadcast', b.id, 'email', email, tenant_id, b.title, v_text, jsonb_build_object('name', coalesce(full_name, ''), 'hospital', hospital, 'title', b.title, 'link', coalesce(b.link, ''))
      from _bc_people where email ~ '@';
    get diagnostics n = row_count; st := st || jsonb_build_object('email', n);
  end if;
  if 'sms' = any (b.channels) then
    insert into public.platform_outbox (kind, ref_id, channel, recipient, hospital_id, subject, body, vars)
    select distinct on (phone) 'broadcast', b.id, 'sms', phone, tenant_id, b.title, v_text, jsonb_build_object('name', coalesce(full_name, ''), 'hospital', hospital, 'title', b.title, 'link', coalesce(b.link, ''))
      from _bc_people where char_length(coalesce(phone, '')) = 10;
    get diagnostics n = row_count; st := st || jsonb_build_object('sms', n);
  end if;
  if 'whatsapp' = any (b.channels) then
    insert into public.platform_outbox (kind, ref_id, channel, recipient, hospital_id, subject, body, vars)
    select distinct on (phone) 'broadcast', b.id, 'whatsapp', phone, tenant_id, b.title, v_text, jsonb_build_object('name', coalesce(full_name, ''), 'hospital', hospital, 'title', b.title, 'link', coalesce(b.link, ''))
      from _bc_people where char_length(coalesce(phone, '')) = 10;
    get diagnostics n = row_count; st := st || jsonb_build_object('whatsapp', n);
  end if;
  if 'push' = any (b.channels) then
    -- the hospital's own Firebase devices, through its own queue (push costs nothing)
    insert into public.notification_outbox (tenant_id, event, channel, recipient, subject, body, vars, related_table, related_id)
    select p.tenant_id, 'platform_broadcast', 'push', p.profile_id::text, b.title, coalesce(nullif(b.body, ''), b.title), jsonb_build_object('link', coalesce(b.link, '')), 'platform_broadcasts', b.id
      from _bc_people p where exists (select 1 from public.push_tokens k where k.profile_id = p.profile_id);
    get diagnostics n = row_count; st := st || jsonb_build_object('push', n);
  end if;
  update public.platform_broadcasts set status = 'sent', sent_at = now(), announcement_id = v_ann, stats = st, updated_at = now() where id = b.id;
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (coalesce(auth.uid(), b.created_by), coalesce((select full_name from public.profiles where id = auth.uid()), b.created_by_name), 'admin', 'broadcast:send', b.title,
          jsonb_build_object('id', b.id, 'channels', to_jsonb(b.channels), 'queued', st));
  return st;
end $$;

create or replace function public.cp_send_broadcast(p_id uuid, p_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.platform_broadcasts;
begin
  perform public.cp_require(array['admin']);
  select * into b from public.platform_broadcasts where id = p_id;
  if not found then raise exception 'Broadcast not found.'; end if;
  if b.status not in ('draft', 'scheduled') then raise exception 'This broadcast was already sent or cancelled.'; end if;
  if p_at is not null and p_at > now() + interval '1 minute' then
    if p_at > now() + interval '90 days' then raise exception 'Schedule within the next 90 days.'; end if;
    update public.platform_broadcasts set status = 'scheduled', scheduled_at = p_at, updated_at = now() where id = p_id returning * into b;
    return to_jsonb(b);
  end if;
  perform public.broadcast_dispatch(p_id);
  return (select to_jsonb(x) from public.platform_broadcasts x where id = p_id);
end $$;

create or replace function public.cp_cancel_broadcast(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.platform_broadcasts;
begin
  perform public.cp_require(array['admin']);
  select * into b from public.platform_broadcasts where id = p_id;
  if not found then raise exception 'Broadcast not found.'; end if;
  if b.status = 'draft' then delete from public.platform_broadcasts where id = p_id; return null; end if;
  if b.status <> 'scheduled' then raise exception 'Only drafts and scheduled broadcasts can be cancelled.'; end if;
  update public.platform_broadcasts set status = 'cancelled', updated_at = now() where id = p_id returning * into b;
  return to_jsonb(b);
end $$;

create or replace function public.cp_broadcasts(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('delivery', coalesce((
             select jsonb_object_agg(channel, s) from (
               select channel, jsonb_build_object('sent', count(*) filter (where status = 'sent'), 'failed', count(*) filter (where status in ('failed', 'skipped')),
                                                  'pending', count(*) filter (where status in ('pending', 'sending'))) s
                 from (select channel, status from public.platform_outbox where ref_id = b.id
                       union all select channel, status from public.notification_outbox where related_table = 'platform_broadcasts' and related_id = b.id) x
                group by channel) y), '{}'::jsonb)) order by b.created_at desc)
     from (select * from public.platform_broadcasts order by created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) b), '[]'::jsonb);
end $$;

create or replace function public.run_due_broadcasts()
returns int language plpgsql volatile security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.platform_broadcasts where status = 'scheduled' and scheduled_at <= now() order by scheduled_at limit 5 loop
    begin perform public.broadcast_dispatch(r.id); n := n + 1;
    exception when others then raise warning 'broadcast % not sent: %', r.id, sqlerrm; end;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------ delivery log (every hospital + the platform)
create or replace function public.cp_delivery_log(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_src text := coalesce(nullif(p ->> 'source', ''), 'all');
  v_status text := nullif(p ->> 'status', ''); v_channel text := nullif(p ->> 'channel', '');
  v_hosp uuid := nullif(p ->> 'hospital', '')::uuid; v_q text := nullif(trim(coalesce(p ->> 'q', '')), '');
  v_limit int := greatest(1, least(coalesce((p ->> 'limit')::int, 100), 300));
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select * from (
        select 'hospital' as source, o.id, o.created_at, o.tenant_id as hospital_id, t.name as hospital, o.event as kind, o.channel, o.status, o.attempts, o.error, o.provider_ref,
               case when o.channel = 'push' then 'device' else o.recipient end as recipient, o.subject, o.sent_at
          from public.notification_outbox o left join public.tenants t on t.id = o.tenant_id
         where v_src in ('all', 'hospital')
           and (v_status is null or o.status = v_status or (v_status = 'failed' and o.status = 'skipped'))
           and (v_channel is null or o.channel = v_channel) and (v_hosp is null or o.tenant_id = v_hosp)
           and (v_q is null or o.recipient ilike '%' || v_q || '%' or o.event ilike '%' || v_q || '%' or coalesce(o.error, '') ilike '%' || v_q || '%')
         order by o.created_at desc limit v_limit) a
      union all
      select * from (
        select 'platform', o.id, o.created_at, o.hospital_id, t.name, o.kind, o.channel, o.status, o.attempts, o.error, o.provider_ref,
               case when o.channel = 'push' then 'team device' else o.recipient end, o.subject, o.sent_at
          from public.platform_outbox o left join public.tenants t on t.id = o.hospital_id
         where v_src in ('all', 'platform')
           and (v_status is null or o.status = v_status or (v_status = 'failed' and o.status = 'skipped'))
           and (v_channel is null or o.channel = v_channel) and (v_hosp is null or o.hospital_id = v_hosp)
           and (v_q is null or o.recipient ilike '%' || v_q || '%' or o.kind ilike '%' || v_q || '%' or coalesce(o.error, '') ilike '%' || v_q || '%')
         order by o.created_at desc limit v_limit) b
      order by created_at desc limit v_limit) x), '[]'::jsonb);
end $$;

create or replace function public.cp_retry_message(p_source text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  if p_source = 'platform' then
    update public.platform_outbox set status = 'pending', attempts = 0, error = null, next_attempt_at = now() where id = p_id and status in ('failed', 'skipped');
  elsif p_source = 'hospital' then
    update public.notification_outbox set status = 'pending', attempts = 0, error = null, next_attempt_at = now()
     where id = p_id and status in ('failed', 'skipped') and event not in ('otp', 'password_otp', 'test');
  else raise exception 'Unknown source.'; end if;
  if not found then raise exception 'Only failed messages can be retried (one-time codes and tests cannot).'; end if;
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'admin', 'message:retry', p_source, jsonb_build_object('id', p_id));
end $$;

-- ------------------------------------------------------------------ 5. health
create table if not exists public.platform_health_checks (
  id          bigint generated always as identity primary key,
  checked_at  timestamptz not null default now(),
  service     text not null check (char_length(service) between 2 and 60),
  status      text not null check (status in ('ok', 'warn', 'fail', 'off')),
  latency_ms  int,
  detail      text check (char_length(detail) <= 500)
);
create index if not exists platform_health_checks_idx on public.platform_health_checks (service, checked_at desc);
create index if not exists platform_health_checks_at_idx on public.platform_health_checks (checked_at);
alter table public.platform_health_checks enable row level security;
revoke all on public.platform_health_checks from anon, authenticated;
grant all on public.platform_health_checks to service_role;

create table if not exists public.platform_health_state (
  service          text primary key,
  label            text,
  grp              text,
  status           text not null,
  since            timestamptz not null default now(),
  last_checked_at  timestamptz not null default now(),
  latency_ms       int,
  detail           text
);
alter table public.platform_health_state enable row level security;
revoke all on public.platform_health_state from anon, authenticated;
grant all on public.platform_health_state to service_role;

-- "last seen" times written by Edge Functions (Razorpay webhook received / rejected)
create table if not exists public.platform_heartbeats (
  key      text primary key check (key ~ '^[a-z0-9_:-]{2,60}$'),
  last_at  timestamptz not null default now(),
  detail   text check (char_length(detail) <= 300),
  count    bigint not null default 1
);
alter table public.platform_heartbeats enable row level security;
revoke all on public.platform_heartbeats from anon, authenticated;
grant all on public.platform_heartbeats to service_role;

create or replace function public.note_heartbeat(p_key text, p_detail text default null)
returns void language sql volatile security definer set search_path = public as $$
  insert into public.platform_heartbeats (key, last_at, detail) values (p_key, now(), left(p_detail, 300))
  on conflict (key) do update set last_at = now(), detail = excluded.detail, count = public.platform_heartbeats.count + 1;
$$;

-- the database's own checks: size, connections, storage, message queues, delivery failures, scheduler, Razorpay webhook
create or replace function public.platform_db_checks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  th jsonb := public.ops_config() -> 'thresholds';
  v_size bigint := pg_database_size(current_database());
  v_limit numeric := greatest(coalesce((th ->> 'dbLimitMb')::numeric, 8192), 1) * 1024 * 1024;
  v_pct numeric; v_backlog int; v_total int; v_failed int; v_fpct numeric; v_cron boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  v_last timestamptz; v_bad int := 0; out jsonb := '[]'::jsonb; v_q int := greatest(coalesce((th ->> 'queueBacklog')::int, 200), 1);
  v_conn int; v_max int; v_cpct numeric; v_st bigint; v_slimit numeric; v_spct numeric;
  v_hours int := greatest(coalesce((th ->> 'webhookHours')::int, 24), 1); v_wh timestamptz; v_whbad timestamptz; v_paid int; v_oldest timestamptz;
begin
  -- connections in use vs max_connections
  select count(*) into v_conn from pg_stat_activity;
  v_max := greatest(coalesce(current_setting('max_connections', true)::int, 100), 1);
  v_cpct := round(v_conn * 100.0 / v_max, 1);
  out := out || jsonb_build_object('service', 'db:connections', 'label', 'Database connections', 'group', 'Database',
    'status', case when v_cpct >= greatest(coalesce((th ->> 'connPct')::numeric, 80), 95) then 'fail' when v_cpct >= coalesce((th ->> 'connPct')::numeric, 80) then 'warn' else 'ok' end,
    'detail', v_conn || ' of ' || v_max || ' in use (' || v_cpct || '%)');
  -- file storage used (all buckets) vs the plan's limit
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'metadata') then
    execute $q$ select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects $q$ into v_st;
    v_slimit := greatest(coalesce((th ->> 'storageLimitMb')::numeric, 102400), 1) * 1024 * 1024;
    v_spct := round(v_st * 100.0 / v_slimit, 1);
    out := out || jsonb_build_object('service', 'storage:usage', 'label', 'File storage used', 'group', 'Database',
      'status', case when v_spct >= greatest(coalesce((th ->> 'storagePct')::numeric, 80), 95) then 'fail' when v_spct >= coalesce((th ->> 'storagePct')::numeric, 80) then 'warn' else 'ok' end,
      'detail', pg_size_pretty(v_st) || ' of ' || pg_size_pretty(v_slimit::bigint) || ' (' || v_spct || '%)');
  end if;
  -- Razorpay webhook: every online payment marked paid should be followed by a webhook
  select last_at into v_wh from public.platform_heartbeats where key = 'razorpay_webhook';
  select last_at into v_whbad from public.platform_heartbeats where key = 'razorpay_webhook_bad';
  select count(*), min(paid_at) into v_paid, v_oldest from public.billing_payments
   where provider = 'razorpay' and status = 'paid' and paid_at > now() - make_interval(hours => v_hours) and paid_at < now() - interval '15 minutes';
  out := out || jsonb_build_object('service', 'webhook:razorpay', 'label', 'Razorpay webhook', 'group', 'Payments',
    'status', case when v_whbad is not null and v_whbad > coalesce(v_wh, '-infinity') and v_whbad > now() - make_interval(hours => v_hours) then 'warn'
                   when v_paid > 0 and coalesce(v_wh, '-infinity') < v_oldest then 'warn'
                   when v_wh is null then 'off' else 'ok' end,
    'detail', case when v_whbad is not null and v_whbad > coalesce(v_wh, '-infinity') and v_whbad > now() - make_interval(hours => v_hours)
                     then 'Webhooks are being rejected (bad signature) — the webhook secret in Razorpay and RAZORPAY_WEBHOOK_SECRET differ'
                   when v_paid > 0 and coalesce(v_wh, '-infinity') < v_oldest
                     then v_paid || ' online payment(s) in the last ' || v_hours || ' h but no webhook since — check Razorpay → Webhooks'
                   when v_wh is null then 'No webhook received yet'
                   else 'Last webhook ' || to_char(v_wh at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' IST' end);

  v_pct := round(v_size * 100.0 / v_limit, 1);
  out := out || jsonb_build_object('service', 'db:size', 'label', 'Database size', 'group', 'Database',
    'status', case when v_pct >= greatest(coalesce((th ->> 'dbPct')::numeric, 80), 95) then 'fail' when v_pct >= coalesce((th ->> 'dbPct')::numeric, 80) then 'warn' else 'ok' end,
    'detail', pg_size_pretty(v_size) || ' of ' || pg_size_pretty(v_limit::bigint) || ' (' || v_pct || '%)');
  select count(*) into v_backlog from (
    select 1 from public.notification_outbox where status = 'pending' and next_attempt_at < now() - interval '5 minutes'
    union all select 1 from public.platform_outbox where status = 'pending' and next_attempt_at < now() - interval '5 minutes') x;
  out := out || jsonb_build_object('service', 'db:queue', 'label', 'Message queue', 'group', 'Messages',
    'status', case when v_backlog >= v_q * 5 then 'fail' when v_backlog >= v_q then 'warn' else 'ok' end,
    'detail', v_backlog || ' messages waiting more than 5 minutes (limit ' || v_q || ')');
  select count(*), count(*) filter (where status in ('failed')) into v_total, v_failed from (
    select status from public.notification_outbox where status in ('sent', 'failed') and created_at > now() - interval '1 hour'
    union all select status from public.platform_outbox where status in ('sent', 'failed') and created_at > now() - interval '1 hour') x;
  v_fpct := case when v_total > 0 then round(v_failed * 100.0 / v_total, 1) else 0 end;
  out := out || jsonb_build_object('service', 'db:delivery', 'label', 'Delivery success', 'group', 'Messages',
    'status', case when v_total >= 10 and v_fpct >= coalesce((th ->> 'failurePct')::numeric, 10) then 'warn' else 'ok' end,
    'detail', case when v_total = 0 then 'No messages in the last hour' else v_failed || ' of ' || v_total || ' failed in the last hour (' || v_fpct || '%)' end);
  if not v_cron then
    out := out || jsonb_build_object('service', 'db:cron', 'label', 'Scheduler', 'group', 'Database', 'status', 'fail', 'detail', 'pg_cron is off — reminders, retries and these checks do not run');
  else
    execute $q$ select max(d.start_time) from cron.job j join cron.job_run_details d on d.jobid = j.jobid where j.jobname = 'dch-notify-flush' $q$ into v_last;
    execute $q$ select count(*) from cron.job j join lateral (select status from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true
                where j.jobname like 'dch-%' and d.status = 'failed' $q$ into v_bad;
    out := out || jsonb_build_object('service', 'db:cron', 'label', 'Scheduler', 'group', 'Database',
      'status', case when v_last is null or v_last < now() - interval '5 minutes' then 'fail' when v_bad > 0 then 'warn' else 'ok' end,
      'detail', case when v_last is null then 'The every-minute job has not run — turn on automatic delivery'
                     when v_last < now() - interval '5 minutes' then 'Last run ' || to_char(v_last at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' IST'
                     when v_bad > 0 then v_bad || ' job(s) failed on their last run' else 'All jobs running' end);
  end if;
  return out;
end $$;

-- p_results: [{ service, label, group, status: ok|warn|fail|off, latency_ms, detail }] from the ops function
create or replace function public.record_health(p_results jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record; v_prev text; v_all jsonb; v_lat int := greatest(coalesce((public.ops_config() #>> '{thresholds,latencyMs}')::int, 3000), 100);
begin
  v_all := coalesce(p_results, '[]'::jsonb) || public.platform_db_checks();
  for r in select * from jsonb_to_recordset(v_all) as x(service text, label text, "group" text, status text, latency_ms int, detail text) loop
    continue when r.service is null or r.status not in ('ok', 'warn', 'fail', 'off');
    if r.status = 'ok' and r.latency_ms is not null and r.latency_ms > v_lat then
      r.status := 'warn'; r.detail := coalesce(r.detail || ' · ', '') || 'slow (' || r.latency_ms || ' ms)';
    end if;
    insert into public.platform_health_checks (service, status, latency_ms, detail) values (left(r.service, 60), r.status, r.latency_ms, left(r.detail, 500));
    select status into v_prev from public.platform_health_state where service = r.service;
    insert into public.platform_health_state (service, label, grp, status, since, last_checked_at, latency_ms, detail)
    values (left(r.service, 60), coalesce(r.label, r.service), r."group", r.status, now(), now(), r.latency_ms, left(r.detail, 500))
    on conflict (service) do update set label = coalesce(r.label, public.platform_health_state.label), grp = coalesce(excluded.grp, public.platform_health_state.grp), status = excluded.status,
      since = case when public.platform_health_state.status = excluded.status then public.platform_health_state.since else now() end,
      last_checked_at = now(), latency_ms = excluded.latency_ms, detail = excluded.detail;
    if v_prev is distinct from r.status then
      if r.status in ('fail', 'warn') and r.service = 'db:cron' then
        perform public.raise_platform_alert_safe('job_late', coalesce(r.label, r.service) || case when r.status = 'fail' then ' stopped' else ' has failing jobs' end,
          coalesce(r.detail, ''), '/health', 'health:' || r.service || ':' || r.status, 60);
      elsif r.status in ('fail', 'warn') and r.service = 'db:delivery' then
        perform public.raise_platform_alert_safe('delivery_spike', 'Message failures spiking', coalesce(r.detail, ''), '/health', 'health:' || r.service || ':' || r.status, 60);
      elsif r.status = 'fail' then
        perform public.raise_platform_alert_safe('health_down', coalesce(r.label, r.service) || ' is down', coalesce(r.detail, ''), '/health', 'health:' || r.service || ':fail', 30);
      elsif r.status = 'warn' and coalesce(v_prev, 'ok') in ('ok', 'off') then
        perform public.raise_platform_alert_safe('threshold', coalesce(r.label, r.service) || ' needs attention', coalesce(r.detail, ''), '/health', 'health:' || r.service || ':warn', 60);
      elsif r.status = 'ok' and v_prev in ('fail', 'warn') then
        perform public.raise_platform_alert_safe('health_recovered', coalesce(r.label, r.service) || ' is back to normal', coalesce(r.detail, ''), '/health');
      end if;
    end if;
  end loop;
  -- keep 30 days of history
  delete from public.platform_health_checks where checked_at < now() - interval '30 days';
  delete from public.platform_alerts where created_at < now() - interval '180 days';
  delete from public.platform_outbox where created_at < now() - interval '90 days';
  return v_all;
end $$;

create or replace function public.cp_health_live()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'support']);
  return jsonb_build_object(
    'last_run', (select max(last_checked_at) from public.platform_health_state),
    'settings', public.ops_config() -> 'health',
    'services', coalesce((select jsonb_agg(jsonb_build_object('service', s.service, 'label', s.label, 'group', s.grp, 'status', s.status, 'since', s.since,
        'last_checked_at', s.last_checked_at, 'latency_ms', s.latency_ms, 'detail', s.detail,
        'uptime24', (select round(100.0 * count(*) filter (where c.status in ('ok', 'warn')) / nullif(count(*) filter (where c.status <> 'off'), 0), 2)
                       from public.platform_health_checks c where c.service = s.service and c.checked_at > now() - interval '24 hours'),
        'uptime7d', (select round(100.0 * count(*) filter (where c.status in ('ok', 'warn')) / nullif(count(*) filter (where c.status <> 'off'), 0), 2)
                       from public.platform_health_checks c where c.service = s.service and c.checked_at > now() - interval '7 days'),
        'days', coalesce((select jsonb_agg(jsonb_build_object('d', d.d, 'ok', d.ok, 'n', d.n, 'ms', d.ms) order by d.d)
                    from (select date_trunc('day', c.checked_at at time zone 'Asia/Kolkata')::date d, count(*) filter (where c.status in ('ok', 'warn'))::int ok,
                                 count(*) filter (where c.status <> 'off')::int n, round(avg(c.latency_ms))::int ms
                            from public.platform_health_checks c where c.service = s.service and c.checked_at > now() - interval '7 days'
                           group by 1) d), '[]'::jsonb),
        'hours', coalesce((select jsonb_agg(jsonb_build_object('h', h.h, 'ok', h.ok, 'n', h.n, 'ms', h.ms) order by h.h)
                    from (select date_trunc('hour', c.checked_at) h, count(*) filter (where c.status in ('ok', 'warn'))::int ok,
                                 count(*) filter (where c.status <> 'off')::int n, round(avg(c.latency_ms))::int ms
                            from public.platform_health_checks c where c.service = s.service and c.checked_at > now() - interval '24 hours'
                           group by 1) h), '[]'::jsonb))
        order by s.grp nulls last, s.service) from public.platform_health_state s), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(jsonb_build_object('at', c.checked_at, 'service', c.service, 'label', coalesce(s.label, c.service), 'status', c.status, 'detail', c.detail) order by c.checked_at desc)
        from (select * from public.platform_health_checks where status in ('fail', 'warn') order by checked_at desc limit 50) c
        left join public.platform_health_state s on s.service = c.service), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ scheduler (every minute, from notify_cron_flush)
create or replace function public.ops_call(p_body jsonb)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_url text := public.tenant_secret('notify_function_url'); v_key text := public.tenant_secret('service_role_key');
begin
  if v_url is null or v_key is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return false; end if;
  v_url := regexp_replace(v_url, '/notify$', '/ops');
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    using v_url, jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'), p_body;
  return true;
end $$;

create or replace function public.ops_cron_tick()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_min int := extract(minute from now())::int;
begin
  perform public.run_due_broadcasts();
  if v_min = 7 then perform public.run_platform_hourly_alerts(); end if;
  if exists (select 1 from public.platform_outbox where status = 'pending' and next_attempt_at <= now()) then perform public.ops_call('{"flush": true}'::jsonb); end if;
  if v_min % 5 = 0 and coalesce((public.ops_config() #>> '{health,enabled}')::boolean, true) then perform public.ops_call('{"health": true}'::jsonb); end if;
exception when others then
  raise warning 'ops tick: %', sqlerrm;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.ops_defaults(), public.ops_alert_catalog(), public.ops_config(), public.platform_vault_on(), public.platform_secret_value(public.platform_secrets),
  public.platform_env(), public.claim_platform_outbox(int), public.ops_default_channels(text),
  public.raise_platform_alert(text, text, text, text, text, int, text, jsonb), public.raise_platform_alert_safe(text, text, text, text, text, int, text),
  public.run_platform_hourly_alerts(), public.broadcast_recipients(jsonb), public.broadcast_dispatch(uuid), public.run_due_broadcasts(),
  public.platform_db_checks(), public.record_health(jsonb), public.note_heartbeat(text, text), public.ops_call(jsonb), public.ops_cron_tick() from public, anon, authenticated;
grant execute on function public.platform_env(), public.claim_platform_outbox(int), public.record_health(jsonb), public.note_heartbeat(text, text), public.raise_platform_alert(text, text, text, text, text, int, text, jsonb) to service_role;

revoke all on function public.cp_messaging_setup(), public.cp_save_messaging_setup(jsonb, jsonb), public.cp_save_platform_templates(jsonb),
  public.cp_register_push(text, text), public.cp_unregister_push(text), public.cp_push_config(), public.cp_alerts(int, boolean), public.cp_alerts_read(uuid[]),
  public.cp_alert_prefs(), public.cp_save_alert_prefs(jsonb), public.cp_ops_settings(), public.cp_save_ops_settings(jsonb),
  public.cp_broadcast_preview(jsonb, text[]), public.cp_save_broadcast(jsonb), public.cp_send_broadcast(uuid, timestamptz), public.cp_cancel_broadcast(uuid),
  public.cp_broadcasts(int), public.cp_delivery_log(jsonb), public.cp_retry_message(text, uuid), public.cp_health_live() from public, anon;
grant execute on function public.cp_messaging_setup(), public.cp_save_messaging_setup(jsonb, jsonb), public.cp_save_platform_templates(jsonb),
  public.cp_register_push(text, text), public.cp_unregister_push(text), public.cp_push_config(), public.cp_alerts(int, boolean), public.cp_alerts_read(uuid[]),
  public.cp_alert_prefs(), public.cp_save_alert_prefs(jsonb), public.cp_ops_settings(), public.cp_save_ops_settings(jsonb),
  public.cp_broadcast_preview(jsonb, text[]), public.cp_save_broadcast(jsonb), public.cp_send_broadcast(uuid, timestamptz), public.cp_cancel_broadcast(uuid),
  public.cp_broadcasts(int), public.cp_delivery_log(jsonb), public.cp_retry_message(text, uuid), public.cp_health_live() to authenticated;

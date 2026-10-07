-- =====================================================================================================
--  OTP VERIFICATION — a one-time code after the password (hospital staff / patients and the Hospital Comrade team)
--
--  Hospital:  Settings → Security → "OTP on sign-in"  (app_settings 'app' → security.otp.login)
--             { enabled, channels: ['whatsapp','sms','email'], roles: 'staff' | 'all' }
--  Team:      Control panel → Platform settings → Security (platform_settings 'security' → loginOtp { enabled, channels })
--  Booking:   Settings → Security → "OTP on online booking" (security.otp.booking { enabled, channels }) — see booking.sql
--
--  How it is enforced: a sign-in is verified per Supabase session (the session_id claim of the access token). Until the
--  code is entered, current_tenant() returns null for that hospital account (every tenant table is hidden by the
--  restrictive tenant_isolation policy) and provider_role() returns null for a team account (every cp_* function and
--  the panel's Edge Functions refuse). So skipping the code screen in the browser gets nothing.
--
--    login_otp_status()            what the sign-in screen needs: required? verified? which channels (masked)
--    request_login_otp(channel)    6-digit code, 10 minutes, 1 per 30 s, 5 per hour per account, 10 per hour per connection
--    verify_login_otp(code)        5 attempts per code → this session is verified
--    login_otp_carry(session)      a fresh password sign-in of an already verified session (re-confirm password) keeps it
--
--  Never locks an account out: a person with no deliverable channel (no mobile on file, channel switched off) is let in
--  — the settings screens show who that affects. Turning sign-in OTP on requires the person doing it to have verified a
--  code in this session first, so a broken channel can't lock out the owner / the admin.
--  "Sign in as user" sessions from the control panel count as verified (the admin proved who they are).
-- =====================================================================================================

create table if not exists public.login_otps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  session_id   text not null,
  scope        text not null check (scope in ('hospital', 'team')),
  hospital_id  uuid,                         -- not tenant_id: read before the hospital is known to the session
  channel      text not null check (channel in ('email', 'sms', 'whatsapp')),
  code_hash    text not null,
  attempts     int not null default 0,
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  ip_hash      text,
  created_at   timestamptz not null default now()
);
create index if not exists login_otps_user_idx on public.login_otps (user_id, created_at desc);
create index if not exists login_otps_ip_idx on public.login_otps (ip_hash, created_at desc) where ip_hash is not null;
alter table public.login_otps enable row level security;   -- no policies: unreachable through the API
revoke all on public.login_otps from anon, authenticated;
grant all on public.login_otps to service_role;

create table if not exists public.login_otp_sessions (
  session_id   text not null,
  scope        text not null check (scope in ('hospital', 'team')),
  user_id      uuid not null,
  channel      text,
  verified_at  timestamptz not null default now(),
  primary key (session_id, scope)
);
create index if not exists login_otp_sessions_user_idx on public.login_otp_sessions (user_id);
alter table public.login_otp_sessions enable row level security;
revoke all on public.login_otp_sessions from anon, authenticated;
grant all on public.login_otp_sessions to service_role;

-- team sign-in codes go out through the control panel's queue (cp_notify.sql) as kind 'otp'
do $$ begin
  if to_regclass('public.platform_outbox') is not null then
    alter table public.platform_outbox drop constraint if exists platform_outbox_kind_check;
    alter table public.platform_outbox add constraint platform_outbox_kind_check check (kind in ('alert', 'broadcast', 'test', 'otp', 'signup_otp'));
  end if;
end $$;

-- ------------------------------------------------------------------ settings
-- a hospital's OTP settings with defaults (sign-in off; booking on, channels from the Notifications events)
create or replace function public.otp_config(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb;
begin
  select data -> 'security' -> 'otp' into s from public.app_settings where key = 'app' and tenant_id = p_tenant;
  s := coalesce(s, '{}'::jsonb);
  return jsonb_build_object(
    'login', jsonb_build_object('enabled', false, 'channels', '["whatsapp","sms","email"]'::jsonb, 'roles', 'staff') || coalesce(s -> 'login', '{}'::jsonb),
    'booking', jsonb_build_object('enabled', true, 'channels', null) || coalesce(s -> 'booking', '{}'::jsonb));
end $$;

create or replace function public.team_otp_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', false, 'channels', '["email","whatsapp","sms"]'::jsonb)
         || coalesce((select data -> 'loginOtp' from public.platform_settings where key = 'security'), '{}'::jsonb)
$$;

-- wording used when a hospital never saved one (the Settings screen saves its own)
create or replace function public.otp_default_template(p_event text)
returns jsonb language sql immutable as $$
  select case p_event
    when 'login_otp' then jsonb_build_object('text', '{code} is your {hospital} sign-in code. It is valid for 10 minutes. Do not share it with anyone.', 'subject', 'Your sign-in code')
    when 'otp' then jsonb_build_object('text', '{code} is your {hospital} booking code. It is valid for 10 minutes. Do not share it with anyone.', 'subject', 'Your booking code')
    else jsonb_build_object('text', '{code} is your verification code. It is valid for 10 minutes.', 'subject', 'Your verification code') end
$$;

create or replace function public.mask_destination(p_channel text, p_to text)
returns text language sql immutable as $$
  select case when p_channel = 'email'
    then left(split_part(p_to, '@', 1), 2) || '•••@' || split_part(p_to, '@', 2)
    else '+91 •••••' || right(p_to, 5) end
$$;

-- ------------------------------------------------------------------ who needs a code, and where it can go
-- [{ channel, to, masked }] — the channels that can reach this person right now, in the order given in the settings
create or replace function public.login_otp_targets(p_scope text, p_user uuid, p_tenant uuid, p_any boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg     jsonb;
  allowed text[];
  n       jsonb;
  ch      text;
  v_to    text;
  v_phone text;
  v_email text;
  out     jsonb := '[]'::jsonb;
  acc     jsonb;
  v_demo  boolean := false;
begin
  select lower(email) into v_email from auth.users where id = p_user;
  if p_scope = 'team' then
    cfg := public.team_otp_config();
    select whatsapp into v_phone from public.platform_alert_prefs where user_id = p_user;
    -- which shared accounts exist: saved in the panel, or the last health check reached them (Edge-secret setups)
    select data into acc from public.platform_settings where key = 'messaging_accounts';
  else
    cfg := public.otp_config(p_tenant) -> 'login';
    select phone into v_phone from public.profiles where id = p_user;
    select data -> 'notifications' into n from public.app_settings where key = 'app' and tenant_id = p_tenant;
    -- demo hospital with codes shown on screen: no channel has to be connected (demo.sql)
    v_demo := to_regprocedure('public.demo_otp_screen(uuid)') is not null and public.demo_otp_screen(p_tenant);
  end if;
  v_phone := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);
  select coalesce(array_agg(x), '{}') into allowed from jsonb_array_elements_text(
    case when p_any then '["whatsapp","sms","email"]'::jsonb else coalesce(cfg -> 'channels', '[]'::jsonb) end) x
   where x in ('whatsapp', 'sms', 'email');
  foreach ch in array allowed loop
    v_to := case when ch = 'email' then v_email else v_phone end;
    continue when v_to is null or (ch = 'email' and v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') or (ch <> 'email' and v_to !~ '^[6-9][0-9]{9}$');
    if p_scope = 'team' then
      continue when coalesce(acc ->> ('PLATFORM_' || upper(case when ch = 'whatsapp' then 'whatsapp' else ch end) || '_PROVIDER'), '') = ''
        and not exists (select 1 from public.platform_health_state h where h.service = 'provider:' || ch and h.status in ('ok', 'warn')
                          and h.last_checked_at > now() - interval '7 days');
    else
      continue when coalesce((n -> ch ->> 'enabled')::boolean, false) is not true and not v_demo;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('channel', ch, 'to', v_to, 'masked', public.mask_destination(ch, v_to)));
  end loop;
  return out;
exception when undefined_table then
  return out;   -- an older database without the control-panel tables
end $$;

create or replace function public.login_otp_required(p_scope text, p_user uuid, p_tenant uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; v_role text;
begin
  if p_scope = 'team' then
    return coalesce((public.team_otp_config() ->> 'enabled')::boolean, false);
  end if;
  if p_tenant is null then return false; end if;
  cfg := public.otp_config(p_tenant) -> 'login';
  if not coalesce((cfg ->> 'enabled')::boolean, false) then return false; end if;
  select role::text into v_role from public.profiles where id = p_user;
  return not (coalesce(cfg ->> 'roles', 'staff') = 'staff' and v_role = 'patient');
end $$;

-- Has this session passed (or does it not need) the sign-in code? Called by current_tenant() / provider_role().
create or replace function public.login_otp_passed(p_scope text, p_tenant uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid text;
begin
  if uid is null then return true; end if;
  if not public.login_otp_required(p_scope, uid, p_tenant) then return true; end if;
  sid := public.jwt_session_id();
  if sid is not null and exists (select 1 from public.login_otp_sessions where session_id = sid and scope = p_scope and user_id = uid) then
    return true;
  end if;
  -- "sign in as user" from the control panel: the admin already proved who they are
  if p_scope = 'hospital' and sid is not null and exists (
       select 1 from public.impersonations i where i.session_id = sid and i.target_id = uid and i.ended_at is null and i.expires_at > now()) then
    return true;
  end if;
  -- nowhere to send a code → never lock the account out
  return jsonb_array_length(public.login_otp_targets(p_scope, uid, p_tenant)) = 0;
exception when undefined_table or undefined_function then
  return true;
end $$;

-- the scope and hospital of the signed-in person (team members first)
create or replace function public.login_otp_scope(out scope text, out tenant uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.provider_users where user_id = auth.uid() and active) then
    scope := 'team'; tenant := null;
  else
    scope := 'hospital'; select p.tenant_id into tenant from public.profiles p where p.id = auth.uid();
  end if;
end $$;

-- ------------------------------------------------------------------ the sign-in screen
create or replace function public.login_otp_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; v_req boolean; v_ok boolean; t jsonb; sid text := public.jwt_session_id();
begin
  if auth.uid() is null then return null; end if;
  select * into s from public.login_otp_scope();
  v_req := public.login_otp_required(s.scope, auth.uid(), s.tenant);
  t := public.login_otp_targets(s.scope, auth.uid(), s.tenant, not v_req);
  v_ok := sid is not null and exists (select 1 from public.login_otp_sessions where session_id = sid and scope = s.scope and user_id = auth.uid());
  return jsonb_build_object(
    'scope', s.scope, 'required', v_req, 'verified', v_ok,
    'passed', public.login_otp_passed(s.scope, s.tenant),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channel', x ->> 'channel', 'to', x ->> 'masked')) from jsonb_array_elements(t) x), '[]'::jsonb),
    'impersonation', s.scope = 'hospital' and v_req and not v_ok and public.login_otp_passed(s.scope, s.tenant) and jsonb_array_length(t) > 0);
end $$;

create or replace function public.request_login_otp(p_channel text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  uid     uuid := auth.uid();
  sid     text := public.jwt_session_id();
  s       record;
  v_req   boolean;
  t       jsonb;
  pick    jsonb;
  v_code  text;
  v_id    uuid;
  v_ip    text := public.client_ip_hash();
  v_tpl   jsonb;
  v_name  text;
  n       int;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if sid is null then raise exception 'This sign-in has no session — please sign in again.'; end if;
  select * into s from public.login_otp_scope();
  v_req := public.login_otp_required(s.scope, uid, s.tenant);
  t := public.login_otp_targets(s.scope, uid, s.tenant, not v_req);
  select x into pick from jsonb_array_elements(t) x where p_channel is null or x ->> 'channel' = p_channel limit 1;
  if pick is null then
    raise exception 'A code can''t be sent on % right now. Choose another way.', coalesce(p_channel, 'any channel');
  end if;
  if exists (select 1 from public.login_otps where user_id = uid and created_at > now() - interval '30 seconds') then
    raise exception 'Please wait 30 seconds before requesting another code.';
  end if;
  if (select count(*) from public.login_otps where user_id = uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested for this account. Please try again in an hour.';
  end if;
  if v_ip is not null and (select count(*) from public.login_otps where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many codes requested from this connection. Please try again in an hour.';
  end if;
  delete from public.login_otps where created_at < now() - interval '2 days';

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.login_otps (user_id, session_id, scope, hospital_id, channel, code_hash, expires_at, ip_hash)
  values (uid, sid, s.scope, s.tenant, pick ->> 'channel', extensions.crypt(v_code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes', v_ip)
  returning id into v_id;
  select full_name into v_name from public.profiles where id = uid;

  if s.scope = 'team' then
    insert into public.platform_outbox (kind, ref_id, channel, recipient, user_id, subject, body, vars)
    values ('otp', v_id, pick ->> 'channel', pick ->> 'to', uid, 'Your sign-in code',
            v_code || ' is your control-panel sign-in code. It is valid for 10 minutes. Do not share it with anyone.',
            jsonb_build_object('code', v_code, 'otp', v_code, 'name', coalesce(v_name, '')));
    n := 1;
  else
    -- the hospital is not visible to this session yet: name it for the queue explicitly
    perform set_config('app.tenant_id', s.tenant::text, true);
    v_tpl := coalesce((select data -> 'notifications' -> 'templates' -> 'login_otp' from public.app_settings where key = 'app' and tenant_id = s.tenant), '{}'::jsonb);
    if coalesce(v_tpl ->> 'text', '') = '' then v_tpl := public.otp_default_template('login_otp') || v_tpl - 'text'; end if;
    if coalesce(v_tpl ->> 'subject', '') = '' then v_tpl := v_tpl || jsonb_build_object('subject', 'Your sign-in code'); end if;
    n := public.notify_enqueue_raw('login_otp', v_tpl, array[pick ->> 'channel'],
           case when pick ->> 'channel' = 'email' then null else pick ->> 'to' end,
           case when pick ->> 'channel' = 'email' then pick ->> 'to' else null end, null,
           jsonb_build_object('code', v_code, 'otp', v_code, 'name', coalesce(v_name, '')), 'login_otps', v_id, null);
    perform set_config('app.tenant_id', '', true);
  end if;
  if s.scope = 'hospital' and public.demo_otp_screen(s.tenant) then   -- demo hospital: the code is shown, not sent
    return jsonb_build_object('sent', true, 'ref', v_id, 'scope', s.scope, 'channel', pick ->> 'channel', 'to', pick ->> 'masked', 'expires_in', 600, 'demo_code', v_code);
  end if;
  return jsonb_build_object('sent', n > 0, 'ref', v_id, 'scope', s.scope, 'channel', pick ->> 'channel', 'to', pick ->> 'masked', 'expires_in', 600);
end $$;

create or replace function public.verify_login_otp(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid text := public.jwt_session_id(); o public.login_otps;
begin
  if uid is null or sid is null then return jsonb_build_object('ok', false, 'error', 'Please sign in again.'); end if;
  select * into o from public.login_otps where user_id = uid and session_id = sid and verified_at is null
   order by created_at desc limit 1 for update;
  if not found or o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This code has expired. Please request a new one.');
  end if;
  if o.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Please request a new code.');
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or o.code_hash <> extensions.crypt(p_code, o.code_hash) then
    update public.login_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error',
      case when o.attempts + 1 >= 5 then 'Too many wrong attempts. Please request a new code.'
           else format('That code is not correct — %s attempt%s left.', 4 - o.attempts, case when 4 - o.attempts = 1 then '' else 's' end) end);
  end if;
  update public.login_otps set verified_at = now() where id = o.id;
  insert into public.login_otp_sessions (session_id, scope, user_id, channel) values (sid, o.scope, uid, o.channel)
  on conflict (session_id, scope) do update set verified_at = now(), user_id = excluded.user_id, channel = excluded.channel;
  delete from public.login_otp_sessions where user_id = uid and verified_at < now() - interval '60 days';
  return jsonb_build_object('ok', true, 'scope', o.scope);
end $$;

-- "Confirm your password" signs in again (a new session): keep the verification of the session it came from, if that
-- session is this user's, verified, and still alive (auth.sessions) — so an admin isn't asked for a code on every
-- risky action. A password alone can't use it: the old session id is only inside the old access token.
create or replace function public.login_otp_carry(p_from_session text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid text := public.jwt_session_id(); n int := 0; alive boolean := true;
begin
  if uid is null or sid is null or p_from_session is null or p_from_session = sid then return false; end if;
  if to_regclass('auth.sessions') is not null then
    execute 'select exists (select 1 from auth.sessions where id::text = $1 and user_id = $2)' into alive using p_from_session, uid;
  end if;
  if not alive then return false; end if;
  insert into public.login_otp_sessions (session_id, scope, user_id, channel)
  select sid, scope, uid, channel from public.login_otp_sessions
   where session_id = p_from_session and user_id = uid and verified_at > now() - interval '24 hours'
  on conflict (session_id, scope) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ------------------------------------------------------------------ turning it on safely (hospital Settings)
-- Saving Settings with sign-in OTP switched on (or with a narrower channel list) needs a verified session for whoever
-- saves it — proof that at least their own code arrives. The control panel (team) and the database owner are exempt.
create or replace function public.guard_login_otp_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was jsonb := case when tg_op = 'UPDATE' then old.data -> 'security' -> 'otp' -> 'login' else null end;
  now_ jsonb := new.data -> 'security' -> 'otp' -> 'login';
  sid text := public.jwt_session_id();
  ch text;
begin
  if new.key <> 'app' or now_ is null then return new; end if;
  if jsonb_typeof(now_) <> 'object' then raise exception 'security.otp.login must be an object'; end if;
  if now_ ? 'channels' then
    if jsonb_typeof(now_ -> 'channels') <> 'array' or jsonb_array_length(now_ -> 'channels') = 0 then
      raise exception 'Choose at least one channel for the sign-in code.';
    end if;
    for ch in select jsonb_array_elements_text(now_ -> 'channels') loop
      if ch not in ('whatsapp', 'sms', 'email') then raise exception 'Unknown OTP channel %', ch; end if;
    end loop;
  end if;
  if coalesce(now_ ->> 'roles', 'staff') not in ('staff', 'all') then raise exception 'security.otp.login.roles must be staff or all'; end if;
  if auth.uid() is null or public.provider_role() is not null then return new; end if;
  if coalesce((now_ ->> 'enabled')::boolean, false) and not coalesce((was ->> 'enabled')::boolean, false)
     and not (sid is not null and exists (select 1 from public.login_otp_sessions where session_id = sid and scope = 'hospital' and user_id = auth.uid())) then
    raise exception 'OTP_SETUP: Verify a code on your own account first (Settings → Security → Send me a code), then switch sign-in OTP on.';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_login_otp on public.app_settings;
create trigger trg_guard_login_otp before insert or update of data on public.app_settings
  for each row execute function public.guard_login_otp_settings();

-- ------------------------------------------------------------------ control panel
-- Platform settings → Security: the team's own sign-in OTP
create or replace function public.cp_security()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return jsonb_build_object('loginOtp', public.team_otp_config(),
    'team', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'email', a.email, 'role', u.role,
                        'channels', (select coalesce(jsonb_agg(x ->> 'channel'), '[]'::jsonb) from jsonb_array_elements(public.login_otp_targets('team', u.user_id, null)) x))
                        order by a.email)
                      from public.provider_users u join auth.users a on a.id = u.user_id where u.active), '[]'::jsonb));
end $$;

create or replace function public.cp_save_security(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cur jsonb := public.team_otp_config(); nxt jsonb; ch text; sid text := public.jwt_session_id();
begin
  perform public.cp_require(array['admin']);
  if jsonb_typeof(p -> 'loginOtp') <> 'object' then raise exception 'loginOtp must be an object'; end if;
  nxt := cur || jsonb_strip_nulls(jsonb_build_object('enabled', p -> 'loginOtp' -> 'enabled', 'channels', p -> 'loginOtp' -> 'channels'));
  if jsonb_typeof(nxt -> 'enabled') <> 'boolean' then raise exception 'enabled must be true or false'; end if;
  if jsonb_typeof(nxt -> 'channels') <> 'array' or jsonb_array_length(nxt -> 'channels') = 0 then raise exception 'Choose at least one channel.'; end if;
  for ch in select jsonb_array_elements_text(nxt -> 'channels') loop
    if ch not in ('whatsapp', 'sms', 'email') then raise exception 'Unknown OTP channel %', ch; end if;
  end loop;
  if (nxt ->> 'enabled')::boolean and not (cur ->> 'enabled')::boolean
     and not (sid is not null and exists (select 1 from public.login_otp_sessions where session_id = sid and scope = 'team' and user_id = auth.uid())) then
    raise exception 'OTP_SETUP: Verify a code on your own account first (Send me a code), then switch sign-in OTP on.';
  end if;
  insert into public.platform_settings (key, data, updated_at, updated_by) values ('security', jsonb_build_object('loginOtp', nxt), now(), auth.uid())
  on conflict (key) do update set data = public.platform_settings.data || jsonb_build_object('loginOtp', nxt), updated_at = now(), updated_by = auth.uid();
  perform public.provider_log('settings:security', null, jsonb_build_object('loginOtp', nxt));
  return public.cp_security();
end $$;

-- Hospital → Security: that hospital's OTP switches, edited by the team (admin, or support assigned to it)
create or replace function public.cp_hospital_otp(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; n jsonb; staff int; reach int;
begin
  perform public.cp_require(array['admin', 'support']);
  if not public.provider_can(p_tenant) then raise exception 'This hospital is not assigned to you.' using errcode = '42501'; end if;
  cfg := public.otp_config(p_tenant);
  select data -> 'notifications' into n from public.app_settings where key = 'app' and tenant_id = p_tenant;
  select count(*), count(*) filter (where jsonb_array_length(public.login_otp_targets('hospital', p.id, p_tenant)) > 0)
    into staff, reach from public.profiles p
   where p.tenant_id = p_tenant and (coalesce(cfg -> 'login' ->> 'roles', 'staff') = 'all' or p.role::text <> 'patient');
  return jsonb_build_object('otp', cfg, 'locked', coalesce((select t.modules ->> 'security' from public.tenants t where t.id = p_tenant), 'provider') <> 'hospital',
    'channels_on', jsonb_build_object('whatsapp', coalesce((n -> 'whatsapp' ->> 'enabled')::boolean, false),
                                      'sms', coalesce((n -> 'sms' ->> 'enabled')::boolean, false),
                                      'email', coalesce((n -> 'email' ->> 'enabled')::boolean, false)),
    'people', staff, 'reachable', reach);
end $$;

create or replace function public.cp_set_hospital_otp(p_tenant uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cur jsonb; nxt jsonb; part text; ch text;
begin
  perform public.cp_require(array['admin', 'support']);
  if not public.provider_can(p_tenant) then raise exception 'This hospital is not assigned to you.' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'OTP settings must be an object'; end if;
  cur := public.otp_config(p_tenant);
  nxt := cur;
  foreach part in array array['login', 'booking'] loop
    continue when not p ? part;
    if jsonb_typeof(p -> part) <> 'object' then raise exception '% must be an object', part; end if;
    nxt := jsonb_set(nxt, array[part], (cur -> part) || jsonb_strip_nulls(jsonb_build_object(
      'enabled', p -> part -> 'enabled', 'channels', p -> part -> 'channels', 'roles', case when part = 'login' then p -> part -> 'roles' end)));
    if jsonb_typeof(nxt -> part -> 'enabled') <> 'boolean' then raise exception '%.enabled must be true or false', part; end if;
    if jsonb_typeof(nxt -> part -> 'channels') = 'array' then
      if jsonb_array_length(nxt -> part -> 'channels') = 0 then raise exception 'Choose at least one channel.'; end if;
      for ch in select jsonb_array_elements_text(nxt -> part -> 'channels') loop
        if ch not in ('whatsapp', 'sms', 'email') then raise exception 'Unknown OTP channel %', ch; end if;
      end loop;
    end if;
  end loop;
  if coalesce(nxt -> 'login' ->> 'roles', 'staff') not in ('staff', 'all') then raise exception 'roles must be staff or all'; end if;
  perform set_config('app.tenant_id', p_tenant::text, true);   -- the hospital's own audit trail gets the change
  insert into public.app_settings (tenant_id, key, data) values (p_tenant, 'app', jsonb_build_object('security', jsonb_build_object('otp', nxt)))
  on conflict (tenant_id, key) do update set
    data = public.app_settings.data || jsonb_build_object('security', coalesce(public.app_settings.data -> 'security', '{}'::jsonb) || jsonb_build_object('otp', nxt)),
    updated_at = now(), updated_by = auth.uid();
  perform set_config('app.tenant_id', '', true);
  perform public.provider_log('hospital:otp', p_tenant::text, nxt);
  return public.cp_hospital_otp(p_tenant);
end $$;

-- ------------------------------------------------------------------ who may call what
revoke all on function public.otp_config(uuid), public.team_otp_config(), public.login_otp_targets(text, uuid, uuid, boolean),
  public.login_otp_required(text, uuid, uuid), public.login_otp_scope(), public.guard_login_otp_settings() from public, anon, authenticated;
grant execute on function public.login_otp_passed(text, uuid) to anon, authenticated, service_role;
revoke all on function public.login_otp_status(), public.request_login_otp(text), public.verify_login_otp(text), public.login_otp_carry(text),
  public.cp_security(), public.cp_save_security(jsonb), public.cp_hospital_otp(uuid), public.cp_set_hospital_otp(uuid, jsonb) from public, anon;
grant execute on function public.login_otp_status(), public.request_login_otp(text), public.verify_login_otp(text), public.login_otp_carry(text),
  public.cp_security(), public.cp_save_security(jsonb), public.cp_hospital_otp(uuid), public.cp_set_hospital_otp(uuid, jsonb) to authenticated;

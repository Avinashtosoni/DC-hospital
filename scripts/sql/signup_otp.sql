-- =====================================================================================================
--  FREE-TRIAL SIGN-UP — VERIFY THE MOBILE NUMBER (WhatsApp, SMS as the fallback)
-- =====================================================================================================
--  Control Panel → Sign-ups → "Mobile verification": platform_settings 'signup' → otp { enabled, channels }
--  (default on, ['whatsapp','sms']). The code goes out on the PLATFORM's shared accounts (Platform settings →
--  Integrations) through platform_outbox kind 'signup_otp' → event 'platform_signup_otp'. With wacrm / Meta Cloud API
--  the WhatsApp message needs an approved authentication template: Messaging → Templates → "Free-trial sign-up code".
--
--    signup_otp_info()                      { required, channels } — part of platform_signup_info()
--    request_signup_otp(phone, channel)     6 digits, 10 minutes; 1 per 30 s and 5 per hour per number, 10 per hour per
--                                           connection, 300 per hour for everyone
--    verify_signup_otp(phone, code)         5 attempts per code → a one-time token (30 minutes)
--    signup_otp_consume(phone, token)       platform_trial_signup(): refuses without a valid token while required, so
--                                           skipping the step in the browser gets nothing
--  The ops Edge Function sends the code at once ({ deliver_signup_otp: ref }); the minute flush is the safety net.
-- =====================================================================================================

create table if not exists public.platform_signup_otps (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null check (phone ~ '^[6-9][0-9]{9}$'),
  channel        text not null check (channel in ('whatsapp', 'sms')),
  code_hash      text not null,
  attempts       int not null default 0,
  expires_at     timestamptz not null,
  verified_at    timestamptz,
  token          text unique,
  token_used_at  timestamptz,
  ip_hash        text,
  created_at     timestamptz not null default now()
);
create index if not exists platform_signup_otps_phone_idx on public.platform_signup_otps (phone, created_at desc);
create index if not exists platform_signup_otps_ip_idx on public.platform_signup_otps (ip_hash, created_at desc) where ip_hash is not null;
alter table public.platform_signup_otps enable row level security;   -- no policies: unreachable through the API
revoke all on public.platform_signup_otps from anon, authenticated;
grant all on public.platform_signup_otps to service_role;

alter table public.platform_signups add column if not exists phone_verified_at timestamptz;
alter table public.platform_signups add column if not exists phone_verified_via text;

do $$ begin
  if to_regclass('public.platform_outbox') is not null then
    alter table public.platform_outbox drop constraint if exists platform_outbox_kind_check;
    alter table public.platform_outbox add constraint platform_outbox_kind_check check (kind in ('alert', 'broadcast', 'test', 'otp', 'signup_otp'));
  end if;
end $$;

-- older settings rows have no otp block: on, WhatsApp then SMS
update public.platform_settings set data = data || '{"otp": {"enabled": true, "channels": ["whatsapp", "sms"]}}'::jsonb, updated_at = now()
 where key = 'signup' and not (data ? 'otp');

create or replace function public.signup_otp_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o jsonb := coalesce(public.signup_config() -> 'otp', '{}'::jsonb); ch text[];
begin
  select coalesce(array_agg(x order by array_position(array['whatsapp', 'sms'], x)), '{}') into ch
    from jsonb_array_elements_text(case when jsonb_typeof(o -> 'channels') = 'array' then o -> 'channels' else '["whatsapp","sms"]'::jsonb end) x
   where x in ('whatsapp', 'sms');
  return jsonb_build_object('required', coalesce((o ->> 'enabled')::boolean, true) and cardinality(ch) > 0, 'channels', to_jsonb(ch));
end $$;

create or replace function public.request_signup_otp(p_phone text, p_channel text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c       jsonb := public.signup_config();
  info    jsonb := public.signup_otp_info();
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_ch    text := coalesce(nullif(p_channel, ''), info -> 'channels' ->> 0);
  v_ip    text := public.client_ip_hash();
  v_code  text;
  v_id    uuid;
begin
  if not coalesce((c ->> 'enabled')::boolean, false) then raise exception 'Online sign-up is closed right now — please use the contact form.'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit Indian mobile number.'; end if;
  if v_ch is null or not (info -> 'channels' ? v_ch) then raise exception 'A code can''t be sent on % right now — choose another way.', coalesce(v_ch, 'that channel'); end if;
  if exists (select 1 from public.platform_signup_otps where phone = v_phone and created_at > now() - interval '30 seconds') then
    raise exception 'Please wait 30 seconds before asking for another code.';
  end if;
  if (select count(*) from public.platform_signup_otps where phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes for this number. Please try again in an hour.';
  end if;
  if v_ip is not null and (select count(*) from public.platform_signup_otps where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many codes from your network. Please try again in an hour.';
  end if;
  if (select count(*) from public.platform_signup_otps where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'We are sending a lot of codes right now — please try again in a few minutes.';
  end if;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.platform_signup_otps (phone, channel, code_hash, expires_at, ip_hash)
  values (v_phone, v_ch, extensions.crypt(v_code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes', v_ip)
  returning id into v_id;
  insert into public.platform_outbox (kind, ref_id, channel, recipient, subject, body, vars)
  values ('signup_otp', v_id, v_ch, v_phone, 'Your verification code',
          v_code || ' is your verification code to start your free trial. It is valid for 10 minutes. Do not share it with anyone.',
          jsonb_build_object('code', v_code, 'otp', v_code));
  return jsonb_build_object('sent', true, 'ref', v_id, 'channel', v_ch, 'to', '+91 ' || left(v_phone, 2) || '•••• ' || right(v_phone, 4),
    'expires_in', 600, 'resend_in', 30);
end $$;

create or replace function public.verify_signup_otp(p_phone text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); o public.platform_signup_otps; v_token text;
begin
  select * into o from public.platform_signup_otps where phone = v_phone and verified_at is null order by created_at desc limit 1 for update;
  if not found or o.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'This code has expired. Please ask for a new one.'); end if;
  if o.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Please ask for a new code.'); end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or o.code_hash <> extensions.crypt(p_code, o.code_hash) then
    update public.platform_signup_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error',
      case when o.attempts + 1 >= 5 then 'Too many wrong attempts. Please ask for a new code.'
           else format('That code is not correct — %s attempt%s left.', 4 - o.attempts, case when 4 - o.attempts = 1 then '' else 's' end) end);
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  update public.platform_signup_otps set verified_at = now(), token = v_token where id = o.id;
  return jsonb_build_object('ok', true, 'token', v_token, 'channel', o.channel);
end $$;

-- platform_trial_signup(): the verified number's token (null = not verified). Raises while verification is required.
create or replace function public.signup_otp_consume(p_phone text, p_token text)
returns public.platform_signup_otps language plpgsql volatile security definer set search_path = public as $$
declare o public.platform_signup_otps;
begin
  if coalesce(p_token, '') <> '' then
    select * into o from public.platform_signup_otps
     where token = p_token and phone = p_phone and token_used_at is null and verified_at > now() - interval '30 minutes' for update;
    if found then
      update public.platform_signup_otps set token_used_at = now() where id = o.id;
      return o;
    end if;
  end if;
  if (public.signup_otp_info() ->> 'required')::boolean then
    raise exception 'Please verify your mobile number first%.', case when coalesce(p_token, '') <> '' then ' — the check has expired, ask for a new code' else '' end;
  end if;
  return null;
end $$;

-- the sign-up page: + whether the number must be verified and on what
create or replace function public.platform_signup_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb := public.signup_config(); b jsonb := public.billing_config();
begin
  return jsonb_build_object('enabled', coalesce((c ->> 'enabled')::boolean, false), 'mode', c ->> 'mode',
    'trialDays', (c ->> 'trialDays')::int, 'plan', c ->> 'plan', 'otp', public.signup_otp_info(),
    -- plans a visitor can start a trial on: shown on the website, not archived, self sign-up on (Control Panel → Plans & billing)
    'plans', coalesce((select jsonb_agg(e.key order by coalesce((e.value ->> 'order')::int, 999), e.key) from jsonb_each(b -> 'plans') e
                        where coalesce((e.value ->> 'public')::boolean, true) and not coalesce((e.value ->> 'archived')::boolean, false)
                          and coalesce((e.value ->> 'signup')::boolean, e.key in ('clinic', 'hospital'))), '[]'::jsonb));
end $$;

-- settings: + otp { enabled, channels }
create or replace function public.cp_save_signup_settings(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare k text; v jsonb := coalesce(p, '{}'::jsonb);
begin
  perform public.cp_require(array['admin']);
  for k in select jsonb_object_keys(v) loop
    if k not in ('enabled', 'mode', 'trialDays', 'plan', 'maxPerDay', 'unclaimedDays', 'platformUrl', 'otp') then raise exception 'Unknown setting %', k; end if;
  end loop;
  if v ? 'enabled' and jsonb_typeof(v -> 'enabled') <> 'boolean' then raise exception 'enabled: true or false'; end if;
  if v ? 'mode' and v ->> 'mode' not in ('instant', 'approve') then raise exception 'Mode: instant or approve.'; end if;
  if v ? 'trialDays' and coalesce((v ->> 'trialDays')::int, 0) not between 1 and 90 then raise exception 'Trial: 1 to 90 days.'; end if;
  if v ? 'plan' and not (public.billing_config() -> 'plans' ? (v ->> 'plan')) then raise exception 'Unknown plan %', v ->> 'plan'; end if;
  if v ? 'maxPerDay' and coalesce((v ->> 'maxPerDay')::int, 0) not between 1 and 1000 then raise exception 'Sign-ups per day: 1 to 1000.'; end if;
  if v ? 'platformUrl' and coalesce(v ->> 'platformUrl', '') !~ '^(https://[a-z0-9.-]+(:[0-9]+)?/?)?$' then raise exception 'Website: https://your-domain (or leave empty).'; end if;
  if v ? 'unclaimedDays' and coalesce((v ->> 'unclaimedDays')::int, 0) not between 3 and 90 then raise exception 'Unclaimed trials: close after 3 to 90 days.'; end if;
  if v ? 'otp' then
    if jsonb_typeof(v -> 'otp') <> 'object' or jsonb_typeof(v -> 'otp' -> 'enabled') <> 'boolean' or jsonb_typeof(v -> 'otp' -> 'channels') <> 'array'
       or exists (select 1 from jsonb_array_elements_text(v -> 'otp' -> 'channels') x where x not in ('whatsapp', 'sms')) then
      raise exception 'Mobile verification: on/off and channels (WhatsApp, SMS).';
    end if;
    if (v -> 'otp' ->> 'enabled')::boolean and jsonb_array_length(v -> 'otp' -> 'channels') = 0 then raise exception 'Mobile verification: pick WhatsApp, SMS or both.'; end if;
    v := jsonb_set(v, '{otp}', jsonb_build_object('enabled', v -> 'otp' -> 'enabled', 'channels', v -> 'otp' -> 'channels'));
  end if;
  update public.platform_settings set data = data || v, updated_at = now() where key = 'signup';
  perform public.provider_log('settings:signup', null, v);
  return public.cp_signup_settings();
end $$;

-- the sign-up itself: unchanged checks, plus the verified number (signup_otp_consume) — see signup.sql for the rest
create or replace function public.platform_trial_signup(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c       jsonb := public.signup_config();
  b       jsonb := public.billing_config();
  v_org   text := trim(regexp_replace(coalesce(p ->> 'organisation', ''), '\s+', ' ', 'g'));
  v_name  text := trim(regexp_replace(coalesce(p ->> 'name', ''), '\s+', ' ', 'g'));
  v_mail  text := lower(trim(coalesce(p ->> 'email', '')));
  v_phone text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  v_city  text := nullif(left(trim(coalesce(p ->> 'city', '')), 80), '');
  v_plan  text := coalesce(nullif(p ->> 'plan', ''), c ->> 'plan', 'clinic');
  v_terms text := trim(coalesce(p ->> 'terms_version', ''));
  v_ip    text;
  v_hash  text;
  v_id    uuid;
  v_slug  text;
  v_otp   public.platform_signup_otps;
  r       jsonb;
begin
  if not coalesce((c ->> 'enabled')::boolean, false) then raise exception 'Online sign-up is closed right now — please use the contact form and we will set you up.'; end if;
  if coalesce(p ->> 'website', '') <> '' then raise exception 'Could not sign up.'; end if;
  if char_length(v_org) not between 2 and 120 then raise exception 'Enter your hospital or clinic''s name.'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'Enter your name.'; end if;
  if v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' or char_length(v_mail) > 150 then raise exception 'Enter a valid e-mail — you will sign in with it.'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit Indian mobile number.'; end if;
  if v_terms = '' or char_length(v_terms) > 20 then raise exception 'Please accept the Terms of Service and the Data Processing Agreement.'; end if;
  if not (b -> 'plans' ? v_plan) or coalesce((b -> 'plans' -> v_plan ->> 'archived')::boolean, false) then v_plan := coalesce(c ->> 'plan', 'clinic'); end if;

  -- one account = one hospital
  if exists (select 1 from public.profiles where lower(email) = v_mail and tenant_id is not null and role <> 'patient')
     or exists (select 1 from public.provider_users u join auth.users a on a.id = u.user_id where lower(a.email) = v_mail)
     or exists (select 1 from public.app_settings s where s.key = 'bootstrap' and lower(s.data ->> 'owner_email') = v_mail) then
    raise exception 'This e-mail already belongs to a hospital here — sign in there, or use another e-mail.';
  end if;
  if exists (select 1 from public.platform_signups where lower(email) = v_mail and status = 'pending') then
    raise exception 'We already have a request from this e-mail — we will be in touch soon.';
  end if;

  -- rate limits: per address, per phone, per day for everyone
  begin
    v_ip := nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
                                         nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null; end;
  v_hash := case when v_ip is null then null else md5('hc-signup:' || v_ip) end;
  if v_hash is not null and (select count(*) from public.platform_signups where ip_hash = v_hash and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many sign-ups from your network today — please try tomorrow or use the contact form.';
  end if;
  if (select count(*) from public.platform_signups where phone = v_phone and created_at > now() - interval '1 day') >= 2 then
    raise exception 'Too many sign-ups with this mobile number today — please use the contact form.';
  end if;
  if (select count(*) from public.platform_signups where created_at > now() - interval '1 day') >= greatest(coalesce((c ->> 'maxPerDay')::int, 25), 1) then
    raise exception 'We are getting a lot of sign-ups today — please leave your details in the contact form and we will set you up.';
  end if;

  -- the mobile number, verified by a code (Control Panel → Sign-ups → Mobile verification)
  v_otp := public.signup_otp_consume(v_phone, p ->> 'otp_token');

  v_slug := public.signup_slug(v_org);
  insert into public.platform_signups (organisation, contact_name, email, phone, city, plan, trial_days, slug, code, terms_version, ip_hash,
                                       phone_verified_at, phone_verified_via)
  values (v_org, v_name, v_mail, v_phone, v_city, v_plan, greatest(1, least(90, coalesce((c ->> 'trialDays')::int, 14))), v_slug, public.signup_code(v_org), v_terms, v_hash,
          v_otp.verified_at, v_otp.channel)
  returning id into v_id;

  if c ->> 'mode' = 'instant' then
    r := public.signup_activate(v_id);
    return jsonb_build_object('status', 'created', 'slug', r ->> 'slug', 'email', v_mail, 'trial_days', greatest(1, least(90, coalesce((c ->> 'trialDays')::int, 14))));
  end if;
  return jsonb_build_object('status', 'pending', 'email', v_mail);
end $$;

-- nightly: old codes go (run_retention → signup_cleanup)
create or replace function public.signup_otp_cleanup()
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare n bigint;
begin
  delete from public.platform_signup_otps where created_at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.signup_otp_info(), public.request_signup_otp(text, text), public.verify_signup_otp(text, text),
  public.signup_otp_consume(text, text), public.signup_otp_cleanup() from public;
grant execute on function public.request_signup_otp(text, text), public.verify_signup_otp(text, text) to anon, authenticated;
grant execute on function public.signup_otp_cleanup() to service_role;
revoke all on function public.platform_signup_info(), public.platform_trial_signup(jsonb) from public;
grant execute on function public.platform_signup_info(), public.platform_trial_signup(jsonb) to anon, authenticated;
revoke all on function public.cp_save_signup_settings(jsonb) from public, anon;
grant execute on function public.cp_save_signup_settings(jsonb) to authenticated;

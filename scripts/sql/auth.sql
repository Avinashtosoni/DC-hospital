-- =====================================================================================================
--  16. PASSWORD RESET BY MOBILE OTP (idempotent; also shipped in supabase/upgrade-2026-10.sql)
--
--  The second "Forgot password" option, next to the e-mail link:
--    request_password_otp(email, phone, channel)  sends a 6-digit code on WhatsApp / SMS — only when that e-mail and
--                                                 mobile belong to the same account (the answer is identical either
--                                                 way, so it never reveals which accounts exist)
--    verify_password_otp(email, phone, code)       5 attempts, 10 minute expiry → one-time token (valid 15 minutes)
--    reset_password_with_otp(token, password)      sets the new password and signs the account out everywhere
--  Unlike the booking OTP the code is NEVER shown on screen: without a connected SMS / WhatsApp gateway this
--  option reports itself unavailable and the e-mail link is used instead.
-- =====================================================================================================

create table if not exists public.password_reset_otps (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users on delete cascade,   -- null = no matching account (kept for rate limits)
  phone          text not null,
  code_hash      text not null,
  attempts       int not null default 0,
  expires_at     timestamptz not null,
  verified_at    timestamptz,
  token          uuid unique,
  token_used_at  timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists password_reset_otps_phone_idx on public.password_reset_otps (phone, created_at desc);
alter table public.password_reset_otps enable row level security;   -- no policies: unreachable through the API
revoke all on public.password_reset_otps from anon, authenticated;

-- the event whose channels / wording are used: "Password reset OTP" once saved in Settings, else the booking OTP's
create or replace function public.password_otp_event()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return case when (select data -> 'notifications' -> 'events' ? 'password_otp' from public.app_settings where key = 'app')
              then 'password_otp' else 'otp' end;
end $$;

-- channels that can deliver the reset code right now (WhatsApp first). Public; reveals no credentials.
create or replace function public.password_otp_channels()
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  n   jsonb;
  ev  text := public.password_otp_event();
  ch  text;
  out text[] := '{}';
begin
  select data -> 'notifications' into n from public.app_settings where key = 'app';
  if n is null then return out; end if;
  foreach ch in array array['whatsapp', 'sms'] loop
    if coalesce((n -> ch ->> 'enabled')::boolean, false)
       and coalesce((n -> 'events' -> ev ->> ch)::boolean, false)
       and coalesce(n -> 'templates' -> ev ->> 'text', '') <> '' then
      out := out || ch;
    end if;
  end loop;
  return out;
end $$;

create or replace function public.request_password_otp(p_email text, p_phone text, p_channel text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone  text := public.norm_phone(p_phone);
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_avail  text[] := public.password_otp_channels();
  v_use    text[];
  v_user   uuid;
  v_code   text;
  v_id     uuid;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Please enter the e-mail you sign in with.';
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Please enter a valid 10-digit Indian mobile number.';
  end if;
  if cardinality(v_avail) = 0 then
    raise exception 'MOBILE_RESET_OFF: Reset by mobile is not set up at this hospital yet. Please use the e-mail link.';
  end if;
  if exists (select 1 from public.password_reset_otps where phone = v_phone and created_at > now() - interval '30 seconds') then
    raise exception 'Please wait 30 seconds before requesting another code.';
  end if;
  if (select count(*) from public.password_reset_otps where phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested for this number. Please try again in an hour.';
  end if;
  if (select count(*) from public.password_reset_otps where created_at > now() - interval '1 hour')
     >= greatest(10, coalesce(nullif(public.booking_setting('otpHourlyLimit', '200'), '')::int, 200)) then
    raise exception 'Too many reset requests right now. Please try again in a few minutes.';
  end if;

  -- the account must have BOTH this e-mail and this mobile (on the profile or the linked patient record)
  select u.id into v_user
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = v_email
    and (u.banned_until is null or u.banned_until < now())
    and (public.norm_phone(p.phone) = v_phone
         or exists (select 1 from public.patients pt where pt.profile_id = p.id and public.norm_phone(pt.phone) = v_phone))
  limit 1;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.password_reset_otps (user_id, phone, code_hash, expires_at)
  values (v_user, v_phone, extensions.crypt(v_code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes')
  returning id into v_id;

  v_use := case when p_channel = any (v_avail) then array[p_channel] else v_avail end;
  if v_user is not null then
    perform public.notify_enqueue(public.password_otp_event(), v_phone, null,
      jsonb_build_object('code', v_code, 'otp', v_code), 'password_reset_otps', v_id, v_use);
  end if;
  -- same answer whether or not an account matched
  return jsonb_build_object('sent', true, 'expires_in', 600, 'ref', v_id, 'channels', to_jsonb(v_use));
end $$;

create or replace function public.verify_password_otp(p_email text, p_phone text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  o       public.password_reset_otps;
  v_token uuid;
begin
  select * into o from public.password_reset_otps
  where phone = v_phone and verified_at is null
  order by created_at desc limit 1
  for update;
  if not found or o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This code has expired. Please request a new one.');
  end if;
  if o.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Please request a new code.');
  end if;
  -- an unmatched request can never verify (no code was sent), and the e-mail must still be the account's
  if o.user_id is null
     or not exists (select 1 from auth.users u where u.id = o.user_id and lower(u.email) = lower(trim(coalesce(p_email, ''))))
     or coalesce(p_code, '') !~ '^[0-9]{6}$' or o.code_hash <> extensions.crypt(p_code, o.code_hash) then
    update public.password_reset_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error',
      case when o.attempts + 1 >= 5 then 'Too many wrong attempts. Please request a new code.'
           else format('That code is not correct — %s attempt%s left.', 4 - o.attempts, case when 4 - o.attempts = 1 then '' else 's' end) end);
  end if;
  v_token := gen_random_uuid();
  update public.password_reset_otps set verified_at = now(), token = v_token where id = o.id;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.reset_password_with_otp(p_token uuid, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  o public.password_reset_otps;
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Use at least 8 characters.';
  end if;
  select * into o from public.password_reset_otps where token = p_token for update;
  if not found or o.user_id is null or o.verified_at is null or o.token_used_at is not null
     or o.verified_at < now() - interval '15 minutes' then
    raise exception 'OTP_REQUIRED: This reset has expired. Please verify your mobile number again.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         recovery_token = '', updated_at = now()
   where id = o.user_id;
  update public.password_reset_otps set token_used_at = now() where id = o.id;
  -- sign the account out on every device (tables exist on Supabase; skipped elsewhere)
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1' using o.user_id::text;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using o.user_id;
  end if;
  return jsonb_build_object('ok', true, 'email', (select email from auth.users where id = o.user_id));
end $$;

revoke all on function public.password_otp_event() from public, anon, authenticated;
grant execute on function public.password_otp_channels() to anon, authenticated;
grant execute on function public.request_password_otp(text, text, text) to anon, authenticated;
grant execute on function public.verify_password_otp(text, text, text) to anon, authenticated;
grant execute on function public.reset_password_with_otp(uuid, text) to anon, authenticated;

-- =====================================================================================================
--  9. ONLINE BOOKING (public website → /book)
--
--  Anonymous visitors never touch the tables directly. They call these SECURITY DEFINER functions:
--    public_doctors()                          bookable doctors (no private fields)
--    public_availability(doctor, from, to)     booked slots, approved leave/blocks, hospital holidays
--    booking_otp_channels()                    which channels can deliver the code ('whatsapp', 'sms')
--    request_booking_otp(phone, channel)       sends a 6-digit code on the chosen channel (rate limited: 1 / 30 s, 5 / hour)
--    verify_booking_otp(phone, code)           5 attempts per code, 10 minute expiry → one-time token
--    public_book_appointment(token, …)         re-validates the slot server-side, then creates
--                                              patient (if new) → appointment → unpaid invoice
--
--  SMS: codes are queued by public.send_booking_otp() on the channels configured in Settings → Notifications
--  and delivered by the Edge Function `notify`. With no gateway configured — and the CMS setting
--  "Show the OTP on screen" ON — the code is returned to the browser for testing.
--  All dates/times are Indian Standard Time.
-- =====================================================================================================

drop function if exists public.public_doctors() cascade;
drop function if exists public.public_availability(uuid, date, date) cascade;
drop function if exists public.request_booking_otp(text) cascade;
drop function if exists public.request_booking_otp(text, text) cascade;
drop function if exists public.booking_otp_channels() cascade;
drop function if exists public.send_booking_otp(text, text, uuid) cascade;
drop function if exists public.send_booking_otp(text, text, uuid, text[]) cascade;
drop function if exists public.verify_booking_otp(text, text) cascade;
drop function if exists public.public_book_appointment(uuid, uuid, date, text, text, text, date, text, text) cascade;
drop function if exists public.send_booking_otp(text, text) cascade;
drop function if exists public.booking_setting(text, text, text) cascade;
drop function if exists public.norm_phone(text) cascade;

alter table public.booking_otps enable row level security;   -- no policies: unreachable through the API
revoke all on public.booking_otps from anon, authenticated;

create or replace function public.norm_phone(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- reads site_content.settings → <group> → <key> (the CMS "Online booking" / "Billing" groups)
create or replace function public.booking_setting(p_key text, p_default text, p_group text default 'booking')
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select data -> p_group ->> p_key from public.site_content where key = 'settings'), p_default)
$$;

-- Queues the code on the channels enabled in Settings → Notifications (SMS / WhatsApp) and returns how many
-- messages were queued. 0 = no gateway configured → the booking page may show the code on screen (demo mode).
-- Delivery is done by the Edge Function `notify` (supabase/functions/notify), which reads the credentials.
drop function if exists public.send_booking_otp(text, text);
create or replace function public.send_booking_otp(p_phone text, p_code text, p_ref uuid default null, p_only text[] default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  return coalesce(public.notify_enqueue('otp', p_phone, null, jsonb_build_object('code', p_code, 'otp', p_code), 'booking_otps', p_ref, p_only), 0);
exception when undefined_function then
  return 0;
end $$;

-- Channels that can deliver the booking code right now: switched on in Settings → Notifications AND ticked for
-- the "Booking OTP" event. WhatsApp first. Public (the booking page shows a WhatsApp / SMS choice); reveals no config.
create or replace function public.booking_otp_channels()
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  n   jsonb;
  ch  text;
  out text[] := '{}';
begin
  -- plpgsql (not sql): app_settings is created later in this file set (settings.sql)
  select data -> 'notifications' into n from public.app_settings where key = 'app';
  if n is null then return out; end if;
  foreach ch in array array['whatsapp', 'sms'] loop
    if coalesce((n -> ch ->> 'enabled')::boolean, false)
       and coalesce((n -> 'events' -> 'otp' ->> ch)::boolean, false)
       and coalesce(n -> 'templates' -> 'otp' ->> 'text', '') <> '' then
      out := out || ch;
    end if;
  end loop;
  return out;
end $$;

create or replace function public.public_doctors()
returns table (id uuid, full_name text, specialization text, department text, consultation_fee numeric,
               available_days text[], shift text, status text)
language sql stable security definer set search_path = public as $$
  select d.id, d.full_name, d.specialization, dep.name, d.consultation_fee, d.available_days, d.shift, d.status
  from public.doctors d
  left join public.departments dep on dep.id = d.department_id
  where d.status = 'active'
  order by d.full_name
$$;

create or replace function public.public_availability(p_doctor uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select p_from as f, least(p_to, p_from + 62) as t)
  select jsonb_build_object(
    'booked', coalesce((
      select jsonb_agg(jsonb_build_object('doctor_id', a.doctor_id, 'appointment_date', a.appointment_date,
                                          'appointment_time', a.appointment_time, 'status', a.status))
      from public.appointments a, r
      where (p_doctor is null or a.doctor_id = p_doctor) and a.appointment_date between r.f and r.t
        and a.status not in ('cancelled', 'no_show')), '[]'::jsonb),
    'leaves', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'doctor_id', l.doctor_id, 'kind', l.kind, 'status', l.status,
                                          'start_date', l.start_date, 'end_date', l.end_date,
                                          'start_time', l.start_time, 'end_time', l.end_time))
      from public.doctor_leaves l, r
      where (p_doctor is null or l.doctor_id = p_doctor) and l.status = 'approved'
        and l.start_date <= r.t and l.end_date >= r.f), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'holiday_date', h.holiday_date, 'name', h.name))
      from public.holidays h, r where h.holiday_date between r.f and r.t), '[]'::jsonb))
$$;

-- p_channel: 'whatsapp' or 'sms' as picked by the visitor; null / unavailable → every available channel
create or replace function public.request_booking_otp(p_phone text, p_channel text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone  text := public.norm_phone(p_phone);
  v_code   text;
  v_queued int;
  v_id     uuid;
  v_avail  text[] := public.booking_otp_channels();
  v_use    text[];
begin
  if public.booking_setting('enabled', 'true') <> 'true' then
    raise exception 'Online booking is switched off right now. Please call the hospital to book.';
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Please enter a valid 10-digit Indian mobile number.';
  end if;
  if exists (select 1 from public.booking_otps where phone = v_phone and created_at > now() - interval '30 seconds') then
    raise exception 'Please wait 30 seconds before requesting another code.';
  end if;
  if (select count(*) from public.booking_otps where phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested for this number. Please try again in an hour.';
  end if;
  -- whole-site cap: stops bots cycling through thousands of numbers to run up the SMS bill ("SMS pumping")
  if (select count(*) from public.booking_otps where created_at > now() - interval '1 hour')
     >= greatest(10, coalesce(nullif(public.booking_setting('otpHourlyLimit', '200'), '')::int, 200)) then
    raise exception 'Online booking is very busy right now. Please try again in a few minutes or call the hospital.';
  end if;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.booking_otps (phone, code_hash, expires_at)
  values (v_phone, extensions.crypt(v_code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes')
  returning id into v_id;
  v_use := case when p_channel = any (v_avail) then array[p_channel] else v_avail end;
  v_queued := case when cardinality(v_use) > 0 then public.send_booking_otp(v_phone, v_code, v_id, v_use) else 0 end;

  -- the code is only ever returned to the browser when no SMS/WhatsApp gateway took it AND demo mode is on
  -- `ref` lets the browser ask the notify function to deliver exactly this message right away
  return jsonb_build_object('sent', true, 'expires_in', 600, 'queued', v_queued, 'ref', v_id,
    'channels', case when v_queued > 0 then to_jsonb(v_use) else '[]'::jsonb end,
    'demo_code', case when v_queued = 0 and public.booking_setting('showDemoOtp', 'true') = 'true' then v_code end);
end $$;

-- returns {ok:true, token} or {ok:false, error} (no exception, so the failed-attempt counter is kept)
create or replace function public.verify_booking_otp(p_phone text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone text := public.norm_phone(p_phone);
  o       public.booking_otps;
  v_token uuid;
begin
  select * into o from public.booking_otps
  where phone = v_phone and verified_at is null
  order by created_at desc limit 1
  for update;

  if not found or o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This code has expired. Please request a new one.');
  end if;
  if o.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Please request a new code.');
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or o.code_hash <> extensions.crypt(p_code, o.code_hash) then
    update public.booking_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error',
      case when o.attempts + 1 >= 5 then 'Too many wrong attempts. Please request a new code.'
           else format('That code is not correct — %s attempt%s left.', 4 - o.attempts, case when 4 - o.attempts = 1 then '' else 's' end) end);
  end if;

  v_token := gen_random_uuid();
  update public.booking_otps set verified_at = now(), token = v_token where id = o.id;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- Why a slot can't be booked (same rules as src/lib/schedule.ts), or null when it is free to book.
-- Double-booking itself is prevented by the unique index appointments_one_per_slot.
drop function if exists public.slot_problem(uuid, date, text, boolean) cascade;
create function public.slot_problem(p_doctor uuid, p_date date, p_time text, p_enforce_window boolean default true)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  d         public.doctors;
  v_now     timestamp := now() at time zone 'Asia/Kolkata';
  v_min     int;
  v_shift   text[];
  v_advance int := coalesce(nullif(public.booking_setting('advanceDays', '30'), '')::int, 30);
  v_notice  int := coalesce(nullif(public.booking_setting('minNoticeMinutes', '60'), '')::int, 60);
begin
  if coalesce(p_time, '') !~ '^[0-2][0-9]:[0-5][0-9]$' then return 'Invalid time.'; end if;
  v_min := split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int;
  select * into d from public.doctors where id = p_doctor;
  if not found or d.status <> 'active' then return 'This doctor is not taking bookings right now.'; end if;
  if p_date < v_now::date then return 'This date is in the past.'; end if;
  if p_enforce_window and p_date > v_now::date + v_advance then return format('Please choose a date within the next %s days.', v_advance); end if;
  if p_enforce_window and p_date + make_interval(mins => v_min) < v_now + make_interval(mins => v_notice) then
    return 'This time is too soon — please pick a later slot.';
  end if;
  if not p_enforce_window and p_date + make_interval(mins => v_min) < v_now then return 'This time has already passed.'; end if;
  if v_min % 30 <> 0 or v_min < 480 or v_min > 1110 then return 'Invalid time.'; end if;
  if exists (select 1 from public.holidays where holiday_date = p_date) then return 'The OPD is closed on this day.'; end if;
  if not (to_char(p_date, 'Dy') = any (coalesce(nullif(d.available_days, '{}'), array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']))) then
    return 'The doctor does not consult on this day.';
  end if;
  v_shift := regexp_match(coalesce(d.shift, ''), '(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})');
  if v_shift is not null and (v_min < v_shift[1]::int * 60 + v_shift[2]::int or v_min >= v_shift[3]::int * 60 + v_shift[4]::int) then
    return 'Outside the doctor''s consulting hours.';
  end if;
  if exists (
    select 1 from public.doctor_leaves l
    where l.doctor_id = d.id and l.status = 'approved' and p_date between l.start_date and l.end_date
      and (l.start_time is null
           or (v_min >= split_part(l.start_time, ':', 1)::int * 60 + split_part(l.start_time, ':', 2)::int
               and v_min < split_part(l.end_time, ':', 1)::int * 60 + split_part(l.end_time, ':', 2)::int))
  ) then
    return 'The doctor is unavailable at this time.';
  end if;
  return null;
end $$;

-- Books a slot for an already-verified mobile number (OTP on the website, or the WhatsApp sender itself).
-- Internal: only called by public_book_appointment / whatsapp_book_appointment.
drop function if exists public.book_slot_internal(text, uuid, date, text, text, text, date, text, text, text) cascade;
create function public.book_slot_internal(
  p_phone text, p_doctor uuid, p_date date, p_time text,
  p_name text, p_gender text, p_dob date, p_email text, p_reason text, p_source text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d         public.doctors;
  v_patient public.patients;
  v_appt    public.appointments;
  v_inv     public.invoices;
  v_dep     text;
  v_now     timestamp := now() at time zone 'Asia/Kolkata';
  v_new     boolean := false;
  v_name    text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone   text := public.norm_phone(p_phone);
  v_problem text;
  v_ref     text;
  v_seq     int;
  v_fee     numeric;
  v_rate    numeric;
  v_tax     numeric;
begin
  if public.booking_setting('enabled', 'true') <> 'true' then
    raise exception 'Online booking is switched off right now. Please call the hospital to book.';
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit Indian mobile number.'; end if;

  -- input
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'Please enter the patient''s full name.'; end if;
  if p_gender is null or p_gender not in ('male', 'female', 'other') then p_gender := 'other'; end if;
  if p_dob is not null and (p_dob > v_now::date or p_dob < v_now::date - 43830) then raise exception 'Please check the date of birth.'; end if;
  if nullif(trim(p_email), '') is not null and trim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please check the email address.'; end if;

  -- the slot must really be free
  v_problem := public.slot_problem(p_doctor, p_date, p_time, true);
  if v_problem is not null then raise exception 'SLOT_UNAVAILABLE: %', v_problem; end if;
  select * into d from public.doctors where id = p_doctor;

  -- patient: same mobile AND same name → existing record (families often share one phone)
  select * into v_patient from public.patients
  where public.norm_phone(phone) = v_phone and lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) = lower(v_name)
  order by created_at limit 1;

  if v_patient.id is not null then
    if exists (select 1 from public.appointments where patient_id = v_patient.id and doctor_id = d.id
               and appointment_date = p_date and status not in ('cancelled', 'no_show')) then
      raise exception 'You already have a booking with this doctor on this day.';
    end if;
  else
    -- mrn '' → assign_record_number() numbers it per hospital
    insert into public.patients (mrn, full_name, gender, date_of_birth, phone, email, status)
    values ('', v_name, p_gender, p_dob, '+91 ' || substr(v_phone, 1, 5) || ' ' || substr(v_phone, 6),
            nullif(lower(trim(p_email)), ''), 'outpatient')
    returning * into v_patient;
    v_new := true;
  end if;

  -- appointment (the partial unique index settles a race for the same slot)
  v_ref := 'DCB-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  begin
    insert into public.appointments (patient_id, doctor_id, appointment_date, appointment_time, type, status, reason, source, booking_ref)
    values (v_patient.id, d.id, p_date, p_time, 'consultation', 'scheduled', nullif(left(trim(p_reason), 500), ''), p_source, v_ref)
    returning * into v_appt;
  exception when unique_violation then
    raise exception 'SLOT_TAKEN: Sorry — someone just booked this slot. Please pick another time.';
  end;

  -- unpaid invoice (GST % from Settings → Billing; 0 = exempt → Bill of Supply)
  v_fee  := d.consultation_fee;
  v_rate := coalesce(nullif(public.booking_setting('gstRate', '0', 'billing'), '')::numeric, 0);
  v_tax  := round(v_fee * v_rate / 100, 2);
  -- invoice_number '' → assign_record_number() numbers it per hospital
  insert into public.invoices (invoice_number, patient_id, issue_date, due_date, items, subtotal, tax, discount, total, amount_paid, status, notes)
  values ('', v_patient.id, v_now::date, p_date,
          jsonb_build_array(jsonb_build_object(
            'description', format('Consultation — %s (%s) · %s, %s', d.full_name, d.specialization, to_char(p_date, 'DD Mon YYYY'), p_time),
            'quantity', 1, 'unit_price', v_fee)),
          v_fee, v_tax, 0, v_fee + v_tax, 0, 'unpaid', initcap(p_source) || ' booking ' || v_ref)
  returning * into v_inv;

  select name into v_dep from public.departments where id = d.department_id;
  return jsonb_build_object(
    'ref', v_ref,
    'is_new_patient', v_new,
    'appointment', to_jsonb(v_appt) - 'notes',
    'patient', jsonb_build_object('id', v_patient.id, 'full_name', v_patient.full_name, 'mrn', v_patient.mrn,
                                  'phone', v_patient.phone, 'email', v_patient.email, 'gender', v_patient.gender,
                                  'address', v_patient.address),
    'doctor', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'specialization', d.specialization, 'department', v_dep),
    'invoice', to_jsonb(v_inv));
end $$;
revoke all on function public.book_slot_internal(text, uuid, date, text, text, text, date, text, text, text) from public, anon, authenticated;

create or replace function public.public_book_appointment(
  p_token uuid, p_doctor uuid, p_date date, p_time text,
  p_name text, p_gender text, p_dob date, p_email text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o     public.booking_otps;
  v_res jsonb;
begin
  perform set_config('app.actor_name', 'Website booking', true);
  perform set_config('app.actor_role', 'public', true);
  if public.booking_setting('enabled', 'true') <> 'true' then
    raise exception 'Online booking is switched off right now. Please call the hospital to book.';
  end if;
  -- verified phone (one booking per verification, valid 30 minutes)
  select * into o from public.booking_otps where token = p_token for update;
  if not found or o.verified_at is null or o.token_used_at is not null or o.verified_at < now() - interval '30 minutes' then
    raise exception 'OTP_REQUIRED: Please verify your mobile number again.';
  end if;
  v_res := public.book_slot_internal(o.phone, p_doctor, p_date, p_time, p_name, p_gender, p_dob, p_email, p_reason, 'website');
  update public.booking_otps set token_used_at = now() where id = o.id;
  return v_res;
end $$;

-- WhatsApp chatbot bookings: the sender's number is already verified by WhatsApp. Service role only
-- (called by the Edge Function supabase/functions/whatsapp-bot).
drop function if exists public.whatsapp_book_appointment(text, uuid, date, text, text, text) cascade;
create function public.whatsapp_book_appointment(p_phone text, p_doctor uuid, p_date date, p_time text, p_name text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform set_config('app.actor_name', 'WhatsApp booking', true);
  perform set_config('app.actor_role', 'public', true);
  return public.book_slot_internal(p_phone, p_doctor, p_date, p_time, p_name, 'other', null, null, p_reason, 'whatsapp');
end $$;
revoke all on function public.whatsapp_book_appointment(text, uuid, date, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_book_appointment(text, uuid, date, text, text, text) to service_role;
grant execute on function public.public_doctors() to service_role;
grant execute on function public.public_availability(uuid, date, date) to service_role;

revoke all on function public.send_booking_otp(text, text, uuid, text[]) from public, anon, authenticated;
revoke all on function public.slot_problem(uuid, date, text, boolean) from public, anon;
grant execute on function public.slot_problem(uuid, date, text, boolean) to authenticated;
revoke all on function public.booking_setting(text, text, text) from public, anon;
grant execute on function public.public_doctors() to anon, authenticated;
grant execute on function public.public_availability(uuid, date, date) to anon, authenticated;
grant execute on function public.request_booking_otp(text, text) to anon, authenticated;
grant execute on function public.booking_otp_channels() to anon, authenticated;
grant execute on function public.verify_booking_otp(text, text) to anon, authenticated;
grant execute on function public.public_book_appointment(uuid, uuid, date, text, text, text, date, text, text) to anon, authenticated;

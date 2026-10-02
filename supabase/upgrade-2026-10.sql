-- ============================================================================================================
-- DC Hospital — in-place upgrade for databases created with an older master.sql / production.sql (October 2026).
-- Safe to run more than once. Keeps all data. Run it in the Supabase SQL editor.
--   • enquiry inbox columns (starred, read_at) + insert policy + Contact-form flood limits
--   • records are never cascade-deleted: patients / doctors / invoices with history can't be deleted
--   • MRN and invoice numbers assigned under a lock (no duplicates when two desks save together)
--   • default dates use the Indian calendar day (Supabase runs on UTC)
--   • site-wide OTP cap against SMS pumping; go-live cleanup keeps real records that point at demo ones
--   • server-side pagination: search / sort indexes and payment → invoice total sync, financial_report() for Reports (section 15)
--   • "Forgot password" by WhatsApp / SMS code, next to the e-mail link (section 16)
--   • website forms (Settings → Forms): site_forms table, form answers on enquiries, submit_site_form() (section 17)
-- (New installs don't need this — production.sql / master.sql already include everything.)
-- ============================================================================================================
begin;

alter table public.site_enquiries add column if not exists starred boolean not null default false;
alter table public.site_enquiries add column if not exists read_at timestamptz;
-- existing messages that were already handled count as read
update public.site_enquiries set read_at = coalesce(updated_at, created_at) where read_at is null and status <> 'new';

create or replace function public.today_ist() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

do $$
declare r record;
begin
  -- default dates → Indian calendar day
  for r in select * from (values ('prescriptions','prescribed_on'),('lab_tests','requested_on'),('admissions','admission_date'),('invoices','issue_date'),
                                 ('payments','paid_on'),('expenses','expense_date'),('notices','published_on')) v(t, c) loop
    execute format('alter table public.%I alter column %I set default public.today_ist()', r.t, r.c);
  end loop;
  -- cascade → restrict for clinical and billing history
  for r in select * from (values ('appointments','patient_id','patients'),('appointments','doctor_id','doctors'),('prescriptions','patient_id','patients'),
                                 ('prescriptions','doctor_id','doctors'),('lab_tests','patient_id','patients'),('admissions','patient_id','patients'),
                                 ('invoices','patient_id','patients'),('payments','invoice_id','invoices'),('payments','patient_id','patients')) v(t, c, ref) loop
    execute format('alter table public.%I drop constraint if exists %I', r.t, r.t || '_' || r.c || '_fkey');
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I (id) on delete restrict', r.t, r.t || '_' || r.c || '_fkey', r.c, r.ref);
  end loop;
end $$;

create or replace function public.assign_record_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'patients' then
    perform pg_advisory_xact_lock(hashtext('dch_patient_mrn'));
    if coalesce(new.mrn, '') = '' or exists (select 1 from public.patients where mrn = new.mrn) then
      select 'DCH-' || (coalesce(max(nullif(regexp_replace(mrn, '\D', '', 'g'), '')::bigint), 100000) + 1) into new.mrn from public.patients;
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('dch_invoice_number'));
    if coalesce(new.invoice_number, '') = '' or exists (select 1 from public.invoices where invoice_number = new.invoice_number) then
      select 'INV-' || lpad((coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 10000) + 1)::text, 5, '0')
        into new.invoice_number from public.invoices;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_patients_number on public.patients;
create trigger trg_patients_number before insert on public.patients
  for each row execute function public.assign_record_number();
drop trigger if exists trg_invoices_number on public.invoices;
create trigger trg_invoices_number before insert on public.invoices
  for each row execute function public.assign_record_number();

drop policy if exists site_enquiries_public_insert on public.site_enquiries;
create policy site_enquiries_public_insert on public.site_enquiries for insert to anon, authenticated
  with check (status = 'new' and notes is null and starred = false and read_at is null);

-- Contact-form flood protection: 3 messages per mobile number per hour and 60 per hour for the whole site.
-- Staff inserts are not limited.
create or replace function public.limit_site_enquiries()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_digits text := right(regexp_replace(new.phone, '\D', '', 'g'), 10);
begin
  if auth.uid() is not null and public.is_staff() then return new; end if;
  if (select count(*) from public.site_enquiries where created_at > now() - interval '1 hour'
        and right(regexp_replace(phone, '\D', '', 'g'), 10) = v_digits) >= 3 then
    raise exception 'You have already sent us a few messages in the last hour — we will get back to you soon. For anything urgent please call us.';
  end if;
  if (select count(*) from public.site_enquiries where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are receiving a lot of messages right now. Please try again shortly or call us.';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_enquiries_limit on public.site_enquiries;
create trigger trg_site_enquiries_limit before insert on public.site_enquiries
  for each row execute function public.limit_site_enquiries();
revoke all on function public.limit_site_enquiries() from public, anon;

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

drop function if exists public.clear_demo_data() cascade;
create function public.clear_demo_data()
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_total int := 0; v_n int; t text; v_id uuid;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can do this.'; end if;
  perform set_config('app.actor_name', 'Go-live cleanup', true);
  foreach t in array array['visit_feedback', 'payments', 'invoices', 'admissions', 'lab_tests', 'prescriptions', 'appointments',
                           'doctor_leaves', 'site_enquiries', 'notices', 'expenses', 'inventory', 'beds', 'wards', 'patients']
  loop
    begin
      execute format('delete from public.%I where public.is_demo_id(id)', t);
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    exception when foreign_key_violation or restrict_violation then
      -- a real record points at a demo one (e.g. a real bill for a demo patient): keep those, delete the rest
      for v_id in execute format('select id from public.%I where public.is_demo_id(id)', t) loop
        begin
          execute format('delete from public.%I where id = $1', t) using v_id;
          v_total := v_total + 1;
        exception when foreign_key_violation or restrict_violation then null;
        end;
      end loop;
    end;
  end loop;
  return v_total;
end $$;
revoke all on function public.clear_demo_data() from public, anon;
grant execute on function public.clear_demo_data() to authenticated;

-- =====================================================================================================
--  15. SCALE — server-side pagination support (idempotent; also shipped in supabase/upgrade-2026-10.sql)
--
--  The dashboard never downloads whole tables: lists ask for one page (search / filters / sort run here),
--  dashboards read date windows and counts. These indexes keep those reads fast at lakhs of rows, and the
--  payment trigger keeps invoice totals correct without the browser having to read the invoice first.
-- =====================================================================================================

-- ---- sort / window indexes used by the paged lists and dashboards
create index if not exists patients_created_idx      on public.patients (created_at desc);
create index if not exists patients_status_idx       on public.patients (status);
create index if not exists invoices_issue_idx        on public.invoices (issue_date desc);
create index if not exists invoices_open_idx         on public.invoices (due_date) where status in ('unpaid', 'partial', 'overdue');
create index if not exists payments_paid_on_idx      on public.payments (paid_on desc);
create index if not exists prescriptions_date_idx    on public.prescriptions (prescribed_on desc);
create index if not exists prescriptions_follow_idx  on public.prescriptions (doctor_id, follow_up_date) where follow_up_date is not null;
create index if not exists lab_tests_requested_idx   on public.lab_tests (requested_on desc);
create index if not exists lab_tests_doctor_idx      on public.lab_tests (doctor_id, status);
create index if not exists admissions_status_idx     on public.admissions (status, admission_date desc);
create index if not exists admissions_doctor_idx     on public.admissions (doctor_id) where status = 'admitted';
create index if not exists appointments_status_date_idx on public.appointments (status, appointment_date);
create index if not exists visit_feedback_created_idx on public.visit_feedback (created_at desc);

-- ---- fast "contains" search on names / phones / numbers (pg_trgm). Optional: skipped where unavailable.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index if not exists patients_name_trgm  on public.patients using gin (full_name extensions.gin_trgm_ops)';
  execute 'create index if not exists patients_phone_trgm on public.patients using gin (phone extensions.gin_trgm_ops)';
  execute 'create index if not exists patients_mrn_trgm   on public.patients using gin (mrn extensions.gin_trgm_ops)';
  execute 'create index if not exists invoices_number_trgm on public.invoices using gin (invoice_number extensions.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm not available (%): search still works, just without trigram indexes', sqlerrm;
end $$;

-- ---- payments → invoice totals (single source of truth: the sum of the invoice's payments)
create or replace function public.invoice_recalc(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric(12,2);
begin
  if p_invoice is null then return; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = p_invoice;
  update public.invoices i set
    amount_paid = v_paid,
    status = case
      when i.status in ('draft', 'cancelled') then i.status
      when i.total > 0 and v_paid >= i.total then 'paid'
      when v_paid > 0 then 'partial'
      when i.due_date is not null and i.due_date < public.today_ist() then 'overdue'
      else 'unpaid' end
  where i.id = p_invoice
    and (i.amount_paid is distinct from v_paid or i.status is distinct from (case
      when i.status in ('draft', 'cancelled') then i.status
      when i.total > 0 and v_paid >= i.total then 'paid'
      when v_paid > 0 then 'partial'
      when i.due_date is not null and i.due_date < public.today_ist() then 'overdue'
      else 'unpaid' end));
end $$;
revoke execute on function public.invoice_recalc(uuid) from public, anon, authenticated;

-- the payment always belongs to the invoice's patient (the browser no longer has to look it up)
create or replace function public.payments_stamp_patient()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select patient_id into new.patient_id from public.invoices where id = new.invoice_id;
  if new.patient_id is null then raise exception 'Invoice not found' using errcode = '23503'; end if;
  return new;
end $$;
revoke execute on function public.payments_stamp_patient() from public, anon, authenticated;

create or replace function public.payments_sync_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.invoice_recalc(old.invoice_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id or new.amount is distinct from old.amount) then
    perform public.invoice_recalc(new.invoice_id);
  end if;
  return null;
end $$;
revoke execute on function public.payments_sync_invoice() from public, anon, authenticated;

drop trigger if exists trg_payments_stamp_patient on public.payments;
create trigger trg_payments_stamp_patient before insert or update of invoice_id on public.payments
  for each row execute function public.payments_stamp_patient();
drop trigger if exists trg_payments_sync_invoice on public.payments;
create trigger trg_payments_sync_invoice after insert or update or delete on public.payments
  for each row execute function public.payments_sync_invoice();

-- ---- Financial Reports totals (the Reports page never downloads every invoice). Runs with the caller's rights,
--      so RLS decides who sees what (owner / accountant). Buckets mirror src/lib/reports.ts.
create or replace function public.financial_report(p_from date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  with inv as (
    select issue_date, total, items from public.invoices where issue_date >= p_from and status not in ('cancelled', 'draft')
  ), items as (
    select coalesce(it ->> 'description', '') d,
           coalesce((it ->> 'quantity')::numeric, 0) * coalesce((it ->> 'unit_price')::numeric, 0) amt
    from inv cross join lateral jsonb_array_elements(case when jsonb_typeof(inv.items) = 'array' then inv.items else '[]'::jsonb end) it
  )
  select jsonb_build_object(
    'billed', (select coalesce(jsonb_object_agg(m, v), '{}') from (select to_char(issue_date, 'YYYY-MM') m, sum(total) v from inv group by 1) x),
    'collected', (select coalesce(jsonb_object_agg(m, v), '{}') from (select to_char(paid_on, 'YYYY-MM') m, sum(amount) v from public.payments where paid_on >= p_from group by 1) x),
    'expenses', (select coalesce(jsonb_object_agg(m, v), '{}') from (select to_char(expense_date, 'YYYY-MM') m, sum(amount) v from public.expenses where expense_date >= p_from group by 1) x),
    'cats', (select coalesce(jsonb_object_agg(category, v), '{}') from (select category, sum(amount) v from public.expenses where expense_date >= p_from group by 1) x),
    'sources', (select coalesce(jsonb_object_agg(s, v), '{}') from (
      select case when d ~* '^Consultation' then 'Consultations' when d ~* '^Lab' then 'Laboratory'
                  when d ~* 'bed charges|Nursing' then 'IPD / Room' when d ~* 'Pharmacy' then 'Pharmacy'
                  when d ~* 'Procedure|OT' then 'Procedures' else 'Other' end s, sum(amt) v
      from items group by 1) x),
    'doctors', (select coalesce(jsonb_object_agg(n, v), '{}') from (
      select substring(d from '^Consultation – (.+)$') n, sum(amt) v from items where d ~ '^Consultation – .+' group by 1) x)
  ) into r;
  return r;
end $$;
revoke execute on function public.financial_report(date) from public, anon;
grant execute on function public.financial_report(date) to authenticated;

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

-- >>> forms (generated from scripts/sql/forms.sql — do not edit here)
-- =====================================================================================================
--  17. WEBSITE FORMS (idempotent; also shipped in supabase/upgrade-2026-10.sql)
--
--  Settings → Forms: the owner manages the Contact form, the Patient review form and any custom form
--  (callback request, job application, health camp…). Every submission lands in the Enquiries inbox
--  (site_enquiries) with the form it came from (form_id, form_name) and all its answers (data).
--    site_forms                       owner: full access · receptionist: read · visitors: enabled forms only
--    submit_site_form(form, answers)  the only way visitors submit a form — validates every answer against the
--                                     form's fields (same rules as src/forms/schema.ts) and returns the reference
--  Older messages (sent before forms existed) are filed under the Contact form.
-- =====================================================================================================

create table if not exists public.site_forms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 500),
  kind        text not null default 'custom' check (kind in ('contact', 'review', 'custom')),
  enabled     boolean not null default true,
  fields      jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_site_forms_updated_at on public.site_forms;
create trigger trg_site_forms_updated_at before update on public.site_forms
  for each row execute function public.set_updated_at();

alter table public.site_enquiries add column if not exists form_id uuid;
alter table public.site_enquiries add column if not exists form_name text;
alter table public.site_enquiries add column if not exists data jsonb;
create index if not exists site_enquiries_form_id_created_at_idx on public.site_enquiries (form_id, created_at desc);

-- built-in forms (kept as edited if they already exist)
insert into public.site_forms (id, slug, name, description, kind, enabled, fields, settings, sort) values
  ('f0000000-0000-4000-8000-000000000001', 'contact', 'Contact form', 'The form on the Contact page. Topics come from Website CMS → Contact page unless you set options here.', 'contact', true, '[{"id":"name","type":"text","label":"Full name","placeholder":"Priya Sharma","required":true,"role":"name","width":"half"},{"id":"phone","type":"phone","label":"Mobile number","placeholder":"98100 12345","required":true,"role":"phone","width":"half"},{"id":"email","type":"email","label":"Email","placeholder":"you@example.com","role":"email","width":"half"},{"id":"speciality","type":"select","label":"Speciality","placeholder":"Not sure / general","optionsFrom":"services","role":"speciality","width":"half"},{"id":"topic","type":"radio","label":"How can we help?","required":true,"options":[],"role":"topic"},{"id":"message","type":"textarea","label":"Message","placeholder":"Tell us how we can help…","required":true,"role":"message"},{"id":"consent","type":"consent","label":"I agree to be contacted about my enquiry and accept the privacy policy.","required":true}]'::jsonb, '{"submitLabel":"Send message","color":"brand"}'::jsonb, 0),
  ('f0000000-0000-4000-8000-000000000002', 'review', 'Patient review', 'Share your experience at our hospital. Reviews are read by the management.', 'review', true, '[{"id":"rating","type":"rating","label":"Overall experience","required":true},{"id":"name","type":"text","label":"Full name","placeholder":"Priya Sharma","required":true,"role":"name","width":"half"},{"id":"phone","type":"phone","label":"Mobile number","placeholder":"98100 12345","required":true,"role":"phone","width":"half"},{"id":"doctor","type":"text","label":"Doctor or department you visited","placeholder":"e.g. Dr. Arjun Mehta, Cardiology","width":"half"},{"id":"visit_date","type":"date","label":"Date of visit","width":"half"},{"id":"liked","type":"checkboxes","label":"What went well?","options":["Doctor consultation","Nursing care","Cleanliness","Waiting time","Billing & front desk"]},{"id":"message","type":"textarea","label":"Your review","placeholder":"Tell us about your visit…","required":true,"role":"message"},{"id":"publish","type":"consent","label":"You may publish my first name with this review on the website."}]'::jsonb, '{"topic":"Patient review","submitLabel":"Submit review","successTitle":"Thank you for your review!","successText":"Your feedback helps us care better for every patient.","color":"amber"}'::jsonb, 1)
on conflict do nothing;

-- messages without a form (older app versions, staff-added) belong to the Contact form
create or replace function public.site_enquiry_default_form()
returns trigger language plpgsql as $$
begin
  if new.form_id is null then
    new.form_id := 'f0000000-0000-4000-8000-000000000001';
    new.form_name := coalesce(new.form_name, (select name from public.site_forms where id = new.form_id), 'Contact form');
  end if;
  return new;
end $$;
drop trigger if exists trg_site_enquiries_form on public.site_enquiries;
create trigger trg_site_enquiries_form before insert on public.site_enquiries
  for each row execute function public.site_enquiry_default_form();
revoke all on function public.site_enquiry_default_form() from public, anon, authenticated;

update public.site_enquiries
   set form_id = 'f0000000-0000-4000-8000-000000000001', form_name = coalesce(form_name, 'Contact form')
 where form_id is null;

-- RLS (same names as the generated policies in master.sql, so re-running is harmless)
alter table public.site_forms enable row level security;
drop policy if exists site_forms_select on public.site_forms;
drop policy if exists site_forms_insert on public.site_forms;
drop policy if exists site_forms_update on public.site_forms;
drop policy if exists site_forms_delete on public.site_forms;
drop policy if exists site_forms_public_read on public.site_forms;
create policy site_forms_select on public.site_forms for select to authenticated
  using (public.has_role('owner', 'receptionist'));
create policy site_forms_insert on public.site_forms for insert to authenticated
  with check (public.has_role('owner'));
create policy site_forms_update on public.site_forms for update to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy site_forms_delete on public.site_forms for delete to authenticated
  using (public.has_role('owner'));
create policy site_forms_public_read on public.site_forms for select to anon, authenticated
  using (enabled);

-- direct inserts (older app versions) can't fake form answers; forms go through submit_site_form()
drop policy if exists site_enquiries_public_insert on public.site_enquiries;
create policy site_enquiries_public_insert on public.site_enquiries for insert to anon, authenticated
  with check (status = 'new' and notes is null and starred = false and read_at is null and data is null);

grant select on public.site_forms to anon;
grant select, insert, update, delete on public.site_forms to authenticated;

-- one submission → one inbox message. Mirrors validateAnswers() + toEnquiry() in src/forms/schema.ts.
create or replace function public.submit_site_form(p_form uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  f        public.site_forms;
  fld      jsonb;
  v        jsonb;
  s        text;
  t        text;
  r        text;
  lbl      text;
  opts     jsonb;
  is_empty boolean;
  req      boolean;
  err      text;
  v_data   jsonb := '[]'::jsonb;
  v_lines  text[] := '{}';
  v_name   text := '';
  v_phone  text := '';
  v_email  text := '';
  v_topic  text := '';
  v_spec   text := '';
  v_msg    text := '';
  v_ref    text;
begin
  select * into f from public.site_forms where id = p_form and enabled;
  if not found then raise exception 'This form is not available any more. Please refresh the page.'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Please fill in the form.'; end if;

  for fld in select value from jsonb_array_elements(f.fields) loop
    t := fld ->> 'type';
    r := fld ->> 'role';
    lbl := coalesce(fld ->> 'label', 'This field');
    v := p_answers -> (fld ->> 'id');
    if v is not null and jsonb_typeof(v) = 'null' then v := null; end if;
    req := coalesce((fld ->> 'required')::boolean, false) or r in ('name', 'phone');
    opts := case when jsonb_typeof(fld -> 'options') = 'array' then fld -> 'options' else '[]'::jsonb end;

    if v is null then s := '';
    elsif jsonb_typeof(v) = 'array' then s := coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v) x), '');
    elsif jsonb_typeof(v) = 'string' then s := v #>> '{}';
    elsif jsonb_typeof(v) in ('number', 'boolean') then s := v::text;
    else raise exception '%: invalid answer', lbl;
    end if;
    s := btrim(s);

    if t = 'consent' then is_empty := v is distinct from 'true'::jsonb;
    elsif t = 'checkboxes' then
      if v is not null and jsonb_typeof(v) <> 'array' then raise exception '%: invalid answer', lbl; end if;
      is_empty := v is null or jsonb_array_length(v) = 0;
    else is_empty := s = '';
    end if;

    if is_empty then
      if req then
        raise exception '%', case t when 'consent' then 'Please accept: ' || lbl when 'rating' then 'Please choose a rating' else lbl || ' is required' end;
      end if;
      continue;
    end if;

    err := null;
    case t
      when 'text' then
        if char_length(s) > 200 then err := 'keep it under 200 characters';
        elsif r = 'name' and char_length(s) < 2 then err := 'please enter your full name'; end if;
      when 'textarea' then
        if char_length(s) > 2000 then err := 'keep it under 2000 characters';
        elsif r = 'message' and req and char_length(s) < 10 then err := 'tell us a little more (at least 10 characters)'; end if;
      when 'email' then
        if s !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(s) > 200 then err := 'enter a valid email address'; end if;
      when 'phone' then
        if right(regexp_replace(s, '\D', '', 'g'), 10) !~ '^[6-9][0-9]{9}$' or s !~ '^[0-9\s+-]+$' then err := 'enter a valid 10-digit mobile number'; end if;
      when 'number' then
        if s !~ '^-?[0-9]{1,12}(\.[0-9]{1,4})?$' then err := 'enter a number'; end if;
      when 'date' then
        if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then err := 'pick a date'; end if;
      when 'rating' then
        if s not in ('1', '2', '3', '4', '5') then err := 'please choose a rating'; end if;
      when 'select', 'radio' then
        if jsonb_array_length(opts) > 0 and not opts ? s then err := 'please choose one of the options';
        elsif char_length(s) > 120 then err := 'invalid choice'; end if;
      when 'checkboxes' then
        if jsonb_array_length(opts) > 0 and exists (select 1 from jsonb_array_elements_text(v) x where not opts ? x) then err := 'please choose from the options';
        elsif char_length(s) > 1000 then err := 'too many choices'; end if;
      when 'consent' then null;
      else err := 'unsupported field';
    end case;
    if err is not null then raise exception '%: %', lbl, err; end if;

    v_data := v_data || jsonb_build_array(jsonb_build_object('id', fld ->> 'id', 'label', lbl, 'type', t, 'value',
      case when t = 'checkboxes' then (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(v) x)
           when t in ('rating', 'number') then to_jsonb(s::numeric)
           when t = 'consent' then 'true'::jsonb
           else to_jsonb(s) end));

    case r
      when 'name' then v_name := s;
      when 'phone' then v_phone := s;
      when 'email' then v_email := s;
      when 'topic' then v_topic := s;
      when 'speciality' then v_spec := s;
      when 'message' then v_msg := s;
      else null;
    end case;
    if (r is null or r not in ('name', 'phone', 'email', 'topic', 'speciality')) and t <> 'consent' then
      v_lines := v_lines || (lbl || ': ' || case when t = 'rating' then s || '/5' else s end);
    end if;
  end loop;

  if v_name = '' or v_phone = '' then raise exception 'This form is missing its name or mobile field. Please contact the hospital.'; end if;

  insert into public.site_enquiries (name, phone, email, topic, speciality, message, form_id, form_name, data)
  values (left(v_name, 120), v_phone, nullif(v_email, ''),
          left(coalesce(nullif(v_topic, ''), nullif(btrim(f.settings ->> 'topic'), ''), f.name), 80),
          nullif(left(v_spec, 80), ''),
          left(coalesce(nullif(v_msg, ''), nullif(array_to_string(v_lines, E'\n'), ''), f.name), 2000),
          f.id, f.name, v_data)
  returning ref into v_ref;
  return jsonb_build_object('ref', v_ref);
end $$;

revoke all on function public.submit_site_form(uuid, jsonb) from public;
grant execute on function public.submit_site_form(uuid, jsonb) to anon, authenticated;
-- <<< forms

-- >>> messaging (generated from scripts/sql/messaging.sql — do not edit here)
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
with d as (select $json${"events":{"account_created":{"sms":false,"whatsapp":true,"email":true,"push":false},"account_updated":{"sms":false,"whatsapp":false,"email":true,"push":true},"account_deleted":{"sms":false,"whatsapp":false,"email":true},"password_changed":{"sms":true,"whatsapp":false,"email":true,"push":true},"notice_published":{"sms":false,"whatsapp":false,"email":false,"push":true}},"templates":{"account_created":{"text":"Welcome to {hospital}, {name}! Your {role} account is ready. Sign in at {link} with {email}.","subject":"Welcome to {hospital}","waTemplate":"","waParams":"name,role,link","smsTemplateId":"","waText":"👋 *Welcome to {hospital}*\n\nHi {name}, your *{role}* account is ready.\nSign in: {link}\nE-mail: {email}","pushText":"Your {role} account is ready. Welcome aboard!"},"account_updated":{"text":"Hi {name}, your {hospital} account was updated ({changes}). If this was not you, call {hospital_phone}.","subject":"Your {hospital} account was updated","waTemplate":"","waParams":"name,changes","smsTemplateId":"","waText":"","pushText":"Your account was updated: {changes}"},"account_deleted":{"text":"Hi {name}, your {hospital} sign-in ({email}) has been removed. Your medical records are kept safely. Questions? Call {hospital_phone}.","subject":"Your {hospital} account was removed","waTemplate":"","waParams":"name,email","smsTemplateId":"","waText":""},"password_changed":{"text":"Hi {name}, your {hospital} password was changed on {time}. Not you? Reset it now: {link} or call {hospital_phone}.","subject":"Your password was changed","waTemplate":"","waParams":"name,time,link","smsTemplateId":"","waText":"","pushText":"Your password was changed on {time}. Not you? Reset it right away."},"notice_published":{"text":"{hospital} notice: {title}. {notice} — {link}","subject":"📌 {title}","waTemplate":"","waParams":"title,notice","smsTemplateId":"","waText":"📌 *{title}*\n\n{notice}\n\nRead on the notice board: {link}\n— {hospital}","pushText":"{notice}"}},"push":{"enabled":false,"apiKey":"","authDomain":"","projectId":"","messagingSenderId":"","appId":"","vapidKey":""},"rates":{"sms":0.25,"whatsapp":0.8,"email":0.05,"push":0}}$json$::jsonb as j)
update public.app_settings a set data = jsonb_set(a.data, '{notifications}', coalesce(a.data -> 'notifications', '{}'::jsonb) || jsonb_build_object(
    'events', (d.j -> 'events') || coalesce(a.data -> 'notifications' -> 'events', '{}'::jsonb),
    'templates', (d.j -> 'templates') || coalesce(a.data -> 'notifications' -> 'templates', '{}'::jsonb),
    'push', (d.j -> 'push') || coalesce(a.data -> 'notifications' -> 'push', '{}'::jsonb),
    'rates', (d.j -> 'rates') || coalesce(a.data -> 'notifications' -> 'rates', '{}'::jsonb)))
  from d
 where a.key = 'app' and jsonb_typeof(a.data -> 'notifications') = 'object';

-- ------------------------------------------------------------------ queue
-- One message per channel. p_tpl = {text, subject, waText, pushText}. Never raises.
create or replace function public.notify_enqueue_raw(p_event text, p_tpl jsonb, p_channels text[], p_phone text, p_email text, p_profile uuid,
  p_vars jsonb, p_related_table text default null, p_related_id uuid default null, p_template uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  n        jsonb := (select data -> 'notifications' from public.app_settings where key = 'app');
  site     jsonb := (select data from public.site_content where key = 'settings');
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
  n    jsonb := (select data -> 'notifications' from public.app_settings where key = 'app');
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
     where (t.audience in ('patients', 'everyone') or t.schedule = 'birthday' or (t.audience = 'roles' and 'patient' = any (t.roles)))
       and (t.schedule <> 'birthday' or to_char(p.date_of_birth, 'MM-DD') = to_char(now() at time zone 'Asia/Kolkata', 'MM-DD'))
    union all
    select pr.id, pr.full_name, pr.phone, pr.email, 2 from public.profiles pr
     where t.schedule <> 'birthday' and pr.role <> 'patient'
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
  select * into t from public.notification_templates where id = p_id;
  if not found then raise exception 'Message not found'; end if;
  return public.notify_run_template(t);
end $$;
create or replace function public.notify_template_audience(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.notification_templates;
begin
  if not public.has_role('owner') then raise exception 'Not allowed'; end if;
  select * into t from public.notification_templates where id = p_id;
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
declare t public.notification_templates; v_total int := 0;
begin
  if auth.uid() is not null and not public.has_role('owner') then raise exception 'Not allowed'; end if;
  for t in select * from public.notification_templates where enabled and next_run_at is not null and next_run_at <= now()
           order by next_run_at limit 20 for update skip locked loop
    v_total := v_total + public.notify_run_template(t);
    update public.notification_templates
       set next_run_at = public.notify_next_run(t, greatest(now(), t.next_run_at)),
           enabled = case when t.schedule = 'once' then false else enabled end
     where id = t.id;
  end loop;
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
     where o.created_at >= (p_from::timestamp at time zone 'Asia/Kolkata')
       and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
     group by 1, 2, 3, 4
     order by 1;
end $$;
revoke all on function public.notification_usage(date, date) from public, anon;
grant execute on function public.notification_usage(date, date) to authenticated;

-- ------------------------------------------------------------------ Supabase cron (pg_cron + pg_net)
-- The job calls the `notify` Edge Function with the service-role key the owner saved (write-only, like every credential).
create or replace function public.notify_cron_flush()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_url text; v_key text;
begin
  if not exists (select 1 from public.notification_outbox where status = 'pending' and next_attempt_at <= now()) then return; end if;
  select value into v_url from public.app_secrets where key = 'notify_function_url';
  select value into v_key from public.app_secrets where key = 'service_role_key';
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
    'url_set', exists (select 1 from public.app_secrets where key = 'notify_function_url'),
    'key_set', exists (select 1 from public.app_secrets where key = 'service_role_key'),
    'pending', (select count(*) from public.notification_outbox where status = 'pending'),
    'scheduled', (select count(*) from public.notification_templates where enabled and next_run_at is not null));
end $$;

create or replace function public.notify_cron_setup(p_enable boolean, p_url text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare j record;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can change automatic delivery'; end if;
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
    if not exists (select 1 from public.app_secrets where key = 'service_role_key') then raise exception 'Save the service-role key first (it lets the scheduler call the notify function).'; end if;
    if not exists (select 1 from public.app_secrets where key = 'notify_function_url') then raise exception 'Save the notify function address first.'; end if;
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
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', trim(p_full_name), 'phone', nullif(trim(coalesce(p_phone, '')), '')),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id, 'email', v_email, 'email_verified', true), 'email', null, now(), now());

  -- handle_new_user() made a patient profile; give it the chosen role
  update public.profiles set role = p_role::public.app_role, full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone, '')), '') where id = v_id;
  if p_role <> 'patient' then
    delete from public.patients where profile_id = v_id;
    if p_role = 'doctor' then update public.doctors set profile_id = v_id where lower(email) = v_email and profile_id is null;
    else update public.staff set profile_id = v_id where lower(email) = v_email and profile_id is null; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_update_user(p_id uuid, p_full_name text, p_role text, p_phone text default null, p_email text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles; v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform public.admin_guard();
  select * into p from public.profiles where id = p_id for update;
  if not found then raise exception 'User not found'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter the full name'; end if;
  if p_role not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff', 'patient') then raise exception 'Choose a role'; end if;
  if p.role = 'owner' and p_role <> 'owner' and (p_id = auth.uid() or (select count(*) from public.profiles where role = 'owner') <= 1) then
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
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_id;
  if not found then raise exception 'User not found'; end if;
end $$;

-- disabled accounts can't sign in (Supabase honours banned_until); their records stay
create or replace function public.admin_set_user_active(p_id uuid, p_active boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.admin_guard();
  if p_id = auth.uid() then raise exception 'You can''t disable your own account'; end if;
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
    using p_ids[1:200];
end $$;

-- deletes the login; patient / doctor / staff records and their history stay (they are unlinked)
create or replace function public.admin_delete_user(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p public.profiles;
begin
  perform public.admin_guard();
  if p_id = auth.uid() then raise exception 'You can''t delete your own account'; end if;
  select * into p from public.profiles where id = p_id;
  if p.role = 'owner' and (select count(*) from public.profiles where role = 'owner') <= 1 then raise exception 'You can''t delete the last owner'; end if;
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
-- <<< messaging

-- >>> tenancy (generated from scripts/sql/tenancy.sql — do not edit here)
-- =====================================================================================================
--  19. MULTI-TENANCY — Hospital Comrade (many hospitals on one database) + provider roles
--
--  Every hospital is a row in `tenants`. Every hospital table gets a `tenant_id` column and ONE extra
--  RESTRICTIVE policy, `tenant_isolation`, which Postgres ANDs with all the existing role policies:
--      tenant_id = current_tenant()
--  so nothing written before this section has to know about tenants for direct table access.
--
--  current_tenant() — which hospital this request belongs to:
--    1. app.tenant_id         set only by our own SQL (signup trigger, cron loops over hospitals)
--    2. provider              the hospital picked in the app (x-tenant-id header), if they may manage it
--    3. signed-in user        always their own hospital (profiles.tenant_id) — a header can't move them
--    4. visitor (anon)        the hospital whose website they're on (x-tenant-id header from the domain)
--    5. otherwise             the primary hospital → single-hospital installs keep working unchanged
--
--  Providers (the Hospital Comrade team) are not members of any hospital:
--    admin   everything, every hospital            → acts as owner
--    support assigned hospitals; patient records read-only → acts as owner (clinical writes blocked)
--    finance assigned hospitals; billing only      → acts as accountant
--  An admin can work in support / finance mode (x-provider-mode header) — the lower mode is the default in the app.
--
--  Idempotent: safe on a fresh database (master / production) and on a live one (upgrade).
-- =====================================================================================================

-- ------------------------------------------------------------------ tables
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null check (char_length(name) between 2 and 120),
  code        text not null default 'HSP' check (code ~ '^[A-Z]{2,6}$'),           -- MRN prefix, e.g. DCH-100001
  status      text not null default 'active' check (status in ('trial', 'active', 'grace', 'read_only', 'suspended')),
  plan        text not null default 'clinic',
  -- module → 'provider' (managed by the Hospital Comrade team, hidden from the hospital) | 'hospital' (owner may edit)
  modules     jsonb not null default '{}'::jsonb,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists tenants_one_primary on public.tenants (is_primary) where is_primary;

-- the hospital every existing row belongs to (fixed id so upgrades and seeds agree)
insert into public.tenants (id, slug, name, code, is_primary, modules)
values ('a0000000-0000-4000-8000-000000000001', 'main', 'DC Hospital', 'DCH', true,
        '{"general":"hospital","appearance":"hospital","dashboard":"hospital","notifications":"hospital","forms":"hospital","security":"hospital","data":"hospital","cms":"hospital"}'::jsonb)
on conflict (id) do nothing;

create table if not exists public.tenant_domains (
  domain          text primary key check (domain ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),   -- lower-case host, no port
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  is_primary      boolean not null default false,
  method          text not null default 'manual' check (method in ('manual', 'cloudflare')),
  verified_at     timestamptz,
  ssl_status      text,
  cf_hostname_id  text,
  created_at      timestamptz not null default now()
);
create index if not exists tenant_domains_tenant_idx on public.tenant_domains (tenant_id);

create table if not exists public.provider_users (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  role            text not null check (role in ('admin', 'support', 'finance')),
  active          boolean not null default true,
  elevated_until  timestamptz,                       -- "sudo" window for admin-only actions (provider panel)
  created_at      timestamptz not null default now()
);

create table if not exists public.provider_assignments (
  user_id     uuid not null references public.provider_users (user_id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table if not exists public.provider_audit (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  user_id     uuid,
  user_name   text,
  mode        text,
  tenant_id   uuid,
  action      text not null,
  target      text,
  detail      jsonb
);
create index if not exists provider_audit_at_idx on public.provider_audit (tenant_id, at desc);

-- ------------------------------------------------------------------ request context
create or replace function public.request_header(p_name text)
returns text language sql stable set search_path = public as $$
  select nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> lower(p_name), '')
$$;

create or replace function public.primary_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.tenants where is_primary limit 1
$$;

-- 'admin' | 'support' | 'finance' | null — the signed-in user's provider role
create or replace function public.provider_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.provider_users where user_id = auth.uid() and active
$$;

-- may the signed-in provider manage this hospital?
create or replace function public.provider_can(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tenant is not null and exists (
    select 1 from public.provider_users u
     where u.user_id = auth.uid() and u.active
       and (u.role = 'admin' or exists (select 1 from public.provider_assignments a where a.user_id = u.user_id and a.tenant_id = p_tenant)))
$$;

-- the mode a provider is working in right now: support / finance users always their own; an admin picks one
create or replace function public.provider_mode()
returns text language plpgsql stable security definer set search_path = public as $$
declare r text := public.provider_role(); m text := public.request_header('x-provider-mode');
begin
  if r is null then return null; end if;
  if r <> 'admin' then return r; end if;
  return case when m in ('admin', 'support', 'finance') then m else 'admin' end;
end $$;

create or replace function public.current_tenant()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid; h text; uid uuid := auth.uid();
begin
  h := nullif(current_setting('app.tenant_id', true), '');
  if h is not null then return h::uuid; end if;

  h := public.request_header('x-tenant-id');
  if h is not null and h !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then h := null; end if;

  if uid is not null then
    if public.provider_role() is not null then
      return case when public.provider_can(h::uuid) then h::uuid end;   -- no hospital picked → sees nothing
    end if;
    select tenant_id into v from public.profiles where id = uid;
    return v;                                                            -- a header never moves a hospital user
  end if;

  if h is not null and exists (select 1 from public.tenants where id = h::uuid) then return h::uuid; end if;
  return public.primary_tenant();
end $$;

-- ------------------------------------------------------------------ roles are per hospital
create or replace function public.has_role(variadic roles public.app_role[])
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant(); m text;
begin
  if t is null then return false; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and tenant_id = t and role = any (roles)) then return true; end if;
  m := public.provider_mode();
  if m is null then return false; end if;
  return (case m when 'finance' then 'accountant' else 'owner' end)::public.app_role = any (roles);
end $$;

create or replace function public.is_staff()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_tenant();
begin
  if t is null then return false; end if;
  return exists (select 1 from public.profiles where id = auth.uid() and tenant_id = t and role <> 'patient')
      or public.provider_mode() is not null;
end $$;

create or replace function public.current_app_role()
returns public.app_role language plpgsql stable security definer set search_path = public as $$
declare m text := public.provider_mode(); r public.app_role;
begin
  if m is not null then return (case m when 'finance' then 'accountant' else 'owner' end)::public.app_role; end if;
  select role into r from public.profiles where id = auth.uid() and tenant_id = public.current_tenant();
  return r;
end $$;

-- ------------------------------------------------------------------ tenant_id on every hospital table
do $tenancy$
declare
  t text;
  tables text[] := array[
    'profiles', 'departments', 'doctors', 'staff', 'patients', 'appointments', 'prescriptions', 'lab_tests', 'wards', 'beds',
    'admissions', 'invoices', 'payments', 'expenses', 'inventory', 'notices', 'notification_templates', 'site_enquiries',
    'site_forms', 'doctor_leaves', 'holidays', 'audit_log', 'visit_feedback', 'staff_invites', 'wa_sessions', 'booking_otps',
    'password_reset_otps', 'site_content', 'site_content_revisions', 'app_settings', 'app_secrets', 'notification_outbox',
    'push_tokens'];
begin
  foreach t in array tables loop
    continue when to_regclass('public.' || t) is null;
    -- constant default first: existing rows join the primary hospital without a table rewrite or firing triggers
    execute format('alter table public.%I add column if not exists tenant_id uuid default %L references public.tenants (id) on delete cascade',
                   t, 'a0000000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column tenant_id set default public.current_tenant()', t);
    if t <> 'profiles' then   -- provider accounts have a profile without a hospital
      execute format('alter table public.%I alter column tenant_id set not null', t);
    end if;
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    if t = 'profiles' then
      execute 'create policy tenant_isolation on public.profiles as restrictive for all to anon, authenticated
                 using (tenant_id = (select public.current_tenant()) or id = auth.uid())
                 with check (tenant_id = (select public.current_tenant()) or id = auth.uid())';
    else
      execute format('create policy tenant_isolation on public.%I as restrictive for all to anon, authenticated
                        using (tenant_id = (select public.current_tenant()))
                        with check (tenant_id = (select public.current_tenant()))', t);
    end if;
  end loop;
end $tenancy$;

-- (sql functions are checked when created, so these come after the tenant_id columns exist)
create or replace function public.my_doctor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.doctors where profile_id = auth.uid() and tenant_id = public.current_tenant() limit 1
$$;

create or replace function public.my_patient_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.patients where profile_id = auth.uid() and tenant_id = public.current_tenant() limit 1
$$;

-- a hospital's own record can't be moved to another hospital by an update
create or replace function public.keep_tenant()
returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id and current_setting('app.tenant_move', true) is distinct from 'on' then
    raise exception 'Records cannot be moved to another hospital' using errcode = '42501';
  end if;
  return new;
end $$;
do $keep$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
            join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('tenant_domains', 'provider_assignments')
  loop
    execute format('drop trigger if exists trg_keep_tenant on public.%I', t);
    execute format('create trigger trg_keep_tenant before update of tenant_id on public.%I for each row execute function public.keep_tenant()', t);
  end loop;
end $keep$;

-- ------------------------------------------------------------------ uniqueness is per hospital
do $uniq$
declare r record; cols text[];
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, c.contype,
           array_agg(a.attname::text order by k.ord) as cols
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype in ('u', 'p') and c.connamespace = 'public'::regnamespace
       and c.conrelid::regclass::text in ('departments', 'wards', 'beds', 'patients', 'invoices', 'inventory', 'site_forms', 'holidays',
                                          'app_settings', 'site_content', 'app_secrets', 'wa_sessions')
     group by 1, 2, 3
  loop
    continue when 'tenant_id' = any (r.cols) or 'id' = any (r.cols)
               or not (r.cols && array['name', 'bed_number', 'mrn', 'invoice_number', 'sku', 'slug', 'holiday_date', 'key', 'phone']);   -- profile_id etc. stay globally unique
    cols := array_prepend('tenant_id', r.cols);
    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
    if r.contype = 'p' then
      execute format('alter table public.%I add primary key (%s)', r.tbl, (select string_agg(quote_ident(x), ', ') from unnest(cols) x));
    else
      execute format('alter table public.%I add constraint %I unique (%s)', r.tbl, r.conname, (select string_agg(quote_ident(x), ', ') from unnest(cols) x));
    end if;
  end loop;
end $uniq$;

drop index if exists public.staff_invites_one_pending;
create unique index if not exists staff_invites_one_pending_t on public.staff_invites (tenant_id, lower(email)) where status = 'pending';

-- MRN / invoice numbers count per hospital, with the hospital's own prefix
create or replace function public.assign_record_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if tg_table_name = 'patients' then
    perform pg_advisory_xact_lock(hashtext('dch_patient_mrn:' || new.tenant_id));
    if coalesce(new.mrn, '') = '' or exists (select 1 from public.patients where tenant_id = new.tenant_id and mrn = new.mrn) then
      select coalesce(code, 'HSP') into v_code from public.tenants where id = new.tenant_id;
      select v_code || '-' || (coalesce(max(nullif(regexp_replace(mrn, '\D', '', 'g'), '')::bigint), 100000) + 1) into new.mrn
        from public.patients where tenant_id = new.tenant_id;
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('dch_invoice_number:' || new.tenant_id));
    if coalesce(new.invoice_number, '') = '' or exists (select 1 from public.invoices where tenant_id = new.tenant_id and invoice_number = new.invoice_number) then
      select 'INV-' || lpad((coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 10000) + 1)::text, 5, '0')
        into new.invoice_number from public.invoices where tenant_id = new.tenant_id;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ new accounts join the hospital they signed up at
-- Sign-ups arrive from Supabase Auth (no request headers), so the website passes its hospital in the sign-up metadata.
-- The choice is pinned for the rest of the transaction, so the patient record made by handle_new_user lands there too.
create or replace function public.profiles_pick_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_meta text; v uuid;
begin
  if new.tenant_id is null or new.tenant_id = public.primary_tenant() then
    select raw_user_meta_data ->> 'tenant_id' into v_meta from auth.users where id = new.id;
    if v_meta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select id into v from public.tenants where id = v_meta::uuid and status <> 'suspended';
    end if;
    new.tenant_id := coalesce(v, new.tenant_id, public.current_tenant(), public.primary_tenant());
  end if;
  perform set_config('app.tenant_id', new.tenant_id::text, true);
  return new;
end $$;
drop trigger if exists trg_profiles_pick_tenant on public.profiles;
create trigger trg_profiles_pick_tenant before insert on public.profiles for each row execute function public.profiles_pick_tenant();

-- ------------------------------------------------------------------ provider: support may read, not change, patient records
do $clinical$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'prescriptions', 'lab_tests', 'admissions', 'visit_feedback'] loop
    execute format('drop policy if exists provider_support_read_only on public.%I', t);
    execute format('create policy provider_support_read_only on public.%I as restrictive for insert to authenticated
                      with check (public.provider_mode() is distinct from %L)', t, 'support');
    execute format('drop policy if exists provider_support_no_update on public.%I', t);
    execute format('create policy provider_support_no_update on public.%I as restrictive for update to authenticated
                      using (public.provider_mode() is distinct from %L)', t, 'support');
    execute format('drop policy if exists provider_support_no_delete on public.%I', t);
    execute format('create policy provider_support_no_delete on public.%I as restrictive for delete to authenticated
                      using (public.provider_mode() is distinct from %L)', t, 'support');
  end loop;
end $clinical$;

-- ------------------------------------------------------------------ RLS on the tenancy tables
alter table public.tenants enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.provider_users enable row level security;
alter table public.provider_assignments enable row level security;
alter table public.provider_audit enable row level security;
revoke all on public.tenants, public.tenant_domains, public.provider_users, public.provider_assignments, public.provider_audit from anon, authenticated;
grant select on public.tenants to anon, authenticated;
grant select, insert, update, delete on public.tenant_domains, public.provider_users, public.provider_assignments to authenticated;
grant update, insert, delete on public.tenants to authenticated;
grant select on public.provider_audit to authenticated;
grant all on public.tenants, public.tenant_domains, public.provider_users, public.provider_assignments, public.provider_audit to service_role;

drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_admin on public.tenants;
create policy tenants_select on public.tenants for select to anon, authenticated
  using (id = (select public.current_tenant()) or public.provider_can(id));
create policy tenants_admin on public.tenants for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin');

drop policy if exists tenant_domains_select on public.tenant_domains;
drop policy if exists tenant_domains_admin on public.tenant_domains;
create policy tenant_domains_select on public.tenant_domains for select to authenticated
  using (public.provider_can(tenant_id) or (tenant_id = (select public.current_tenant()) and public.has_role('owner')));
create policy tenant_domains_admin on public.tenant_domains for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin');

drop policy if exists provider_users_select on public.provider_users;
drop policy if exists provider_users_admin on public.provider_users;
create policy provider_users_select on public.provider_users for select to authenticated
  using (user_id = auth.uid() or public.provider_mode() = 'admin');
create policy provider_users_admin on public.provider_users for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin' and user_id <> auth.uid());

drop policy if exists provider_assignments_select on public.provider_assignments;
drop policy if exists provider_assignments_admin on public.provider_assignments;
create policy provider_assignments_select on public.provider_assignments for select to authenticated
  using (user_id = auth.uid() or public.provider_mode() = 'admin');
create policy provider_assignments_admin on public.provider_assignments for all to authenticated
  using (public.provider_mode() = 'admin') with check (public.provider_mode() = 'admin');

drop policy if exists provider_audit_select on public.provider_audit;
create policy provider_audit_select on public.provider_audit for select to authenticated
  using (public.provider_mode() = 'admin' or (user_id = auth.uid()));

-- ------------------------------------------------------------------ RPCs
-- the website asks "which hospital is this domain?" before anything else (multi-tenant mode)
create or replace function public.resolve_tenant(p_host text)
returns table (id uuid, slug text, name text, status text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, t.status
    from public.tenant_domains d join public.tenants t on t.id = d.tenant_id
   where d.domain = lower(split_part(trim(coalesce(p_host, '')), ':', 1))
$$;

-- who am I here: hospital, my role in it, provider role / mode and which modules the hospital may edit itself
create or replace function public.my_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.tenants; v_tid uuid := public.current_tenant();
begin
  select * into t from public.tenants where id = v_tid;
  return jsonb_build_object(
    'tenant', case when t.id is null then null else jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan', t.plan, 'modules', t.modules, 'is_primary', t.is_primary) end,
    'role', public.current_app_role(),
    'provider_role', public.provider_role(),
    'provider_mode', public.provider_mode());
end $$;

-- hospitals a provider may open (switcher)
create or replace function public.provider_tenants()
returns table (id uuid, slug text, name text, status text, plan text, domain text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, t.status, t.plan,
         (select d.domain from public.tenant_domains d where d.tenant_id = t.id order by d.is_primary desc, d.created_at limit 1)
    from public.tenants t
   where public.provider_can(t.id)
   order by t.is_primary desc, t.name
$$;

-- providers write to the audit log for anything sensitive they open (e.g. a patient chart)
create or replace function public.provider_log(p_action text, p_target text default null, p_detail jsonb default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public.provider_role() is null then return; end if;
  insert into public.provider_audit (user_id, user_name, mode, tenant_id, action, target, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), public.provider_mode(), public.current_tenant(),
          left(p_action, 80), left(p_target, 200), p_detail);
end $$;

revoke all on function public.request_header(text), public.primary_tenant(), public.keep_tenant(), public.profiles_pick_tenant() from public, anon, authenticated;
grant execute on function public.current_tenant(), public.provider_role(), public.provider_can(uuid), public.provider_mode(),
  public.has_role(public.app_role[]), public.is_staff(), public.current_app_role(), public.my_doctor_id(), public.my_patient_id()
  to anon, authenticated, service_role;
grant execute on function public.resolve_tenant(text) to anon, authenticated;
grant execute on function public.my_context(), public.provider_tenants(), public.provider_log(text, text, jsonb) to authenticated;
revoke all on function public.my_context(), public.provider_tenants(), public.provider_log(text, text, jsonb) from public, anon;
-- <<< tenancy

commit;

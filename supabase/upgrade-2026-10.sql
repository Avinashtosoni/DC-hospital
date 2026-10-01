-- ============================================================================================================
-- DC Hospital — in-place upgrade for databases created with an older master.sql / production.sql (October 2026).
-- Safe to run more than once. Keeps all data. Run it in the Supabase SQL editor.
--   • enquiry inbox columns (starred, read_at) + insert policy + Contact-form flood limits
--   • records are never cascade-deleted: patients / doctors / invoices with history can't be deleted
--   • MRN and invoice numbers assigned under a lock (no duplicates when two desks save together)
--   • default dates use the Indian calendar day (Supabase runs on UTC)
--   • site-wide OTP cap against SMS pumping; go-live cleanup keeps real records that point at demo ones
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

commit;

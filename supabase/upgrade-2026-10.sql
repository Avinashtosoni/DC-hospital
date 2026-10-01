-- ============================================================================================================
-- DC Hospital — in-place upgrade for databases created with an older master.sql / production.sql (October 2026).
-- Safe to run more than once. Keeps all data. Run it in the Supabase SQL editor.
--   • enquiry inbox columns (starred, read_at) + insert policy + Contact-form flood limits
--   • records are never cascade-deleted: patients / doctors / invoices with history can't be deleted
--   • MRN and invoice numbers assigned under a lock (no duplicates when two desks save together)
--   • default dates use the Indian calendar day (Supabase runs on UTC)
--   • site-wide OTP cap against SMS pumping; go-live cleanup keeps real records that point at demo ones
--   • server-side pagination: search / sort indexes and payment → invoice total sync (section 15)
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

commit;

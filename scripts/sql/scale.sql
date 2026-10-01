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

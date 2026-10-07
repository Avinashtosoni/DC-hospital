-- =====================================================================================================
--  DATA INTEGRITY (production audit, October 2026)
--  The database — not the browser — guarantees the money and bed rules, so a stale tab, a second receptionist
--  or a hand-made API call cannot leave the books or the ward wrong. Idempotent: safe in master / production /
--  upgrade. Checked by tests/sql/integrity.test.ts.
--
--   1. same hospital   every reference (patient_id, bed_id, invoice_id …) points at a row of the SAME hospital
--   2. invoices        subtotal / total are recomputed from the line items; amount paid always = sum of payments;
--                      paid / partial / overdue derived; no cancelling a bill that has payments
--   3. payments        never more than the balance due; never on a draft / cancelled bill (row-locked, so two
--                      counters recording at once cannot overpay)
--   4. admissions      one admitted patient per bed, one live admission per patient, only into a free bed;
--                      discharge date stamped
--   5. beds            an occupied bed cannot be freed / deleted while its patient is admitted
--   6. lab tests       completion date stamped
-- =====================================================================================================

-- ------------------------------------------------------------------ 1. references stay inside one hospital
-- RLS checks a row's own tenant_id; this checks the rows it points at. Without it a user of hospital A who knew an id
-- of hospital B could attach B's bed / invoice / doctor to A's rows (and definer triggers would then update B's rows).
create or replace function public.enforce_same_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  i int := 0;
  v_col text; v_parent text; v_ref text; v_parent_tenant uuid;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  while i < tg_nargs loop
    v_col := tg_argv[i]; v_parent := tg_argv[i + 1]; i := i + 2;
    v_ref := n ->> v_col;
    continue when v_ref is null;
    continue when tg_op = 'UPDATE' and v_ref is not distinct from (o ->> v_col) and (n ->> 'tenant_id') is not distinct from (o ->> 'tenant_id');
    execute format('select tenant_id from public.%I where id = $1', v_parent) into v_parent_tenant using v_ref::uuid;
    -- a parent without a hospital (a platform team member's profile) may be referenced from anywhere
    if v_parent_tenant is not null and v_parent_tenant is distinct from (n ->> 'tenant_id')::uuid then
      raise exception 'The selected % belongs to another hospital.', replace(regexp_replace(v_col, '_id$', ''), '_', ' ')
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.enforce_same_tenant() from public, anon, authenticated;

-- one trigger per table, built from the foreign keys themselves (single-column FKs to `id` of a table that also has
-- tenant_id) — new tables are covered the next time this file runs
do $same$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as child,
           string_agg(format('%L, %L', a.attname, p.relname), ', ' order by a.attname) as args
      from pg_constraint c
      join pg_class ch on ch.oid = c.conrelid
      join pg_namespace ns on ns.oid = ch.relnamespace and ns.nspname = 'public'
      join pg_class p on p.oid = c.confrelid
      join pg_namespace pns on pns.oid = p.relnamespace and pns.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1] and pa.attname = 'id'
     where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.conrelid <> c.confrelid
       and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'tenant_id' and not x.attisdropped)
       and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'tenant_id' and not x.attisdropped)
       and a.attname <> 'tenant_id'
     group by c.conrelid
  loop
    execute format('drop trigger if exists trg_zz_same_tenant on %s', r.child);
    -- "zz": runs after the other BEFORE triggers, so tenant_id / stamped columns are final
    execute format('create trigger trg_zz_same_tenant before insert or update on %s for each row execute function public.enforce_same_tenant(%s)', r.child, r.args);
  end loop;
end $same$;

-- ------------------------------------------------------------------ 2. invoices: totals from the line items
create or replace function public.invoices_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it jsonb; q numeric; p numeric;
  v_sub numeric := 0;
  v_paid numeric := 0;
begin
  if jsonb_typeof(coalesce(new.items, '[]'::jsonb)) <> 'array' then
    raise exception 'Invoice items must be a list.' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    begin
      q := coalesce(nullif(it ->> 'quantity', '')::numeric, 0);
      p := coalesce(nullif(it ->> 'unit_price', '')::numeric, 0);
    exception when others then
      raise exception 'Every line item needs a number for quantity and price.' using errcode = '22023';
    end;
    if q <= 0 then raise exception 'Every line item needs a quantity above 0.' using errcode = '23514'; end if;
    if p < 0 then raise exception 'Line item prices cannot be negative.' using errcode = '23514'; end if;
    v_sub := v_sub + q * p;
  end loop;

  new.subtotal := round(v_sub, 2);
  new.discount := round(coalesce(new.discount, 0), 2);
  new.tax := round(coalesce(new.tax, 0), 2);
  if new.discount < 0 or new.tax < 0 then raise exception 'Discount and tax cannot be negative.' using errcode = '23514'; end if;
  if new.discount > new.subtotal + new.tax then raise exception 'The discount is larger than the bill.' using errcode = '23514'; end if;
  new.total := new.subtotal - new.discount + new.tax;

  -- amount paid is never typed in: it is the sum of the payments
  if tg_op = 'UPDATE' then select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = new.id; end if;
  new.amount_paid := v_paid;
  if v_paid > 0 and new.status in ('draft', 'cancelled') then
    raise exception 'This invoice already has payments (₹%). Delete those payments before making it %.', v_paid, new.status
      using errcode = '23514';
  end if;
  if v_paid > new.total + 0.005 then
    raise exception 'The total (₹%) cannot be less than what has already been paid (₹%).', new.total, v_paid using errcode = '23514';
  end if;
  new.status := case
    when new.status in ('draft', 'cancelled') then new.status
    when new.total > 0 and v_paid >= new.total then 'paid'
    when v_paid > 0 then 'partial'
    when new.due_date is not null and new.due_date < public.today_ist() then 'overdue'
    else 'unpaid' end;
  return new;
end $$;
revoke execute on function public.invoices_integrity() from public, anon, authenticated;
drop trigger if exists trg_invoices_integrity on public.invoices;
create trigger trg_invoices_integrity before insert or update on public.invoices
  for each row execute function public.invoices_integrity();

-- ------------------------------------------------------------------ 3. payments: never more than the balance
create or replace function public.payments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv record; v_other numeric;
begin
  -- the row lock serialises two payments on the same bill (two counters, a double click)
  select id, invoice_number, total, status, tenant_id into inv from public.invoices where id = new.invoice_id for update;
  if not found then raise exception 'Invoice not found' using errcode = '23503'; end if;
  if inv.status in ('draft', 'cancelled') then
    raise exception 'Invoice % is %. Payments can only be recorded on issued invoices.', inv.invoice_number, inv.status using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into v_other from public.payments where invoice_id = new.invoice_id and id is distinct from new.id;
  if v_other + new.amount > inv.total + 0.005 then
    raise exception 'This payment (₹%) is more than the balance due on % (₹%).', new.amount, inv.invoice_number, greatest(inv.total - v_other, 0)
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.payments_guard() from public, anon, authenticated;
drop trigger if exists trg_payments_guard on public.payments;
create trigger trg_payments_guard before insert or update of amount, invoice_id on public.payments
  for each row execute function public.payments_guard();

-- ------------------------------------------------------------------ 4. admissions: one patient per bed
create or replace function public.admissions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if new.status = 'discharged' and new.discharge_date is null then new.discharge_date := greatest(public.today_ist(), new.admission_date); end if;
  if new.status = 'admitted' then new.discharge_date := null; end if;
  if new.status = 'admitted' and new.bed_id is not null
     and (tg_op = 'INSERT' or old.status <> 'admitted' or old.bed_id is distinct from new.bed_id) then
    select bed_number, status into b from public.beds where id = new.bed_id for update;
    if found and b.status not in ('available', 'reserved') then
      raise exception 'Bed % is %. Choose an available bed.', b.bed_number,
        case b.status when 'occupied' then 'already occupied' else 'under maintenance' end using errcode = '23514';
    end if;
  end if;
  if new.status = 'admitted' and exists (select 1 from public.admissions a where a.patient_id = new.patient_id and a.status = 'admitted' and a.id <> new.id) then
    raise exception 'This patient is already admitted. Discharge or transfer the current admission instead.' using errcode = '23505';
  end if;
  return new;
end $$;
revoke execute on function public.admissions_guard() from public, anon, authenticated;
drop trigger if exists trg_admissions_guard on public.admissions;
create trigger trg_admissions_guard before insert or update on public.admissions
  for each row execute function public.admissions_guard();

-- bed + patient status follow the admissions (replaces the 5d version: a patient with another live admission keeps
-- "inpatient", and deleting an admission without a bed resets the patient too)
create or replace function public.sync_admission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_patient uuid := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;
begin
  if tg_op = 'DELETE' then
    if old.status = 'admitted' and old.bed_id is not null then
      update public.beds set status = 'available' where id = old.bed_id and status = 'occupied';
    end if;
  else
    if tg_op = 'UPDATE' and old.bed_id is distinct from new.bed_id and old.bed_id is not null then
      update public.beds set status = 'available' where id = old.bed_id and status = 'occupied';
    end if;
    if new.bed_id is not null then
      update public.beds set status = case when new.status = 'admitted' then 'occupied' else 'available' end
       where id = new.bed_id and status is distinct from (case when new.status = 'admitted' then 'occupied' else 'available' end);
    end if;
  end if;
  update public.patients set status = case
      when exists (select 1 from public.admissions a where a.patient_id = v_patient and a.status = 'admitted') then 'inpatient'
      when tg_op = 'DELETE' then 'outpatient'
      else 'discharged' end
   where id = v_patient;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- the uniqueness itself (also catches two inserts racing past the trigger). An existing database with duplicates
-- keeps working — the warning tells the hospital what to fix — and the index arrives on the next run.
do $idx$
begin
  if exists (select 1 from public.admissions where status = 'admitted' and bed_id is not null group by bed_id having count(*) > 1) then
    raise warning 'Some beds have two admitted patients — discharge or move one, then run this file again (index admissions_one_per_bed).';
  else
    create unique index if not exists admissions_one_per_bed on public.admissions (bed_id) where status = 'admitted' and bed_id is not null;
  end if;
  if exists (select 1 from public.admissions where status = 'admitted' group by patient_id having count(*) > 1) then
    raise warning 'Some patients have two live admissions — discharge one, then run this file again (index admissions_one_per_patient).';
  else
    create unique index if not exists admissions_one_per_patient on public.admissions (patient_id) where status = 'admitted';
  end if;
end $idx$;

-- ------------------------------------------------------------------ 5. beds follow their patient
create or replace function public.beds_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
        v_busy boolean;
begin
  select exists (select 1 from public.admissions where bed_id = v_id and status = 'admitted') into v_busy;
  if tg_op = 'DELETE' then
    -- restrict_violation: a hospital purge retries children-first (admissions go, then the beds)
    if v_busy then raise exception 'Bed % has an admitted patient. Discharge or transfer them first.', old.bed_number using errcode = '23001'; end if;
    return old;
  end if;
  if new.status is distinct from old.status then
    if new.status <> 'occupied' and v_busy then
      raise exception 'Bed % has an admitted patient. Discharge or transfer them first.', new.bed_number using errcode = '23514';
    end if;
    if new.status = 'occupied' and not v_busy then
      raise exception 'A bed becomes occupied when a patient is admitted to it (Admissions).' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.beds_guard() from public, anon, authenticated;
drop trigger if exists trg_beds_guard on public.beds;
create trigger trg_beds_guard before update of status or delete on public.beds
  for each row execute function public.beds_guard();

-- ------------------------------------------------------------------ 6. lab tests: completion date
create or replace function public.lab_tests_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and new.completed_on is null then new.completed_on := public.today_ist(); end if;
  if new.status <> 'completed' then new.completed_on := null; end if;
  return new;
end $$;
revoke execute on function public.lab_tests_stamp() from public, anon, authenticated;
drop trigger if exists trg_lab_tests_stamp on public.lab_tests;
create trigger trg_lab_tests_stamp before insert or update of status, completed_on on public.lab_tests
  for each row execute function public.lab_tests_stamp();

-- ------------------------------------------------------------------ 7. a hospital always keeps an owner
-- admin_update_user() / admin_delete_user() already say no; this also covers a direct API call (PATCH / DELETE
-- on profiles). The platform team (closing / purging a hospital) and the SQL editor are not limited.
create or replace function public.profiles_keep_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.provider_role() is not null then return coalesce(new, old); end if;
  if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner') then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.id = auth.uid() then
    raise exception 'You can''t remove your own owner access. Ask another owner to do it.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.role = 'owner' and p.id <> old.id and p.tenant_id is not distinct from old.tenant_id) then
    raise exception 'This is the last owner of the hospital. Make someone else an owner first.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_profiles_keep_owner on public.profiles;
create trigger trg_profiles_keep_owner before update of role or delete on public.profiles
  for each row execute function public.profiles_keep_owner();
revoke all on function public.profiles_keep_owner() from public, anon, authenticated;

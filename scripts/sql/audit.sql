-- =====================================================================================================
--  7d. AUDIT TRAIL — who changed what, and when
--
--  Every insert / update / delete on the clinical + financial tables writes one row to public.audit_log
--  with the acting user (auth.uid() → profiles), a short summary of the record and a column-level diff
--  ({"column": {"from": old, "to": new}}). The trigger runs as SECURITY DEFINER, so users cannot write,
--  edit or delete audit rows themselves: RLS allows the owner to read everything and every other staff
--  member to read only their own actions (see ROW_RULES in src/auth/permissions.ts).
--
--  Created AFTER the demo data is loaded, so the seed itself is not logged
--  (a short demo history is seeded directly instead).
--  Server-side callers without a user (e.g. the public booking API) can label themselves with
--    perform set_config('app.actor_name', 'Website booking', true);
--    perform set_config('app.actor_role', 'public', true);
-- =====================================================================================================

create or replace function public.audit_summary(p_table text, r jsonb)
returns text language sql immutable set search_path = public as $$
  select left(case p_table
    when 'patients'      then concat_ws(' ', r ->> 'full_name', '(' || (r ->> 'mrn') || ')')
    when 'invoices'      then r ->> 'invoice_number'
    when 'appointments'  then concat_ws(' · ', r ->> 'appointment_date', r ->> 'appointment_time')
    when 'payments'      then '₹' || (r ->> 'amount') || ' · ' || upper(coalesce(r ->> 'method', ''))
    when 'prescriptions' then r ->> 'diagnosis'
    when 'lab_tests'     then r ->> 'test_name'
    when 'doctor_leaves' then concat_ws(' ', r ->> 'kind', r ->> 'start_date',
                                case when r ->> 'end_date' <> r ->> 'start_date' then '→ ' || (r ->> 'end_date') end)
    when 'holidays'      then concat_ws(' · ', r ->> 'name', r ->> 'holiday_date')
    when 'expenses'      then r ->> 'description'
    else coalesce(r ->> 'full_name', r ->> 'name', r ->> 'title')
  end, 160)
$$;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_actor   uuid  := auth.uid();
  v_name    text;
  v_role    text;
  k         text;
begin
  -- erasing a patient / purging a hospital (phase 7) must not copy the personal data it removes into the log
  if current_setting('app.skip_audit', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      -- read_at / starred are personal inbox state (enquiries), not worth an audit entry
      continue when k in ('id', 'created_at', 'updated_at', 'read_at', 'starred');
      if (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;   -- nothing meaningful changed
  else
    for k in select jsonb_object_keys(v_row) loop
      continue when k in ('id', 'created_at', 'updated_at') or jsonb_typeof(v_row -> k) = 'null';
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object(case when tg_op = 'INSERT' then 'to' else 'from' end, v_row -> k));
    end loop;
  end if;

  if v_actor is not null then
    select p.full_name, p.role::text into v_name, v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.audit_log (table_name, record_id, action, actor_id, actor_name, actor_role, summary, changes)
  values (
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    v_actor,
    coalesce(v_name, nullif(current_setting('app.actor_name', true), ''), case when v_actor is null then 'System' else 'Unknown user' end),
    coalesce(v_role, nullif(current_setting('app.actor_role', true), ''), 'system'),
    public.audit_summary(tg_table_name, v_row),
    v_changes
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['staff_invites', 'patients', 'appointments', 'prescriptions', 'lab_tests', 'admissions', 'invoices', 'payments',
                           'doctors', 'doctor_leaves', 'holidays', 'profiles', 'staff', 'expenses'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- the log is append-only for everyone (only the definer trigger writes to it)
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

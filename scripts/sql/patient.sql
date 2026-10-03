-- =====================================================================================================
--  13. PATIENT SELF-SERVICE · FEEDBACK · STAFF INVITES · GO-LIVE HELPERS · WHATSAPP BOT STATE
-- =====================================================================================================

-- ------------------------------------------------------------------ helpers
create or replace function public.site_url()
returns text language sql stable security definer set search_path = public as $$
  select rtrim(coalesce((public.tenant_content('settings') ->> 'siteUrl'), ''), '/')
$$;

-- ------------------------------------------------------------------ patients book / reschedule / cancel their own visits
-- The patient portal writes to `appointments` directly (RLS: own rows). This trigger makes sure a patient
-- can only book a genuinely free slot for themselves, move a future visit to another free slot of the
-- same doctor, or cancel it — never change the doctor, status (other than cancel), notes or reference.
create or replace function public.guard_patient_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_problem text;
  v_now     timestamp := now() at time zone 'Asia/Kolkata';
  v_cutoff  int := coalesce(nullif(public.booking_setting('rescheduleCutoffHours', '4'), '')::int, 4);
begin
  if auth.uid() is null or not public.has_role('patient') then return new; end if;

  if tg_op = 'INSERT' then
    if new.patient_id is distinct from public.my_patient_id() then raise exception 'You can only book appointments for yourself.'; end if;
    new.status := 'scheduled';
    new.source := 'portal';
    new.notes := null;
    new.contacted_at := null;
    v_problem := public.slot_problem(new.doctor_id, new.appointment_date, new.appointment_time, true);
    if v_problem is not null then raise exception 'SLOT_UNAVAILABLE: %', v_problem; end if;
    return new;
  end if;

  -- UPDATE
  if old.status not in ('scheduled', 'confirmed') or old.appointment_date + old.appointment_time::time < v_now then
    raise exception 'This appointment can no longer be changed online. Please call the hospital.';
  end if;
  new.patient_id := old.patient_id;
  new.doctor_id := old.doctor_id;
  new.type := old.type;
  new.notes := old.notes;
  new.source := old.source;
  new.booking_ref := old.booking_ref;
  new.contacted_at := old.contacted_at;

  if new.status is distinct from old.status and new.status <> 'cancelled'
     and not (new.status = 'scheduled' and (new.appointment_date, new.appointment_time) is distinct from (old.appointment_date, old.appointment_time)) then
    raise exception 'You can only cancel an appointment.';
  end if;
  if new.status = 'cancelled' then
    new.appointment_date := old.appointment_date;
    new.appointment_time := old.appointment_time;
    return new;
  end if;

  if (new.appointment_date, new.appointment_time) is distinct from (old.appointment_date, old.appointment_time) then
    if old.appointment_date + old.appointment_time::time < v_now + make_interval(hours => v_cutoff) then
      raise exception 'Appointments can be rescheduled online up to % hours before the visit. Please call the hospital.', v_cutoff;
    end if;
    v_problem := public.slot_problem(new.doctor_id, new.appointment_date, new.appointment_time, true);
    if v_problem is not null then raise exception 'SLOT_UNAVAILABLE: %', v_problem; end if;
    new.status := 'scheduled';   -- a moved visit needs to be confirmed again
  end if;
  return new;
end $$;
drop trigger if exists trg_appointments_patient_guard on public.appointments;
create trigger trg_appointments_patient_guard before insert or update on public.appointments
  for each row execute function public.guard_patient_appointment();

-- ------------------------------------------------------------------ visit feedback
create or replace function public.guard_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = new.appointment_id;
  if not found then raise exception 'Appointment not found.'; end if;
  if a.status <> 'completed' then raise exception 'You can rate a visit once it is completed.'; end if;
  if auth.uid() is not null and public.has_role('patient') then
    if a.patient_id is distinct from public.my_patient_id() then raise exception 'You can only rate your own visits.'; end if;
    new.source := 'portal';
  end if;
  new.patient_id := a.patient_id;
  new.doctor_id := a.doctor_id;
  new.comment := nullif(left(trim(coalesce(new.comment, '')), 1000), '');
  new.tags := coalesce(new.tags, '{}');
  return new;
end $$;
drop trigger if exists trg_visit_feedback_guard on public.visit_feedback;
create trigger trg_visit_feedback_guard before insert on public.visit_feedback
  for each row execute function public.guard_feedback();

-- Public feedback link (/feedback/<appointment id>) sent after the visit. The appointment id is a random
-- UUID, so it works like a one-time token; nothing personal beyond the first name is returned.
drop function if exists public.feedback_context(uuid) cascade;
create function public.feedback_context(p_appt uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a public.appointments;
  p public.patients;
  d public.doctors;
begin
  select * into a from public.appointments where id = p_appt and tenant_id = public.current_tenant();
  if not found or a.status <> 'completed' or a.appointment_date < current_date - 60 then
    return jsonb_build_object('ok', false, 'error', 'This feedback link has expired.');
  end if;
  select * into p from public.patients where id = a.patient_id;
  select * into d from public.doctors where id = a.doctor_id;
  return jsonb_build_object('ok', true,
    'first_name', split_part(p.full_name, ' ', 1),
    'doctor', d.full_name, 'specialization', d.specialization,
    'date', a.appointment_date,
    'submitted', exists (select 1 from public.visit_feedback f where f.appointment_id = a.id));
end $$;

drop function if exists public.submit_feedback(uuid, int, text, text[], boolean) cascade;
create function public.submit_feedback(p_appt uuid, p_rating int, p_comment text, p_tags text[] default '{}', p_recommend boolean default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.appointments;
begin
  perform set_config('app.actor_name', 'Patient feedback', true);
  select * into a from public.appointments where id = p_appt and tenant_id = public.current_tenant();
  if not found or a.status <> 'completed' or a.appointment_date < current_date - 60 then
    raise exception 'This feedback link has expired.';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Please choose a rating from 1 to 5 stars.'; end if;
  begin
    insert into public.visit_feedback (appointment_id, patient_id, rating, comment, tags, would_recommend, source)
    values (p_appt, a.patient_id, p_rating, p_comment,
            (select coalesce(array_agg(t), '{}') from unnest(coalesce(p_tags, '{}')) t where t ~ '^[a-z_]{2,30}$'),
            p_recommend, case when auth.uid() is null then 'link' else 'portal' end);
  exception when unique_violation then
    raise exception 'Thank you — feedback for this visit has already been received.';
  end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.feedback_context(uuid) from public;
revoke all on function public.submit_feedback(uuid, int, text, text[], boolean) from public;
grant execute on function public.feedback_context(uuid) to anon, authenticated;
grant execute on function public.submit_feedback(uuid, int, text, text[], boolean) to anon, authenticated;

-- ask for feedback when a visit is marked completed
create or replace function public.notify_feedback_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.patients; d public.doctors;
begin
  if new.status <> 'completed' or old.status = 'completed' or public.site_url() = '' then return new; end if;
  select * into p from public.patients where id = new.patient_id;
  select * into d from public.doctors where id = new.doctor_id;
  perform public.notify_enqueue('feedback_request', p.phone, p.email, jsonb_build_object(
    'name', split_part(p.full_name, ' ', 1), 'doctor', d.full_name,
    'link', public.site_url() || '/feedback/' || new.id), 'appointments', new.id);
  return new;
exception when others then
  raise warning 'notify_feedback_request: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_appointments_feedback on public.appointments;
create trigger trg_appointments_feedback after update on public.appointments
  for each row execute function public.notify_feedback_request();

-- ------------------------------------------------------------------ staff invitations
create or replace function public.stamp_staff_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  new.invited_by_name := coalesce(new.invited_by_name, (select full_name from public.profiles where id = auth.uid()));
  if exists (select 1 from auth.users u where lower(u.email) = new.email) then
    raise exception 'An account with this email already exists — change its role in Users & Roles instead.';
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_invites_stamp on public.staff_invites;
create trigger trg_staff_invites_stamp before insert on public.staff_invites
  for each row execute function public.stamp_staff_invite();

create or replace function public.notify_staff_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.site_url() = '' then return new; end if;   -- no website address yet: the owner shares the link manually
  perform public.notify_enqueue('staff_invite', new.phone, new.email, jsonb_build_object(
    'name', split_part(new.full_name, ' ', 1), 'role', initcap(new.role::text),
    'link', public.site_url() || '/register?invite=' || new.token), 'staff_invites', new.id);
  return new;
exception when others then
  raise warning 'notify_staff_invite: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_staff_invites_notify on public.staff_invites;
create trigger trg_staff_invites_notify after insert on public.staff_invites
  for each row execute function public.notify_staff_invite();

-- the sign-up page shows who the invite is for
drop function if exists public.invite_lookup(text) cascade;
create function public.invite_lookup(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'email', email, 'full_name', full_name, 'role', role, 'phone', phone)
     from public.staff_invites where token = p_token and status = 'pending' and expires_at > now() and tenant_id = public.current_tenant()),
    jsonb_build_object('ok', false, 'error', 'This invitation link is invalid or has expired. Ask the hospital to send a new one.'))
$$;
revoke all on function public.invite_lookup(text) from public;
grant execute on function public.invite_lookup(text) to anon, authenticated;

-- New auth users: an accepted staff invite gives the invited role; the hospital's bootstrap e-mail (app_settings
-- 'bootstrap' — set by production.sql for the first hospital, by supabase/snippets/add-hospital.sql for later ones)
-- becomes that hospital's first owner; everyone else is a patient.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  next_mrn int;
  v_name   text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1));
  v_phone  text := nullif(new.raw_user_meta_data ->> 'phone', '');
  v_inv    public.staff_invites;
  v_owner  text;
  v_meta   text := new.raw_user_meta_data ->> 'tenant_id';
  v_tenant uuid;
begin
  -- the hospital this sign-up belongs to (same rule as profiles_pick_tenant): an invite only counts there
  if v_meta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_tenant from public.tenants where id = v_meta::uuid and status <> 'suspended';
  end if;
  v_tenant := coalesce(v_tenant, public.current_tenant(), public.primary_tenant());
  select lower(data ->> 'owner_email') into v_owner from public.app_settings where tenant_id = v_tenant and key = 'bootstrap';

  select * into v_inv from public.staff_invites
  where token = new.raw_user_meta_data ->> 'invite_token' and email = lower(new.email) and tenant_id = v_tenant
    and status = 'pending' and expires_at > now()
  for update;

  if found then
    insert into public.profiles (id, full_name, email, role, phone)
    values (new.id, coalesce(nullif(v_name, ''), v_inv.full_name), new.email, v_inv.role, coalesce(v_phone, v_inv.phone))
    on conflict (id) do update set role = excluded.role;
    update public.staff_invites set status = 'accepted', accepted_at = now() where id = v_inv.id;
    -- link an existing doctor / staff record with the same e-mail
    if v_inv.role = 'doctor' then
      update public.doctors set profile_id = new.id where lower(email) = lower(new.email) and profile_id is null and tenant_id = v_tenant;
    else
      update public.staff set profile_id = new.id where lower(email) = lower(new.email) and profile_id is null and tenant_id = v_tenant;
    end if;
    return new;
  end if;

  if v_owner is not null and lower(new.email) = v_owner
     and not exists (select 1 from public.profiles where role = 'owner' and tenant_id = v_tenant) then
    insert into public.profiles (id, full_name, email, role, phone) values (new.id, v_name, new.email, 'owner', v_phone)
    on conflict (id) do update set role = 'owner';
    return new;
  end if;

  insert into public.profiles (id, full_name, email, role, phone)
  values (new.id, v_name, new.email, 'patient', v_phone)
  on conflict (id) do nothing;

  -- mrn '' → assign_record_number() gives the next number of this hospital (with its prefix)
  insert into public.patients (profile_id, mrn, full_name, email, phone, gender, status)
  values (new.id, '', v_name, new.email, v_phone, 'other', 'outpatient')
  on conflict (profile_id) do nothing;
  return new;
end $$;

-- ------------------------------------------------------------------ go-live helpers (owner only)
-- Demo seed rows use ids shaped d0cXXXXX-0000-4000-8000-XXXXXXXXXXXX, which random UUIDs never produce.
create or replace function public.is_demo_id(p uuid)
returns boolean language sql immutable as $$ select p::text ~ '^d0c[0-9]{5}-0000-4000-8000-[0-9]{12}$' $$;

drop function if exists public.demo_status() cascade;
create function public.demo_status()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare u auth.users;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can do this.'; end if;
  if public.current_tenant() is distinct from public.primary_tenant() then
    return jsonb_build_object('demo_accounts_active', 0, 'owner_is_demo_email', false, 'owner_has_demo_password', false, 'demo_rows', 0);
  end if;
  select * into u from auth.users where id = auth.uid();
  return jsonb_build_object(
    'demo_accounts_active', (select count(*) from auth.users a where public.is_demo_id(a.id) and a.id <> auth.uid()
                             and (a.banned_until is null or a.banned_until < now())),
    'owner_is_demo_email', lower(u.email) like '%@dchospital.com',
    'owner_has_demo_password', coalesce(u.encrypted_password = extensions.crypt('Demo@123', u.encrypted_password), false),
    'demo_rows', (select count(*) from public.patients where public.is_demo_id(id))
               + (select count(*) from public.appointments where public.is_demo_id(id))
               + (select count(*) from public.invoices where public.is_demo_id(id)));
end $$;

-- Locks the demo logins (random password + banned), except the account running this.
drop function if exists public.lock_demo_accounts() cascade;
create function public.lock_demo_accounts()
returns int language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_count int;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can do this.'; end if;
  if public.current_tenant() is distinct from public.primary_tenant() then return 0; end if;   -- demo logins live in the main hospital
  perform public.module_guard('data');
  update auth.users set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
                        banned_until = 'infinity'
  where public.is_demo_id(id) and id <> auth.uid();
  get diagnostics v_count = row_count;
  insert into public.audit_log (table_name, record_id, action, actor_id, actor_name, actor_role, summary, changes)
  values ('profiles', null, 'update', auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'owner',
          'Locked ' || v_count || ' demo accounts', '{}'::jsonb);
  return v_count;
end $$;

-- Deletes the demo patients / visits / bills / staff records. Real records (random ids) are untouched.
drop function if exists public.clear_demo_data() cascade;
create function public.clear_demo_data()
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_total int := 0; v_n int; t text; v_id uuid;
begin
  if not public.has_role('owner') then raise exception 'Only the hospital owner can do this.'; end if;
  if public.current_tenant() is distinct from public.primary_tenant() then return 0; end if;   -- demo rows live in the main hospital
  perform public.module_guard('data');
  perform set_config('app.actor_name', 'Go-live cleanup', true);
  foreach t in array array['visit_feedback', 'payments', 'invoices', 'admissions', 'lab_tests', 'prescriptions', 'appointments',
                           'doctor_leaves', 'site_enquiries', 'site_forms', 'notices', 'expenses', 'inventory', 'beds', 'wards', 'patients']
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
revoke all on function public.demo_status() from public, anon;
revoke all on function public.lock_demo_accounts() from public, anon;
revoke all on function public.clear_demo_data() from public, anon;
grant execute on function public.demo_status() to authenticated;
grant execute on function public.lock_demo_accounts() to authenticated;
grant execute on function public.clear_demo_data() to authenticated;

-- ------------------------------------------------------------------ WhatsApp chatbot state
alter table public.wa_sessions enable row level security;   -- no policies: Edge Function (service role) only
revoke all on public.wa_sessions from anon, authenticated;
grant all on public.wa_sessions to service_role;
grant select, insert, update on public.visit_feedback to service_role;
grant select on public.appointments, public.doctors, public.patients, public.departments to service_role;

-- tables created in this section need the standard grants too
grant select, insert, update, delete on public.visit_feedback, public.staff_invites to authenticated;

-- ------------------------------------------------------------------ WhatsApp chatbot helpers (service role only)
-- The sender's number is verified by WhatsApp itself, so the bot can book / list / cancel for that number.
create or replace function public.bot_free_slots(p_doctor uuid, p_limit int default 8)
returns table (slot_date date, slot_time text)
language sql stable security definer set search_path = public as $$
  with days as (
    select (now() at time zone 'Asia/Kolkata')::date + g as d
    from generate_series(0, least(coalesce(nullif(public.booking_setting('advanceDays', '30'), '')::int, 30), 60)) g
  ), times as (
    select to_char(time '08:00' + make_interval(mins => 30 * g), 'HH24:MI') as t from generate_series(0, 21) g
  )
  select days.d, times.t
  from days cross join times
  where public.slot_problem(p_doctor, days.d, times.t, true) is null
    and not exists (select 1 from public.appointments a
                    where a.tenant_id = public.current_tenant() and a.doctor_id = p_doctor and a.appointment_date = days.d and left(a.appointment_time, 5) = times.t
                      and a.status not in ('cancelled', 'no_show'))
  order by 1, 2
  limit greatest(1, least(p_limit, 20))
$$;

create or replace function public.bot_patient(p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'mrn', p.mrn)
  from public.patients p
  where p.tenant_id = public.current_tenant() and public.norm_phone(p.phone) = public.norm_phone(p_phone)
  order by p.created_at
  limit 1
$$;

create or replace function public.bot_upcoming(p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'ref', coalesce(a.booking_ref, upper(left(a.id::text, 8))), 'date', a.appointment_date,
           'time', left(a.appointment_time, 5), 'status', a.status, 'doctor', d.full_name) order by a.appointment_date, a.appointment_time), '[]'::jsonb)
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  join public.doctors d on d.id = a.doctor_id
  where a.tenant_id = public.current_tenant() and public.norm_phone(p.phone) = public.norm_phone(p_phone)
    and a.appointment_date >= (now() at time zone 'Asia/Kolkata')::date
    and a.status in ('scheduled', 'confirmed')
$$;

create or replace function public.whatsapp_cancel_appointment(p_phone text, p_appt uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  perform set_config('app.actor_name', 'WhatsApp bot', true);
  perform set_config('app.actor_role', 'public', true);
  update public.appointments a set status = 'cancelled'
  from public.patients p
  where a.id = p_appt and a.tenant_id = public.current_tenant() and p.id = a.patient_id and public.norm_phone(p.phone) = public.norm_phone(p_phone)
    and a.status in ('scheduled', 'confirmed') and a.appointment_date >= (now() at time zone 'Asia/Kolkata')::date
  returning a.id into v_id;
  if v_id is null then raise exception 'This appointment cannot be cancelled here. Please call the hospital.'; end if;
  return true;
end $$;

revoke all on function public.bot_free_slots(uuid, int) from public, anon, authenticated;
revoke all on function public.bot_patient(text) from public, anon, authenticated;
revoke all on function public.bot_upcoming(text) from public, anon, authenticated;
revoke all on function public.whatsapp_cancel_appointment(text, uuid) from public, anon, authenticated;
grant execute on function public.bot_free_slots(uuid, int) to service_role;
grant execute on function public.bot_patient(text) to service_role;
grant execute on function public.bot_upcoming(text) to service_role;
grant execute on function public.whatsapp_cancel_appointment(text, uuid) to service_role;

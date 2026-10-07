-- =====================================================================================================
--  CONTROL PANEL — HOSPITAL OPERATIONS (A–F + sign in as user)
-- =====================================================================================================
-- What the Hospital Comrade team can do *for* a hospital from the control panel, without opening it:
--   A  details (website contact, legal / GST details, logo), owner transfer, resend the owner's invite
--   B  the hospital's user accounts (list, change role, block, invite, remove — last-owner rule kept)
--   C  record counts, read-only lists (patients / doctors / appointments / bills), CSV import of patients / doctors
--   D  messaging channels on/off and a monthly cap on the shared (platform) accounts
--   E  wallet history and GST credit notes against paid Hospital Comrade invoices
--   F  announcements shown inside the hospital app
--   +  "sign in as user" (admins only, reason required, 30 minutes, banner, everything logged)
--
-- Roles: admin — everything · support — their assigned hospitals, no money and no deleting · finance — billing only.
-- Each function pins the hospital first (cp_pin) so the existing per-hospital rules, triggers and provider_log apply
-- exactly as when the team member opens the hospital app.

-- ------------------------------------------------------------------ helper
-- check the role + assignment and work "inside" the hospital for the rest of this transaction
create or replace function public.cp_pin(p_id uuid, p_roles text[] default array['admin', 'support', 'finance'])
returns text language plpgsql volatile security definer set search_path = public as $$
declare r text := public.cp_require(p_roles);
begin
  if p_id is null or not exists (select 1 from public.tenants where id = p_id) then raise exception 'Hospital not found.'; end if;
  if not public.provider_can(p_id) then raise exception 'This hospital is not assigned to you.' using errcode = '42501'; end if;
  perform set_config('app.tenant_id', p_id::text, true);
  return r;
end $$;

-- ------------------------------------------------------------------ A · details
create or replace function public.cp_hospital_profile(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants; s jsonb;
begin
  perform public.cp_pin(p_id);
  select * into t from public.tenants where id = p_id;
  s := coalesce(public.tenant_content('settings'), '{}'::jsonb);
  return jsonb_build_object(
    'name', coalesce(nullif(s ->> 'name', ''), t.name),
    'tagline', coalesce(s ->> 'tagline', ''),
    'address', coalesce(s ->> 'address', ''),
    'phone', coalesce(s ->> 'phone', ''),
    'appointmentsPhone', coalesce(s ->> 'appointmentsPhone', ''),
    'whatsapp', coalesce(s ->> 'whatsapp', ''),
    'email', coalesce(s ->> 'email', ''),
    'logoUrl', coalesce(s -> 'brand' ->> 'logoUrl', ''),
    'legalName', coalesce(t.billing ->> 'legalName', ''),
    'gstin', coalesce(t.billing ->> 'gstin', ''),
    'pan', coalesce(t.billing ->> 'pan', ''),
    'billingAddress', coalesce(t.billing ->> 'address', ''));
end $$;

create or replace function public.cp_save_hospital_profile(p_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  t      public.tenants;
  k      text;
  v      text;
  s      jsonb;
  site   jsonb := '{}'::jsonb;
  bill   jsonb := '{}'::jsonb;
  lens   jsonb := '{"name":120,"tagline":160,"address":300,"phone":20,"appointmentsPhone":20,"whatsapp":20,"email":120,
                   "logoUrl":500,"legalName":150,"gstin":15,"pan":10,"billingAddress":300}';
begin
  perform public.cp_pin(p_id, array['admin', 'support']);
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Nothing to save.'; end if;
  for k, v in select key, trim(coalesce(value, '')) from jsonb_each_text(p) loop
    if not lens ? k then raise exception 'Unknown field "%".', k; end if;
    if char_length(v) > (lens ->> k)::int then raise exception '% is too long (at most % characters).', k, lens ->> k; end if;
    if k = 'name' and char_length(v) < 2 then raise exception 'Enter the hospital name.'; end if;
    if k in ('phone', 'appointmentsPhone', 'whatsapp') and v <> '' and regexp_replace(v, '\D', '', 'g') !~ '^[0-9]{10,13}$' then
      raise exception 'Enter a valid phone number (10 digits, optional +91).';
    end if;
    if k = 'email' and v <> '' and v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid e-mail address.'; end if;
    if k = 'logoUrl' and v <> '' and v !~* '^https://[^\s]+$' then raise exception 'The logo must be an https:// link to an image.'; end if;
    if k = 'gstin' then
      v := upper(regexp_replace(v, '\s', '', 'g'));
      if v <> '' and v !~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$' then raise exception 'That GSTIN does not look right (15 characters, e.g. 10ABCDE1234F1Z5).'; end if;
    end if;
    if k = 'pan' then
      v := upper(regexp_replace(v, '\s', '', 'g'));
      if v <> '' and v !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'That PAN does not look right (e.g. ABCDE1234F).'; end if;
    end if;
    if k in ('legalName', 'gstin', 'pan') then bill := bill || jsonb_build_object(k, v);
    elsif k = 'billingAddress' then bill := bill || jsonb_build_object('address', v);
    else site := site || jsonb_build_object(k, v);
    end if;
  end loop;

  if site <> '{}'::jsonb then
    s := coalesce(public.tenant_content('settings'), '{}'::jsonb);
    if site ? 'logoUrl' then
      s := jsonb_set(s, '{brand}', coalesce(s -> 'brand', '{}'::jsonb) || jsonb_build_object('logoUrl', site ->> 'logoUrl'), true);
      site := site - 'logoUrl';
    end if;
    s := s || site;
    insert into public.site_content (tenant_id, key, data) values (p_id, 'settings', s)
    on conflict (tenant_id, key) do update set data = excluded.data;
    if site ? 'name' then update public.tenants set name = site ->> 'name' where id = p_id; end if;
  end if;
  if bill <> '{}'::jsonb then update public.tenants set billing = billing || bill where id = p_id; end if;

  select * into t from public.tenants where id = p_id;
  perform public.provider_log('hospital:profile', t.slug, p);
  return public.cp_hospital_profile(p_id);
end $$;

-- make another staff account the owner; the current owner(s) become p_old_role (or stay owners)
create or replace function public.cp_transfer_owner(p_id uuid, p_user uuid, p_old_role text default 'staff')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.profiles; v_slug text;
begin
  perform public.cp_pin(p_id, array['admin']);
  if coalesce(p_old_role, '') not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff') then
    raise exception 'Choose what the current owner becomes.';
  end if;
  select * into v from public.profiles where id = p_user and tenant_id = p_id;
  if not found then raise exception 'That user is not in this hospital.'; end if;
  if v.role = 'patient' then raise exception 'A patient account can’t become the owner — invite them as staff first.'; end if;
  if exists (select 1 from public.provider_users where user_id = p_user) then raise exception 'A Hospital Comrade team account can’t own a hospital.'; end if;
  if v.role = 'owner' and p_old_role = 'owner' then raise exception '% is already an owner.', v.full_name; end if;

  update public.profiles set role = 'owner' where id = p_user;              -- promote first: a hospital always keeps an owner
  if p_old_role <> 'owner' then
    update public.profiles set role = p_old_role::public.app_role where tenant_id = p_id and role = 'owner' and id <> p_user;
  end if;
  insert into public.app_settings (tenant_id, key, data) values (p_id, 'bootstrap', jsonb_build_object('owner_email', lower(v.email)))
  on conflict (tenant_id, key) do update set data = public.app_settings.data || excluded.data;

  select slug into v_slug from public.tenants where id = p_id;
  perform public.provider_log('hospital:owner', v_slug, jsonb_build_object('new_owner', v.email, 'previous_owner_becomes', p_old_role));
  return jsonb_build_object('owner', v.email);
end $$;

-- e-mail the owner their sign-up link again (only while nobody has signed up as owner)
create or replace function public.cp_resend_owner_invite(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants; v_email text; v_path text; v_base text; v_link text; n int := 0;
begin
  perform public.cp_pin(p_id, array['admin', 'support']);
  select * into t from public.tenants where id = p_id;
  if exists (select 1 from public.profiles where tenant_id = p_id and role = 'owner') then
    raise exception 'The owner has already signed up — use “Send password reset” in Users instead.';
  end if;
  select lower(data ->> 'owner_email') into v_email from public.app_settings where tenant_id = p_id and key = 'bootstrap';
  if coalesce(v_email, '') = '' or v_email = 'owner@your-hospital.in' then raise exception 'Set the owner’s e-mail first (Settings → Details).'; end if;
  v_path := '/register?hospital=' || t.slug;
  v_base := rtrim(coalesce(public.signup_config() ->> 'platformUrl', ''), '/');
  if v_base <> '' then
    v_link := v_base || v_path;
    n := public.notify_enqueue_raw('owner_invite',
      jsonb_build_object('subject', 'Your {hospital} account is ready',
        'text', 'Namaste! {hospital} is ready on {platform}. Create the owner account with this e-mail ({email}) here: {link}'),
      array['email'], null, v_email, null,
      jsonb_build_object('email', v_email, 'link', v_link, 'platform', coalesce(nullif(public.billing_config() -> 'seller' ->> 'name', ''), 'Hospital Comrade')),
      'tenants', p_id);
  end if;
  perform public.provider_log('hospital:owner_invite', t.slug, jsonb_build_object('email', v_email, 'queued', n));
  return jsonb_build_object('email', v_email, 'path', v_path, 'link', v_link, 'queued', n);
end $$;

-- ------------------------------------------------------------------ B · users
create or replace function public.cp_hospital_users(p_id uuid, p_search text default null, p_role text default null,
  p_offset int default 0, p_limit int default 50)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare q text := nullif(lower(trim(coalesce(p_search, ''))), ''); r text := nullif(p_role, ''); v_total int; v_rows jsonb; v_inv jsonb;
begin
  perform public.cp_pin(p_id, array['admin', 'support']);
  select count(*) into v_total from public.profiles p
   where p.tenant_id = p_id
     and (r is null or (r = 'staff_all' and p.role <> 'patient') or p.role::text = r)
     and (q is null or strpos(lower(p.full_name), q) > 0 or strpos(lower(coalesce(p.email, '')), q) > 0 or strpos(coalesce(p.phone, ''), q) > 0);
  select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_rows from (
    select p.id, p.full_name, p.email, p.phone, p.role::text as role, p.created_at,
           (u.banned_until is not null and u.banned_until > now()) as blocked,
           to_jsonb(u) ->> 'last_sign_in_at' as last_sign_in_at,
           row_number() over (order by (p.role = 'patient'), p.role, lower(p.full_name)) as ord
      from public.profiles p left join auth.users u on u.id = p.id
     where p.tenant_id = p_id
       and (r is null or (r = 'staff_all' and p.role <> 'patient') or p.role::text = r)
       and (q is null or strpos(lower(p.full_name), q) > 0 or strpos(lower(coalesce(p.email, '')), q) > 0 or strpos(coalesce(p.phone, ''), q) > 0)
     order by (p.role = 'patient'), p.role, lower(p.full_name)
     offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'full_name', i.full_name, 'email', i.email, 'phone', i.phone, 'role', i.role,
           'token', i.token, 'expires_at', i.expires_at, 'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
    into v_inv from public.staff_invites i where i.tenant_id = p_id and i.status = 'pending' and i.expires_at > now();
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'invites', v_inv);
end $$;

-- create | update | disable | enable | delete | invite | revoke_invite | password_reset (the e-mail itself is sent by Supabase Auth)
create or replace function public.cp_user_action(p_id uuid, p_action text, p_user uuid default null, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.profiles; v_new uuid; v_inv uuid; v_tok text; p_ jsonb := coalesce(p, '{}'::jsonb);
begin
  perform public.cp_pin(p_id, case when p_action = 'delete' then array['admin'] else array['admin', 'support'] end);
  if p_action in ('update', 'disable', 'enable', 'delete', 'password_reset') then
    select * into v from public.profiles where id = p_user and tenant_id = p_id;
    if not found then raise exception 'That user is not in this hospital.'; end if;
  end if;
  case p_action
    when 'create' then
      v_new := public.admin_create_user(p_ ->> 'email', p_ ->> 'full_name', p_ ->> 'role', nullif(p_ ->> 'phone', ''), null);
    when 'update' then
      perform public.admin_update_user(p_user, coalesce(p_ ->> 'full_name', v.full_name), coalesce(p_ ->> 'role', v.role::text),
                                       case when p_ ? 'phone' then nullif(p_ ->> 'phone', '') else v.phone end, coalesce(p_ ->> 'email', v.email));
    when 'disable' then perform public.admin_set_user_active(p_user, false);
    when 'enable' then perform public.admin_set_user_active(p_user, true);
    when 'delete' then perform public.admin_delete_user(p_user);
    when 'invite' then
      if coalesce(p_ ->> 'role', '') not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff') then raise exception 'Choose a staff role.'; end if;
      insert into public.staff_invites (full_name, email, phone, role)
      values (trim(coalesce(p_ ->> 'full_name', '')), trim(coalesce(p_ ->> 'email', '')), nullif(trim(coalesce(p_ ->> 'phone', '')), ''), (p_ ->> 'role')::public.app_role)
      returning id, token into v_inv, v_tok;
    when 'revoke_invite' then
      update public.staff_invites set status = 'revoked', updated_at = now()
       where id = nullif(p_ ->> 'invite_id', '')::uuid and tenant_id = p_id and status = 'pending';
      if not found then raise exception 'That invitation is no longer pending.'; end if;
    when 'password_reset' then null;
    else raise exception 'Unknown action "%".', p_action;
  end case;
  perform public.provider_log('user:' || p_action, coalesce(v.email, p_ ->> 'email', p_ ->> 'invite_id'), p_ - 'password');
  return jsonb_build_object('ok', true, 'user_id', coalesce(v_new, p_user), 'email', coalesce(v.email, lower(p_ ->> 'email')), 'invite_id', v_inv, 'token', v_tok);
end $$;

-- ------------------------------------------------------------------ C · data
create or replace function public.cp_hospital_data(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c jsonb := '{}'::jsonb; t text; n bigint; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.cp_pin(p_id);
  foreach t in array array['patients', 'doctors', 'staff', 'departments', 'appointments', 'prescriptions', 'lab_tests', 'admissions',
                           'wards', 'beds', 'invoices', 'payments', 'expenses', 'inventory', 'notices', 'site_enquiries', 'visit_feedback',
                           'doctor_leaves', 'holidays', 'audit_log'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('select count(*) from public.%I where tenant_id = $1', t) into n using p_id;
    c := c || jsonb_build_object(t, n);
  end loop;
  return jsonb_build_object('counts', c,
    'users', (select count(*) from public.profiles where tenant_id = p_id and role <> 'patient'),
    'appointments_30d', (select count(*) from public.appointments where tenant_id = p_id and appointment_date > v_today - 30),
    'admitted_now', (select count(*) from public.admissions where tenant_id = p_id and status = 'admitted'),
    'billed_30d', (select coalesce(sum(total), 0) from public.invoices where tenant_id = p_id and issue_date > v_today - 30 and status not in ('draft', 'cancelled')),
    'outstanding', (select coalesce(sum(total - amount_paid), 0) from public.invoices where tenant_id = p_id and status in ('unpaid', 'partial', 'overdue')),
    'last_activity', (select max(created_at) from public.audit_log where tenant_id = p_id));
end $$;

-- read-only lists; every look is logged. finance sees bills only.
create or replace function public.cp_browse(p_id uuid, p_kind text, p_search text default null, p_offset int default 0, p_limit int default 25)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_role text := public.cp_pin(p_id);
  q      text := nullif(lower(trim(coalesce(p_search, ''))), '');
  lim    int  := least(greatest(coalesce(p_limit, 25), 1), 100);
  off    int  := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if v_role = 'finance' and p_kind <> 'invoices' then raise exception 'Finance can look at bills only.' using errcode = '42501'; end if;
  if p_kind = 'patients' then
    select count(*) into v_total from public.patients p where p.tenant_id = p_id
       and (q is null or strpos(lower(p.full_name), q) > 0 or strpos(lower(coalesce(p.mrn, '')), q) > 0 or strpos(coalesce(p.phone, ''), q) > 0);
    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_rows from (
      select p.id, p.mrn, p.full_name, p.gender, p.date_of_birth, p.phone, p.created_at, row_number() over (order by p.created_at desc, p.id) ord
        from public.patients p where p.tenant_id = p_id
         and (q is null or strpos(lower(p.full_name), q) > 0 or strpos(lower(coalesce(p.mrn, '')), q) > 0 or strpos(coalesce(p.phone, ''), q) > 0)
       order by p.created_at desc, p.id offset off limit lim) x;
  elsif p_kind = 'doctors' then
    select count(*) into v_total from public.doctors d where d.tenant_id = p_id
       and (q is null or strpos(lower(d.full_name), q) > 0 or strpos(lower(coalesce(d.specialization, '')), q) > 0);
    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_rows from (
      select d.id, d.full_name, d.specialization, d.phone, d.email, d.consultation_fee, d.status, dp.name as department,
             row_number() over (order by lower(d.full_name), d.id) ord
        from public.doctors d left join public.departments dp on dp.id = d.department_id
       where d.tenant_id = p_id
         and (q is null or strpos(lower(d.full_name), q) > 0 or strpos(lower(coalesce(d.specialization, '')), q) > 0)
       order by lower(d.full_name), d.id offset off limit lim) x;
  elsif p_kind = 'appointments' then
    select count(*) into v_total from public.appointments a
      left join public.patients pt on pt.id = a.patient_id left join public.doctors d on d.id = a.doctor_id
     where a.tenant_id = p_id and (q is null or strpos(lower(coalesce(pt.full_name, '')), q) > 0 or strpos(lower(coalesce(d.full_name, '')), q) > 0);
    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_rows from (
      select a.id, a.appointment_date, a.appointment_time, a.status, a.type, pt.full_name as patient, d.full_name as doctor,
             row_number() over (order by a.appointment_date desc, a.appointment_time desc, a.id) ord
        from public.appointments a
        left join public.patients pt on pt.id = a.patient_id left join public.doctors d on d.id = a.doctor_id
       where a.tenant_id = p_id and (q is null or strpos(lower(coalesce(pt.full_name, '')), q) > 0 or strpos(lower(coalesce(d.full_name, '')), q) > 0)
       order by a.appointment_date desc, a.appointment_time desc, a.id offset off limit lim) x;
  elsif p_kind = 'invoices' then
    select count(*) into v_total from public.invoices i left join public.patients pt on pt.id = i.patient_id
     where i.tenant_id = p_id and (q is null or strpos(lower(i.invoice_number), q) > 0 or strpos(lower(coalesce(pt.full_name, '')), q) > 0);
    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_rows from (
      select i.id, i.invoice_number, i.issue_date, i.total, i.amount_paid, i.status, pt.full_name as patient,
             row_number() over (order by i.issue_date desc, i.created_at desc, i.id) ord
        from public.invoices i left join public.patients pt on pt.id = i.patient_id
       where i.tenant_id = p_id and (q is null or strpos(lower(i.invoice_number), q) > 0 or strpos(lower(coalesce(pt.full_name, '')), q) > 0)
       order by i.issue_date desc, i.created_at desc, i.id offset off limit lim) x;
  else
    raise exception 'Unknown list "%".', p_kind;
  end if;
  perform public.provider_log('data:browse', p_kind, jsonb_build_object('search', q, 'offset', off));
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- CSV import (rows already parsed by the panel). Every row is checked on its own; a bad row never stops the rest.
-- Duplicates (same name + phone for patients, same name + speciality for doctors) are skipped.
create or replace function public.cp_import(p_id uuid, p_kind text, p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  x jsonb; i int := 0; ok int := 0; dup int := 0; errs jsonb := '[]'::jsonb; nerr int := 0;
  v_name text; v_phone text; v_email text; v_g text; v_dob date; v_bg text; v_dept uuid; v_fee numeric; v_exp int; v_spec text; v_raw text;
begin
  perform public.cp_pin(p_id, array['admin']);
  if p_kind not in ('patients', 'doctors') then raise exception 'You can import patients or doctors.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Nothing to import.'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Import at most 1,000 rows at a time — split the file.'; end if;

  for x in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      if jsonb_typeof(x) <> 'object' then raise exception 'not a row'; end if;
      v_name := trim(regexp_replace(coalesce(x ->> 'full_name', ''), '\s+', ' ', 'g'));
      if char_length(v_name) < 2 then raise exception 'name is missing'; end if;
      if char_length(v_name) > 120 then raise exception 'name is too long'; end if;
      v_raw := regexp_replace(coalesce(x ->> 'phone', ''), '\D', '', 'g');
      v_phone := nullif(right(v_raw, 10), '');
      if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'phone "%" is not a 10-digit mobile number', x ->> 'phone'; end if;
      v_email := nullif(lower(trim(coalesce(x ->> 'email', ''))), '');
      if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail "%" is not valid', v_email; end if;

      if p_kind = 'patients' then
        v_g := case lower(left(trim(coalesce(x ->> 'gender', '')), 1)) when 'm' then 'male' when 'f' then 'female' else 'other' end;
        v_dob := null;
        if coalesce(trim(x ->> 'date_of_birth'), '') <> '' then
          begin v_dob := (trim(x ->> 'date_of_birth'))::date;
          exception when others then raise exception 'date of birth "%" — use YYYY-MM-DD', x ->> 'date_of_birth'; end;
          if v_dob > current_date or v_dob < date '1900-01-01' then raise exception 'date of birth % is not possible', v_dob; end if;
        end if;
        v_bg := nullif(upper(replace(trim(coalesce(x ->> 'blood_group', '')), ' ', '')), '');
        if v_bg is not null and v_bg not in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') then raise exception 'blood group "%" is not valid', v_bg; end if;
        if exists (select 1 from public.patients where tenant_id = p_id and lower(full_name) = lower(v_name) and coalesce(phone, '') = coalesce(v_phone, '')) then
          dup := dup + 1; continue;
        end if;
        if not p_dry_run then
          insert into public.patients (full_name, gender, date_of_birth, blood_group, phone, email, address)
          values (v_name, v_g, v_dob, v_bg, v_phone, v_email, nullif(left(trim(coalesce(x ->> 'address', '')), 300), ''));
        end if;
      else
        v_spec := trim(coalesce(x ->> 'specialization', ''));
        if char_length(v_spec) < 2 then raise exception 'specialization is missing'; end if;
        v_fee := 0;
        if coalesce(trim(x ->> 'consultation_fee'), '') <> '' then
          begin v_fee := replace(trim(x ->> 'consultation_fee'), ',', '')::numeric;
          exception when others then raise exception 'fee "%" is not a number', x ->> 'consultation_fee'; end;
          if v_fee < 0 or v_fee > 100000 then raise exception 'fee % is not possible', v_fee; end if;
        end if;
        v_exp := 0;
        if coalesce(trim(x ->> 'experience_years'), '') <> '' then
          begin v_exp := trim(x ->> 'experience_years')::int;
          exception when others then raise exception 'experience "%" is not a whole number', x ->> 'experience_years'; end;
          if v_exp < 0 or v_exp > 70 then raise exception 'experience % is not possible', v_exp; end if;
        end if;
        v_dept := null;
        if coalesce(trim(x ->> 'department'), '') <> '' then
          select id into v_dept from public.departments where tenant_id = p_id and lower(name) = lower(trim(x ->> 'department')) limit 1;
          if v_dept is null then raise exception 'department "%" does not exist in this hospital', trim(x ->> 'department'); end if;
        end if;
        if exists (select 1 from public.doctors where tenant_id = p_id and lower(full_name) = lower(v_name) and lower(coalesce(specialization, '')) = lower(v_spec)) then
          dup := dup + 1; continue;
        end if;
        if not p_dry_run then
          insert into public.doctors (full_name, specialization, qualification, phone, email, experience_years, consultation_fee, department_id, available_days)
          values (v_name, v_spec, nullif(left(trim(coalesce(x ->> 'qualification', '')), 200), ''), v_phone, v_email, v_exp, v_fee, v_dept,
                  array['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        end if;
      end if;
      ok := ok + 1;
    exception when others then
      nerr := nerr + 1;
      if nerr <= 200 then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm); end if;
    end;
  end loop;
  if not p_dry_run then
    perform public.provider_log('data:import', p_kind, jsonb_build_object('imported', ok, 'duplicates', dup, 'failed', nerr));
  end if;
  return jsonb_build_object('dry_run', coalesce(p_dry_run, false), 'imported', ok, 'duplicates', dup, 'failed', nerr, 'errors', errs);
end $$;

-- ------------------------------------------------------------------ D · messaging
create or replace function public.cp_messaging(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants; n jsonb; cfg jsonb := public.billing_config(); v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.cp_pin(p_id);
  select * into t from public.tenants where id = p_id;
  n := coalesce(public.tenant_setting('app') -> 'notifications', '{}'::jsonb);
  return jsonb_build_object(
    'channels', (select jsonb_object_agg(ch, jsonb_build_object('enabled', coalesce((n -> ch ->> 'enabled')::boolean, false),
                                                                'source', coalesce(n -> ch ->> 'source', 'own')))
                   from unnest(array['sms', 'whatsapp', 'email']) ch),
    'monthlyLimit', coalesce(t.billing -> 'monthlyLimit', '{}'::jsonb),
    'included', coalesce(t.billing -> 'included', cfg -> 'plans' -> t.plan -> 'included', '{}'::jsonb),
    'usage', coalesce((select jsonb_object_agg(u.channel || ':' || u.source, jsonb_build_object('sent', u.sent, 'failed', u.failed))
                         from public.message_usage u where u.tenant_id = p_id and u.month = v_month), '{}'::jsonb),
    'pending', coalesce((select jsonb_object_agg(o.channel, o.n) from (select channel, count(*) n from public.notification_outbox
                          where tenant_id = p_id and status in ('pending', 'sending') group by channel) o), '{}'::jsonb),
    'wallet_paise', t.wallet_paise,
    'is_primary', t.is_primary);
end $$;

-- { channels?: { sms|whatsapp|email: { enabled?, source?: own|platform } }, monthlyLimit?: { sms|whatsapp|email: int | null } }
create or replace function public.cp_save_messaging(p_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare d jsonb; ch text; v jsonb; k text; lim jsonb; v_slug text;
begin
  perform public.cp_pin(p_id, array['admin']);
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Nothing to save.'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('channels', 'monthlyLimit') then raise exception 'Unknown field "%".', k; end if;
  end loop;
  if p ? 'channels' then
    d := coalesce(public.tenant_setting('app'), '{}'::jsonb);
    if jsonb_typeof(coalesce(d -> 'notifications', 'null')) <> 'object' then d := jsonb_set(d, '{notifications}', '{}'::jsonb, true); end if;
    for ch, v in select key, value from jsonb_each(p -> 'channels') loop
      if ch not in ('sms', 'whatsapp', 'email') then raise exception 'Unknown channel "%".', ch; end if;
      if exists (select 1 from jsonb_object_keys(v) kk where kk not in ('enabled', 'source')) then raise exception 'Unknown setting for %.', ch; end if;
      if v ? 'source' and v ->> 'source' not in ('own', 'platform') then raise exception 'Source must be own or platform.'; end if;
      d := jsonb_set(d, array['notifications', ch], coalesce(d -> 'notifications' -> ch, '{}'::jsonb)
             || jsonb_strip_nulls(jsonb_build_object('enabled', (v ->> 'enabled')::boolean, 'source', v ->> 'source')), true);
    end loop;
    insert into public.app_settings (tenant_id, key, data) values (p_id, 'app', d)
    on conflict (tenant_id, key) do update set data = excluded.data;
  end if;
  if p ? 'monthlyLimit' then
    lim := '{}'::jsonb;
    for ch, v in select key, value from jsonb_each(p -> 'monthlyLimit') loop
      if ch not in ('sms', 'whatsapp', 'email') then raise exception 'Unknown channel "%".', ch; end if;
      continue when v is null or v = 'null'::jsonb;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 0 and 1000000 then
        raise exception 'The % limit must be a whole number between 0 and 10,00,000 (blank = no limit).', ch;
      end if;
      lim := lim || jsonb_build_object(ch, (v #>> '{}')::int);
    end loop;
    update public.tenants set billing = case when lim = '{}'::jsonb then billing - 'monthlyLimit' else billing || jsonb_build_object('monthlyLimit', lim) end
     where id = p_id;
  end if;
  select slug into v_slug from public.tenants where id = p_id;
  perform public.provider_log('hospital:messaging', v_slug, p);
  return public.cp_messaging(p_id);
end $$;

-- ------------------------------------------------------------------ E · wallet history + credit notes
create sequence if not exists public.billing_credit_note_seq;
create table if not exists public.billing_credit_notes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  payment_id       uuid not null references public.billing_payments (id) on delete cascade,
  credit_no        text not null unique,
  created_at       timestamptz not null default now(),
  base_paise       bigint not null check (base_paise >= 0),
  gst_paise        bigint not null default 0 check (gst_paise >= 0),
  total_paise      bigint not null check (total_paise > 0),
  mode             text not null check (mode in ('wallet', 'refund')),
  reason           text not null check (char_length(reason) between 5 and 300),
  seller           jsonb,
  buyer            jsonb not null default '{}'::jsonb,
  created_by       uuid,
  created_by_name  text
);
create index if not exists billing_credit_notes_tenant_idx on public.billing_credit_notes (tenant_id, created_at desc);
create index if not exists billing_credit_notes_payment_idx on public.billing_credit_notes (payment_id);
alter table public.billing_credit_notes enable row level security;
revoke all on public.billing_credit_notes from anon, authenticated;
grant select on public.billing_credit_notes to authenticated;
grant all on public.billing_credit_notes to service_role;
drop policy if exists tenant_isolation on public.billing_credit_notes;
create policy tenant_isolation on public.billing_credit_notes as restrictive for all to anon, authenticated
  using (tenant_id = (select public.current_tenant())) with check (tenant_id = (select public.current_tenant()));
drop policy if exists billing_read on public.billing_credit_notes;
create policy billing_read on public.billing_credit_notes for select to authenticated using (public.has_role('owner', 'accountant'));
drop trigger if exists trg_keep_tenant on public.billing_credit_notes;
create trigger trg_keep_tenant before update of tenant_id on public.billing_credit_notes for each row execute function public.keep_tenant();
-- (integrity.sql builds this from the foreign keys on its next run; here so a fresh install matches)
drop trigger if exists trg_zz_same_tenant on public.billing_credit_notes;
create trigger trg_zz_same_tenant before insert or update on public.billing_credit_notes
  for each row execute function public.enforce_same_tenant('payment_id', 'billing_payments');

create or replace function public.cp_wallet_ledger(p_id uuid, p_limit int default 200)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_pin(p_id, array['admin', 'finance']);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select l.id, l.created_at, l.day, l.kind, l.channel, l.units, l.amount_paise, l.balance_paise, l.note, b.invoice_no
      from public.wallet_ledger l left join public.billing_payments b on b.id = l.payment
     where l.tenant_id = p_id order by l.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]'::jsonb);
end $$;

create or replace function public.cp_credit_notes(p_tenant uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'finance']);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select c.*, b.invoice_no, b.kind, b.plan, b.months, b.total_paise as invoice_total_paise, b.paid_at as invoice_date, t.name as hospital
      from public.billing_credit_notes c join public.billing_payments b on b.id = c.payment_id join public.tenants t on t.id = c.tenant_id
     where (p_tenant is null or c.tenant_id = p_tenant) and public.provider_can(c.tenant_id)
     order by c.created_at desc limit 500) x), '[]'::jsonb);
end $$;

-- { amount?: ₹ incl. GST (blank = everything left), reason, mode: wallet (credit the hospital's wallet) | refund (money paid back) }
create or replace function public.cp_credit_note(p_payment uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  bp       public.billing_payments;
  p_       jsonb := coalesce(p, '{}'::jsonb);
  v_mode   text := coalesce(nullif(p_ ->> 'mode', ''), 'wallet');
  v_reason text := trim(coalesce(p_ ->> 'reason', ''));
  v_left   bigint;
  v_total  bigint;
  v_gst    bigint;
  v_base   bigint;
  v_wallet bigint;
  v_d      date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy     text;
  v_no     text;
  r        public.billing_credit_notes;
begin
  perform public.cp_require(array['admin', 'finance']);
  select * into bp from public.billing_payments where id = p_payment for update;
  if not found or not public.provider_can(bp.tenant_id) then raise exception 'Invoice not found.' using errcode = '42501'; end if;
  perform set_config('app.tenant_id', bp.tenant_id::text, true);
  if bp.status <> 'paid' or bp.invoice_no is null then raise exception 'Only a paid invoice can get a credit note.'; end if;
  if v_mode not in ('wallet', 'refund') then raise exception 'Choose wallet credit or refund.'; end if;
  if v_mode = 'wallet' and bp.kind = 'wallet' then raise exception 'A wallet top-up can only be refunded (the money is already in the wallet).'; end if;
  if char_length(v_reason) < 5 then raise exception 'Write the reason (at least 5 characters) — it is printed on the credit note.'; end if;

  v_left := bp.total_paise - coalesce((select sum(total_paise) from public.billing_credit_notes where payment_id = bp.id), 0);
  if nullif(trim(coalesce(p_ ->> 'amount', '')), '') is null then v_total := v_left;
  else v_total := round((p_ ->> 'amount')::numeric * 100)::bigint;
  end if;
  if v_total is null or v_total < 100 or v_total > v_left then
    raise exception 'The credit must be between ₹1 and ₹% (what is left on this invoice).', to_char(v_left / 100.0, 'FM99999990.00');
  end if;
  v_gst := case when bp.total_paise = 0 then 0 else round(v_total::numeric * bp.gst_paise / bp.total_paise)::bigint end;
  v_base := v_total - v_gst;

  if v_mode = 'refund' and bp.kind = 'wallet' then        -- money back for a top-up: the credit (before GST) leaves the wallet
    select wallet_paise into v_wallet from public.tenants where id = bp.tenant_id for update;
    if v_wallet < v_base then raise exception 'The wallet has only ₹% left — refund at most that much (before GST).', to_char(v_wallet / 100.0, 'FM99999990.00'); end if;
  end if;

  v_fy := case when extract(month from v_d) >= 4 then to_char(v_d, 'YYYY') || '-' || to_char(v_d + interval '1 year', 'YY')
               else to_char(v_d - interval '1 year', 'YYYY') || '-' || to_char(v_d, 'YY') end;
  v_no := 'HC-CN/' || v_fy || '/' || lpad(nextval('public.billing_credit_note_seq')::text, 5, '0');
  insert into public.billing_credit_notes (tenant_id, payment_id, credit_no, base_paise, gst_paise, total_paise, mode, reason, seller, buyer, created_by, created_by_name)
  values (bp.tenant_id, bp.id, v_no, v_base, v_gst, v_total, v_mode, v_reason, coalesce(bp.seller, public.billing_config() -> 'seller'),
          coalesce(bp.buyer, '{}'::jsonb), auth.uid(), (select full_name from public.profiles where id = auth.uid()))
  returning * into r;

  if v_mode = 'wallet' then
    perform public.wallet_apply(bp.tenant_id, 'refund', v_total, bp.id, 'Credit note ' || v_no || ' — ' || v_reason);
  elsif bp.kind = 'wallet' then
    perform public.wallet_apply(bp.tenant_id, 'refund', -v_base, bp.id, 'Refund, credit note ' || v_no);
  end if;
  if v_left - v_total = 0 then update public.billing_payments set status = 'refunded' where id = bp.id; end if;

  perform public.provider_log('billing:credit_note', bp.invoice_no,
    jsonb_build_object('credit_no', v_no, 'total_paise', v_total, 'mode', v_mode, 'reason', v_reason));
  return to_jsonb(r) || jsonb_build_object('invoice_no', bp.invoice_no, 'invoice_date', bp.paid_at, 'kind', bp.kind, 'plan', bp.plan, 'months', bp.months);
end $$;

-- ------------------------------------------------------------------ F · announcements
create table if not exists public.platform_announcements (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 3 and 120),
  body             text not null default '' check (char_length(body) <= 1000),
  level            text not null default 'info' check (level in ('info', 'warning', 'critical')),
  hospital_ids     uuid[],                                   -- null = every hospital
  roles            text[] not null default array['owner'],   -- which hospital roles see it
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  active           boolean not null default true,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
alter table public.platform_announcements enable row level security;
revoke all on public.platform_announcements from anon, authenticated;
grant all on public.platform_announcements to service_role;

create or replace function public.cp_announcements()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'support']);
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'hospitals', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name), '[]'::jsonb) from public.tenants t where t.id = any (a.hospital_ids)),
      'live', a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now()))
    order by a.created_at desc) from public.platform_announcements a), '[]'::jsonb);
end $$;

create or replace function public.cp_save_announcement(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p_ jsonb := coalesce(p, '{}'::jsonb);
  v_id uuid := nullif(p_ ->> 'id', '')::uuid;
  v_roles text[]; v_ids uuid[]; r public.platform_announcements;
begin
  perform public.cp_require(array['admin']);
  v_roles := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_ -> 'roles', '["owner"]'::jsonb)) x), array['owner']);
  if exists (select 1 from unnest(v_roles) x where x not in ('owner', 'doctor', 'receptionist', 'accountant', 'staff')) then
    raise exception 'Announcements go to staff roles only.';
  end if;
  if jsonb_typeof(p_ -> 'hospital_ids') = 'array' and jsonb_array_length(p_ -> 'hospital_ids') > 0 then
    v_ids := (select array_agg(distinct x::uuid) from jsonb_array_elements_text(p_ -> 'hospital_ids') x);
    if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.tenants t where t.id = x)) then raise exception 'Unknown hospital in the list.'; end if;
  end if;
  if v_id is null then
    insert into public.platform_announcements (title, body, level, hospital_ids, roles, starts_at, ends_at, active, created_by, created_by_name)
    values (trim(coalesce(p_ ->> 'title', '')), trim(coalesce(p_ ->> 'body', '')), coalesce(nullif(p_ ->> 'level', ''), 'info'), v_ids, v_roles,
            coalesce(nullif(p_ ->> 'starts_at', '')::timestamptz, now()), nullif(p_ ->> 'ends_at', '')::timestamptz, coalesce((p_ ->> 'active')::boolean, true),
            auth.uid(), (select full_name from public.profiles where id = auth.uid()))
    returning * into r;
  else
    update public.platform_announcements set title = trim(coalesce(p_ ->> 'title', title)), body = trim(coalesce(p_ ->> 'body', body)),
           level = coalesce(nullif(p_ ->> 'level', ''), level), hospital_ids = v_ids, roles = v_roles,
           starts_at = coalesce(nullif(p_ ->> 'starts_at', '')::timestamptz, starts_at),
           ends_at = case when p_ ? 'ends_at' then nullif(p_ ->> 'ends_at', '')::timestamptz else ends_at end,
           active = coalesce((p_ ->> 'active')::boolean, active), updated_at = now()
     where id = v_id returning * into r;
    if not found then raise exception 'Announcement not found.'; end if;
  end if;
  perform public.provider_log('announcement:save', r.title, jsonb_build_object('id', r.id, 'level', r.level, 'hospitals', coalesce(cardinality(r.hospital_ids), 0), 'roles', r.roles));
  return to_jsonb(r);
end $$;

create or replace function public.cp_delete_announcement(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_title text;
begin
  perform public.cp_require(array['admin']);
  delete from public.platform_announcements where id = p_id returning title into v_title;
  if not found then raise exception 'Announcement not found.'; end if;
  perform public.provider_log('announcement:delete', v_title, jsonb_build_object('id', p_id));
end $$;

-- what the signed-in hospital user should see now
create or replace function public.my_announcements()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text := public.current_app_role()::text; v_t uuid := public.current_tenant();
begin
  if auth.uid() is null or v_role is null or v_role = 'patient' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'level', a.level, 'starts_at', a.starts_at)
                     order by case a.level when 'critical' then 0 when 'warning' then 1 else 2 end, a.starts_at desc)
    from (select * from public.platform_announcements a
           where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
             and (a.hospital_ids is null or v_t = any (a.hospital_ids)) and v_role = any (a.roles)
           order by a.starts_at desc limit 5) a), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ sign in as user (admins only)
-- The impersonate Edge Function calls impersonation_start as the admin, then makes a one-time sign-in link for the
-- user. The new tab signs in with it, binds its session here (impersonation_bind) and shows a banner with a countdown.
-- When it ends — button, or 30 minutes (notify_cron_flush → impersonation_expire) — that session is deleted.
create table if not exists public.impersonations (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null,
  admin_name    text,
  target_id     uuid not null,
  target_email  text,
  target_role   text,
  hospital_id   uuid not null references public.tenants (id) on delete cascade,
  reason        text not null check (char_length(reason) between 10 and 300),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  session_id    text,
  bound_at      timestamptz,
  ended_at      timestamptz,
  end_reason    text
);
create index if not exists impersonations_target_idx on public.impersonations (target_id, created_at desc);
create index if not exists impersonations_open_idx on public.impersonations (expires_at) where ended_at is null;
alter table public.impersonations enable row level security;
revoke all on public.impersonations from anon, authenticated;
grant all on public.impersonations to service_role;

-- the Supabase session id of this request (in every access token)
create or replace function public.jwt_session_id()
returns text language plpgsql stable set search_path = public as $$
declare c jsonb;
begin
  begin c := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then c := null; end;
  return nullif(c ->> 'session_id', '');
end $$;

create or replace function public.impersonation_close(p_row public.impersonations, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.impersonations set ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, p_reason) where id = p_row.id;
  if p_row.session_id is not null and to_regclass('auth.sessions') is not null then
    begin
      execute 'delete from auth.sessions where id = $1::uuid and user_id = $2' using p_row.session_id, p_row.target_id;
    exception when others then raise warning 'impersonation_close: %', sqlerrm;
    end;
  end if;
end $$;

create or replace function public.impersonation_start(p_user uuid, p_reason text, p_minutes int default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.profiles; t public.tenants; u record; o public.impersonations; r public.impersonations; v_min int := least(greatest(coalesce(p_minutes, 30), 5), 30);
begin
  perform public.cp_require(array['admin']);
  if not public.recent_reauth(600) then raise exception 'REAUTH_REQUIRED: confirm your password to sign in as a user.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Write why you need to sign in as this user (at least 10 characters).'; end if;
  select * into v from public.profiles where id = p_user;
  if not found or v.tenant_id is null then raise exception 'User not found.'; end if;
  if v.role = 'patient' then raise exception 'Signing in as a patient is not allowed.'; end if;
  if exists (select 1 from public.provider_users where user_id = p_user) then raise exception 'You can’t sign in as a Hospital Comrade team member.'; end if;
  if p_user = auth.uid() then raise exception 'That is your own account.'; end if;
  select * into t from public.tenants where id = v.tenant_id;
  if public.tenant_license(t.id) = 'suspended' then raise exception 'This hospital is suspended — resume it first.'; end if;
  select a.email, a.banned_until into u from auth.users a where a.id = p_user;
  if u.email is null then raise exception 'This user has no sign-in e-mail.'; end if;
  if u.banned_until is not null and u.banned_until > now() then raise exception 'This user is blocked — unblock them first.'; end if;

  for o in select * from public.impersonations where admin_id = auth.uid() and ended_at is null loop   -- one at a time per admin
    perform public.impersonation_close(o, 'replaced');
  end loop;
  insert into public.impersonations (admin_id, admin_name, target_id, target_email, target_role, hospital_id, reason, expires_at)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), p_user, lower(u.email), v.role::text, t.id,
          trim(p_reason), now() + make_interval(mins => v_min))
  returning * into r;
  perform set_config('app.tenant_id', t.id::text, true);
  perform public.provider_log('impersonate:start', lower(u.email), jsonb_build_object('id', r.id, 'role', v.role, 'reason', r.reason, 'minutes', v_min));
  return jsonb_build_object('id', r.id, 'email', r.target_email, 'full_name', v.full_name, 'role', v.role, 'hospital_id', t.id,
                            'slug', t.slug, 'hospital', t.name, 'expires_at', r.expires_at);
end $$;

-- the impersonation tab, right after signing in: remember which session is the impersonated one
create or replace function public.impersonation_bind(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.impersonations; v_sid text := public.jwt_session_id();
begin
  select * into r from public.impersonations where id = p_id for update;
  if not found or r.target_id is distinct from auth.uid() or r.ended_at is not null or r.expires_at <= now()
     or r.bound_at is not null or r.created_at < now() - interval '5 minutes' then
    raise exception 'This sign-in link has expired — start again from the control panel.' using errcode = '42501';
  end if;
  update public.impersonations set session_id = v_sid, bound_at = now() where id = p_id;
  return jsonb_build_object('id', r.id, 'expires_at', r.expires_at, 'admin_name', r.admin_name, 'reason', r.reason);
end $$;

-- the banner checks this: is my current session still a running impersonation?
create or replace function public.impersonation_status(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.impersonations;
begin
  select * into r from public.impersonations where id = p_id and target_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'expires_at', r.expires_at, 'admin_name', r.admin_name,
                            'active', r.ended_at is null and r.expires_at > now() and r.session_id is not distinct from public.jwt_session_id());
end $$;

-- end it: the impersonated tab itself, or the admin who started it
create or replace function public.impersonation_end(p_id uuid, p_reason text default 'ended')
returns void language plpgsql volatile security definer set search_path = public as $$
declare r public.impersonations;
begin
  select * into r from public.impersonations where id = p_id for update;
  if not found then return; end if;
  if r.target_id is distinct from auth.uid() and r.admin_id is distinct from auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if r.ended_at is not null then return; end if;
  perform public.impersonation_close(r, left(coalesce(nullif(p_reason, ''), 'ended'), 40));
  insert into public.provider_audit (user_id, user_name, mode, tenant_id, action, target, detail)
  values (r.admin_id, r.admin_name, 'admin', r.hospital_id, 'impersonate:end', r.target_email,
          jsonb_build_object('id', r.id, 'reason', p_reason, 'minutes', round(extract(epoch from now() - r.created_at) / 60)));
end $$;

-- time limit (every minute from notify_cron_flush)
create or replace function public.impersonation_expire()
returns int language plpgsql volatile security definer set search_path = public as $$
declare r public.impersonations; n int := 0;
begin
  for r in select * from public.impersonations where ended_at is null and expires_at <= now() for update skip locked loop
    perform public.impersonation_close(r, 'expired');
    insert into public.provider_audit (user_id, user_name, mode, tenant_id, action, target, detail)
    values (r.admin_id, r.admin_name, 'admin', r.hospital_id, 'impersonate:end', r.target_email, jsonb_build_object('id', r.id, 'reason', 'expired'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.cp_impersonations(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select i.id, i.admin_name, i.target_email, i.target_role, i.reason, i.created_at, i.expires_at, i.bound_at, i.ended_at, i.end_reason,
           t.name as hospital, i.hospital_id, (i.ended_at is null and i.expires_at > now()) as active
      from public.impersonations i join public.tenants t on t.id = i.hospital_id
     order by i.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 500)) x), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.cp_pin(uuid, text[]), public.impersonation_close(public.impersonations, text), public.impersonation_expire(),
  public.jwt_session_id() from public, anon, authenticated;
revoke all on function public.cp_hospital_profile(uuid), public.cp_save_hospital_profile(uuid, jsonb), public.cp_transfer_owner(uuid, uuid, text),
  public.cp_resend_owner_invite(uuid), public.cp_hospital_users(uuid, text, text, int, int), public.cp_user_action(uuid, text, uuid, jsonb),
  public.cp_hospital_data(uuid), public.cp_browse(uuid, text, text, int, int), public.cp_import(uuid, text, jsonb, boolean),
  public.cp_messaging(uuid), public.cp_save_messaging(uuid, jsonb), public.cp_wallet_ledger(uuid, int), public.cp_credit_notes(uuid),
  public.cp_credit_note(uuid, jsonb), public.cp_announcements(), public.cp_save_announcement(jsonb), public.cp_delete_announcement(uuid),
  public.my_announcements(), public.impersonation_start(uuid, text, int), public.impersonation_bind(uuid), public.impersonation_status(uuid),
  public.impersonation_end(uuid, text), public.cp_impersonations(int) from public, anon;
grant execute on function public.cp_hospital_profile(uuid), public.cp_save_hospital_profile(uuid, jsonb), public.cp_transfer_owner(uuid, uuid, text),
  public.cp_resend_owner_invite(uuid), public.cp_hospital_users(uuid, text, text, int, int), public.cp_user_action(uuid, text, uuid, jsonb),
  public.cp_hospital_data(uuid), public.cp_browse(uuid, text, text, int, int), public.cp_import(uuid, text, jsonb, boolean),
  public.cp_messaging(uuid), public.cp_save_messaging(uuid, jsonb), public.cp_wallet_ledger(uuid, int), public.cp_credit_notes(uuid),
  public.cp_credit_note(uuid, jsonb), public.cp_announcements(), public.cp_save_announcement(jsonb), public.cp_delete_announcement(uuid),
  public.my_announcements(), public.impersonation_start(uuid, text, int), public.impersonation_bind(uuid), public.impersonation_status(uuid),
  public.impersonation_end(uuid, text), public.cp_impersonations(int) to authenticated;

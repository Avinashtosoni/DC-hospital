-- =====================================================================================================
--  23. OPS & COMPLIANCE — phase 7 (loaded last, after the control panel)
-- =====================================================================================================
--  7.1 Privacy (DPDP Act 2023): a patient downloads everything held about them, withdraws marketing consent and asks
--      for a correction or erasure; the owner works the requests. Erasure = anonymise: the medical and GST records
--      stay (clinical-establishment and tax rules require them) but nothing identifies the person any more.
--  7.3 Offboarding: the platform closes a hospital (read-only, owner can export), then purges it after the notice
--      period — with a fresh password confirmation ("sudo"). GST invoices to the hospital are archived first.
--  7.4 Incident register (personal-data breaches: Board + affected people within 72 hours).
--  7.5 System health for the platform team.  7.6 Retention: old logs / OTPs / enquiries removed daily.
--  Session switches used here: app.skip_audit (no copy of removed data in the audit log), app.privacy (privacy
--  actions pass the licence guard). Only SECURITY DEFINER functions set them.

-- ------------------------------------------------------------------ helpers
-- did the signed-in user type their password in the last p_seconds? (Supabase puts the sign-in time in the JWT's amr)
create or replace function public.recent_reauth(p_seconds int default 600)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare c jsonb; v_ts numeric;
begin
  begin c := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then c := null; end;
  if c is null then return false; end if;
  select max((a ->> 'timestamp')::numeric) into v_ts from jsonb_array_elements(case when jsonb_typeof(c -> 'amr') = 'array' then c -> 'amr' else '[]'::jsonb end) a
   where a ->> 'method' in ('password', 'otp', 'totp');
  v_ts := coalesce(v_ts, (c ->> 'iat')::numeric);
  return v_ts is not null and to_timestamp(v_ts) > now() - make_interval(secs => greatest(coalesce(p_seconds, 600), 60));
end $$;

-- the hospital owner to write to (the first owner account, else the e-mail the owner will sign up with)
create or replace function public.tenant_owner_contact(p_tenant uuid)
returns table (profile_id uuid, full_name text, email text) language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email from public.profiles p where p.tenant_id = p_tenant and p.role = 'owner'
  union all
  select null, null, s.data ->> 'owner_email' from public.app_settings s
   where s.tenant_id = p_tenant and s.key = 'bootstrap' and not exists (select 1 from public.profiles p where p.tenant_id = p_tenant and p.role = 'owner')
  limit 1
$$;

-- ------------------------------------------------------------------ 7.1 privacy: tables
alter table public.patients add column if not exists marketing_opt_out boolean not null default false;
alter table public.patients add column if not exists erased_at timestamptz;

create table if not exists public.privacy_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  created_at        timestamptz not null default now(),
  profile_id        uuid references public.profiles (id) on delete set null,
  patient_id        uuid references public.patients (id) on delete set null,
  requester_name    text,
  kind              text not null check (kind in ('access', 'correction', 'erasure')),
  details           text check (char_length(details) <= 2000),
  status            text not null default 'open' check (status in ('open', 'done', 'rejected')),
  resolved_at       timestamptz,
  resolved_by       uuid,
  resolved_by_name  text,
  resolution        text check (char_length(resolution) <= 1000)
);
create index if not exists privacy_requests_tenant_idx on public.privacy_requests (tenant_id, status, created_at desc);

create table if not exists public.consent_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  created_at  timestamptz not null default now(),
  profile_id  uuid references public.profiles (id) on delete set null,
  patient_id  uuid references public.patients (id) on delete set null,
  purpose     text not null,                       -- 'marketing' (health tips & offers)
  granted     boolean not null,
  source      text not null default 'portal'
);
create index if not exists consent_log_patient_idx on public.consent_log (tenant_id, patient_id, created_at desc);

do $rls$
declare t text;
begin
  foreach t in array array['privacy_requests', 'consent_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to anon, authenticated
                      using (tenant_id = (select public.current_tenant())) with check (tenant_id = (select public.current_tenant()))', t);
    execute format('drop policy if exists privacy_read on public.%I', t);
    -- the person themself, and the owner who answers the requests
    execute format('create policy privacy_read on public.%I for select to authenticated using (profile_id = (select auth.uid()) or public.has_role(''owner''))', t);
    execute format('drop trigger if exists trg_keep_tenant on public.%I', t);
    execute format('create trigger trg_keep_tenant before update of tenant_id on public.%I for each row execute function public.keep_tenant()', t);
  end loop;
end $rls$;

-- scheduled / custom messages to patients skip those who said no to health tips & offers
create or replace function public.patient_accepts_marketing(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not marketing_opt_out and erased_at is null from public.patients where id = p_patient), true)
$$;

-- ------------------------------------------------------------------ 7.1 privacy: the patient
-- everything this hospital holds about the signed-in person, as one JSON document (logged as a fulfilled access request)
create or replace function public.my_data_export()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pid uuid;
  r     jsonb;
  t     text;
  rows  jsonb;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select id into v_pid from public.patients where profile_id = v_uid and tenant_id = public.current_tenant();
  r := jsonb_build_object(
    'generated_at', now(),
    'hospital', (select name from public.tenants where id = public.current_tenant()),
    'account', (select to_jsonb(p) - 'tenant_id' from public.profiles p where p.id = v_uid),
    'patient', (select to_jsonb(x) - 'tenant_id' from public.patients x where x.id = v_pid));
  if v_pid is not null then
    foreach t in array array['appointments', 'prescriptions', 'lab_tests', 'admissions', 'invoices', 'payments', 'visit_feedback'] loop
      continue when to_regclass('public.' || t) is null;
      execute format('select coalesce(jsonb_agg(to_jsonb(x) - ''tenant_id'' order by x.created_at), ''[]''::jsonb) from public.%I x where x.patient_id = $1 and x.tenant_id = $2', t)
        into rows using v_pid, public.current_tenant();
      r := r || jsonb_build_object(t, rows);
    end loop;
  end if;
  r := r || jsonb_build_object(
    'consents', coalesce((select jsonb_agg(jsonb_build_object('at', c.created_at, 'purpose', c.purpose, 'granted', c.granted, 'source', c.source) order by c.created_at)
                            from public.consent_log c where c.profile_id = v_uid and c.tenant_id = public.current_tenant()), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('at', q.created_at, 'kind', q.kind, 'status', q.status, 'details', q.details, 'resolution', q.resolution) order by q.created_at)
                            from public.privacy_requests q where q.profile_id = v_uid and q.tenant_id = public.current_tenant()), '[]'::jsonb));
  perform set_config('app.privacy', 'on', true);
  insert into public.privacy_requests (profile_id, patient_id, requester_name, kind, details, status, resolved_at, resolution)
  values (v_uid, v_pid, (select full_name from public.profiles where id = v_uid), 'access', 'Downloaded from the patient portal', 'done', now(), 'Self-service download');
  perform set_config('app.privacy', '', true);
  return r;
end $$;

-- marketing (health tips & offers) consent — appointment and health messages are part of the service and always sent
create or replace function public.set_marketing_consent(p_granted boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select id into v_pid from public.patients where profile_id = auth.uid() and tenant_id = public.current_tenant();
  if v_pid is null then raise exception 'Only patients have this choice.'; end if;
  perform set_config('app.privacy', 'on', true);
  update public.patients set marketing_opt_out = not coalesce(p_granted, false), updated_at = now() where id = v_pid;
  insert into public.consent_log (profile_id, patient_id, purpose, granted, source) values (auth.uid(), v_pid, 'marketing', coalesce(p_granted, false), 'portal');
  perform set_config('app.privacy', '', true);
  return jsonb_build_object('marketing', coalesce(p_granted, false));
end $$;

-- ask the hospital to correct or erase my data (one open request of each kind); the owner is e-mailed
create or replace function public.privacy_submit(p_kind text, p_details text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_pid uuid; v_name text; o record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  -- friendly messages instead of raw "null value in column …" errors
  if public.current_tenant() is null then raise exception 'Your account is not linked to a hospital yet.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'patient') then
    raise exception 'Only patients can do this.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('correction', 'erasure') then raise exception 'Choose correction or erasure.'; end if;
  if p_kind = 'correction' and coalesce(trim(p_details), '') = '' then raise exception 'Tell us what is wrong and what it should say.'; end if;
  if exists (select 1 from public.privacy_requests where profile_id = auth.uid() and kind = p_kind and status = 'open' and tenant_id = public.current_tenant()) then
    raise exception 'You already have an open % request — the hospital will get back to you.', p_kind;
  end if;
  select id into v_pid from public.patients where profile_id = auth.uid() and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  perform set_config('app.privacy', 'on', true);
  insert into public.privacy_requests (profile_id, patient_id, requester_name, kind, details)
  values (auth.uid(), v_pid, v_name, p_kind, nullif(left(trim(coalesce(p_details, '')), 2000), '')) returning id into v_id;
  perform set_config('app.privacy', '', true);
  select * into o from public.tenant_owner_contact(public.current_tenant());
  if o.email is not null or o.profile_id is not null then
    perform public.notify_enqueue_raw('privacy_request',
      jsonb_build_object('subject', '{hospital}: new privacy request ({kind})',
        'text', 'A patient ({name}) asked for data {kind}. Please answer within 30 days: Privacy requests in the app.'),
      array['email', 'push'], null, o.email, o.profile_id, jsonb_build_object('kind', p_kind, 'name', coalesce(v_name, 'patient')), 'privacy_requests', v_id);
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ 7.1 privacy: erasure (anonymisation)
create or replace function public.erase_patient(p_patient uuid, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p public.patients; v_phone text;
begin
  select * into p from public.patients where id = p_patient for update;
  if not found then raise exception 'Patient not found'; end if;
  if p.erased_at is not null then return; end if;
  v_phone := right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10);
  perform set_config('app.skip_audit', 'on', true);
  perform set_config('app.privacy', 'on', true);
  update public.patients
     set full_name = 'Erased patient ' || p.mrn, phone = null, email = null, address = null, emergency_contact_name = null,
         emergency_contact_phone = null, insurance_provider = null,
         date_of_birth = case when p.date_of_birth is null then null else make_date(extract(year from p.date_of_birth)::int, 1, 1) end,
         marketing_opt_out = true, erased_at = now(), profile_id = null, updated_at = now()
   where id = p.id;
  update public.visit_feedback set comment = null where patient_id = p.id;
  if v_phone <> '' then
    delete from public.wa_sessions where right(regexp_replace(phone, '\D', '', 'g'), 10) = v_phone and tenant_id = p.tenant_id;
    delete from public.booking_otps where right(regexp_replace(phone, '\D', '', 'g'), 10) = v_phone and tenant_id = p.tenant_id;
    delete from public.site_enquiries where right(regexp_replace(phone, '\D', '', 'g'), 10) = v_phone and tenant_id = p.tenant_id;
  end if;
  -- the sign-in account goes (profile, devices, consents follow); clinical rows keep pointing at the anonymised patient
  if p.profile_id is not null then delete from auth.users where id = p.profile_id; end if;
  -- the audit trail keeps that something happened, not who it was about
  update public.audit_log set changes = jsonb_build_object('redacted', true), summary = 'Erased patient ' || p.mrn
   where record_id in (p.id, coalesce(p.profile_id, p.id));
  insert into public.audit_log (table_name, record_id, action, actor_id, actor_name, actor_role, summary, changes)
  values ('patients', p.id, 'update', auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), 'System'),
          coalesce((select role::text from public.profiles where id = auth.uid()), 'system'), 'Erased patient ' || p.mrn,
          jsonb_build_object('erased', jsonb_build_object('to', true), 'reason', jsonb_build_object('to', left(coalesce(p_reason, 'privacy request'), 200))));
  perform set_config('app.skip_audit', '', true);
  perform set_config('app.privacy', '', true);
end $$;

-- the owner answers a request: done / rejected (+ a note to the person). Erasure "done" anonymises the patient.
create or replace function public.privacy_resolve(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare q public.privacy_requests;
begin
  if not public.has_role('owner') then raise exception 'Only the owner answers privacy requests.' using errcode = '42501'; end if;
  if p_status not in ('done', 'rejected') then raise exception 'Mark it done or rejected.'; end if;
  select * into q from public.privacy_requests where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Request not found'; end if;
  if q.status <> 'open' then raise exception 'This request was already answered.'; end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'Say why — the person sees this note.'; end if;
  if q.kind = 'erasure' and p_status = 'done' then
    if q.patient_id is not null then perform public.erase_patient(q.patient_id, 'privacy request');
    elsif q.profile_id is not null then delete from auth.users where id = q.profile_id; end if;
  end if;
  perform set_config('app.privacy', 'on', true);
  update public.privacy_requests set status = p_status, resolved_at = now(), resolved_by = auth.uid(),
         resolved_by_name = (select full_name from public.profiles where id = auth.uid()), resolution = nullif(left(trim(coalesce(p_note, '')), 1000), '')
   where id = p_id;
  perform set_config('app.privacy', '', true);
  return (select to_jsonb(r) from public.privacy_requests r where r.id = p_id);
end $$;

-- ------------------------------------------------------------------ 7.3 offboarding
create table if not exists public.tenant_purges (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,          -- not "tenant_id": this platform table must stay out of the per-hospital loops
  slug            text not null,
  name            text not null,
  closed_at       timestamptz,
  close_reason    text,
  purged_at       timestamptz not null default now(),
  purged_by       uuid,
  purged_by_name  text,
  counts          jsonb not null default '{}'::jsonb,
  billing         jsonb not null default '[]'::jsonb      -- the platform's GST invoices to the hospital (kept 8 years)
);
alter table public.tenant_purges enable row level security;
revoke all on public.tenant_purges from anon, authenticated;
grant all on public.tenant_purges to service_role;

create or replace function public.cp_close_hospital(p_id uuid, p_reason text, p_days int default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants; o record;
begin
  perform public.cp_require(array['admin']);
  select * into t from public.tenants where id = p_id for update;
  if not found then raise exception 'Hospital not found'; end if;
  if t.is_primary then raise exception 'The platform''s own hospital can''t be closed.'; end if;
  if t.closing_at is not null then raise exception 'This hospital is already closing.'; end if;
  if coalesce(p_days, 0) not between 7 and 90 then raise exception 'Give the hospital 7 to 90 days to export its data.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Add the reason (it is kept with the record).'; end if;
  update public.tenants set closing_at = now(), purge_after = now() + make_interval(days => p_days), close_reason = left(trim(p_reason), 300), updated_at = now() where id = p_id;
  perform set_config('app.tenant_id', p_id::text, true);
  perform public.provider_log('hospital:close', t.slug, jsonb_build_object('reason', p_reason, 'days', p_days));
  select * into o from public.tenant_owner_contact(p_id);
  if o.email is not null or o.profile_id is not null then
    perform public.notify_enqueue_raw('hospital_closing',
      jsonb_build_object('subject', '{hospital}: your account is closing on {date}',
        'text', 'Your Hospital Comrade account for {hospital} is now read-only and will be deleted after {date}. Download your data before then: Settings → Data → Export all data.'),
      array['email', 'push'], null, o.email, o.profile_id,
      jsonb_build_object('date', to_char((now() + make_interval(days => p_days)) at time zone 'Asia/Kolkata', 'DD Mon YYYY')), 'tenants', p_id);
  end if;
  return public.cp_hospital(p_id);
end $$;

create or replace function public.cp_reopen_hospital(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants;
begin
  perform public.cp_require(array['admin']);
  select * into t from public.tenants where id = p_id for update;
  if not found or t.closing_at is null then raise exception 'This hospital is not closing.'; end if;
  update public.tenants set closing_at = null, purge_after = null, close_reason = null, updated_at = now() where id = p_id;
  perform set_config('app.tenant_id', p_id::text, true);
  perform public.provider_log('hospital:reopen', t.slug, null);
  return public.cp_hospital(p_id);
end $$;

-- delete everything of a closed hospital. Needs: admin, password typed in the last 10 minutes, the short name typed,
-- the notice period over. Keeps a tombstone with row counts and the platform's invoices to the hospital.
create or replace function public.cp_purge_hospital(p_id uuid, p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  t       public.tenants;
  v_tabs  text[];
  v_left  text[];
  tab     text;
  v_pass  int := 0;
  v_count jsonb := '{}'::jsonb;
  n       bigint;
begin
  perform public.cp_require(array['admin']);
  if not public.recent_reauth(600) then
    raise exception 'REAUTH_REQUIRED: Confirm your password to delete a hospital.' using errcode = '42501';
  end if;
  select * into t from public.tenants where id = p_id for update;
  if not found then raise exception 'Hospital not found'; end if;
  if t.is_primary then raise exception 'The platform''s own hospital can''t be deleted.'; end if;
  if t.closing_at is null then raise exception 'Close the hospital first — it gets time to export its data.'; end if;
  if t.purge_after > now() then raise exception 'The hospital can export its data until % — delete after that.', to_char(t.purge_after at time zone 'Asia/Kolkata', 'DD Mon YYYY'); end if;
  if coalesce(p_confirm, '') <> t.slug then raise exception 'Type the hospital''s short name (%) to confirm.', t.slug; end if;

  perform set_config('app.tenant_id', p_id::text, true);
  perform set_config('app.skip_audit', 'on', true);
  select array_agg(c.table_name::text order by c.table_name) into v_tabs
    from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name not in ('tenants', 'provider_audit');
  foreach tab in array v_tabs loop
    execute format('select count(*) from public.%I where tenant_id = $1', tab) into n using p_id;
    if n > 0 then v_count := v_count || jsonb_build_object(tab, n); end if;
  end loop;
  insert into public.tenant_purges (hospital_id, slug, name, closed_at, close_reason, purged_by, purged_by_name, counts, billing)
  values (t.id, t.slug, t.name, t.closing_at, t.close_reason, auth.uid(), (select full_name from public.profiles where id = auth.uid()), v_count,
          coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.billing_payments b where b.tenant_id = p_id and b.status in ('paid', 'refunded')), '[]'::jsonb));

  -- sign-in accounts first (a person belongs to one hospital), then the rows: tables referencing each other with
  -- ON DELETE RESTRICT are emptied children-first by retrying until nothing is left
  delete from auth.users where id in (select id from public.profiles where tenant_id = p_id) and id not in (select user_id from public.provider_users);
  v_left := v_tabs;
  while array_length(v_left, 1) > 0 and v_pass < 8 loop
    v_pass := v_pass + 1;
    v_tabs := v_left; v_left := '{}';
    foreach tab in array v_tabs loop
      begin
        execute format('delete from public.%I where tenant_id = $1', tab) using p_id;
      exception when foreign_key_violation or restrict_violation then v_left := v_left || tab;
      end;
    end loop;
  end loop;
  if array_length(v_left, 1) > 0 then raise exception 'Could not delete: %', array_to_string(v_left, ', '); end if;
  delete from public.tenants where id = p_id;
  perform set_config('app.skip_audit', '', true);
  perform public.provider_log('hospital:purge', t.slug, jsonb_build_object('name', t.name, 'counts', v_count));
  return jsonb_build_object('purged', t.slug, 'counts', v_count);
end $$;

-- ------------------------------------------------------------------ 7.4 incident register
create table if not exists public.platform_incidents (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  detected_at            timestamptz not null default now(),
  title                  text not null check (char_length(title) between 3 and 200),
  description            text check (char_length(description) <= 5000),
  severity               text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status                 text not null default 'open' check (status in ('open', 'contained', 'resolved')),
  personal_data          boolean not null default false,
  affected_tenants       uuid[] not null default '{}',
  affected_people        int check (affected_people >= 0),
  board_reported_at      timestamptz,
  hospitals_notified_at  timestamptz,
  resolved_at            timestamptz,
  timeline               jsonb not null default '[]'::jsonb,
  created_by             uuid,
  created_by_name        text
);
alter table public.platform_incidents enable row level security;
revoke all on public.platform_incidents from anon, authenticated;
grant all on public.platform_incidents to service_role;

create or replace function public.cp_incidents()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'support']);
  return coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object(
      'deadline', i.detected_at + interval '72 hours',
      'hospitals', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug) order by t.name) from public.tenants t where t.id = any (i.affected_tenants)), '[]'::jsonb))
      order by (i.status = 'resolved'), i.detected_at desc)
    from public.platform_incidents i), '[]'::jsonb);
end $$;

-- create (no id) or update an incident; "note" appends to the timeline; board_reported: true stamps the time
create or replace function public.cp_save_incident(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_name text := (select full_name from public.profiles where id = auth.uid()); i public.platform_incidents;
begin
  perform public.cp_require(array['admin']);
  if v_id is null then
    insert into public.platform_incidents (title, description, severity, personal_data, affected_tenants, affected_people, detected_at, created_by, created_by_name, timeline)
    values (trim(p ->> 'title'), p ->> 'description', coalesce(p ->> 'severity', 'medium'), coalesce((p ->> 'personal_data')::boolean, false),
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'affected_tenants', '[]'::jsonb)) x), '{}'),
            (p ->> 'affected_people')::int, coalesce((p ->> 'detected_at')::timestamptz, now()), auth.uid(), v_name,
            jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name, 'note', coalesce(nullif(p ->> 'note', ''), 'Incident recorded'))))
    returning id into v_id;
  else
    select * into i from public.platform_incidents where id = v_id for update;
    if not found then raise exception 'Incident not found'; end if;
    update public.platform_incidents set
      title = coalesce(nullif(trim(p ->> 'title'), ''), title),
      description = case when p ? 'description' then p ->> 'description' else description end,
      severity = coalesce(p ->> 'severity', severity),
      status = coalesce(p ->> 'status', status),
      personal_data = coalesce((p ->> 'personal_data')::boolean, personal_data),
      affected_tenants = case when p ? 'affected_tenants' then coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'affected_tenants') x), '{}') else affected_tenants end,
      affected_people = case when p ? 'affected_people' then (p ->> 'affected_people')::int else affected_people end,
      board_reported_at = case when coalesce((p ->> 'board_reported')::boolean, false) then coalesce(board_reported_at, now()) else board_reported_at end,
      resolved_at = case when p ->> 'status' = 'resolved' then coalesce(resolved_at, now()) when p ->> 'status' in ('open', 'contained') then null else resolved_at end,
      timeline = timeline || case when coalesce(p ->> 'note', '') <> '' or (p ->> 'status') is distinct from i.status and p ? 'status'
                                  then jsonb_build_array(jsonb_build_object('at', now(), 'by', v_name,
                                         'note', concat_ws(' — ', case when p ? 'status' and (p ->> 'status') <> i.status then 'Status: ' || (p ->> 'status') end, nullif(p ->> 'note', ''))))
                                  else '[]'::jsonb end,
      updated_at = now()
     where id = v_id;
  end if;
  perform public.provider_log('incident:save', v_id::text, p - 'description');
  return (select to_jsonb(x) from public.platform_incidents x where x.id = v_id);
end $$;

-- e-mail (+ push) the owners of the affected hospitals; returns who got it queued and who must be contacted by hand
create or replace function public.cp_notify_incident(p_id uuid, p_message text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare i public.platform_incidents; t record; o record; n int; r jsonb := '[]'::jsonb;
begin
  perform public.cp_require(array['admin']);
  select * into i from public.platform_incidents where id = p_id for update;
  if not found then raise exception 'Incident not found'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Write the notice: what happened, what data, what you are doing, what they should do.'; end if;
  if cardinality(i.affected_tenants) = 0 then raise exception 'Add the affected hospitals first.'; end if;
  for t in select id, name from public.tenants where id = any (i.affected_tenants) order by name loop
    perform set_config('app.tenant_id', t.id::text, true);
    select * into o from public.tenant_owner_contact(t.id);
    n := 0;
    if o.email is not null or o.profile_id is not null then
      n := public.notify_enqueue_raw('incident_notice', jsonb_build_object('subject', '{hospital}: security notice from Hospital Comrade', 'text', left(p_message, 3500)),
             array['email', 'push'], null, o.email, o.profile_id, jsonb_build_object('incident', i.id), 'platform_incidents', i.id);
    end if;
    r := r || jsonb_build_object('id', t.id, 'name', t.name, 'owner_email', o.email, 'queued', n);
  end loop;
  perform set_config('app.tenant_id', '', true);
  update public.platform_incidents set hospitals_notified_at = now(), updated_at = now(),
         timeline = timeline || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select full_name from public.profiles where id = auth.uid()),
                                                                      'note', 'Hospitals notified (' || jsonb_array_length(r) || ')'))
   where id = p_id;
  perform public.provider_log('incident:notify', p_id::text, jsonb_build_object('hospitals', r));
  return r;
end $$;

-- ------------------------------------------------------------------ 7.6 retention
insert into public.platform_settings (key, data) values ('retention', jsonb_build_object(
  'auditDays', 1095, 'providerAuditDays', 1095, 'outboxDays', 400, 'otpDays', 7, 'enquiryDays', 1095, 'leadDays', 1095,
  'privacyDays', 1095, 'waSessionDays', 30))
on conflict (key) do nothing;

create or replace function public.retention_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.platform_settings where key = 'retention'), '{}'::jsonb)
$$;

-- delete what is past its keep-by date (daily from the scheduler as dch-retention; a platform admin can run it too)
create or replace function public.run_retention()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  c   jsonb := public.retention_config();
  r   jsonb := '{}'::jsonb;
  r_s jsonb;
  n   bigint;
  d   int;
begin
  if auth.uid() is not null and coalesce(public.provider_role(), '') <> 'admin' then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('app.skip_audit', 'on', true);
  d := greatest(coalesce((c ->> 'auditDays')::int, 1095), 365);
  delete from public.audit_log where created_at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('audit_log', n);
  d := greatest(coalesce((c ->> 'providerAuditDays')::int, 1095), 365);
  delete from public.provider_audit where at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('provider_audit', n);
  d := greatest(coalesce((c ->> 'outboxDays')::int, 400), 30);
  delete from public.notification_outbox where created_at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('notification_outbox', n);
  d := greatest(coalesce((c ->> 'otpDays')::int, 7), 1);
  delete from public.booking_otps where created_at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('booking_otps', n);
  delete from public.password_reset_otps where created_at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('password_reset_otps', n);
  d := greatest(coalesce((c ->> 'enquiryDays')::int, 1095), 30);
  delete from public.site_enquiries where created_at < now() - make_interval(days => d) and status in ('resolved', 'spam'); get diagnostics n = row_count; r := r || jsonb_build_object('site_enquiries', n);
  d := greatest(coalesce((c ->> 'leadDays')::int, 1095), 30);
  delete from public.platform_leads where created_at < now() - make_interval(days => d) and status in ('won', 'lost'); get diagnostics n = row_count; r := r || jsonb_build_object('platform_leads', n);
  d := greatest(coalesce((c ->> 'privacyDays')::int, 1095), 365);
  delete from public.privacy_requests where status <> 'open' and resolved_at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('privacy_requests', n);
  d := greatest(coalesce((c ->> 'waSessionDays')::int, 30), 1);
  delete from public.wa_sessions where updated_at < now() - make_interval(days => d); get diagnostics n = row_count; r := r || jsonb_build_object('wa_sessions', n);
  -- self-service sign-ups (phase 8, signup.sql — loaded after this file)
  if to_regprocedure('public.signup_cleanup()') is not null then execute 'select public.signup_cleanup()' into r_s; r := r || jsonb_build_object('signups', r_s); end if;
  perform set_config('app.skip_audit', '', true);
  update public.platform_settings set data = data || jsonb_build_object('last_run', jsonb_build_object('at', now(), 'deleted', r)), updated_at = now() where key = 'retention';
  return r;
end $$;

create or replace function public.cp_retention()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return public.retention_config();
end $$;

create or replace function public.cp_save_retention(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare k text; v int;
  mins constant jsonb := '{"auditDays": 365, "providerAuditDays": 365, "outboxDays": 30, "otpDays": 1, "enquiryDays": 30, "leadDays": 30, "privacyDays": 365, "waSessionDays": 1}';
begin
  perform public.cp_require(array['admin']);
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if not (mins ? k) then raise exception 'Unknown setting %', k; end if;
    v := (p ->> k)::int;
    if v is null or v < (mins ->> k)::int or v > 3650 then raise exception '%: keep at least % days (at most 3650).', k, mins ->> k; end if;
  end loop;
  update public.platform_settings set data = data || (select jsonb_object_agg(key, (value #>> '{}')::int) from jsonb_each(p)), updated_at = now() where key = 'retention';
  perform public.provider_log('settings:retention', null, p);
  return public.retention_config();
end $$;

-- ------------------------------------------------------------------ 7.5 system health
create or replace function public.cp_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.cp_require(array['admin', 'support']);
  v_cron boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  v_net  boolean := exists (select 1 from pg_extension where extname = 'pg_net');
  v_jobs jsonb := '[]'::jsonb;
  v_db   bigint;
begin
  if v_cron then
    execute $q$ select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
              'last_run', d.start_time, 'last_status', d.status, 'last_message', left(d.return_message, 200)) order by j.jobname), '[]'::jsonb)
           from cron.job j
           left join lateral (select start_time, status, return_message from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true
          where j.jobname like 'dch-%' $q$ into v_jobs;
  end if;
  begin v_db := pg_database_size(current_database()); exception when others then v_db := null; end;
  return jsonb_build_object(
    'at', now(),
    'extensions', jsonb_build_object('pg_cron', v_cron, 'pg_net', v_net),
    'jobs', v_jobs,
    'messages', coalesce((select jsonb_agg(x order by (x ->> 'failed')::int desc, x ->> 'name') from (
        select jsonb_build_object('id', t.id, 'name', t.name,
          'sent', count(*) filter (where o.status = 'sent'), 'failed', count(*) filter (where o.status = 'failed'),
          'waiting', count(*) filter (where o.status in ('queued', 'sending')),
          'stuck', count(*) filter (where o.status in ('queued', 'sending') and o.created_at < now() - interval '15 minutes')) x
          from public.notification_outbox o join public.tenants t on t.id = o.tenant_id
         where o.created_at > now() - interval '24 hours' and (v_role = 'admin' or public.provider_can(t.id))
         group by t.id, t.name) s), '[]'::jsonb),
    'recent_failures', coalesce((select jsonb_agg(jsonb_build_object('at', o.created_at, 'hospital', t.name, 'event', o.event, 'channel', o.channel, 'error', left(o.error, 200)) order by o.created_at desc)
        from (select * from public.notification_outbox where status = 'failed' and created_at > now() - interval '7 days' order by created_at desc limit 20) o
        join public.tenants t on t.id = o.tenant_id where v_role = 'admin' or public.provider_can(t.id)), '[]'::jsonb),
    'payments', jsonb_build_object(
        'abandoned_7d', (select count(*) from public.billing_payments where status = 'created' and created_at between now() - interval '7 days' and now() - interval '1 hour'),
        'failed_7d', (select count(*) from public.billing_payments where status = 'failed' and created_at > now() - interval '7 days'),
        'paid_7d', (select count(*) from public.billing_payments where status = 'paid' and paid_at > now() - interval '7 days')),
    'database', jsonb_build_object('size_bytes', v_db,
        'largest_tables', case when v_role = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('table', c.relname, 'bytes', pg_total_relation_size(c.oid)) order by pg_total_relation_size(c.oid) desc)
            from (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
                  order by pg_total_relation_size(c.oid) desc limit 8) c), '[]'::jsonb) else '[]'::jsonb end),
    'hospitals', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'closing_at', t.closing_at, 'purge_after', t.purge_after,
          'patients', (select count(*) from public.patients p where p.tenant_id = t.id),
          'appointments', (select count(*) from public.appointments a where a.tenant_id = t.id),
          'invoices', (select count(*) from public.invoices i where i.tenant_id = t.id),
          'audit_log', (select count(*) from public.audit_log l where l.tenant_id = t.id)) order by t.is_primary desc, t.name)
        from public.tenants t where v_role = 'admin' or public.provider_can(t.id)), '[]'::jsonb),
    'retention', public.retention_config() -> 'last_run',
    'privacy_open', (select count(*) from public.privacy_requests where status = 'open'),
    'privacy_overdue', (select count(*) from public.privacy_requests where status = 'open' and created_at < now() - interval '30 days'),
    'incidents_open', (select count(*) from public.platform_incidents where status <> 'resolved'));
end $$;

-- ------------------------------------------------------------------ who may call what
revoke all on function public.recent_reauth(int), public.tenant_owner_contact(uuid), public.erase_patient(uuid, text),
  public.retention_config(), public.patient_accepts_marketing(uuid) from public, anon, authenticated;
grant execute on function public.run_retention(), public.patient_accepts_marketing(uuid) to service_role;
-- run_retention checks the caller itself (scheduler / service, or a platform admin from the panel)
revoke all on function public.run_retention() from public, anon;
grant execute on function public.run_retention() to authenticated;
revoke all on function public.my_data_export(), public.set_marketing_consent(boolean), public.privacy_submit(text, text), public.privacy_resolve(uuid, text, text),
  public.cp_close_hospital(uuid, text, int), public.cp_reopen_hospital(uuid), public.cp_purge_hospital(uuid, text), public.cp_incidents(),
  public.cp_save_incident(jsonb), public.cp_notify_incident(uuid, text), public.cp_retention(), public.cp_save_retention(jsonb), public.cp_health() from public, anon;
grant execute on function public.my_data_export(), public.set_marketing_consent(boolean), public.privacy_submit(text, text), public.privacy_resolve(uuid, text, text),
  public.cp_close_hospital(uuid, text, int), public.cp_reopen_hospital(uuid), public.cp_purge_hospital(uuid, text), public.cp_incidents(),
  public.cp_save_incident(jsonb), public.cp_notify_incident(uuid, text), public.cp_retention(), public.cp_save_retention(jsonb), public.cp_health() to authenticated;

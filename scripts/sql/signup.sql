-- =====================================================================================================
--  PHASE 8.2 — SELF-SERVICE FREE-TRIAL SIGN-UP (Hospital Comrade product page → /signup)
-- =====================================================================================================
--  • platform_settings 'signup' { enabled, mode: instant|approve, trialDays, plan, maxPerDay, unclaimedDays, platformUrl }
--    — the platform admin decides in the control panel (Settings → Free-trial sign-up).
--  • platform_trial_signup(p) — anyone (anon): validates, rate-limits, records the accepted Terms version and either
--    creates the hospital right away (instant) or waits for the admin (approve). The person then creates the owner
--    account on the new hospital with the same e-mail (app_settings 'bootstrap', as for panel-created hospitals).
--  • cp_signups / cp_signup_decide — the admin's list with approve / reject.
--  • signup_cleanup() (nightly, from run_retention): pending requests expire after 30 days; hospitals nobody claimed
--    within unclaimedDays are closed (the normal 7-day notice, then the admin may delete them).
--  Platform tables never use a column called tenant_id (the tenancy loops would scope them to a hospital).
-- =====================================================================================================

insert into public.platform_settings (key, data) values ('signup',
  '{"enabled": true, "mode": "approve", "trialDays": 14, "plan": "clinic", "maxPerDay": 25, "unclaimedDays": 14, "platformUrl": "", "otp": {"enabled": true, "channels": ["whatsapp", "sms"]}}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.platform_signups (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  organisation     text not null check (char_length(organisation) between 2 and 120),
  contact_name     text not null check (char_length(contact_name) between 2 and 100),
  email            text not null check (char_length(email) <= 150),
  phone            text not null check (char_length(phone) <= 20),
  city             text check (char_length(city) <= 80),
  plan             text not null,
  trial_days       int not null,
  slug             text not null,
  code             text not null,
  status           text not null default 'pending' check (status in ('pending', 'created', 'rejected', 'expired')),
  hospital_id      uuid references public.tenants (id) on delete set null,
  terms_version    text not null check (char_length(terms_version) between 1 and 20),
  ip_hash          text,
  decided_at       timestamptz,
  decided_by       uuid,
  decided_by_name  text,
  reason           text check (char_length(reason) <= 300)
);
create index if not exists platform_signups_status_idx on public.platform_signups (status, created_at desc);
create index if not exists platform_signups_email_idx on public.platform_signups (lower(email));
alter table public.platform_signups enable row level security;
revoke all on public.platform_signups from anon, authenticated;
grant all on public.platform_signups to service_role;

create or replace function public.signup_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select '{"enabled": true, "mode": "approve", "trialDays": 14, "plan": "clinic", "maxPerDay": 25, "unclaimedDays": 14, "platformUrl": "", "otp": {"enabled": true, "channels": ["whatsapp", "sms"]}}'::jsonb
      || coalesce((select data from public.platform_settings where key = 'signup'), '{}'::jsonb)
$$;

-- platform_signup_info(), platform_trial_signup() and cp_save_signup_settings(): scripts/sql/signup_otp.sql
--   (they include the mobile-number verification, which is defined after the platform outbox)

-- a free short name for the hospital, from its name: "City Care Clinic" → citycareclinic, citycareclinic-2, …
create or replace function public.signup_slug(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  base text := left(trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '', 'g')), 30);
  s    text;
  i    int := 1;
begin
  if char_length(base) < 3 then base := 'hospital'; end if;
  s := base;
  while s in ('main', 'www', 'app', 'api', 'admin', 'demo', 'mail', 'help', 'status', 'signup', 'legal', 'controlpanel')
     or exists (select 1 from public.tenants where slug = s)
     or exists (select 1 from public.platform_signups where slug = s and status = 'pending') loop
    i := i + 1;
    s := base || '-' || i;
  end loop;
  return s;
end $$;

-- record prefix from the initials: City Care Clinic → CCC, Apollo → APO
create or replace function public.signup_code(p_name text)
returns text language plpgsql immutable as $$
declare clean text := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', ' ', 'g')); v text;
begin
  select string_agg(left(w, 1), '') into v from regexp_split_to_table(trim(clean), '\s+') w where w <> '' and w not in ('THE', 'AND', 'OF', 'PVT', 'LTD');
  if char_length(coalesce(v, '')) < 2 then v := left(replace(clean, ' ', ''), 3); end if;
  v := left(coalesce(v, ''), 6);
  return case when char_length(v) >= 2 then v else 'HC' end;
end $$;

-- turns a sign-up request into a hospital (internal) and writes the welcome e-mail
create or replace function public.signup_activate(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.platform_signups; r jsonb;
begin
  select * into s from public.platform_signups where id = p_id for update;
  if not found or s.status <> 'pending' then raise exception 'This sign-up was already handled.'; end if;
  if exists (select 1 from public.tenants where slug = s.slug) then
    update public.platform_signups set slug = public.signup_slug(s.organisation) where id = p_id returning * into s;
  end if;
  r := public.hospital_create(jsonb_build_object('slug', s.slug, 'name', s.organisation, 'code', s.code, 'plan', s.plan,
         'owner_email', s.email, 'status', 'trial', 'trial_days', s.trial_days,
         'notes', 'Self-service sign-up · ' || s.contact_name || ' · ' || s.phone || coalesce(' · ' || nullif(s.city, ''), '') || ' · Terms ' || s.terms_version));
  update public.platform_signups set status = 'created', hospital_id = (r ->> 'id')::uuid where id = p_id;
  -- welcome e-mail (Hospital Comrade messaging; best effort — the sign-up page shows the same link)
  perform set_config('app.tenant_id', r ->> 'id', true);
  perform public.notify_enqueue_raw('signup_welcome',
    jsonb_build_object('subject', 'Your free trial of {hospital} is ready',
      'text', 'Namaste {name}, {hospital} is ready — free for {days} days. Create your owner account with this e-mail ({email}) here: {link} . After that, invite your team from Users & Roles. Reply to this e-mail if you need help.'),
    array['email'], s.phone, s.email, null,
    jsonb_build_object('name', split_part(regexp_replace(s.contact_name, '^(dr|mr|mrs|ms|shri|smt)\.?\s+', '', 'i'), ' ', 1),
      'hospital', s.organisation, 'days', s.trial_days, 'email', s.email, 'link', rtrim(coalesce(public.signup_config() ->> 'platformUrl', ''), '/') || '/register?hospital=' || s.slug),
    'tenants', (r ->> 'id')::uuid, null);
  return r;
end $$;


-- ------------------------------------------------------------------ control panel
create or replace function public.cp_signups(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return coalesce((select jsonb_agg(to_jsonb(s) - 'ip_hash' || jsonb_build_object(
      'hospital_slug', t.slug,
      'owner_joined', exists (select 1 from public.profiles p where p.tenant_id = s.hospital_id and p.role = 'owner'))
      order by (s.status = 'pending') desc, s.created_at desc)
    from (select * from public.platform_signups where p_status is null or status = p_status order by created_at desc limit 300) s
    left join public.tenants t on t.id = s.hospital_id), '[]'::jsonb);
end $$;

-- approve (creates the hospital) or reject a pending request
create or replace function public.cp_signup_decide(p_id uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.platform_signups; r jsonb;
begin
  perform public.cp_require(array['admin']);
  select * into s from public.platform_signups where id = p_id for update;
  if not found then raise exception 'Sign-up not found'; end if;
  if s.status <> 'pending' then raise exception 'This sign-up was already handled.'; end if;
  if p_action = 'approve' then
    r := public.signup_activate(p_id);
    perform set_config('app.tenant_id', '', true);
  elsif p_action = 'reject' then
    update public.platform_signups set status = 'rejected', reason = nullif(left(trim(coalesce(p_reason, '')), 300), '') where id = p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  update public.platform_signups set decided_at = now(), decided_by = auth.uid(), decided_by_name = (select full_name from public.profiles where id = auth.uid()) where id = p_id;
  perform public.provider_log('signup:' || p_action, s.organisation, jsonb_build_object('email', s.email, 'slug', r ->> 'slug', 'reason', p_reason));
  return (select to_jsonb(x) - 'ip_hash' from public.platform_signups x where x.id = p_id);
end $$;

create or replace function public.cp_signup_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  return public.signup_config() || jsonb_build_object('pending', (select count(*) from public.platform_signups where status = 'pending'));
end $$;


-- nightly (run_retention): expire old requests, close hospitals nobody claimed
create or replace function public.signup_cleanup()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c jsonb := public.signup_config(); n_exp bigint; n_close bigint := 0; r record;
begin
  update public.platform_signups set status = 'expired', reason = 'No decision within 30 days' where status = 'pending' and created_at < now() - interval '30 days';
  get diagnostics n_exp = row_count;
  for r in select s.id, s.hospital_id from public.platform_signups s join public.tenants t on t.id = s.hospital_id
            where s.status = 'created' and t.closing_at is null and not t.is_primary and t.paid_until is null
              and s.created_at < now() - make_interval(days => greatest(coalesce((c ->> 'unclaimedDays')::int, 14), 3))
              and not exists (select 1 from public.profiles p where p.tenant_id = s.hospital_id and p.role = 'owner') loop
    update public.tenants set closing_at = now(), purge_after = now() + interval '7 days', close_reason = 'Unclaimed free trial (self-service sign-up)', updated_at = now() where id = r.hospital_id;
    update public.platform_signups set status = 'expired', reason = 'Owner never signed up' where id = r.id;
    n_close := n_close + 1;
  end loop;
  delete from public.platform_signups where status in ('rejected', 'expired') and hospital_id is null
     and created_at < now() - make_interval(days => greatest(coalesce((public.retention_config() ->> 'leadDays')::int, 1095), 30));
  begin perform public.signup_otp_cleanup(); exception when undefined_function then null; end;   -- signup_otp.sql
  return jsonb_build_object('expired', n_exp, 'closed', n_close);
end $$;

revoke all on function public.signup_config(), public.signup_slug(text), public.signup_activate(uuid), public.signup_cleanup() from public, anon, authenticated;
revoke all on function public.cp_signups(text), public.cp_signup_decide(uuid, text, text), public.cp_signup_settings() from public, anon;
grant execute on function public.cp_signups(text), public.cp_signup_decide(uuid, text, text), public.cp_signup_settings() to authenticated;
grant execute on function public.signup_cleanup() to service_role;

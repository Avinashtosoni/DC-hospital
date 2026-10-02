-- Prefer the control panel (https://<PLATFORM_DOMAIN>/control-panel/) — this snippet is the fallback (e.g. the first admin).
-- ============================================================================================================
-- Hospital Comrade — make an account a platform team member (until the provider panel exists).
-- 1. The person signs up once anywhere (any hospital's address) with their work e-mail.
-- 2. Supabase → SQL editor → paste → edit the values marked ✏️ → Run.
-- admin: every hospital, full access (can switch to support / finance mode) · support: assigned hospitals, acts as owner
-- but patient records are read-only · finance: assigned hospitals, acts as accountant. Every switch is logged.
-- Checked by tests/sql/onboarding.test.ts.
-- ============================================================================================================
do $add_provider$
declare
  v_email     text   := 'support@hospitalcomrade.in';   -- ✏️ their account's e-mail
  v_role      text   := 'support';                      -- ✏️ admin | support | finance
  v_hospitals text[] := array['citycare'];              -- ✏️ hospital short names (admin: ignored, sees all)
  v_user      uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then raise exception 'No account with e-mail % — ask them to sign up first', v_email; end if;
  -- a platform account belongs to no hospital (its sign-up created a patient record there — removed)
  perform set_config('app.tenant_move', 'on', true);
  update public.profiles set tenant_id = null, role = 'patient' where id = v_user;
  delete from public.patients where profile_id = v_user;
  insert into public.provider_users (user_id, role) values (v_user, v_role)
  on conflict (user_id) do update set role = excluded.role, active = true;
  delete from public.provider_assignments where user_id = v_user;
  insert into public.provider_assignments (user_id, tenant_id)
  select v_user, t.id from public.tenants t where t.slug = any (v_hospitals);
  raise notice '% is now Hospital Comrade %', v_email, v_role;
end $add_provider$;

-- ============================================================================================================
-- Hospital Comrade — add a hospital (until the provider panel exists). Supabase → SQL editor → paste → edit the
-- values marked ✏️ → Run. Then send the owner to the hospital's address to sign up with the owner e-mail: that
-- account becomes the hospital's owner (everyone else who signs up there becomes a patient of that hospital).
-- Needs TENANCY=multi in the app. Checked by tests/sql/onboarding.test.ts.
-- ============================================================================================================
do $add_hospital$
declare
  v_slug    text  := 'citycare';                              -- ✏️ short name: a-z, 0-9, '-' (address ?hospital=citycare)
  v_name    text  := 'City Care Clinic';                      -- ✏️ hospital name
  v_code    text  := 'CCC';                                   -- ✏️ MRN / invoice prefix, 2–6 capital letters (CCC-100001)
  v_plan    text  := 'clinic';                                -- ✏️ clinic | hospital | enterprise | custom
  v_status  text  := 'trial';                                 -- ✏️ trial | active
  v_domain  text  := 'citycare.hospital.digitalcomrade.in';   -- ✏️ the hospital's address ('' = none yet, use ?hospital=)
  v_owner   text  := 'owner@citycare.in';                     -- ✏️ e-mail of the first owner
  -- settings the owner may change; anything not listed is managed by the platform team and hidden from the hospital
  -- modules: general, appearance, dashboard, notifications, forms, security, data, cms
  v_modules jsonb := '{"dashboard": "hospital", "forms": "hospital", "notifications": "hospital", "security": "hospital"}';   -- ✏️
  v_id      uuid;
begin
  insert into public.tenants (slug, name, code, plan, status, modules)
  values (lower(v_slug), v_name, upper(v_code), v_plan, v_status, v_modules)
  returning id into v_id;
  if coalesce(v_domain, '') <> '' then
    insert into public.tenant_domains (domain, tenant_id, is_primary) values (lower(v_domain), v_id, true);
  end if;
  insert into public.app_settings (tenant_id, key, data) values (v_id, 'bootstrap', jsonb_build_object('owner_email', lower(v_owner)));
  perform public.seed_hospital_defaults(v_id);   -- built-in website forms + the name on its website
  raise notice 'Added % (id %). Owner: sign up at https://% with %', v_name, v_id, coalesce(nullif(v_domain, ''), '<app>/?hospital=' || v_slug), v_owner;
end $add_hospital$;

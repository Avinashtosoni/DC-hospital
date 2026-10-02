-- =====================================================================================================
--  17. WEBSITE FORMS (idempotent; also shipped in supabase/upgrade-2026-10.sql)
--
--  Settings → Forms: the owner manages the Contact form, the Patient review form and any custom form
--  (callback request, job application, health camp…). Every submission lands in the Enquiries inbox
--  (site_enquiries) with the form it came from (form_id, form_name) and all its answers (data).
--    site_forms                       owner: full access · receptionist: read · visitors: enabled forms only
--    submit_site_form(form, answers)  the only way visitors submit a form — validates every answer against the
--                                     form's fields (same rules as src/forms/schema.ts) and returns the reference
--  Older messages (sent before forms existed) are filed under the Contact form.
-- =====================================================================================================

create table if not exists public.site_forms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 500),
  kind        text not null default 'custom' check (kind in ('contact', 'review', 'custom')),
  enabled     boolean not null default true,
  fields      jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- tables created by this section get their hospital column right away (functions below refer to it)
select public.ensure_tenant_columns();
drop trigger if exists trg_site_forms_updated_at on public.site_forms;
create trigger trg_site_forms_updated_at before update on public.site_forms
  for each row execute function public.set_updated_at();

alter table public.site_enquiries add column if not exists form_id uuid;
alter table public.site_enquiries add column if not exists form_name text;
alter table public.site_enquiries add column if not exists data jsonb;
create index if not exists site_enquiries_form_id_created_at_idx on public.site_enquiries (form_id, created_at desc);

-- built-in forms (kept as edited if they already exist)
-- @@DEFAULT_FORMS@@

-- messages without a form (older app versions, staff-added) belong to the Contact form
create or replace function public.site_enquiry_default_form()
returns trigger language plpgsql as $$
begin
  if new.form_id is null then
    -- this hospital's Contact form
    select id, coalesce(new.form_name, name) into new.form_id, new.form_name
      from public.site_forms where kind = 'contact' and tenant_id = new.tenant_id order by sort, created_at limit 1;
    new.form_name := coalesce(new.form_name, 'Contact form');
  end if;
  return new;
end $$;
drop trigger if exists trg_site_enquiries_form on public.site_enquiries;
create trigger trg_site_enquiries_form before insert on public.site_enquiries
  for each row execute function public.site_enquiry_default_form();
revoke all on function public.site_enquiry_default_form() from public, anon, authenticated;

update public.site_enquiries
   set form_id = 'f0000000-0000-4000-8000-000000000001', form_name = coalesce(form_name, 'Contact form')
 where form_id is null;

-- RLS (same names as the generated policies in master.sql, so re-running is harmless)
alter table public.site_forms enable row level security;
drop policy if exists site_forms_select on public.site_forms;
drop policy if exists site_forms_insert on public.site_forms;
drop policy if exists site_forms_update on public.site_forms;
drop policy if exists site_forms_delete on public.site_forms;
drop policy if exists site_forms_public_read on public.site_forms;
create policy site_forms_select on public.site_forms for select to authenticated
  using (public.has_role('owner', 'receptionist'));
create policy site_forms_insert on public.site_forms for insert to authenticated
  with check (public.has_role('owner'));
create policy site_forms_update on public.site_forms for update to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy site_forms_delete on public.site_forms for delete to authenticated
  using (public.has_role('owner'));
create policy site_forms_public_read on public.site_forms for select to anon, authenticated
  using (enabled);

-- direct inserts (older app versions) can't fake form answers; forms go through submit_site_form()
drop policy if exists site_enquiries_public_insert on public.site_enquiries;
create policy site_enquiries_public_insert on public.site_enquiries for insert to anon, authenticated
  with check (status = 'new' and notes is null and starred = false and read_at is null and data is null);

grant select on public.site_forms to anon;
grant select, insert, update, delete on public.site_forms to authenticated;

-- one submission → one inbox message. Mirrors validateAnswers() + toEnquiry() in src/forms/schema.ts.
create or replace function public.submit_site_form(p_form uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  f        public.site_forms;
  fld      jsonb;
  v        jsonb;
  s        text;
  t        text;
  r        text;
  lbl      text;
  opts     jsonb;
  is_empty boolean;
  req      boolean;
  err      text;
  v_data   jsonb := '[]'::jsonb;
  v_lines  text[] := '{}';
  v_name   text := '';
  v_phone  text := '';
  v_email  text := '';
  v_topic  text := '';
  v_spec   text := '';
  v_msg    text := '';
  v_ref    text;
begin
  select * into f from public.site_forms where id = p_form and enabled and tenant_id = public.current_tenant();
  if not found then raise exception 'This form is not available any more. Please refresh the page.'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Please fill in the form.'; end if;

  for fld in select value from jsonb_array_elements(f.fields) loop
    t := fld ->> 'type';
    r := fld ->> 'role';
    lbl := coalesce(fld ->> 'label', 'This field');
    v := p_answers -> (fld ->> 'id');
    if v is not null and jsonb_typeof(v) = 'null' then v := null; end if;
    req := coalesce((fld ->> 'required')::boolean, false) or r in ('name', 'phone');
    opts := case when jsonb_typeof(fld -> 'options') = 'array' then fld -> 'options' else '[]'::jsonb end;

    if v is null then s := '';
    elsif jsonb_typeof(v) = 'array' then s := coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(v) x), '');
    elsif jsonb_typeof(v) = 'string' then s := v #>> '{}';
    elsif jsonb_typeof(v) in ('number', 'boolean') then s := v::text;
    else raise exception '%: invalid answer', lbl;
    end if;
    s := btrim(s);

    if t = 'consent' then is_empty := v is distinct from 'true'::jsonb;
    elsif t = 'checkboxes' then
      if v is not null and jsonb_typeof(v) <> 'array' then raise exception '%: invalid answer', lbl; end if;
      is_empty := v is null or jsonb_array_length(v) = 0;
    else is_empty := s = '';
    end if;

    if is_empty then
      if req then
        raise exception '%', case t when 'consent' then 'Please accept: ' || lbl when 'rating' then 'Please choose a rating' else lbl || ' is required' end;
      end if;
      continue;
    end if;

    err := null;
    case t
      when 'text' then
        if char_length(s) > 200 then err := 'keep it under 200 characters';
        elsif r = 'name' and char_length(s) < 2 then err := 'please enter your full name'; end if;
      when 'textarea' then
        if char_length(s) > 2000 then err := 'keep it under 2000 characters';
        elsif r = 'message' and req and char_length(s) < 10 then err := 'tell us a little more (at least 10 characters)'; end if;
      when 'email' then
        if s !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(s) > 200 then err := 'enter a valid email address'; end if;
      when 'phone' then
        if right(regexp_replace(s, '\D', '', 'g'), 10) !~ '^[6-9][0-9]{9}$' or s !~ '^[0-9\s+-]+$' then err := 'enter a valid 10-digit mobile number'; end if;
      when 'number' then
        if s !~ '^-?[0-9]{1,12}(\.[0-9]{1,4})?$' then err := 'enter a number'; end if;
      when 'date' then
        if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then err := 'pick a date'; end if;
      when 'rating' then
        if s not in ('1', '2', '3', '4', '5') then err := 'please choose a rating'; end if;
      when 'select', 'radio' then
        if jsonb_array_length(opts) > 0 and not opts ? s then err := 'please choose one of the options';
        elsif char_length(s) > 120 then err := 'invalid choice'; end if;
      when 'checkboxes' then
        if jsonb_array_length(opts) > 0 and exists (select 1 from jsonb_array_elements_text(v) x where not opts ? x) then err := 'please choose from the options';
        elsif char_length(s) > 1000 then err := 'too many choices'; end if;
      when 'consent' then null;
      else err := 'unsupported field';
    end case;
    if err is not null then raise exception '%: %', lbl, err; end if;

    v_data := v_data || jsonb_build_array(jsonb_build_object('id', fld ->> 'id', 'label', lbl, 'type', t, 'value',
      case when t = 'checkboxes' then (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(v) x)
           when t in ('rating', 'number') then to_jsonb(s::numeric)
           when t = 'consent' then 'true'::jsonb
           else to_jsonb(s) end));

    case r
      when 'name' then v_name := s;
      when 'phone' then v_phone := s;
      when 'email' then v_email := s;
      when 'topic' then v_topic := s;
      when 'speciality' then v_spec := s;
      when 'message' then v_msg := s;
      else null;
    end case;
    if (r is null or r not in ('name', 'phone', 'email', 'topic', 'speciality')) and t <> 'consent' then
      v_lines := v_lines || (lbl || ': ' || case when t = 'rating' then s || '/5' else s end);
    end if;
  end loop;

  if v_name = '' or v_phone = '' then raise exception 'This form is missing its name or mobile field. Please contact the hospital.'; end if;

  insert into public.site_enquiries (name, phone, email, topic, speciality, message, form_id, form_name, data)
  values (left(v_name, 120), v_phone, nullif(v_email, ''),
          left(coalesce(nullif(v_topic, ''), nullif(btrim(f.settings ->> 'topic'), ''), f.name), 80),
          nullif(left(v_spec, 80), ''),
          left(coalesce(nullif(v_msg, ''), nullif(array_to_string(v_lines, E'\n'), ''), f.name), 2000),
          f.id, f.name, v_data)
  returning ref into v_ref;
  return jsonb_build_object('ref', v_ref);
end $$;

revoke all on function public.submit_site_form(uuid, jsonb) from public;
grant execute on function public.submit_site_form(uuid, jsonb) to anon, authenticated;

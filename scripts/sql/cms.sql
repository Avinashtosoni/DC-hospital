-- =====================================================================================================
--  8. WEBSITE CMS
--  Content for the public website, edited by the hospital owner from Dashboard → Website CMS.
--  Unlike the tables above, these are NOT dropped when you re-run this file — your website edits,
--  version history and uploaded images are kept. (To start over, delete the rows from site_content.)
--
--  site_content            one row per section (settings, home, about, doctors, …) → jsonb document.
--                          Missing rows fall back to the defaults shipped with the app.
--  site_content_revisions  the previous version of a section, saved automatically on every publish/reset.
--  storage "site-media"    public bucket for images uploaded from the CMS media library.
-- =====================================================================================================
create table if not exists public.site_content (
  key              text primary key check (key ~ '^[a-zA-Z]{2,40}$'),
  data             jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text
);

create table if not exists public.site_content_revisions (
  id               uuid primary key default gen_random_uuid(),
  key              text not null,
  data             jsonb not null,
  created_at       timestamptz not null default now(),
  created_by_name  text
);
create index if not exists site_content_revisions_key_idx on public.site_content_revisions (key, created_at desc);

-- 8a. stamp who/when on every write (the client never sends these)
drop function if exists public.site_content_stamp() cascade;
create function public.site_content_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce((select full_name from public.profiles where id = auth.uid()), 'Database');
  return new;
end $$;
create trigger trg_site_content_stamp before insert or update on public.site_content
  for each row execute function public.site_content_stamp();

-- 8b. keep the replaced version in the history (latest 30 per section)
drop function if exists public.site_content_revision() cascade;
create function public.site_content_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.data = old.data then return new; end if;
  insert into public.site_content_revisions (key, data, created_at, created_by_name)
  values (old.key, old.data, old.updated_at, old.updated_by_name);
  delete from public.site_content_revisions r
  where r.key = old.key
    and r.id not in (select id from public.site_content_revisions where key = old.key order by created_at desc limit 30);
  return coalesce(new, old);
end $$;
create trigger trg_site_content_revision after update or delete on public.site_content
  for each row execute function public.site_content_revision();

-- 8c. row level security
alter table public.site_content enable row level security;
alter table public.site_content_revisions enable row level security;

drop policy if exists site_content_public_read on public.site_content;
drop policy if exists site_content_owner_insert on public.site_content;
drop policy if exists site_content_owner_update on public.site_content;
drop policy if exists site_content_owner_delete on public.site_content;
drop policy if exists site_content_revisions_owner_read on public.site_content_revisions;

create policy site_content_public_read on public.site_content for select to anon, authenticated using (true);
create policy site_content_owner_insert on public.site_content for insert to authenticated with check (public.has_role('owner'));
create policy site_content_owner_update on public.site_content for update to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));
create policy site_content_owner_delete on public.site_content for delete to authenticated using (public.has_role('owner'));
create policy site_content_revisions_owner_read on public.site_content_revisions for select to authenticated using (public.has_role('owner'));

-- Contact form: anyone (signed in or not) may send a *new* enquiry, but only staff can read them (policies above).
drop policy if exists site_enquiries_public_insert on public.site_enquiries;
create policy site_enquiries_public_insert on public.site_enquiries for insert to anon, authenticated
  with check (status = 'new' and notes is null and starred = false and read_at is null);

revoke all on public.site_content, public.site_content_revisions from anon;
grant select on public.site_content to anon;
grant select, insert, update, delete on public.site_content to authenticated;
revoke all on public.site_content_revisions from authenticated;
grant select on public.site_content_revisions to authenticated;
grant insert on public.site_enquiries to anon;

-- 8d. media bucket (public read, owner-only write). Images are resized to WebP in the browser before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists site_media_public_read on storage.objects;
drop policy if exists site_media_owner_insert on storage.objects;
drop policy if exists site_media_owner_update on storage.objects;
drop policy if exists site_media_owner_delete on storage.objects;
create policy site_media_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'site-media');
create policy site_media_owner_insert on storage.objects for insert to authenticated with check (bucket_id = 'site-media' and public.has_role('owner'));
create policy site_media_owner_update on storage.objects for update to authenticated using (bucket_id = 'site-media' and public.has_role('owner'));
create policy site_media_owner_delete on storage.objects for delete to authenticated using (bucket_id = 'site-media' and public.has_role('owner'));

-- 8e. profile photos: public read; each user writes only inside their own "<user id>/" folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists avatars_own_insert on storage.objects;
drop policy if exists avatars_own_update on storage.objects;
drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy avatars_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================================================
--  PLATFORM WEBSITE CMS  (control panel → Website)
--  The Hospital Comrade product site on PLATFORM_DOMAIN: pages, legal pages and the blog. Not per hospital —
--  these tables have no tenant_id. Re-running keeps every edit, revision, post and image.
--
--  platform_content            one row per page key (home, features, legal, …): published `data` + unpublished `draft`.
--                              A key with no row (or no published data) shows the defaults shipped with the app.
--  platform_content_revisions  the previous published version, saved on every publish / reset (latest 30 per key).
--  platform_posts              blog articles (draft / published).
--  storage "platform-media"    public images uploaded from the panel (platform admins only).
--
--  Reading: anyone, through platform_site() / platform_blog() / platform_blog_post() — published content only;
--  drafts only for the platform team (preview). Writing: platform admins (support can look, not change).
-- =====================================================================================================
create table if not exists public.platform_content (
  key           text primary key check (key ~ '^[a-z]{2,30}$'),
  data          jsonb,
  draft         jsonb,
  published_at  timestamptz,
  published_by  text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create table if not exists public.platform_content_revisions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists platform_content_revisions_key_idx on public.platform_content_revisions (key, created_at desc);

create table if not exists public.platform_posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title         text not null check (length(btrim(title)) between 3 and 160),
  excerpt       text not null default '' check (length(excerpt) <= 400),
  cover         text check (cover is null or cover ~ '^(https://|/)'),
  body          text not null default '' check (length(body) <= 100000),
  tags          text[] not null default '{}',
  author        text check (author is null or length(author) <= 80),
  status        text not null default 'draft' check (status in ('draft', 'published')),
  published_at  timestamptz,
  seo           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create index if not exists platform_posts_published_idx on public.platform_posts (status, published_at desc);

-- only through the functions below
alter table public.platform_content enable row level security;
alter table public.platform_content_revisions enable row level security;
alter table public.platform_posts enable row level security;
revoke all on public.platform_content, public.platform_content_revisions, public.platform_posts from public, anon, authenticated;
grant all on public.platform_content, public.platform_content_revisions, public.platform_posts to service_role;

-- the page keys the site knows (keeps typos and junk out)
create or replace function public.platform_page_keys()
returns text[] language sql immutable as $$
  select array['brand', 'home', 'features', 'pricing', 'solutions', 'security', 'about', 'contact', 'faq', 'blog', 'legal']
$$;

create or replace function public.platform_me_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), (select email from auth.users where id = auth.uid()), 'Platform')
$$;

-- ------------------------------------------------------------------ public reading
-- every published page as { key: data }; p_preview = drafts too (platform team only — others get published)
create or replace function public.platform_site(p_preview boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_draft boolean := coalesce(p_preview, false) and public.provider_role() is not null;
begin
  return coalesce((
    select jsonb_object_agg(key, case when v_draft then coalesce(draft, data) else data end)
      from public.platform_content
     where (case when v_draft then coalesce(draft, data) else data end) is not null
  ), '{}'::jsonb);
end $$;

create or replace function public.platform_blog(p_tag text default null, p_offset int default 0, p_limit int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_limit int := least(greatest(coalesce(p_limit, 12), 1), 50); v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'total', (select count(*) from public.platform_posts where status = 'published' and published_at <= now() and (p_tag is null or p_tag = any (tags))),
    'tags', coalesce((select jsonb_agg(t order by t) from (select distinct unnest(tags) t from public.platform_posts where status = 'published' and published_at <= now()) x), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'excerpt', excerpt, 'cover', cover, 'tags', tags, 'author', author, 'published_at', published_at) order by published_at desc)
        from (select * from public.platform_posts
               where status = 'published' and published_at <= now() and (p_tag is null or p_tag = any (tags))
               order by published_at desc offset v_off limit v_limit) p
    ), '[]'::jsonb));
end $$;

create or replace function public.platform_blog_post(p_slug text, p_preview boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.platform_posts; v_draft boolean := coalesce(p_preview, false) and public.provider_role() is not null;
begin
  select * into p from public.platform_posts where slug = lower(p_slug) and (v_draft or (status = 'published' and published_at <= now()));
  if not found then return null; end if;
  return jsonb_build_object('slug', p.slug, 'title', p.title, 'excerpt', p.excerpt, 'cover', p.cover, 'body', p.body, 'tags', p.tags,
    'author', p.author, 'status', p.status, 'published_at', p.published_at, 'updated_at', p.updated_at, 'seo', p.seo);
end $$;

-- ------------------------------------------------------------------ control panel: pages
create or replace function public.cp_site()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text := public.cp_require(array['admin', 'support']);
begin
  return jsonb_build_object('canEdit', r = 'admin', 'pages', coalesce((
    select jsonb_agg(jsonb_build_object('key', key, 'data', data, 'draft', draft, 'published_at', published_at, 'published_by', published_by,
      'updated_at', updated_at, 'updated_by', updated_by) order by key) from public.platform_content), '[]'::jsonb));
end $$;

-- save a draft, or publish (p_publish) — publishing keeps the replaced version in the history
create or replace function public.cp_site_save(p_key text, p_data jsonb, p_publish boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_old public.platform_content; v_name text := public.platform_me_name(); v_row public.platform_content;
begin
  perform public.cp_require(array['admin']);
  if p_key is null or not (p_key = any (public.platform_page_keys())) then raise exception 'Unknown page "%".', p_key using errcode = '22023'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Page content must be an object.' using errcode = '22023'; end if;
  if length(p_data::text) > 300000 then raise exception 'This page is too large (over 300 KB). Shorten it or split it up.' using errcode = '22023'; end if;

  select * into v_old from public.platform_content where key = p_key for update;
  if coalesce(p_publish, false) then
    if v_old.data is not null and v_old.data is distinct from p_data then
      insert into public.platform_content_revisions (key, data, created_at, created_by) values (p_key, v_old.data, coalesce(v_old.published_at, v_old.updated_at), v_old.published_by);
    end if;
    insert into public.platform_content as c (key, data, draft, published_at, published_by, updated_at, updated_by)
    values (p_key, p_data, null, now(), v_name, now(), v_name)
    on conflict (key) do update set data = excluded.data, draft = null, published_at = now(), published_by = v_name, updated_at = now(), updated_by = v_name
    returning * into v_row;
  else
    insert into public.platform_content as c (key, draft, updated_at, updated_by) values (p_key, p_data, now(), v_name)
    on conflict (key) do update set draft = excluded.draft, updated_at = now(), updated_by = v_name
    returning * into v_row;
  end if;
  delete from public.platform_content_revisions
   where key = p_key and id not in (select id from public.platform_content_revisions where key = p_key order by created_at desc limit 30);
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (auth.uid(), v_name, 'admin', case when coalesce(p_publish, false) then 'site:publish' else 'site:draft' end, p_key, '{}'::jsonb);
  return to_jsonb(v_row);
end $$;

create or replace function public.cp_site_discard(p_key text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin']);
  update public.platform_content set draft = null, updated_at = now(), updated_by = public.platform_me_name() where key = p_key;
  delete from public.platform_content where key = p_key and data is null and draft is null;
end $$;

-- back to the built-in text (the published version goes to the history)
create or replace function public.cp_site_reset(p_key text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_old public.platform_content;
begin
  perform public.cp_require(array['admin']);
  select * into v_old from public.platform_content where key = p_key for update;
  if not found then return; end if;
  if v_old.data is not null then
    insert into public.platform_content_revisions (key, data, created_at, created_by) values (p_key, v_old.data, coalesce(v_old.published_at, v_old.updated_at), v_old.published_by);
  end if;
  delete from public.platform_content where key = p_key;
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (auth.uid(), public.platform_me_name(), 'admin', 'site:reset', p_key, '{}'::jsonb);
end $$;

create or replace function public.cp_site_history(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'support']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'key', key, 'data', data, 'created_at', created_at, 'created_by', created_by) order by created_at desc)
    from (select * from public.platform_content_revisions where key = p_key order by created_at desc limit 20) r), '[]'::jsonb);
end $$;

-- an old version becomes the draft (review it, then publish)
create or replace function public.cp_site_restore(p_rev uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.platform_content_revisions;
begin
  perform public.cp_require(array['admin']);
  select * into v from public.platform_content_revisions where id = p_rev;
  if not found then raise exception 'That version no longer exists.' using errcode = 'P0002'; end if;
  return public.cp_site_save(v.key, v.data, false);
end $$;

-- ------------------------------------------------------------------ control panel: blog
create or replace function public.cp_posts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(array['admin', 'support']);
  return coalesce((select jsonb_agg(to_jsonb(p) order by coalesce(p.published_at, p.updated_at) desc) from (select * from public.platform_posts order by updated_at desc limit 500) p), '[]'::jsonb);
end $$;

create or replace function public.cp_save_post(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_slug text := lower(btrim(coalesce(p->>'slug', '')));
  v_status text := coalesce(nullif(p->>'status', ''), 'draft');
  v_pub timestamptz := nullif(p->>'published_at', '')::timestamptz;
  v_tags text[];
  v_name text := public.platform_me_name();
  v_row public.platform_posts;
begin
  perform public.cp_require(array['admin']);
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 80 then
    raise exception 'The web address (slug) may only have small letters, numbers and dashes — e.g. "gst-for-clinics".' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p->>'title', ''))) < 3 then raise exception 'Give the article a title.' using errcode = '22023'; end if;
  if v_status not in ('draft', 'published') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if coalesce(p->>'cover', '') <> '' and p->>'cover' !~ '^(https://|/)' then raise exception 'The cover image must be an https:// link.' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct left(lower(btrim(t)), 30)) filter (where btrim(t) <> ''), '{}') into v_tags
    from jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb)) t;
  if v_status = 'published' and v_pub is null then v_pub := now(); end if;
  if exists (select 1 from public.platform_posts where slug = v_slug and id is distinct from v_id) then
    raise exception 'Another article already uses the address "%".', v_slug using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.platform_posts (slug, title, excerpt, cover, body, tags, author, status, published_at, seo, updated_by)
    values (v_slug, btrim(p->>'title'), coalesce(p->>'excerpt', ''), nullif(p->>'cover', ''), coalesce(p->>'body', ''), v_tags,
            nullif(btrim(coalesce(p->>'author', '')), ''), v_status, v_pub, coalesce(p->'seo', '{}'::jsonb), v_name)
    returning * into v_row;
  else
    update public.platform_posts set slug = v_slug, title = btrim(p->>'title'), excerpt = coalesce(p->>'excerpt', ''), cover = nullif(p->>'cover', ''),
      body = coalesce(p->>'body', ''), tags = v_tags, author = nullif(btrim(coalesce(p->>'author', '')), ''), status = v_status, published_at = v_pub,
      seo = coalesce(p->'seo', '{}'::jsonb), updated_at = now(), updated_by = v_name
     where id = v_id returning * into v_row;
    if not found then raise exception 'Article not found.' using errcode = 'P0002'; end if;
  end if;
  insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
  values (auth.uid(), v_name, 'admin', 'blog:save', v_row.slug, jsonb_build_object('status', v_row.status));
  return to_jsonb(v_row);
end $$;

create or replace function public.cp_delete_post(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_slug text;
begin
  perform public.cp_require(array['admin']);
  delete from public.platform_posts where id = p_id returning slug into v_slug;
  if v_slug is not null then
    insert into public.provider_audit (user_id, user_name, mode, action, target, detail)
    values (auth.uid(), public.platform_me_name(), 'admin', 'blog:delete', v_slug, '{}'::jsonb);
  end if;
end $$;

-- ------------------------------------------------------------------ media (public read, platform admins write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('platform-media', 'platform-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists platform_media_public_read on storage.objects;
drop policy if exists platform_media_admin_insert on storage.objects;
drop policy if exists platform_media_admin_update on storage.objects;
drop policy if exists platform_media_admin_delete on storage.objects;
create policy platform_media_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'platform-media');
create policy platform_media_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'platform-media' and public.provider_role() = 'admin');
create policy platform_media_admin_update on storage.objects for update to authenticated using (bucket_id = 'platform-media' and public.provider_role() = 'admin');
create policy platform_media_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'platform-media' and public.provider_role() = 'admin');

revoke all on function public.platform_me_name(), public.cp_site(), public.cp_site_save(text, jsonb, boolean), public.cp_site_discard(text),
  public.cp_site_reset(text), public.cp_site_history(text), public.cp_site_restore(uuid), public.cp_posts(), public.cp_save_post(jsonb),
  public.cp_delete_post(uuid) from public, anon;
grant execute on function public.cp_site(), public.cp_site_save(text, jsonb, boolean), public.cp_site_discard(text), public.cp_site_reset(text),
  public.cp_site_history(text), public.cp_site_restore(uuid), public.cp_posts(), public.cp_save_post(jsonb), public.cp_delete_post(uuid) to authenticated;
grant execute on function public.platform_site(boolean), public.platform_blog(text, int, int), public.platform_blog_post(text, boolean),
  public.platform_page_keys() to anon, authenticated;

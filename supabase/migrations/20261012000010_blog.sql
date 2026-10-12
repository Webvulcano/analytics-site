-- Blog-modul: cikkek site-onként és nyelvenként, admin-szerkesztés, publikus RPC-k a weboldalnak.
--   sites.blog      manifestből: { label, locales, path: {hu:'/blog'}, postPath: {hu:'/blog/{slug}'}, author }; null = nincs blog
--   posts           egy sor = egy cikk egy nyelven; group_id köti össze a nyelvi változatokat (alapból a saját id)
--                   status: draft (még sosem jelent meg) | published | hidden (elrejtve)
--                   deleted_at = Kuka (az admin 30 nap után véglegesen törli, a képekkel együtt)
--   cms_list_posts / cms_get_post        → weboldal (anon): csak közzétett, nem törölt cikk
--   cms_get_post_preview                 → piszkozat-előnézet a cikk preview_token-jével
--   cms_get_site_content                 + posts: { <locale>: db }
--   Storage: {site}/blog/{post}/{uuid}.webp (borító) + {site}/blog/{post}/og-{uuid}.jpg (megosztási kép, JPEG:
--            a WebP-t nem minden link-előnézet mutatja) → a bucket a JPEG-et is engedi, de az útvonal-szabály csak itt.

alter table public.sites add column blog jsonb;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  locale text not null,
  group_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(title) between 1 and 160),
  meta_title text check (length(meta_title) <= 70),
  description text check (length(description) <= 170),
  excerpt text check (length(excerpt) <= 400),
  body jsonb not null default '{"type":"doc","content":[]}'::jsonb check (jsonb_typeof(body) = 'object'),
  author text check (length(author) <= 120),
  cover_path text check (cover_path like site_id::text || '/blog/' || id::text || '/%'),
  cover_width int check (cover_width > 0),
  cover_height int check (cover_height > 0),
  cover_alt text check (length(cover_alt) <= 300),
  og_path text check (og_path like site_id::text || '/blog/' || id::text || '/og-%'),
  faq jsonb not null default '[]'::jsonb
    check (case when jsonb_typeof(faq) = 'array' then jsonb_array_length(faq) <= 30 else false end),
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  preview_token uuid not null default gen_random_uuid(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  foreign key (site_id, locale) references public.site_locales (site_id, locale) on delete cascade,
  check (status = 'draft' or published_at is not null),
  check ((cover_path is null) = (cover_width is null) and (cover_path is null) = (cover_height is null))
);
create unique index posts_slug_idx on public.posts (site_id, locale, slug) where deleted_at is null;
create index posts_list_idx on public.posts (site_id, locale, status, published_at desc);
create index posts_group_idx on public.posts (group_id);

-- group_id alapból a saját id; updated_at (= dateModified) csak tartalmi változásnál lép, elrejtésnél / kukánál nem.
create or replace function private.posts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.group_id := coalesce(new.group_id, new.id);
    return new;
  end if;
  if (new.slug, new.title, new.meta_title, new.description, new.excerpt, new.body, new.author,
      new.cover_path, new.cover_alt, new.faq)
     is distinct from
     (old.slug, old.title, old.meta_title, old.description, old.excerpt, old.body, old.author,
      old.cover_path, old.cover_alt, old.faq) then
    new.updated_at := now();
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger posts_touch before insert or update on public.posts
  for each row execute function private.posts_touch();

alter table public.posts enable row level security;
revoke all on public.posts from anon;

create policy posts_select on public.posts
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy posts_write on public.posts
  for all to authenticated
  using (site_id in (select private.my_writable_site_ids()))
  with check (site_id in (select private.my_writable_site_ids()));

-- Storage: a bucket a JPEG-et is engedi (csak az OG-kép útvonalán érvényes, ld. is_media_path).
update storage.buckets set allowed_mime_types = array['image/webp', 'image/jpeg'] where id = 'site-media';

create or replace function private.is_media_path(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/slots/[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
      or p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gallery/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
      or p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/blog/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
      or p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/blog/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/og-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
$$;

-- GC: a cikkek borító- és OG-képei sem árvák.
create or replace function public.cms_orphan_objects(p_min_age interval default interval '24 hours')
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'site-media'
    and o.created_at < now() - p_min_age
    and not exists (select 1 from public.images i where i.path = o.name)
    and not exists (select 1 from public.gallery_items g where g.path = o.name)
    and not exists (select 1 from public.posts b where b.cover_path = o.name or b.og_path = o.name)
$$;

-- Weboldal-JSON egy cikkről (full: törzs + GYIK is).
create or replace function private.post_json(p public.posts, p_full boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'locale', p.locale, 'group', p.group_id,
    'title', p.title, 'metaTitle', p.meta_title, 'description', p.description, 'excerpt', p.excerpt,
    'author', p.author,
    'cover', case when p.cover_path is null then null
                  else jsonb_build_object('path', p.cover_path, 'w', p.cover_width, 'h', p.cover_height, 'alt', p.cover_alt) end,
    'og', p.og_path, 'status', p.status,
    'publishedAt', p.published_at, 'updatedAt', p.updated_at)
  || case when p_full then jsonb_build_object(
       'body', p.body, 'faq', p.faq,
       -- közzétett nyelvi párok (hreflang + nyelvválasztó)
       'translations', coalesce(
         (select jsonb_agg(jsonb_build_object('locale', t.locale, 'slug', t.slug) order by t.locale)
          from public.posts t
          where t.group_id = p.group_id and t.id <> p.id and t.status = 'published' and t.deleted_at is null),
         '[]'::jsonb))
     else '{}'::jsonb end
$$;

create or replace function public.cms_list_posts(p_site text, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.post_json(p, false) order by p.published_at desc, p.created_at desc), '[]'::jsonb)
  from public.posts p join public.sites s on s.id = p.site_id
  where s.slug = p_site and s.status <> 'archived' and s.blog is not null
    and p.locale = p_locale and p.status = 'published' and p.deleted_at is null
$$;

create or replace function public.cms_get_post(p_site text, p_locale text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.post_json(p, true)
  from public.posts p join public.sites s on s.id = p.site_id
  where s.slug = p_site and s.status <> 'archived' and s.blog is not null
    and p.locale = p_locale and p.slug = p_slug and p.status = 'published' and p.deleted_at is null
$$;

-- Előnézet: bármely állapotú (nem törölt) cikk, ha a token egyezik. A token az adminban látszik (RLS).
create or replace function public.cms_get_post_preview(p_site text, p_id uuid, p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.post_json(p, true)
  from public.posts p join public.sites s on s.id = p.site_id
  where s.slug = p_site and s.status <> 'archived' and s.blog is not null
    and p.id = p_id and p.preview_token = p_token and p.deleted_at is null
$$;

revoke all on function private.post_json(public.posts, boolean) from public, anon, authenticated;
revoke all on function private.posts_touch() from public, anon, authenticated;
revoke execute on function public.cms_list_posts(text, text) from public;
revoke execute on function public.cms_get_post(text, text, text) from public;
revoke execute on function public.cms_get_post_preview(text, uuid, uuid) from public;
grant execute on function public.cms_list_posts(text, text) to anon, authenticated, service_role;
grant execute on function public.cms_get_post(text, text, text) to anon, authenticated, service_role;
grant execute on function public.cms_get_post_preview(text, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.cms_get_site_content(p_site text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select id, slug, default_locale, gallery, blog
    from public.sites
    where slug = p_site and status <> 'archived'
  )
  select jsonb_build_object(
    'slug', s.slug,
    'defaultLocale', s.default_locale,
    'locales', coalesce(
      (select jsonb_agg(l.locale order by l.sort) from public.site_locales l where l.site_id = s.id),
      '[]'::jsonb),
    'fields', coalesce(
      (select jsonb_object_agg(f.key, jsonb_build_object(
          't', f.type,
          'd', f.default_value,
          'v', coalesce(
            (select jsonb_object_agg(v.locale, v.value) from public.content_values v where v.field_id = f.id),
            '{}'::jsonb)))
        from public.content_fields f
        where f.site_id = s.id and f.archived_at is null),
      '{}'::jsonb),
    'images', coalesce(
      (select jsonb_object_agg(sl.key, jsonb_build_object(
          'k', sl.kind,
          'd', jsonb_build_object('src', sl.default_src, 'w', sl.default_width, 'h', sl.default_height, 'alt', sl.default_alt),
          'items', coalesce(
            (select jsonb_agg(jsonb_build_object('path', i.path, 'w', i.width, 'h', i.height, 'alt', i.alt) order by i.position)
             from public.images i where i.slot_id = sl.id),
            '[]'::jsonb)))
        from public.image_slots sl
        where sl.site_id = s.id and sl.archived_at is null),
      '{}'::jsonb),
    'gallery', case when s.gallery is null then null else jsonb_build_object(
      'categories', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'slug', c.slug, 'title', c.title, 'link', c.link_key) order by c.position, c.created_at)
         from public.gallery_categories c where c.site_id = s.id),
        '[]'::jsonb),
      'items', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'id', i.id, 'c', c.slug, 'k', i.kind, 'path', i.path, 'yt', i.youtube_id,
            'w', i.width, 'h', i.height, 'title', i.title, 'year', i.year, 'alt', i.alt)
            order by c.position, c.created_at, i.position, i.created_at)
         from public.gallery_items i join public.gallery_categories c on c.id = i.category_id
         where i.site_id = s.id),
        '[]'::jsonb)
    ) end,
    -- Blog: közzétett cikkek száma nyelvenként (menü / hreflang tudja, van-e blog). null = nincs blog-modul.
    'posts', case when s.blog is null then null else coalesce(
      (select jsonb_object_agg(x.locale, x.n)
       from (select p.locale, count(*) as n from public.posts p
             where p.site_id = s.id and p.status = 'published' and p.deleted_at is null
             group by p.locale) x),
      '{}'::jsonb) end
  )
  from s
$$;

revoke execute on function public.cms_get_site_content(text) from public, anon, authenticated;
grant execute on function public.cms_get_site_content(text) to anon, authenticated, service_role;

create or replace function public.cms_sync_manifest(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_site jsonb := p -> 'site';
  v_prune boolean := coalesce((p ->> 'prune')::boolean, false);
  v_site_id uuid;
  v_inserted boolean;
  r jsonb;
  f_new int := 0; f_upd int := 0; f_arch int := 0;
  s_new int := 0; s_upd int := 0; s_arch int := 0;
  m_removed int := 0;
begin
  if v_site ->> 'slug' is null or v_site ->> 'name' is null or v_site ->> 'site_url' is null then
    raise exception 'site.slug, site.name és site.site_url kötelező';
  end if;
  if jsonb_array_length(coalesce(p -> 'locales', '[]'::jsonb)) = 0 then
    raise exception 'legalább egy locale kell';
  end if;

  insert into public.sites as t (
    slug, name, site_url, revalidate_url, default_locale,
    ga4_property_id, gsc_site_url, cta_event, cta_buttons, gallery, blog, preview_url, manifest_hash, synced_at)
  values (
    v_site ->> 'slug', v_site ->> 'name', v_site ->> 'site_url', v_site ->> 'revalidate_url',
    coalesce(v_site ->> 'default_locale', 'hu'),
    v_site ->> 'ga4_property_id', v_site ->> 'gsc_site_url',
    coalesce(v_site ->> 'cta_event', 'cta_click'), coalesce(v_site -> 'cta_buttons', '[]'::jsonb),
    nullif(v_site -> 'gallery', 'null'::jsonb), nullif(v_site -> 'blog', 'null'::jsonb), v_site ->> 'preview_url', p ->> 'manifest_hash', now())
  on conflict (slug) do update set
    name = excluded.name,
    site_url = excluded.site_url,
    revalidate_url = excluded.revalidate_url,
    default_locale = excluded.default_locale,
    ga4_property_id = excluded.ga4_property_id,
    gsc_site_url = excluded.gsc_site_url,
    cta_event = excluded.cta_event,
    cta_buttons = excluded.cta_buttons,
    gallery = excluded.gallery,
    blog = excluded.blog,
    preview_url = excluded.preview_url,
    manifest_hash = excluded.manifest_hash,
    synced_at = now()
  returning t.id into v_site_id;

  -- Locales
  insert into public.site_locales (site_id, locale, label, sort)
  select v_site_id, x ->> 'locale', x ->> 'label', coalesce((x ->> 'sort')::int, 0)
  from jsonb_array_elements(p -> 'locales') x
  on conflict (site_id, locale) do update set label = excluded.label, sort = excluded.sort;

  if not exists (
    select 1 from public.site_locales
    where site_id = v_site_id and locale = coalesce(v_site ->> 'default_locale', 'hu')
  ) then
    raise exception 'default_locale nincs a locales listában';
  end if;

  if v_prune then
    -- Removing a locale also deletes its translations (FK cascade) → only with --prune.
    delete from public.site_locales
    where site_id = v_site_id
      and locale not in (select x ->> 'locale' from jsonb_array_elements(p -> 'locales') x);
  end if;

  -- Members (emails lowercase)
  insert into public.site_members (site_id, email, role)
  select v_site_id, lower(x ->> 'email'), coalesce(x ->> 'role', 'editor')
  from jsonb_array_elements(coalesce(p -> 'members', '[]'::jsonb)) x
  on conflict (site_id, email) do update set role = excluded.role;

  if v_prune then
    delete from public.site_members
    where site_id = v_site_id
      and email not in (select lower(x ->> 'email') from jsonb_array_elements(coalesce(p -> 'members', '[]'::jsonb)) x);
    get diagnostics m_removed = row_count;
  end if;

  -- Pages (pure structure, safe to replace)
  insert into public.site_pages (site_id, key, label, path, paths, sort)
  select v_site_id, x ->> 'key', x ->> 'label', x ->> 'path',
    coalesce(nullif(x -> 'paths', 'null'::jsonb), '{}'::jsonb), coalesce((x ->> 'sort')::int, 0)
  from jsonb_array_elements(coalesce(p -> 'pages', '[]'::jsonb)) x
  on conflict (site_id, key) do update set label = excluded.label, path = excluded.path, paths = excluded.paths, sort = excluded.sort;

  delete from public.site_pages
  where site_id = v_site_id
    and key not in (select x ->> 'key' from jsonb_array_elements(coalesce(p -> 'pages', '[]'::jsonb)) x);

  -- Fields: upsert by key; values are never touched.
  for r in select * from jsonb_array_elements(coalesce(p -> 'fields', '[]'::jsonb)) loop
    insert into public.content_fields as t (
      site_id, key, page_key, section_key, section_label, label, help, type,
      translatable, options, default_value, sort, archived_at)
    values (
      v_site_id, r ->> 'key', r ->> 'page_key', r ->> 'section_key', r ->> 'section_label',
      r ->> 'label', r ->> 'help', r ->> 'type',
      coalesce((r ->> 'translatable')::boolean, true),
      coalesce(r -> 'options', '{}'::jsonb), coalesce(r -> 'default_value', '{}'::jsonb),
      coalesce((r ->> 'sort')::int, 0), null)
    on conflict (site_id, key) do update set
      page_key = excluded.page_key,
      section_key = excluded.section_key,
      section_label = excluded.section_label,
      label = excluded.label,
      help = excluded.help,
      type = excluded.type,
      translatable = excluded.translatable,
      options = excluded.options,
      default_value = excluded.default_value,
      sort = excluded.sort,
      archived_at = null
    returning (xmax = 0) into v_inserted;
    if v_inserted then f_new := f_new + 1; else f_upd := f_upd + 1; end if;
  end loop;

  update public.content_fields set archived_at = now()
  where site_id = v_site_id and archived_at is null
    and key not in (select x ->> 'key' from jsonb_array_elements(coalesce(p -> 'fields', '[]'::jsonb)) x);
  get diagnostics f_arch = row_count;

  -- Image slots
  for r in select * from jsonb_array_elements(coalesce(p -> 'slots', '[]'::jsonb)) loop
    insert into public.image_slots as t (
      site_id, key, page_key, section_key, section_label, label, help, kind,
      max_width, max_height, aspect, quality, max_items,
      default_src, default_width, default_height, default_alt, sort, archived_at)
    values (
      v_site_id, r ->> 'key', r ->> 'page_key', r ->> 'section_key', r ->> 'section_label',
      r ->> 'label', r ->> 'help', r ->> 'kind',
      coalesce((r ->> 'max_width')::int, 1920), (r ->> 'max_height')::int, r ->> 'aspect',
      coalesce((r ->> 'quality')::int, 80), (r ->> 'max_items')::int,
      r ->> 'default_src', (r ->> 'default_width')::int, (r ->> 'default_height')::int,
      coalesce(r -> 'default_alt', '{}'::jsonb), coalesce((r ->> 'sort')::int, 0), null)
    on conflict (site_id, key) do update set
      page_key = excluded.page_key,
      section_key = excluded.section_key,
      section_label = excluded.section_label,
      label = excluded.label,
      help = excluded.help,
      kind = excluded.kind,
      max_width = excluded.max_width,
      max_height = excluded.max_height,
      aspect = excluded.aspect,
      quality = excluded.quality,
      max_items = excluded.max_items,
      default_src = excluded.default_src,
      default_width = excluded.default_width,
      default_height = excluded.default_height,
      default_alt = excluded.default_alt,
      sort = excluded.sort,
      archived_at = null
    returning (xmax = 0) into v_inserted;
    if v_inserted then s_new := s_new + 1; else s_upd := s_upd + 1; end if;
  end loop;

  update public.image_slots set archived_at = now()
  where site_id = v_site_id and archived_at is null
    and key not in (select x ->> 'key' from jsonb_array_elements(coalesce(p -> 'slots', '[]'::jsonb)) x);
  get diagnostics s_arch = row_count;

  return jsonb_build_object(
    'site_id', v_site_id,
    'fields', jsonb_build_object('created', f_new, 'updated', f_upd, 'archived', f_arch),
    'slots', jsonb_build_object('created', s_new, 'updated', s_upd, 'archived', s_arch),
    'members_removed', m_removed
  );
end;
$$;

revoke execute on function public.cms_sync_manifest(jsonb) from public, anon, authenticated;
grant execute on function public.cms_sync_manifest(jsonb) to service_role;


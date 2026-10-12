-- Galéria modul (portfólió): kategóriák + elemek (fotó WebP / YouTube videó) site-onként.
--   sites.gallery          manifestből: { label, maxWidth, links: [{ key, label }] } — null = nincs galéria
--   gallery_categories     slug (létrehozáskor, utána fix — URL-ekben van), title {hu,en}, link_key (főoldali gomb)
--   gallery_items          kind photo|video, path (site-media WebP) | youtube_id, title/alt {hu,en}, year
--   Storage: {site_id}/gallery/{category_id}/{uuid}.webp
--   cms_get_site_content   + 'gallery' kulcs; cms_sync_manifest + sites.gallery

alter table public.sites add column gallery jsonb;

create table public.gallery_categories (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  title jsonb not null default '{}'::jsonb,
  link_key text check (link_key ~ '^[a-z0-9_-]{1,40}$'),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (site_id, slug),
  unique (id, site_id)
);
create unique index gallery_categories_link_idx on public.gallery_categories (site_id, link_key) where link_key is not null;

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  category_id uuid not null,
  kind text not null check (kind in ('photo', 'video')),
  path text unique check (path like site_id::text || '/gallery/%'),
  youtube_id text check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  width int check (width > 0),
  height int check (height > 0),
  bytes int check (bytes > 0),
  title jsonb not null default '{}'::jsonb,
  year int check (year between 1900 and 2100),
  alt jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (category_id, site_id) references public.gallery_categories (id, site_id) on delete cascade,
  check (
    (kind = 'photo' and path is not null and youtube_id is null and width is not null and height is not null)
    or (kind = 'video' and youtube_id is not null)
  )
);
create index gallery_items_category_idx on public.gallery_items (category_id, position);

alter table public.gallery_categories enable row level security;
alter table public.gallery_items enable row level security;
revoke all on public.gallery_categories, public.gallery_items from anon;

create policy gallery_categories_select on public.gallery_categories
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy gallery_categories_write on public.gallery_categories
  for all to authenticated
  using (site_id in (select private.my_writable_site_ids()))
  with check (site_id in (select private.my_writable_site_ids()));

create policy gallery_items_select on public.gallery_items
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy gallery_items_write on public.gallery_items
  for all to authenticated
  using (site_id in (select private.my_writable_site_ids()))
  with check (site_id in (select private.my_writable_site_ids()));

-- Storage: slot képek ÉS galéria képek.
create or replace function private.is_media_path(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/slots/[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
      or p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gallery/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
$$;

-- Sorrend egy hívásban (kategóriák egy site-on, vagy elemek egy kategórián belül).
create or replace function public.cms_gallery_reorder(p_site uuid, p_category uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total int;
  v_updated int;
begin
  if p_category is null then
    select count(*) into v_total from public.gallery_categories where site_id = p_site;
  else
    select count(*) into v_total from public.gallery_items where site_id = p_site and category_id = p_category;
  end if;
  if v_total = 0 or v_total <> coalesce(array_length(p_ids, 1), 0)
     or v_total <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'A sorrendnek az összes elemet tartalmaznia kell';
  end if;

  if p_category is null then
    update public.gallery_categories set position = array_position(p_ids, id) - 1
    where site_id = p_site and id = any(p_ids);
  else
    update public.gallery_items set position = array_position(p_ids, id) - 1
    where site_id = p_site and category_id = p_category and id = any(p_ids);
  end if;
  get diagnostics v_updated = row_count;
  if v_updated <> v_total then raise exception 'Ismeretlen elem a sorrendben'; end if;
end;
$$;
revoke execute on function public.cms_gallery_reorder(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.cms_gallery_reorder(uuid, uuid, uuid[]) to authenticated;

-- GC: a galéria-elemek fájljai sem árvák.
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
$$;

create or replace function public.cms_get_site_content(p_site text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select id, slug, default_locale, gallery
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
    ) end
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
    ga4_property_id, gsc_site_url, cta_event, cta_buttons, gallery, manifest_hash, synced_at)
  values (
    v_site ->> 'slug', v_site ->> 'name', v_site ->> 'site_url', v_site ->> 'revalidate_url',
    coalesce(v_site ->> 'default_locale', 'hu'),
    v_site ->> 'ga4_property_id', v_site ->> 'gsc_site_url',
    coalesce(v_site ->> 'cta_event', 'cta_click'), coalesce(v_site -> 'cta_buttons', '[]'::jsonb),
    nullif(v_site -> 'gallery', 'null'::jsonb), p ->> 'manifest_hash', now())
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
  insert into public.site_pages (site_id, key, label, path, sort)
  select v_site_id, x ->> 'key', x ->> 'label', x ->> 'path', coalesce((x ->> 'sort')::int, 0)
  from jsonb_array_elements(coalesce(p -> 'pages', '[]'::jsonb)) x
  on conflict (site_id, key) do update set label = excluded.label, path = excluded.path, sort = excluded.sort;

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

-- 0014 packages: csomag-modul (kész árajánlatok letölthető PDF-fel, pl. StillSoul „Kész csomagjaink” popup).
--   sites.packages       manifestből: { label } — null = nincs csomag-modul (menü sem látszik)
--   packages             title / tiers / price {hu,en} (cím alapnyelven kötelező — appban ellenőrizve),
--                        files {hu,en} → PDF útvonal a site-media bucketben, visible, position
--   cms_packages_reorder sorrend egy hívásban
--   Storage: site-media bucket + application/pdf, limit 3 → 10 MB; útvonal {site_id}/packages/{uuid}.pdf
--   cms_orphan_objects   a csomag-PDF-ek sem árvák
--   cms_get_site_content + 'packages' (csak visible); cms_sync_manifest + sites.packages
-- RLS: az értékelések mintája (olvasás my_site_ids, írás my_writable_site_ids, anon semmi).

alter table public.sites add column packages jsonb;

-- files: { "hu": "<site_id>/packages/<uuid>.pdf", "en": … } — csak a saját site mappája, csak PDF-útvonal.
create or replace function private.package_files_ok(p_site uuid, p_files jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_files) = 'object'
     and not exists (
       select 1 from jsonb_each(p_files) e
       where jsonb_typeof(e.value) <> 'string'
          or e.value #>> '{}' !~ ('^' || p_site::text || '/packages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'))
$$;
revoke all on function private.package_files_ok(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.package_files_ok(uuid, jsonb) to authenticated, service_role;

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  title jsonb not null default '{}'::jsonb,
  tiers jsonb not null default '{}'::jsonb,
  price jsonb not null default '{}'::jsonb,
  files jsonb not null default '{}'::jsonb check (private.package_files_ok(site_id, files)),
  visible boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index packages_site_idx on public.packages (site_id, position);

alter table public.packages enable row level security;
revoke all on public.packages from anon;

create policy packages_select on public.packages
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy packages_write on public.packages
  for all to authenticated
  using (site_id in (select private.my_writable_site_ids()))
  with check (site_id in (select private.my_writable_site_ids()));

create or replace function public.cms_packages_reorder(p_site uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total int;
  v_updated int;
begin
  select count(*) into v_total from public.packages where site_id = p_site;
  if v_total = 0 or v_total <> coalesce(array_length(p_ids, 1), 0)
     or v_total <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'A sorrendnek az összes csomagot tartalmaznia kell';
  end if;
  update public.packages set position = array_position(p_ids, id) - 1
  where site_id = p_site and id = any(p_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> v_total then raise exception 'Ismeretlen csomag a sorrendben'; end if;
end;
$$;
revoke execute on function public.cms_packages_reorder(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.cms_packages_reorder(uuid, uuid[]) to authenticated;

-- Storage: PDF is mehet a site-media bucketbe (csak a packages/ útvonalon, ld. is_media_path).
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg', 'application/pdf'],
    file_size_limit = 10485760
where id = 'site-media';

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
      or p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/packages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
$$;

-- GC: a csomag-PDF-ek sem árvák.
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
    and not exists (select 1 from public.packages k, jsonb_each_text(k.files) f where f.value = o.name)
$$;

create or replace function public.cms_get_site_content(p_site text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select id, slug, default_locale, gallery, blog, reviews, packages
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
            'w', i.width, 'h', i.height, 'title', i.title, 'year', i.year, 'alt', i.alt,
            'fx', i.focus_x, 'fy', i.focus_y, 'fit', i.fit)
            order by c.position, c.created_at, i.position, i.created_at)
         from public.gallery_items i join public.gallery_categories c on c.id = i.category_id
         where i.site_id = s.id),
        '[]'::jsonb)
    ) end,
    -- Értékelések: csak a láthatók, admin-sorrendben. null = nincs értékelés-modul.
    'reviews', case when s.reviews is null then null else coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', r.id, 'author', r.author, 'subtitle', r.subtitle, 'body', r.body, 'rating', r.rating)
          order by r.position, r.created_at)
       from public.reviews r where r.site_id = s.id and r.visible),
      '[]'::jsonb) end,
    -- Csomagok: csak a láthatók, admin-sorrendben. null = nincs csomag-modul.
    'packages', case when s.packages is null then null else coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', k.id, 'title', k.title, 'tiers', k.tiers, 'price', k.price, 'files', k.files)
          order by k.position, k.created_at)
       from public.packages k where k.site_id = s.id and k.visible),
      '[]'::jsonb) end,
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
    ga4_property_id, gsc_site_url, cta_event, cta_buttons, gallery, blog, reviews, packages, preview_url, manifest_hash, synced_at)
  values (
    v_site ->> 'slug', v_site ->> 'name', v_site ->> 'site_url', v_site ->> 'revalidate_url',
    coalesce(v_site ->> 'default_locale', 'hu'),
    v_site ->> 'ga4_property_id', v_site ->> 'gsc_site_url',
    coalesce(v_site ->> 'cta_event', 'cta_click'), coalesce(v_site -> 'cta_buttons', '[]'::jsonb),
    nullif(v_site -> 'gallery', 'null'::jsonb), nullif(v_site -> 'blog', 'null'::jsonb), nullif(v_site -> 'reviews', 'null'::jsonb), nullif(v_site -> 'packages', 'null'::jsonb), v_site ->> 'preview_url', p ->> 'manifest_hash', now())
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
    reviews = excluded.reviews,
    packages = excluded.packages,
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

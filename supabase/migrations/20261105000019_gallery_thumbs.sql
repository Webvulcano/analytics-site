-- Galéria bélyegképek (thumb): a kártyákhoz kicsi WebP (~800 px), a nagy kép csak a nagyításhoz.
--   gallery_items.thumb_path   nullable; null = nincs bélyegkép (régi elem) → a kliens a nagy képet használja
--                              Storage: ugyanaz a mappa, mint a nagy képé: {site_id}/gallery/{category_id}/{uuid}.webp
--                              (a meglévő private.is_media_path / storage RLS változatlanul engedi)
--   cms_get_site_content       gallery.items[].thumb
--   media_refs_check           a thumb_path-ot is ellenőrzi (létezik, WebP, ≤ 3 MB)
--   cms_orphan_objects         a thumb_path-ra hivatkozott fájl nem árva
-- Visszafelé kompatibilis: új nullable oszlop + új JSON-kulcs; a régi admin és kliensek változatlanul működnek.

alter table public.gallery_items
  add column thumb_path text unique check (thumb_path like site_id::text || '/gallery/%');

create or replace function private.media_refs_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_image constant bigint := 3145728;  -- 3 MB
  c_pdf constant bigint := 10485760;   -- 10 MB
  v_size bigint;
  f record;
begin
  if tg_table_name = 'images' then
    if tg_op = 'INSERT' or new.path is distinct from old.path then
      v_size := private.media_size(new.path, 'image/webp');
      if v_size is null or v_size > c_image then raise exception 'A kép nem található, nem WebP, vagy 3 MB-nál nagyobb' using errcode = '22023'; end if;
      new.bytes := v_size;
    end if;

  elsif tg_table_name = 'gallery_items' then
    if new.path is not null and (tg_op = 'INSERT' or new.path is distinct from old.path) then
      v_size := private.media_size(new.path, 'image/webp');
      if v_size is null or v_size > c_image then raise exception 'A kép nem található, nem WebP, vagy 3 MB-nál nagyobb' using errcode = '22023'; end if;
      if new.kind = 'photo' then new.bytes := v_size; end if;
    end if;
    if new.thumb_path is not null and (tg_op = 'INSERT' or new.thumb_path is distinct from old.thumb_path) then
      v_size := private.media_size(new.thumb_path, 'image/webp');
      if v_size is null or v_size > c_image then raise exception 'A bélyegkép nem található, nem WebP, vagy 3 MB-nál nagyobb' using errcode = '22023'; end if;
    end if;

  elsif tg_table_name = 'posts' then
    if new.cover_path is not null and (tg_op = 'INSERT' or new.cover_path is distinct from old.cover_path) then
      v_size := private.media_size(new.cover_path, 'image/webp');
      if v_size is null or v_size > c_image then raise exception 'A borítókép nem található, nem WebP, vagy 3 MB-nál nagyobb' using errcode = '22023'; end if;
    end if;
    if new.og_path is not null and (tg_op = 'INSERT' or new.og_path is distinct from old.og_path) then
      v_size := private.media_size(new.og_path, 'image/jpeg');
      if v_size is null or v_size > c_image then raise exception 'A megosztási kép nem található, nem JPEG, vagy 3 MB-nál nagyobb' using errcode = '22023'; end if;
    end if;

  elsif tg_table_name = 'packages' then
    if tg_op = 'INSERT' or new.files is distinct from old.files then
      for f in select * from jsonb_each_text(new.files) loop
        if tg_op = 'UPDATE' and old.files ->> f.key = f.value then continue; end if;
        v_size := private.media_size(f.value, 'application/pdf');
        if v_size is null or v_size > c_pdf then raise exception 'A PDF nem található, nem PDF, vagy 10 MB-nál nagyobb (%)', f.key using errcode = '22023'; end if;
      end loop;
    end if;
  end if;
  return new;
end;
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
            'fx', i.focus_x, 'fy', i.focus_y, 'fit', i.fit, 'thumb', i.thumb_path)
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
    and split_part(o.name, '/', 2) <> 'defaults'
    and not exists (select 1 from public.images i where i.path = o.name)
    and not exists (select 1 from public.gallery_items g where g.path = o.name or g.thumb_path = o.name)
    and not exists (select 1 from public.posts b where b.cover_path = o.name or b.og_path = o.name)
    and not exists (select 1 from public.packages k, jsonb_each_text(k.files) f where f.value = o.name)
$$;

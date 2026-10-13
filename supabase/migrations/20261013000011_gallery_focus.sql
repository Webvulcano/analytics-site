-- 0011 gallery focus: képenkénti fókuszpont + „teljes kép” mód a galéria-elemekre.
--   gallery_items.focus_x / focus_y  0–100 (%), default 50/50 = közép (= eddigi viselkedés)
--   gallery_items.fit                'cover' (vág, fókuszpont szerint) | 'contain' (teljes kép)
--   cms_get_site_content             gallery item + fx, fy, fit
-- RLS változatlan: az oszlopok a meglévő gallery_items policy-k alá esnek.

alter table public.gallery_items
  add column focus_x smallint not null default 50 check (focus_x between 0 and 100),
  add column focus_y smallint not null default 50 check (focus_y between 0 and 100),
  add column fit text not null default 'cover' check (fit in ('cover', 'contain'));

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
            'w', i.width, 'h', i.height, 'title', i.title, 'year', i.year, 'alt', i.alt,
            'fx', i.focus_x, 'fy', i.focus_y, 'fit', i.fit)
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

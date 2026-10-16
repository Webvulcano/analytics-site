-- GC: a <site_id>/defaults/ mappa nem árva.
-- Ide kerülnek egy ügyféloldal beépített alapképei (pl. image_slots.default_src, vagy a kliens
-- kódja fix URL-lel hivatkozik rájuk). Egyik tábla sem hivatkozik rájuk path szerint, ezért
-- e nélkül a scripts/gc-storage.mjs --delete letörölné őket. Első használó: StillSoul (2026-10-16).
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
    and not exists (select 1 from public.gallery_items g where g.path = o.name)
    and not exists (select 1 from public.posts b where b.cover_path = o.name or b.og_path = o.name)
    and not exists (select 1 from public.packages k, jsonb_each_text(k.files) f where f.value = o.name)
$$;

revoke execute on function public.cms_orphan_objects(interval) from public, anon, authenticated;
grant execute on function public.cms_orphan_objects(interval) to service_role;

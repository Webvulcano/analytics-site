-- Fix: `select id::text from private.my_*_site_ids()` resolved `id` to storage.objects.id
-- (correlated), so the folder never matched and every upload was denied. Alias the set instead.

alter policy site_media_select on storage.objects
  using (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (select s::text from private.my_site_ids() s)
  );

alter policy site_media_insert on storage.objects
  with check (
    bucket_id = 'site-media'
    and private.is_media_path(name)
    and (storage.foldername(name))[1] in (select s::text from private.my_writable_site_ids() s)
  );

alter policy site_media_delete on storage.objects
  using (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (select s::text from private.my_writable_site_ids() s)
  );

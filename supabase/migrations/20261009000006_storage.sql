-- Fázis 4: image storage.
--   Bucket `site-media`: public read, WebP only, 3 MB. Path: {site_id}/slots/{slot_key}/{uuid}.webp
--   Objects are immutable (uuid names, no UPDATE policy); replacing an image = new object + delete old.
--   cms_commit_image   → attach an uploaded object to a slot (single: replaces, gallery: appends)
--   cms_reorder_images → gallery order in one call
--   cms_orphan_objects → service role only, used by scripts/gc-storage.mjs

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 3145728, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- {site_id}/slots/{slot_key}/{uuid}.webp — slot keys are `page.section.name`.
create or replace function private.is_media_path(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/slots/[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
$$;
revoke all on function private.is_media_path(text) from public, anon, authenticated;
grant execute on function private.is_media_path(text) to authenticated, service_role;

-- Public bucket: anonymous reads go through the public URL, no SELECT policy needed for anon.
create policy site_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (select s::text from private.my_site_ids() s)
  );

create policy site_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'site-media'
    and private.is_media_path(name)
    and (storage.foldername(name))[1] in (select s::text from private.my_writable_site_ids() s)
  );

create policy site_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (select s::text from private.my_writable_site_ids() s)
  );


create or replace function public.cms_commit_image(
  p_slot uuid,
  p_path text,
  p_width int,
  p_height int,
  p_alt jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot public.image_slots;
  v_bytes int;
  v_id uuid;
  v_removed text[] := '{}';
  v_count int;
begin
  -- RLS: only slots of the caller's sites are visible.
  select * into v_slot from public.image_slots where id = p_slot and archived_at is null;
  if not found then raise exception 'Ismeretlen képhely'; end if;

  if not private.is_media_path(p_path)
     or split_part(p_path, '/', 1) <> v_slot.site_id::text
     or split_part(p_path, '/', 3) <> v_slot.key then
    raise exception 'Érvénytelen fájl-útvonal';
  end if;

  if p_width < 1 or p_height < 1
     or p_width > v_slot.max_width
     or (v_slot.max_height is not null and p_height > v_slot.max_height) then
    raise exception 'A kép mérete nem felel meg a képhelynek';
  end if;

  -- The object must really exist (uploaded by the caller via RLS); size comes from storage, not the client.
  select (metadata ->> 'size')::int into v_bytes
  from storage.objects
  where bucket_id = 'site-media' and name = p_path;
  if v_bytes is null then raise exception 'A feltöltött fájl nem található'; end if;

  if v_slot.kind = 'single' then
    with d as (
      delete from public.images where slot_id = v_slot.id returning path
    )
    select coalesce(array_agg(path), '{}') into v_removed from d;
    insert into public.images (slot_id, site_id, path, width, height, bytes, alt, position)
    values (v_slot.id, v_slot.site_id, p_path, p_width, p_height, v_bytes, coalesce(p_alt, '{}'::jsonb), 0)
    returning id into v_id;
  else
    select count(*) into v_count from public.images where slot_id = v_slot.id;
    if v_slot.max_items is not null and v_count >= v_slot.max_items then
      raise exception 'A galéria megtelt (max % kép)', v_slot.max_items;
    end if;
    insert into public.images (slot_id, site_id, path, width, height, bytes, alt, position)
    values (v_slot.id, v_slot.site_id, p_path, p_width, p_height, v_bytes, coalesce(p_alt, '{}'::jsonb),
            coalesce((select max(position) + 1 from public.images where slot_id = v_slot.id), 0))
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id, 'bytes', v_bytes, 'removed', to_jsonb(v_removed));
end;
$$;

revoke execute on function public.cms_commit_image(uuid, text, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.cms_commit_image(uuid, text, int, int, jsonb) to authenticated;


create or replace function public.cms_reorder_images(p_slot uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total int;
  v_updated int;
begin
  select count(*) into v_total from public.images where slot_id = p_slot;
  if v_total <> coalesce(array_length(p_ids, 1), 0)
     or v_total <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'A sorrendnek a képhely összes képét tartalmaznia kell';
  end if;

  update public.images
  set position = array_position(p_ids, id) - 1
  where slot_id = p_slot and id = any(p_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> v_total then raise exception 'Ismeretlen kép a sorrendben'; end if;
end;
$$;

revoke execute on function public.cms_reorder_images(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.cms_reorder_images(uuid, uuid[]) to authenticated;


-- Objects in site-media not referenced by any image row, older than p_min_age. For the GC script.
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
$$;

revoke execute on function public.cms_orphan_objects(interval) from public, anon, authenticated;
grant execute on function public.cms_orphan_objects(interval) to service_role;

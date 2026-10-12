-- Többnyelvű ügyféloldalak előnézete (első: Hallásgondozó, HU/EN/DE).
--   site_pages.paths   oldal-útvonal nyelvenként, pl. {"hu":"/hallokeszulekek","en":"/en/hearing-aids"}.
--                      Üres objektum = minden nyelven a `path` (régi viselkedés). A szerkesztő az aktuális
--                      nyelv útvonalát tölti be az előnézetbe.
--   sites.preview_url  opcionális előnézeti deploy (pl. még nem élesített nyelvekhez, noindex). Ha be van
--                      állítva, a szerkesztő ezt framelli, és a publish ezt is revalidálja (ugyanaz a secret).
--   cms_sync_manifest  + preview_url, + pages[].paths

alter table public.sites add column preview_url text check (preview_url ~ '^https?://[^/]+$');

alter table public.site_pages add column paths jsonb not null default '{}'::jsonb
  check (jsonb_typeof(paths) = 'object');

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
    ga4_property_id, gsc_site_url, cta_event, cta_buttons, gallery, preview_url, manifest_hash, synced_at)
  values (
    v_site ->> 'slug', v_site ->> 'name', v_site ->> 'site_url', v_site ->> 'revalidate_url',
    coalesce(v_site ->> 'default_locale', 'hu'),
    v_site ->> 'ga4_property_id', v_site ->> 'gsc_site_url',
    coalesce(v_site ->> 'cta_event', 'cta_click'), coalesce(v_site -> 'cta_buttons', '[]'::jsonb),
    nullif(v_site -> 'gallery', 'null'::jsonb), v_site ->> 'preview_url', p ->> 'manifest_hash', now())
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

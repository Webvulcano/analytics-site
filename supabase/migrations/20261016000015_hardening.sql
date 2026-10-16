-- Biztonsági keményítés (audit 2026-10-12/16). A szerver-actionök már ellenőriznek, de a tagok a
-- publikus kulccsal + saját sessionnel közvetlenül is elérik a REST API-t → a szabályok ide is kellenek.
--   1. content_values: érték-ellenőrzés a mező típusa szerint (javascript:-link, objektum szöveg helyett stb.)
--   2. Szerkesztés-zár (sites.editing_locked) az RLS-ben is: zárt site-on szöveg/képhely nem írható
--   3. posts: group_id csak saját site cikkcsoportja; nyelv csak a blog nyelvei közül;
--      a nyelvi párok (translations) site-ra szűrve
--   4. posts.preview_token: új token elrejtéskor / kukába tételkor (a régi előnézeti link meghal),
--      kézzel nem írható át
--   5. Fájl-hivatkozások: a hivatkozott objektumnak léteznie kell, a típusa és a mérete stimmel
--      (kép: WebP/JPEG ≤ 3 MB, csomag: PDF ≤ 10 MB). A bucket-limit (10 MB, 3 MIME) bucket-szintű,
--      ezért itt kötjük össze az útvonallal.
--   6. TRUNCATE / REFERENCES / TRIGGER jog vissza (TRUNCATE megkerüli az RLS-t)
--   7. site_members: a tag csak a saját sorát látja (más ügyfél-emailt nem)

-- ── 1. Érték-ellenőrzés ─────────────────────────────────────────────────────

-- Egy skalár mező (vagy lista-elem mező) értéke. Hibaüzenet, vagy null ha rendben.
-- Ugyanaz a szabály, mint lib/content/validate.js + client-kit isSafeHref (szigorúbb: "/\" sem link).
create or replace function private.cms_scalar_error(p_type text, p_max int, v jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text;
begin
  if p_type = 'richtext' then
    if jsonb_typeof(v) = 'string' then return null; end if;
    if jsonb_typeof(v) = 'object' and v ->> 'type' = 'doc'
       and coalesce(jsonb_typeof(v -> 'content'), 'array') = 'array' then
      return null;
    end if;
    return 'formázott szöveg (doc) kell';
  end if;

  if p_type not in ('text', 'textarea', 'url') then return 'ismeretlen mezőtípus: ' || coalesce(p_type, 'null'); end if;
  if jsonb_typeof(v) <> 'string' then return 'szöveg kell'; end if;
  s := v #>> '{}';
  if char_length(s) > coalesce(p_max, 5000) then return 'túl hosszú'; end if;
  if p_type = 'text' and strpos(s, chr(10)) > 0 then return 'nem lehet benne sortörés'; end if;
  if p_type = 'url' then
    s := regexp_replace(s, '^\s+|\s+$', '', 'g');
    if s <> '' and (char_length(s) > 2000 or s !~* '^(https?://|mailto:|tel:|/(?![/\\])|#)') then
      return 'érvénytelen link (https://, tel:, mailto:, / vagy # kell)';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.cms_scalar_error(text, int, jsonb) from public, anon, authenticated;

create or replace function private.content_values_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.content_fields;
  v_default text;
  err text;
  item jsonb;
  def jsonb;
  k text;
begin
  select * into f from public.content_fields where id = new.field_id;
  if not found then raise exception 'Ismeretlen mező'; end if;

  if not f.translatable then
    select default_locale into v_default from public.sites where id = new.site_id;
    if new.locale <> v_default then
      raise exception '%: ez a mező csak az alapnyelven (%) menthető', f.label, v_default using errcode = '22023';
    end if;
  end if;

  if f.type <> 'list' then
    err := private.cms_scalar_error(f.type, (f.options ->> 'maxLength')::int, new.value);
    if err is not null then raise exception '%: %', f.label, err using errcode = '22023'; end if;
    return new;
  end if;

  if jsonb_typeof(new.value) <> 'array' then raise exception '%: lista kell', f.label using errcode = '22023'; end if;
  if (f.options ->> 'count') is not null and jsonb_array_length(new.value) <> (f.options ->> 'count')::int then
    raise exception '%: % elem kell', f.label, f.options ->> 'count' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(new.value) loop
    if jsonb_typeof(item) <> 'object' then raise exception '%: hibás lista-elem', f.label using errcode = '22023'; end if;
    for k in select * from jsonb_object_keys(item) loop
      select x.value into def from jsonb_array_elements(coalesce(f.options -> 'itemFields', '[]'::jsonb)) x where x.value ->> 'key' = k;
      if def is null then raise exception '%: ismeretlen lista-mező (%)', f.label, k using errcode = '22023'; end if;
      err := private.cms_scalar_error(def ->> 'type', (def ->> 'maxLength')::int, item -> k);
      if err is not null then raise exception '% (%): %', f.label, def ->> 'label', err using errcode = '22023'; end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function private.content_values_check() from public, anon, authenticated;

create trigger content_values_check
  before insert or update on public.content_values
  for each row execute function private.content_values_check();

-- ── 2. Szerkesztés-zár az RLS-ben ───────────────────────────────────────────

create or replace function private.my_editable_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.sites s
  where s.editing_locked = false
    and s.id in (select private.my_writable_site_ids())
$$;
revoke all on function private.my_editable_site_ids() from public, anon;
grant execute on function private.my_editable_site_ids() to authenticated;

alter policy content_values_write on public.content_values
  using (site_id in (select private.my_editable_site_ids()))
  with check (site_id in (select private.my_editable_site_ids()));
alter policy images_write on public.images
  using (site_id in (select private.my_editable_site_ids()))
  with check (site_id in (select private.my_editable_site_ids()));

-- ── 3. posts: cikkcsoport + nyelv ───────────────────────────────────────────

create or replace function private.posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := coalesce(new.group_id, new.id);
  v_locales jsonb;
begin
  if tg_op = 'INSERT' or new.locale is distinct from old.locale then
    select coalesce(s.blog -> 'locales', jsonb_build_array(s.default_locale)) into v_locales
    from public.sites s where s.id = new.site_id and s.blog is not null;
    if v_locales is null then raise exception 'Ennél a weboldalnál nincs blog' using errcode = '22023'; end if;
    if not v_locales ? new.locale then
      raise exception 'Ezen a nyelven (%) nincs blog', new.locale using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT' or new.group_id is distinct from old.group_id then
    if exists (
      select 1 from public.posts p
      where (p.id = v_group or p.group_id = v_group) and p.site_id <> new.site_id
    ) then
      raise exception 'Érvénytelen cikkcsoport' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.posts_guard() from public, anon, authenticated;

-- Név szerinti sorrendben fut: posts_guard a posts_touch előtt (ott kap group_id-t az új cikk).
create trigger posts_guard
  before insert or update on public.posts
  for each row execute function private.posts_guard();

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
       -- közzétett nyelvi párok (hreflang + nyelvválasztó) - csak ugyanarról a site-ról
       'translations', coalesce(
         (select jsonb_agg(jsonb_build_object('locale', t.locale, 'slug', t.slug) order by t.locale)
          from public.posts t
          where t.group_id = p.group_id and t.site_id = p.site_id and t.id <> p.id
            and t.status = 'published' and t.deleted_at is null),
         '[]'::jsonb))
     else '{}'::jsonb end
$$;
revoke all on function private.post_json(public.posts, boolean) from public, anon, authenticated;

-- ── 4. Előnézeti token ──────────────────────────────────────────────────────

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
  -- Elrejtés / kukába tétel → új token: a korábban kiküldött előnézeti linkek nem mutatják tovább.
  -- Egyébként a token nem írható át kézzel.
  if (new.status = 'hidden' and old.status <> 'hidden')
     or (new.deleted_at is not null and old.deleted_at is null) then
    new.preview_token := gen_random_uuid();
  else
    new.preview_token := old.preview_token;
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.posts_touch() from public, anon, authenticated;

-- ── 5. Fájl-hivatkozások ────────────────────────────────────────────────────

-- A site-media objektum mérete bájtban, ha létezik és a típusa p_mime; különben null.
create or replace function private.media_size(p_path text, p_mime text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (o.metadata ->> 'size')::bigint
  from storage.objects o
  where o.bucket_id = 'site-media' and o.name = p_path and o.metadata ->> 'mimetype' = p_mime
$$;
revoke all on function private.media_size(text, text) from public, anon, authenticated;

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
revoke all on function private.media_refs_check() from public, anon, authenticated;

create trigger images_media_check before insert or update on public.images
  for each row execute function private.media_refs_check();
create trigger gallery_items_media_check before insert or update on public.gallery_items
  for each row execute function private.media_refs_check();
create trigger posts_media_check before insert or update on public.posts
  for each row execute function private.media_refs_check();
create trigger packages_media_check before insert or update on public.packages
  for each row execute function private.media_refs_check();

-- ── 6. Felesleges táblajogok ────────────────────────────────────────────────

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ── 7. site_members: csak a saját sor ───────────────────────────────────────

alter policy site_members_select on public.site_members
  using (email = lower(auth.jwt() ->> 'email') and site_id in (select private.my_site_ids()));

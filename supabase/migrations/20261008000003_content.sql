-- Content model: pages, editable fields + values (per locale), image slots + images,
-- revision history. All structure (pages/fields/slots) is written only by the manifest
-- sync (service role); members write values and images.

create table public.site_pages (
  site_id uuid not null references public.sites on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  label text not null,
  path text not null check (path ~ '^/'),
  sort int not null default 0,
  primary key (site_id, key)
);

create table public.content_fields (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$'), -- page.section.field
  page_key text not null,
  section_key text not null,
  section_label text not null,
  label text not null,
  help text,
  type text not null check (type in ('text', 'textarea', 'richtext', 'url', 'list')),
  translatable boolean not null default true,
  options jsonb not null default '{}'::jsonb,       -- {maxLength, lines, hidden, itemFields, count}
  default_value jsonb not null default '{}'::jsonb, -- {"hu": ...}
  sort int not null default 0,
  archived_at timestamptz,
  unique (site_id, key),
  unique (id, site_id)
);

create table public.content_values (
  field_id uuid not null,
  site_id uuid not null,
  locale text not null,
  value jsonb not null check (octet_length(value::text) <= 60000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (field_id, locale),
  foreign key (field_id, site_id) references public.content_fields (id, site_id) on delete cascade,
  foreign key (site_id, locale) references public.site_locales (site_id, locale) on delete cascade
);
create index content_values_site_idx on public.content_values (site_id);

create table public.content_revisions (
  id bigint generated always as identity primary key,
  field_id uuid not null,
  site_id uuid not null,
  locale text not null,
  value jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index content_revisions_field_idx on public.content_revisions (field_id, changed_at desc);

create table public.image_slots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$'),
  page_key text not null,
  section_key text not null,
  section_label text not null,
  label text not null,
  help text,
  kind text not null check (kind in ('single', 'gallery')),
  max_width int not null default 1920 check (max_width between 320 and 3840),
  max_height int,
  aspect text,
  quality int not null default 80 check (quality between 50 and 95),
  max_items int,
  default_src text,
  default_width int,
  default_height int,
  default_alt jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  archived_at timestamptz,
  unique (site_id, key),
  unique (id, site_id)
);

create table public.images (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null,
  site_id uuid not null,
  path text not null unique check (path like site_id::text || '/%'),
  width int not null check (width > 0),
  height int not null check (height > 0),
  bytes int not null check (bytes > 0),
  variants jsonb not null default '[]'::jsonb,
  alt jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (slot_id, site_id) references public.image_slots (id, site_id) on delete cascade
);
create index images_slot_idx on public.images (slot_id, position);

-- Revision trigger: keep the previous value on every update/delete.
create or replace function private.log_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.content_revisions (field_id, site_id, locale, value, changed_by)
  values (old.field_id, old.site_id, old.locale, old.value, auth.uid());
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.log_content_revision() from public, anon, authenticated;

create trigger content_values_revision
  before update or delete on public.content_values
  for each row execute function private.log_content_revision();

-- Writable sites: member/superadmin AND site active (locked = read-only, e.g. unpaid).
create or replace function private.my_writable_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.sites s
  where s.status = 'active'
    and s.id in (select private.my_site_ids())
$$;
revoke all on function private.my_writable_site_ids() from public, anon;
grant execute on function private.my_writable_site_ids() to authenticated;

-- RLS
alter table public.site_pages enable row level security;
alter table public.content_fields enable row level security;
alter table public.content_values enable row level security;
alter table public.content_revisions enable row level security;
alter table public.image_slots enable row level security;
alter table public.images enable row level security;

revoke all on public.site_pages, public.content_fields, public.content_values,
  public.content_revisions, public.image_slots, public.images from anon;
revoke insert, update, delete, truncate on public.site_pages, public.content_fields,
  public.content_revisions, public.image_slots from authenticated;

create policy site_pages_select on public.site_pages
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy content_fields_select on public.content_fields
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy content_revisions_select on public.content_revisions
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy image_slots_select on public.image_slots
  for select to authenticated using (site_id in (select private.my_site_ids()));

create policy content_values_select on public.content_values
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy content_values_write on public.content_values
  for all to authenticated
  using (site_id in (select private.my_writable_site_ids()))
  with check (site_id in (select private.my_writable_site_ids()));

create policy images_select on public.images
  for select to authenticated using (site_id in (select private.my_site_ids()));
create policy images_write on public.images
  for all to authenticated
  using (site_id in (select private.my_writable_site_ids()))
  with check (site_id in (select private.my_writable_site_ids()));

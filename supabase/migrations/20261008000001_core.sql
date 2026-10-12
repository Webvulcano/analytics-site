-- Core tenant tables: sites, superadmins, site_members, site_locales.
-- Content / image tables come in later migrations (phase 2+).

create schema if not exists private;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9-]{2,40}$' and slug not in ('login', 'auth', 'api')),
  name text not null,
  site_url text not null,
  revalidate_url text,
  default_locale text not null default 'hu' check (default_locale ~ '^[a-z]{2}$'),
  status text not null default 'active' check (status in ('active', 'locked', 'archived')),
  ga4_property_id text,
  gsc_site_url text,
  cta_event text not null default 'cta_click',
  cta_buttons jsonb not null default '[]'::jsonb,
  manifest_hash text,
  synced_at timestamptz,
  last_published_at timestamptz,
  last_publish_error text,
  created_at timestamptz not null default now()
);

create table public.superadmins (
  email text primary key check (email = lower(email))
);

create table public.site_members (
  site_id uuid not null references public.sites on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (site_id, email)
);
create index site_members_email_idx on public.site_members (email);

create table public.site_locales (
  site_id uuid not null references public.sites on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}$'),
  label text not null,
  sort int not null default 0,
  primary key (site_id, locale)
);

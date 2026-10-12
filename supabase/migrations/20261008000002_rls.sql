-- Row level security: a signed-in user sees only the sites they are a member of
-- (matched by the verified Google email in the JWT), superadmins see every site.
-- No anon access to any table; client websites read through a dedicated RPC later.

create or replace function private.my_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.sites s
  where s.status <> 'archived'
    and (
      exists (
        select 1 from public.superadmins a
        where a.email = lower(auth.jwt() ->> 'email')
      )
      or exists (
        select 1 from public.site_members m
        where m.site_id = s.id
          and m.email = lower(auth.jwt() ->> 'email')
      )
    )
$$;

revoke all on function private.my_site_ids() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.my_site_ids() to authenticated;

alter table public.sites enable row level security;
alter table public.superadmins enable row level security;
alter table public.site_members enable row level security;
alter table public.site_locales enable row level security;

-- Defense in depth: anon never touches these tables directly.
revoke all on public.sites, public.superadmins, public.site_members, public.site_locales from anon;

-- Members can read; all writes go through the service role (manifest sync).
revoke insert, update, delete, truncate on public.sites, public.superadmins, public.site_members, public.site_locales from authenticated;

create policy sites_select on public.sites
  for select to authenticated
  using (id in (select private.my_site_ids()));

create policy site_members_select on public.site_members
  for select to authenticated
  using (site_id in (select private.my_site_ids()));

create policy site_locales_select on public.site_locales
  for select to authenticated
  using (site_id in (select private.my_site_ids()));

-- superadmins: RLS on, no policies → service role only.

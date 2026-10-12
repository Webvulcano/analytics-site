-- Records the result of the last publish (client website revalidate) for a site.
-- Members cannot update `sites` directly, so this narrow definer function does it,
-- only for sites the caller may write.

create or replace function public.cms_mark_published(p_site uuid, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sites
  set last_published_at = case when p_error is null then now() else last_published_at end,
      last_publish_error = left(p_error, 500)
  where id = p_site
    and id in (select private.my_writable_site_ids());
$$;

revoke execute on function public.cms_mark_published(uuid, text) from public, anon, authenticated;
grant execute on function public.cms_mark_published(uuid, text) to authenticated;

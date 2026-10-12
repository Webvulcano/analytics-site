// The site props the post editor needs (plain data for the client component).
export function editorSite(site, locales) {
  const blogLocales = site.blog.locales ?? [site.default_locale];
  return {
    id: site.id,
    slug: site.slug,
    siteUrl: site.site_url,
    previewBase: site.preview_url ?? site.site_url,
    blog: site.blog,
    readOnly: site.status !== "active",
    locales: locales.filter((l) => blogLocales.includes(l.locale)),
  };
}

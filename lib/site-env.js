import "server-only";

// Which environment this admin runs in. Vercel sets VERCEL_ENV ("production" | "preview");
// locally it is unset → "development". All three share one database (same content):
// only the client-site URL the admin frames and refreshes differs.
export const APP_ENV = process.env.VERCEL_ENV ?? "development";

// Local client-site origins for the dev admin, from .env.local:
//   CMS_DEV_SITE_URLS=hallasgondozo=http://localhost:3700,stillsoul-demo=http://localhost:3010
function devUrls() {
  const map = new Map();
  for (const pair of (process.env.CMS_DEV_SITE_URLS ?? "").split(",")) {
    const [slug, url] = pair.split("=").map((s) => s?.trim());
    if (slug && url) map.set(slug, url.replace(/\/$/, ""));
  }
  return map;
}

function devUrl(site) {
  return APP_ENV === "development" ? devUrls().get(site.slug) ?? null : null;
}

// The client-site origin this admin shows (editor iframe, blog preview links):
// production → live site, preview → preview deploy, development → local site.
export function frameUrl(site) {
  if (APP_ENV === "production") return site.site_url;
  if (APP_ENV === "preview") return site.preview_url ?? site.site_url;
  return devUrl(site) ?? site.preview_url ?? site.site_url;
}

// Content is shared, so a save refreshes every deploy that shows it: live + preview, and the
// local site too when running locally (a Vercel-hosted admin cannot reach localhost).
export function revalidateTargets(site) {
  if (!site.revalidate_url) return [];
  const { pathname } = new URL(site.revalidate_url);
  const candidates = [
    { label: "éles", url: site.revalidate_url },
    site.preview_url && { label: "előnézet", url: new URL(pathname, site.preview_url).toString() },
    devUrl(site) && { label: "lokális", url: new URL(pathname, devUrl(site)).toString() },
  ].filter(Boolean);
  // The live and preview URL can be the same deploy (before a domain switch) — call it once.
  return candidates.filter((t, i) => candidates.findIndex((c) => c.url === t.url) === i);
}

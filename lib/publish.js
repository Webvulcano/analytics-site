import "server-only";
import { deriveRevalidateSecret } from "@/lib/secrets";
import { revalidateTargets } from "@/lib/site-env";

async function revalidate(url, slug) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${deriveRevalidateSecret(slug)}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    return e?.name === "TimeoutError" ? "Időtúllépés" : e?.message ?? "Ismeretlen hiba";
  }
}

// Tells the client website to refresh its CMS content. Never throws: a failed publish
// still leaves the content saved (the site also refreshes on its own later).
export async function publishSite(supabase, site) {
  const targets = revalidateTargets(site);
  if (!targets.length) return { published: false, error: "Nincs revalidate URL beállítva" };

  const results = await Promise.all(targets.map((t) => revalidate(t.url, site.slug)));
  const failed = targets.map((t, i) => (results[i] ? `${t.label}: ${results[i]}` : null)).filter(Boolean);
  const error = failed.length ? (targets.length > 1 ? failed.join(", ") : results[0]) : null;

  await supabase.rpc("cms_mark_published", { p_site: site.id, p_error: error });
  return { published: !error, error };
}

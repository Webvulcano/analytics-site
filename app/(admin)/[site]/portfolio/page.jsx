import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import GalleryCategories from "@/components/gallery/GalleryCategories";

export const metadata = { title: "Portfólió" };

export default async function GalleryPage({ params }) {
  const { site: slug } = await params;
  const { site } = await requireSite(slug);
  if (!site.gallery) notFound();
  const supabase = await createClient();

  const [cats, items, locales] = await Promise.all([
    supabase
      .from("gallery_categories")
      .select("id, slug, title, link_key, position")
      .eq("site_id", site.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("gallery_items")
      .select("category_id, kind, path, youtube_id")
      .eq("site_id", site.id)
      .order("position")
      .order("created_at"),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
  ]);
  const failed = [cats, items, locales].find((r) => r.error);
  if (failed) throw new Error(`Galéria adatai nem tölthetők be: ${failed.error.message}`);

  // Item count + first item as cover, per category.
  const stats = new Map();
  for (const it of items.data) {
    const s = stats.get(it.category_id) ?? { count: 0, cover: null };
    s.count += 1;
    s.cover ??= { path: it.path, youtubeId: it.youtube_id };
    stats.set(it.category_id, s);
  }

  return (
    <GalleryCategories
      site={{ slug: site.slug, gallery: site.gallery, defaultLocale: site.default_locale, readOnly: site.status !== "active" }}
      locales={locales.data}
      categories={cats.data.map((c) => ({ ...c, ...(stats.get(c.id) ?? { count: 0, cover: null }) }))}
    />
  );
}

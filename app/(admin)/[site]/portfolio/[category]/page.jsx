import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import GalleryCategoryView from "@/components/gallery/GalleryCategoryView";

export const metadata = { title: "Portfólió" };

export default async function GalleryCategoryPage({ params }) {
  const { site: slug, category: categoryId } = await params;
  const { site } = await requireSite(slug);
  if (!site.gallery || !/^[0-9a-f-]{36}$/.test(categoryId)) notFound();
  const supabase = await createClient();

  const [cats, items, locales] = await Promise.all([
    supabase
      .from("gallery_categories")
      .select("id, slug, title, link_key")
      .eq("site_id", site.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("gallery_items")
      .select("id, kind, path, youtube_id, width, height, bytes, title, year, alt, position, category_id")
      .eq("site_id", site.id)
      .eq("category_id", categoryId)
      .order("position")
      .order("created_at"),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
  ]);
  const failed = [cats, items, locales].find((r) => r.error);
  if (failed) throw new Error(`Galéria adatai nem tölthetők be: ${failed.error.message}`);

  const category = cats.data.find((c) => c.id === categoryId);
  if (!category) notFound();

  return (
    <GalleryCategoryView
      site={{
        id: site.id,
        slug: site.slug,
        gallery: site.gallery,
        defaultLocale: site.default_locale,
        readOnly: site.status !== "active",
      }}
      locales={locales.data}
      category={category}
      categories={cats.data}
      items={items.data}
    />
  );
}

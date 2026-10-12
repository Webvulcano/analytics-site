import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import BlogList from "@/components/blog/BlogList";
import { purgeTrash } from "./actions";

export const metadata = { title: "Blog" };

export default async function BlogPage({ params }) {
  const { site: slug } = await params;
  const { site } = await requireSite(slug);
  if (!site.blog) notFound();

  // A 30 napnál régebben kukába tett cikkek itt törlődnek véglegesen (nincs külön ütemező).
  if (site.status === "active") await purgeTrash(site.slug);

  const supabase = await createClient();
  const [posts, locales] = await Promise.all([
    supabase
      .from("posts")
      .select("id, locale, group_id, slug, title, status, preview_token, published_at, updated_at, deleted_at, cover_path")
      .eq("site_id", site.id)
      .order("deleted_at", { ascending: false, nullsFirst: true })
      .order("published_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false }),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
  ]);
  const failed = [posts, locales].find((r) => r.error);
  if (failed) throw new Error(`A blog adatai nem tölthetők be: ${failed.error.message}`);

  return (
    <BlogList
      site={{
        slug: site.slug,
        siteUrl: site.site_url,
        previewBase: site.preview_url ?? site.site_url,
        blog: site.blog,
        readOnly: site.status !== "active",
      }}
      locales={locales.data.filter((l) => (site.blog.locales ?? [site.default_locale]).includes(l.locale))}
      posts={posts.data}
    />
  );
}

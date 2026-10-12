import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import PostEditor from "@/components/blog/PostEditor";
import { editorSite } from "../editor-site";

export const metadata = { title: "Új cikk" };

// Új cikk: csak az első mentéskor jön létre (üres piszkozatok nem halmozódnak).
// ?forditas=<cikk-id>&nyelv=en → az adott cikk fordítása (ugyanabba a nyelvi csoportba kerül).
export default async function NewPostPage({ params, searchParams }) {
  const { site: slug } = await params;
  const { forditas, nyelv } = await searchParams;
  const { site } = await requireSite(slug);
  if (!site.blog) notFound();

  const supabase = await createClient();
  const { data: locales } = await supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort");
  const blogLocales = site.blog.locales ?? [site.default_locale];

  let source = null;
  if (forditas) {
    const { data } = await supabase
      .from("posts")
      .select("id, title, locale")
      .eq("site_id", site.id)
      .eq("id", String(forditas))
      .is("deleted_at", null)
      .maybeSingle();
    source = data;
  }
  const locale = blogLocales.includes(String(nyelv)) ? String(nyelv) : blogLocales[0];

  return (
    <PostEditor
      site={editorSite(site, locales ?? [])}
      post={null}
      initialLocale={locale}
      translationOf={source ? { id: source.id, title: source.title, locale: source.locale } : null}
      siblings={[]}
    />
  );
}

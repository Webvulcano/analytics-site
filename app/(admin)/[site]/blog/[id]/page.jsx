import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { POST_COLUMNS } from "@/lib/blog";
import PostEditor from "@/components/blog/PostEditor";
import { editorSite } from "../editor-site";

export const metadata = { title: "Cikk szerkesztése" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function EditPostPage({ params }) {
  const { site: slug, id } = await params;
  const { site } = await requireSite(slug);
  if (!site.blog || !UUID.test(id)) notFound();

  const supabase = await createClient();
  const [post, locales] = await Promise.all([
    supabase.from("posts").select(POST_COLUMNS).eq("site_id", site.id).eq("id", id).maybeSingle(),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
  ]);
  if (post.error) throw new Error(`A cikk nem tölthető be: ${post.error.message}`);
  if (!post.data) notFound();

  // Nyelvi párok (fordítás-linkekhez)
  const { data: siblings } = await supabase
    .from("posts")
    .select("id, locale, title, status")
    .eq("site_id", site.id)
    .eq("group_id", post.data.group_id)
    .neq("id", post.data.id)
    .is("deleted_at", null);

  return (
    <PostEditor
      key={post.data.id}
      site={editorSite(site, locales.data ?? [])}
      post={post.data}
      initialLocale={post.data.locale}
      translationOf={null}
      siblings={siblings ?? []}
    />
  );
}

import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { frameUrl } from "@/lib/site-env";
import Editor from "@/components/editor/Editor";
import { editingLocked } from "@/lib/editor/lock";

export const metadata = { title: "Szerkesztés" };

export default async function EditorPage({ params }) {
  const { site: slug } = await params;
  const { site } = await requireSite(slug);
  const supabase = await createClient();

  const [fields, values, slots, locales, pages, images] = await Promise.all([
    supabase
      .from("content_fields")
      .select("id, key, page_key, section_key, section_label, label, help, type, translatable, options, default_value, sort")
      .eq("site_id", site.id)
      .is("archived_at", null)
      .order("sort"),
    supabase.from("content_values").select("field_id, locale, value").eq("site_id", site.id),
    supabase
      .from("image_slots")
      .select(
        "id, key, page_key, section_key, section_label, label, help, kind, max_width, max_height, max_items, aspect, quality, default_src, default_width, default_height, default_alt, sort"
      )
      .eq("site_id", site.id)
      .is("archived_at", null)
      .order("sort"),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
    supabase.from("site_pages").select("key, label, path, paths").eq("site_id", site.id).order("sort"),
    supabase.from("images").select("id, slot_id, path, width, height, bytes, alt, position").eq("site_id", site.id).order("position"),
  ]);

  const failed = [fields, values, slots, locales, pages, images].find((r) => r.error);
  if (failed) throw new Error(`Szerkesztő adatai nem tölthetők be: ${failed.error.message}`);

  // { [fieldKey]: { [locale]: value } }
  const keyById = new Map(fields.data.map((f) => [f.id, f.key]));
  const valueMap = {};
  for (const row of values.data) {
    const key = keyById.get(row.field_id);
    if (key) (valueMap[key] ??= {})[row.locale] = row.value;
  }

  // Single slots: { [slotKey]: image } (first image). Gallery slots: { [slotKey]: [images] } in order.
  const slotById = new Map(slots.data.map((s) => [s.id, s]));
  const imageMap = {};
  const galleryMap = {};
  for (const { slot_id, ...img } of images.data) {
    const slot = slotById.get(slot_id);
    if (!slot) continue;
    if (slot.kind === "gallery") (galleryMap[slot.key] ??= []).push(img);
    else if (!imageMap[slot.key]) imageMap[slot.key] = img;
  }

  if (fields.data.length === 0 && slots.data.length === 0) {
    return (
      <div className="p-6 md:p-10">
        <h1 className="text-2xl font-semibold">Szerkesztés</h1>
        <p className="mt-4 text-sm text-zinc-500">
          Ehhez a weboldalhoz még nincs szerkeszthető tartalom beállítva.
        </p>
      </div>
    );
  }

  return (
    <Editor
      site={{
        id: site.id,
        slug: site.slug,
        name: site.name,
        siteUrl: site.site_url,
        previewUrl: frameUrl(site),
        defaultLocale: site.default_locale,
        readOnly: site.status !== "active",
        locked: editingLocked(site),
        galleryLabel: site.gallery?.label ?? null,
      }}
      fields={fields.data.map(({ id, ...f }) => f)}
      initialValues={valueMap}
      slots={slots.data.map(({ id, ...s }) => s)}
      initialImages={imageMap}
      initialGalleries={galleryMap}
      locales={locales.data}
      pages={pages.data.length ? pages.data : [{ key: "home", label: "Főoldal", path: "/", paths: {} }]}
    />
  );
}

"use server";

import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { validateFieldValue } from "@/lib/content/validate";
import { publishSite } from "@/lib/publish";

// Server Actions are public endpoints: every action re-checks the session and site
// access (requireSite) and validates input; RLS enforces the same again in the DB.

async function loadField(supabase, site, key, locale) {
  const { data: field } = await supabase
    .from("content_fields")
    .select("id, key, label, type, options, translatable, archived_at")
    .eq("site_id", site.id)
    .eq("key", key)
    .maybeSingle();
  if (!field || field.archived_at) return { error: "Ismeretlen mező." };

  const targetLocale = field.translatable ? locale : site.default_locale;
  const { data: loc } = await supabase
    .from("site_locales")
    .select("locale")
    .eq("site_id", site.id)
    .eq("locale", targetLocale)
    .maybeSingle();
  if (!loc) return { error: "Ismeretlen nyelv." };

  return { field, locale: targetLocale };
}

export async function saveField({ siteSlug, key, locale, value }) {
  const { site, user } = await requireSite(String(siteSlug));
  if (site.status !== "active") return { ok: false, error: "Ez a weboldal jelenleg csak olvasható." };

  const supabase = await createClient();
  const target = await loadField(supabase, site, String(key), String(locale));
  if (target.error) return { ok: false, error: target.error };

  const checked = validateFieldValue(target.field, value);
  if (!checked.ok) return { ok: false, error: checked.error };

  const { error } = await supabase.from("content_values").upsert(
    {
      field_id: target.field.id,
      site_id: site.id,
      locale: target.locale,
      value: checked.value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "field_id,locale" }
  );
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };

  const pub = await publishSite(supabase, site);
  return { ok: true, value: checked.value, locale: target.locale, published: pub.published, publishError: pub.error };
}

// Back to the manifest default: delete the saved value (kept in content_revisions).
export async function resetField({ siteSlug, key, locale }) {
  const { site } = await requireSite(String(siteSlug));
  if (site.status !== "active") return { ok: false, error: "Ez a weboldal jelenleg csak olvasható." };

  const supabase = await createClient();
  const target = await loadField(supabase, site, String(key), String(locale));
  if (target.error) return { ok: false, error: target.error };

  const { error } = await supabase
    .from("content_values")
    .delete()
    .eq("field_id", target.field.id)
    .eq("locale", target.locale);
  if (error) return { ok: false, error: `Visszaállítás sikertelen: ${error.message}` };

  const pub = await publishSite(supabase, site);
  return { ok: true, locale: target.locale, published: pub.published, publishError: pub.error };
}

// ── Images ──────────────────────────────────────────────────────────────────

const MEDIA_BUCKET = "site-media";
const MAX_ALT = 300;
const PATH_RE = /^[0-9a-f-]{36}\/slots\/[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+\/[0-9a-f-]{36}\.webp$/;

async function loadSlot(supabase, site, key) {
  const { data: slot } = await supabase
    .from("image_slots")
    .select("id, key, kind, archived_at")
    .eq("site_id", site.id)
    .eq("key", key)
    .maybeSingle();
  if (!slot || slot.archived_at) return null;
  return slot;
}

async function checkLocale(supabase, site, locale) {
  const { data } = await supabase
    .from("site_locales")
    .select("locale")
    .eq("site_id", site.id)
    .eq("locale", locale)
    .maybeSingle();
  return Boolean(data);
}

function cleanAlt(alt) {
  return String(alt ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ALT);
}

// Storage cleanup never fails the save: anything left behind is removed by gc-storage.
async function removeObjects(supabase, paths) {
  if (!paths?.length) return;
  await supabase.storage.from(MEDIA_BUCKET).remove(paths).catch(() => {});
}

// The browser already uploaded the WebP (RLS-checked); this attaches it to the slot.
export async function commitImage({ siteSlug, slotKey, path, width, height, alt, locale }) {
  const { site } = await requireSite(String(siteSlug));
  if (site.status !== "active") return { ok: false, error: "Ez a weboldal jelenleg csak olvasható." };

  const supabase = await createClient();
  const slot = await loadSlot(supabase, site, String(slotKey));
  if (!slot) return { ok: false, error: "Ismeretlen képhely." };
  if (slot.kind !== "single") return { ok: false, error: "Galéria szerkesztése még nem támogatott." };
  if (!(await checkLocale(supabase, site, String(locale)))) return { ok: false, error: "Ismeretlen nyelv." };

  path = String(path);
  if (!PATH_RE.test(path) || !path.startsWith(`${site.id}/slots/${slot.key}/`)) {
    return { ok: false, error: "Érvénytelen fájl-útvonal." };
  }
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    return { ok: false, error: "Érvénytelen képméret." };
  }

  if (!cleanAlt(alt)) return { ok: false, error: "A kép leírása (alt szöveg) kötelező." };

  // Keep alt texts of the other languages from the image being replaced.
  const { data: prev } = await supabase.from("images").select("alt").eq("slot_id", slot.id).maybeSingle();
  const altMap = { ...(prev?.alt ?? {}), [String(locale)]: cleanAlt(alt) };

  const { data, error } = await supabase.rpc("cms_commit_image", {
    p_slot: slot.id,
    p_path: path,
    p_width: w,
    p_height: h,
    p_alt: altMap,
  });
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };

  await removeObjects(supabase, data.removed);
  const pub = await publishSite(supabase, site);
  return {
    ok: true,
    image: { path, width: w, height: h, bytes: data.bytes, alt: altMap },
    published: pub.published,
    publishError: pub.error,
  };
}

export async function saveImageAlt({ siteSlug, slotKey, alt, locale }) {
  const { site } = await requireSite(String(siteSlug));
  if (site.status !== "active") return { ok: false, error: "Ez a weboldal jelenleg csak olvasható." };

  const supabase = await createClient();
  const slot = await loadSlot(supabase, site, String(slotKey));
  if (!slot) return { ok: false, error: "Ismeretlen képhely." };
  if (!(await checkLocale(supabase, site, String(locale)))) return { ok: false, error: "Ismeretlen nyelv." };

  if (!cleanAlt(alt)) return { ok: false, error: "A kép leírása (alt szöveg) kötelező." };

  const { data: row } = await supabase.from("images").select("id, alt").eq("slot_id", slot.id).maybeSingle();
  if (!row) return { ok: false, error: "Az alapképhez nem adható leírás — előbb tölts fel saját képet." };

  const altMap = { ...row.alt, [String(locale)]: cleanAlt(alt) };
  const { error } = await supabase.from("images").update({ alt: altMap }).eq("id", row.id);
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };

  const pub = await publishSite(supabase, site);
  return { ok: true, alt: altMap, published: pub.published, publishError: pub.error };
}

// Back to the template image: drop the slot's uploaded image(s).
export async function resetImage({ siteSlug, slotKey }) {
  const { site } = await requireSite(String(siteSlug));
  if (site.status !== "active") return { ok: false, error: "Ez a weboldal jelenleg csak olvasható." };

  const supabase = await createClient();
  const slot = await loadSlot(supabase, site, String(slotKey));
  if (!slot) return { ok: false, error: "Ismeretlen képhely." };

  const { data: removed, error } = await supabase.from("images").delete().eq("slot_id", slot.id).select("path");
  if (error) return { ok: false, error: `Visszaállítás sikertelen: ${error.message}` };

  await removeObjects(supabase, removed.map((r) => r.path));
  const pub = await publishSite(supabase, site);
  return { ok: true, published: pub.published, publishError: pub.error };
}

export async function retryPublish({ siteSlug }) {
  const { site } = await requireSite(String(siteSlug));
  const supabase = await createClient();
  const pub = await publishSite(supabase, site);
  return { ok: pub.published, error: pub.error };
}

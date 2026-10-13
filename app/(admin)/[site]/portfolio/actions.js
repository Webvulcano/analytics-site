"use server";

import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { publishSite } from "@/lib/publish";
import { MAX_ALT, MAX_TITLE, cleanLocaleMap, parseYouTubeId, slugify } from "@/lib/gallery";

// Server Actions are public endpoints: every action re-checks the session and site
// access (requireSite) and validates input; RLS enforces the same again in the DB.

const MEDIA_BUCKET = "site-media";
const UUID = /^[0-9a-f-]{36}$/;

async function context(siteSlug) {
  const { site } = await requireSite(String(siteSlug));
  if (!site.gallery) return { error: "Ennél a weboldalnál nincs galéria." };
  if (site.status !== "active") return { error: "Ez a weboldal jelenleg csak olvasható." };
  const supabase = await createClient();
  const { data: locs } = await supabase.from("site_locales").select("locale").eq("site_id", site.id);
  return { site, supabase, locales: (locs ?? []).map((l) => l.locale) };
}

async function publish(ctx, skip) {
  if (skip) return { published: null, publishError: null };
  const pub = await publishSite(ctx.supabase, ctx.site);
  return { published: pub.published, publishError: pub.error };
}

function linkKey(site, link) {
  if (link == null || link === "") return { value: null };
  const ok = (site.gallery.links ?? []).some((l) => l.key === link);
  return ok ? { value: String(link) } : { error: "Ismeretlen főoldali gomb." };
}

async function loadCategory(ctx, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await ctx.supabase
    .from("gallery_categories")
    .select("id, slug, title, link_key")
    .eq("site_id", ctx.site.id)
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function nextPosition(ctx, table, column, value) {
  const { data } = await ctx.supabase
    .from(table)
    .select("position")
    .eq(column, value)
    .order("position", { ascending: false })
    .limit(1);
  return (data?.[0]?.position ?? -1) + 1;
}

async function removeObjects(ctx, paths) {
  const list = paths.filter(Boolean);
  if (list.length) await ctx.supabase.storage.from(MEDIA_BUCKET).remove(list).catch(() => {});
}

function dbError(error, fallback) {
  if (error?.code === "23505" && /link/.test(error.message)) return "Ez a főoldali gomb már egy másik kategóriához tartozik.";
  return `${fallback}: ${error.message}`;
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function createCategory({ siteSlug, title, link }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };

  const titles = cleanLocaleMap(title, ctx.locales, MAX_TITLE);
  const main = titles[ctx.site.default_locale];
  if (!main) return { ok: false, error: "A kategória neve kötelező." };
  const lk = linkKey(ctx.site, link);
  if (lk.error) return { ok: false, error: lk.error };

  const base = slugify(main) || "kategoria";
  const { data: taken } = await ctx.supabase
    .from("gallery_categories")
    .select("slug")
    .eq("site_id", ctx.site.id)
    .like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((r) => r.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;

  const { data, error } = await ctx.supabase
    .from("gallery_categories")
    .insert({
      site_id: ctx.site.id,
      slug,
      title: titles,
      link_key: lk.value,
      position: await nextPosition(ctx, "gallery_categories", "site_id", ctx.site.id),
    })
    .select("id, slug, title, link_key, position")
    .single();
  if (error) return { ok: false, error: dbError(error, "Létrehozás sikertelen") };

  return { ok: true, category: data, ...(await publish(ctx)) };
}

export async function updateCategory({ siteSlug, id, title, link }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const cat = await loadCategory(ctx, id);
  if (!cat) return { ok: false, error: "Ismeretlen kategória." };

  const titles = cleanLocaleMap(title, ctx.locales, MAX_TITLE);
  if (!titles[ctx.site.default_locale]) return { ok: false, error: "A kategória neve kötelező." };
  const lk = linkKey(ctx.site, link);
  if (lk.error) return { ok: false, error: lk.error };

  const { error } = await ctx.supabase
    .from("gallery_categories")
    .update({ title: titles, link_key: lk.value })
    .eq("id", cat.id);
  if (error) return { ok: false, error: dbError(error, "Mentés sikertelen") };

  return { ok: true, ...(await publish(ctx)) };
}

// Deletes the category with all its items and their files.
export async function deleteCategory({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const cat = await loadCategory(ctx, id);
  if (!cat) return { ok: false, error: "Ismeretlen kategória." };

  const { data: items } = await ctx.supabase.from("gallery_items").select("path").eq("category_id", cat.id);
  const { error } = await ctx.supabase.from("gallery_categories").delete().eq("id", cat.id);
  if (error) return { ok: false, error: `Törlés sikertelen: ${error.message}` };

  await removeObjects(ctx, (items ?? []).map((i) => i.path));
  return { ok: true, ...(await publish(ctx)) };
}

export async function reorderCategories({ siteSlug, ids }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!Array.isArray(ids) || !ids.every((x) => UUID.test(String(x)))) return { ok: false, error: "Hibás sorrend." };

  const { error } = await ctx.supabase.rpc("cms_gallery_reorder", { p_site: ctx.site.id, p_category: null, p_ids: ids });
  if (error) return { ok: false, error: `Sorrend mentése sikertelen: ${error.message}` };
  return { ok: true, ...(await publish(ctx)) };
}

// ── Items ───────────────────────────────────────────────────────────────────

// The browser already uploaded the WebP (RLS-checked); this records it in the category.
// deferPublish: batch uploads publish once at the end (publishGallery).
export async function addPhoto({ siteSlug, categoryId, path, width, height, bytes, alt, deferPublish }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const cat = await loadCategory(ctx, categoryId);
  if (!cat) return { ok: false, error: "Ismeretlen kategória." };

  path = String(path);
  const re = new RegExp(`^${ctx.site.id}/gallery/${cat.id}/[0-9a-f-]{36}\\.webp$`);
  if (!re.test(path)) return { ok: false, error: "Érvénytelen fájl-útvonal." };
  const w = Number(width);
  const h = Number(height);
  const b = Number(bytes);
  const max = ctx.site.gallery.maxWidth ?? 2000;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > max) {
    return { ok: false, error: "Érvénytelen képméret." };
  }

  const alts = cleanLocaleMap(alt, ctx.locales, MAX_ALT);
  if (!alts[ctx.site.default_locale]) return { ok: false, error: "A kép leírása (alt szöveg) kötelező." };

  const { data, error } = await ctx.supabase
    .from("gallery_items")
    .insert({
      site_id: ctx.site.id,
      category_id: cat.id,
      kind: "photo",
      path,
      width: w,
      height: h,
      bytes: Number.isInteger(b) && b > 0 ? b : null,
      alt: alts,
      position: await nextPosition(ctx, "gallery_items", "category_id", cat.id),
    })
    .select("id, kind, path, youtube_id, width, height, bytes, title, year, alt, focus_x, focus_y, fit, position, category_id")
    .single();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };

  return { ok: true, item: data, ...(await publish(ctx, deferPublish)) };
}

export async function addVideo({ siteSlug, categoryId, url, title, year }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const cat = await loadCategory(ctx, categoryId);
  if (!cat) return { ok: false, error: "Ismeretlen kategória." };

  const youtubeId = parseYouTubeId(url);
  if (!youtubeId) return { ok: false, error: "Ez nem érvényes YouTube-link." };
  const y = parseYear(year);
  if (y.error) return { ok: false, error: y.error };

  const { data, error } = await ctx.supabase
    .from("gallery_items")
    .insert({
      site_id: ctx.site.id,
      category_id: cat.id,
      kind: "video",
      youtube_id: youtubeId,
      title: cleanLocaleMap(title, ctx.locales, MAX_TITLE),
      year: y.value,
      position: await nextPosition(ctx, "gallery_items", "category_id", cat.id),
    })
    .select("id, kind, path, youtube_id, width, height, bytes, title, year, alt, focus_x, focus_y, fit, position, category_id")
    .single();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };

  return { ok: true, item: data, ...(await publish(ctx)) };
}

function parseYear(year) {
  if (year == null || String(year).trim() === "") return { value: null };
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return { error: "Az évszám 1900 és 2100 közötti egész szám legyen." };
  return { value: y };
}

// Crop anchor in % (0–100) + fit mode; undefined = unchanged.
function parseFocus(focus, fit) {
  const out = {};
  if (focus !== undefined) {
    const x = Number(focus?.x);
    const y = Number(focus?.y);
    if (![x, y].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) return { error: "Érvénytelen fókuszpont." };
    out.focus_x = x;
    out.focus_y = y;
  }
  if (fit !== undefined) {
    if (fit !== "cover" && fit !== "contain") return { error: "Érvénytelen megjelenítési mód." };
    out.fit = fit;
  }
  return { value: out };
}

// coverPath: videos only — a just-uploaded own cover image (null = back to the YouTube thumbnail).
export async function updateItem({ siteSlug, id, title, alt, year, categoryId, coverPath, focus, fit }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen elem." };

  const { data: item } = await ctx.supabase
    .from("gallery_items")
    .select("id, kind, category_id, path")
    .eq("site_id", ctx.site.id)
    .eq("id", id)
    .maybeSingle();
  if (!item) return { ok: false, error: "Ismeretlen elem." };
  let oldCover = null;

  const y = parseYear(year);
  if (y.error) return { ok: false, error: y.error };
  const f = parseFocus(focus, fit);
  if (f.error) return { ok: false, error: f.error };
  const patch = { title: cleanLocaleMap(title, ctx.locales, MAX_TITLE), year: y.value, ...f.value };

  if (item.kind === "photo") {
    patch.alt = cleanLocaleMap(alt, ctx.locales, MAX_ALT);
    if (!patch.alt[ctx.site.default_locale]) return { ok: false, error: "A kép leírása (alt szöveg) kötelező." };
  }

  if (item.kind === "video" && coverPath !== undefined) {
    if (coverPath === null) {
      patch.path = null;
    } else {
      const re = new RegExp(`^${ctx.site.id}/gallery/[0-9a-f-]{36}/[0-9a-f-]{36}\\.webp$`);
      if (!re.test(String(coverPath))) return { ok: false, error: "Érvénytelen fájl-útvonal." };
      patch.path = String(coverPath);
    }
    if (item.path && item.path !== patch.path) oldCover = item.path;
  }

  if (categoryId && categoryId !== item.category_id) {
    const target = await loadCategory(ctx, categoryId);
    if (!target) return { ok: false, error: "Ismeretlen kategória." };
    patch.category_id = target.id;
    patch.position = await nextPosition(ctx, "gallery_items", "category_id", target.id);
  }

  const { data, error } = await ctx.supabase
    .from("gallery_items")
    .update(patch)
    .eq("id", item.id)
    .select("id, kind, path, youtube_id, width, height, bytes, title, year, alt, focus_x, focus_y, fit, position, category_id")
    .single();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };

  if (oldCover) await removeObjects(ctx, [oldCover]);
  return { ok: true, item: data, ...(await publish(ctx)) };
}

export async function deleteItem({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen elem." };

  const { data, error } = await ctx.supabase
    .from("gallery_items")
    .delete()
    .eq("site_id", ctx.site.id)
    .eq("id", id)
    .select("path");
  if (error) return { ok: false, error: `Törlés sikertelen: ${error.message}` };
  if (!data.length) return { ok: false, error: "Ismeretlen elem." };

  await removeObjects(ctx, data.map((r) => r.path));
  return { ok: true, ...(await publish(ctx)) };
}

export async function reorderItems({ siteSlug, categoryId, ids }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const cat = await loadCategory(ctx, categoryId);
  if (!cat) return { ok: false, error: "Ismeretlen kategória." };
  if (!Array.isArray(ids) || !ids.every((x) => UUID.test(String(x)))) return { ok: false, error: "Hibás sorrend." };

  const { error } = await ctx.supabase.rpc("cms_gallery_reorder", { p_site: ctx.site.id, p_category: cat.id, p_ids: ids });
  if (error) return { ok: false, error: `Sorrend mentése sikertelen: ${error.message}` };
  return { ok: true, ...(await publish(ctx)) };
}

export async function publishGallery({ siteSlug }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  return { ok: true, ...(await publish(ctx)) };
}

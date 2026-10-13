"use server";

import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { publishSite } from "@/lib/publish";
import { MAX_PRICE, MAX_TIERS, MAX_TITLE, PACKAGE_COLS } from "@/lib/packages";

// Server Actions are public endpoints: every action re-checks the session and site
// access (requireSite) and validates input; RLS + the files check constraint enforce it again in the DB.
// PDFs are uploaded by the browser first (lib/image/upload.js uploadPackagePdf), the actions only
// attach the paths and remove the files a save replaced / a delete left behind.

const UUID = /^[0-9a-f-]{36}$/;
const MEDIA_BUCKET = "site-media";
const pdfPath = (siteId) =>
  new RegExp(`^${siteId}/packages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$`);

async function context(siteSlug) {
  const { site } = await requireSite(String(siteSlug));
  if (!site.packages) return { error: "Ennél a weboldalnál nincs csomag-modul." };
  if (site.status !== "active") return { error: "Ez a weboldal jelenleg csak olvasható." };
  const supabase = await createClient();
  const { data: locs } = await supabase.from("site_locales").select("locale").eq("site_id", site.id);
  return { site, supabase, locales: (locs ?? []).map((l) => l.locale) };
}

async function publish(ctx) {
  const pub = await publishSite(ctx.supabase, ctx.site);
  return { published: pub.published, publishError: pub.error };
}

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// { hu: "…", en: "…" } → only the site's locales, trimmed, empty ones dropped.
function localeMap(map, locales, max) {
  const out = {};
  for (const l of locales) {
    const v = clean(map?.[l], max);
    if (v) out[l] = v;
  }
  return out;
}

// Validated row fields from the form, or { error }.
function parsePackage(ctx, { title, tiers, price, files }) {
  const t = localeMap(title, ctx.locales, MAX_TITLE);
  if (!t[ctx.site.default_locale]) return { error: "A csomag neve (alapnyelven) kötelező." };
  const re = pdfPath(ctx.site.id);
  const f = {};
  for (const l of ctx.locales) {
    const p = files?.[l];
    if (p == null || p === "") continue;
    if (typeof p !== "string" || !re.test(p)) return { error: "Érvénytelen PDF." };
    f[l] = p;
  }
  if (!f[ctx.site.default_locale]) return { error: "A PDF (alapnyelven) kötelező." };
  return {
    value: { title: t, tiers: localeMap(tiers, ctx.locales, MAX_TIERS), price: localeMap(price, ctx.locales, MAX_PRICE), files: f },
  };
}

// Best effort: a file left behind is picked up by scripts/gc-storage.mjs later.
async function removeFiles(ctx, paths) {
  const list = paths.filter(Boolean);
  if (list.length) await ctx.supabase.storage.from(MEDIA_BUCKET).remove(list).catch(() => {});
}

export async function createPackage({ siteSlug, ...input }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const parsed = parsePackage(ctx, input);
  if (parsed.error) return { ok: false, error: parsed.error };

  // New packages go to the end: the order is usually deliberate (cheapest / main offer first).
  const { data: last } = await ctx.supabase
    .from("packages")
    .select("position")
    .eq("site_id", ctx.site.id)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { data, error } = await ctx.supabase
    .from("packages")
    .insert({ site_id: ctx.site.id, ...parsed.value, visible: true, position })
    .select(PACKAGE_COLS)
    .single();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };
  return { ok: true, pkg: data, ...(await publish(ctx)) };
}

export async function updatePackage({ siteSlug, id, ...input }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen csomag." };
  const parsed = parsePackage(ctx, input);
  if (parsed.error) return { ok: false, error: parsed.error };

  const { data: old } = await ctx.supabase
    .from("packages")
    .select("files")
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .maybeSingle();
  if (!old) return { ok: false, error: "Ismeretlen csomag." };

  const { data, error } = await ctx.supabase
    .from("packages")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .select(PACKAGE_COLS)
    .maybeSingle();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };
  if (!data) return { ok: false, error: "Ismeretlen csomag." };

  const kept = new Set(Object.values(data.files ?? {}));
  await removeFiles(ctx, Object.values(old.files ?? {}).filter((p) => !kept.has(p)));
  return { ok: true, pkg: data, ...(await publish(ctx)) };
}

export async function setPackageVisible({ siteSlug, id, visible }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen csomag." };

  const { data, error } = await ctx.supabase
    .from("packages")
    .update({ visible: Boolean(visible) })
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .select(PACKAGE_COLS)
    .maybeSingle();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };
  if (!data) return { ok: false, error: "Ismeretlen csomag." };
  return { ok: true, pkg: data, ...(await publish(ctx)) };
}

export async function deletePackage({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen csomag." };

  const { data, error } = await ctx.supabase
    .from("packages")
    .delete()
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .select("files");
  if (error) return { ok: false, error: `Törlés sikertelen: ${error.message}` };
  if (!data?.length) return { ok: false, error: "Ismeretlen csomag." };
  await removeFiles(ctx, Object.values(data[0].files ?? {}));
  return { ok: true, ...(await publish(ctx)) };
}

export async function reorderPackages({ siteSlug, ids }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!Array.isArray(ids) || !ids.every((x) => UUID.test(String(x)))) return { ok: false, error: "Érvénytelen sorrend." };

  const { error } = await ctx.supabase.rpc("cms_packages_reorder", { p_site: ctx.site.id, p_ids: ids.map(String) });
  if (error) return { ok: false, error: `Sorrend mentése sikertelen: ${error.message}` };
  return { ok: true, ...(await publish(ctx)) };
}

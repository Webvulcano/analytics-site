"use server";

import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { publishSite } from "@/lib/publish";
import { MAX_AUTHOR, MAX_BODY, MAX_SUBTITLE, REVIEW_COLS } from "@/lib/reviews";

// Server Actions are public endpoints: every action re-checks the session and site
// access (requireSite) and validates input; RLS enforces the same again in the DB.

const UUID = /^[0-9a-f-]{36}$/;

async function context(siteSlug) {
  const { site } = await requireSite(String(siteSlug));
  if (!site.reviews) return { error: "Ennél a weboldalnál nincs értékelés-modul." };
  if (site.status !== "active") return { error: "Ez a weboldal jelenleg csak olvasható." };
  const supabase = await createClient();
  const { data: locs } = await supabase.from("site_locales").select("locale").eq("site_id", site.id);
  return { site, supabase, locales: (locs ?? []).map((l) => l.locale) };
}

async function publish(ctx) {
  const pub = await publishSite(ctx.supabase, ctx.site);
  return { published: pub.published, publishError: pub.error };
}

const clean = (v, max, multiline = false) => {
  const s = String(v ?? "");
  const out = multiline ? s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim();
  return out.slice(0, max);
};

// { hu: "…", en: "…" } → only the site's locales, trimmed, empty ones dropped.
function localeMap(map, locales, max, multiline) {
  const out = {};
  for (const l of locales) {
    const v = clean(map?.[l], max, multiline);
    if (v) out[l] = v;
  }
  return out;
}

// Validated row fields from the form, or { error }.
function parseReview(ctx, { author, subtitle, body, rating }) {
  const a = clean(author, MAX_AUTHOR);
  if (!a) return { error: "A név kötelező." };
  const b = localeMap(body, ctx.locales, MAX_BODY, true);
  if (!b[ctx.site.default_locale]) return { error: "Az értékelés szövege (alapnyelven) kötelező." };
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return { error: "A csillagok száma 1 és 5 között legyen." };
  return { value: { author: a, subtitle: localeMap(subtitle, ctx.locales, MAX_SUBTITLE), body: b, rating: r } };
}

export async function createReview({ siteSlug, ...input }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const parsed = parseReview(ctx, input);
  if (parsed.error) return { ok: false, error: parsed.error };

  // New reviews go to the front: they are usually the freshest.
  const { data: first } = await ctx.supabase
    .from("reviews")
    .select("position")
    .eq("site_id", ctx.site.id)
    .order("position")
    .limit(1);
  const position = (first?.[0]?.position ?? 1) - 1;

  const { data, error } = await ctx.supabase
    .from("reviews")
    .insert({ site_id: ctx.site.id, ...parsed.value, visible: true, position })
    .select(REVIEW_COLS)
    .single();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };
  return { ok: true, review: data, ...(await publish(ctx)) };
}

export async function updateReview({ siteSlug, id, ...input }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen értékelés." };
  const parsed = parseReview(ctx, input);
  if (parsed.error) return { ok: false, error: parsed.error };

  const { data, error } = await ctx.supabase
    .from("reviews")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .select(REVIEW_COLS)
    .maybeSingle();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };
  if (!data) return { ok: false, error: "Ismeretlen értékelés." };
  return { ok: true, review: data, ...(await publish(ctx)) };
}

export async function setReviewVisible({ siteSlug, id, visible }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen értékelés." };

  const { data, error } = await ctx.supabase
    .from("reviews")
    .update({ visible: Boolean(visible) })
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .select(REVIEW_COLS)
    .maybeSingle();
  if (error) return { ok: false, error: `Mentés sikertelen: ${error.message}` };
  if (!data) return { ok: false, error: "Ismeretlen értékelés." };
  return { ok: true, review: data, ...(await publish(ctx)) };
}

export async function deleteReview({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!UUID.test(String(id))) return { ok: false, error: "Ismeretlen értékelés." };

  const { data, error } = await ctx.supabase
    .from("reviews")
    .delete()
    .eq("site_id", ctx.site.id)
    .eq("id", String(id))
    .select("id");
  if (error) return { ok: false, error: `Törlés sikertelen: ${error.message}` };
  if (!data?.length) return { ok: false, error: "Ismeretlen értékelés." };
  return { ok: true, ...(await publish(ctx)) };
}

export async function reorderReviews({ siteSlug, ids }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!Array.isArray(ids) || !ids.every((x) => UUID.test(String(x)))) return { ok: false, error: "Érvénytelen sorrend." };

  const { error } = await ctx.supabase.rpc("cms_reviews_reorder", { p_site: ctx.site.id, p_ids: ids.map(String) });
  if (error) return { ok: false, error: `Sorrend mentése sikertelen: ${error.message}` };
  return { ok: true, ...(await publish(ctx)) };
}

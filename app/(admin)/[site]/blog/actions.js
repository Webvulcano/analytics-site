"use server";

import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { publishSite } from "@/lib/publish";
import { validatePost } from "@/lib/blog/validate";
import { COVER, LIMITS, POST_COLUMNS, TRASH_DAYS } from "@/lib/blog";

// Server Actions are public endpoints: every action re-checks the session and site access
// (requireSite), validates input, and RLS enforces the same again in the DB.
// The website is revalidated only when the change is visible there (published before or after).

const MEDIA_BUCKET = "site-media";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function context(siteSlug) {
  const { site } = await requireSite(String(siteSlug));
  if (!site.blog) return { error: "Ennél a weboldalnál nincs blog." };
  if (site.status !== "active") return { error: "Ez a weboldal jelenleg csak olvasható." };
  return { site, supabase: await createClient() };
}

async function loadPost(ctx, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await ctx.supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("site_id", ctx.site.id)
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function removeObjects(ctx, paths) {
  const list = paths.filter(Boolean);
  if (list.length) await ctx.supabase.storage.from(MEDIA_BUCKET).remove(list).catch(() => {});
}

async function publish(ctx, needed) {
  if (!needed) return { published: null, publishError: null };
  const pub = await publishSite(ctx.supabase, ctx.site);
  return { published: pub.published, publishError: pub.error };
}

function dbError(error, fallback) {
  if (error?.code === "23505" && /slug/.test(error.message)) {
    return "Ez az URL-név már foglalt egy másik cikknél (ezen a nyelven). Válassz másikat.";
  }
  return `${fallback}: ${error.message}`;
}

const nowIso = () => new Date().toISOString();

// ── Mentés / közzététel ─────────────────────────────────────────────────────

// action: "save" (állapot marad; új cikk = piszkozat) | "publish" (közzététel / frissítés élesben)
export async function savePost({ siteSlug, id, data, action = "save", group }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };

  const existing = id ? await loadPost(ctx, id) : null;
  if (id && !existing) return { ok: false, error: "A cikk nem található." };
  if (existing?.deleted_at) return { ok: false, error: "A kukában lévő cikk nem szerkeszthető - előbb állítsd vissza." };

  const checked = validatePost(
    { ...data, locale: existing?.locale ?? data?.locale },
    { locales: ctx.site.blog.locales ?? [ctx.site.default_locale] }
  );
  if (!checked.ok) return { ok: false, error: checked.error };
  const row = checked.value;

  // A közzétett cikk URL-je nem változhat: a Google és a megosztott linkek erre mutatnak.
  if (existing && existing.status !== "draft" && row.slug !== existing.slug) {
    return { ok: false, error: "A már közzétett cikk URL-neve nem módosítható." };
  }

  row.status = action === "publish" ? "published" : existing?.status ?? "draft";
  if (row.status !== "draft") row.published_at = row.published_at ?? existing?.published_at ?? nowIso();

  let saved;
  if (existing) {
    const { data: upd, error } = await ctx.supabase
      .from("posts")
      .update(row)
      .eq("site_id", ctx.site.id)
      .eq("id", existing.id)
      .select(POST_COLUMNS)
      .single();
    if (error) return { ok: false, error: dbError(error, "Mentés sikertelen") };
    saved = upd;
  } else {
    // Fordítás: ugyanabba a csoportba kerül, mint a forrás-cikk (más nyelven).
    let groupId = null;
    if (group) {
      const source = await loadPost(ctx, group);
      if (!source || source.deleted_at) return { ok: false, error: "A forrás-cikk nem található." };
      if (source.locale === row.locale) return { ok: false, error: "A fordítás nyelve nem lehet ugyanaz." };
      const { count } = await ctx.supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("group_id", source.group_id)
        .eq("locale", row.locale)
        .is("deleted_at", null);
      if (count) return { ok: false, error: "Ennek a cikknek már van ilyen nyelvű változata." };
      groupId = source.group_id;
    }
    const { data: ins, error } = await ctx.supabase
      .from("posts")
      .insert({ site_id: ctx.site.id, ...row, ...(groupId ? { group_id: groupId } : {}) })
      .select(POST_COLUMNS)
      .single();
    if (error) return { ok: false, error: dbError(error, "Mentés sikertelen") };
    saved = ins;
  }

  const pub = await publish(ctx, saved.status === "published" || existing?.status === "published");
  return { ok: true, post: saved, ...pub };
}

// Közzététel (published) vagy elrejtés (hidden) - tartalom nem változik.
export async function setPostStatus({ siteSlug, id, status }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (status !== "published" && status !== "hidden") return { ok: false, error: "Ismeretlen állapot." };

  const post = await loadPost(ctx, id);
  if (!post || post.deleted_at) return { ok: false, error: "A cikk nem található." };
  if (status === "hidden" && post.status === "draft") return { ok: false, error: "Piszkozatot nem kell elrejteni - nem látszik." };

  const { data, error } = await ctx.supabase
    .from("posts")
    .update({ status, ...(status === "published" && !post.published_at ? { published_at: nowIso() } : {}) })
    .eq("site_id", ctx.site.id)
    .eq("id", post.id)
    .select(POST_COLUMNS)
    .single();
  if (error) return { ok: false, error: dbError(error, "Módosítás sikertelen") };

  const pub = await publish(ctx, true);
  return { ok: true, post: data, ...pub };
}

// ── Kuka ────────────────────────────────────────────────────────────────────

export async function trashPost({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = await loadPost(ctx, id);
  if (!post || post.deleted_at) return { ok: false, error: "A cikk nem található." };

  const { data, error } = await ctx.supabase
    .from("posts")
    .update({ deleted_at: nowIso() })
    .eq("site_id", ctx.site.id)
    .eq("id", post.id)
    .select(POST_COLUMNS)
    .single();
  if (error) return { ok: false, error: dbError(error, "Törlés sikertelen") };

  const pub = await publish(ctx, post.status === "published");
  return { ok: true, post: data, ...pub };
}

export async function restorePost({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = await loadPost(ctx, id);
  if (!post?.deleted_at) return { ok: false, error: "A cikk nem található a kukában." };

  const { data, error } = await ctx.supabase
    .from("posts")
    .update({ deleted_at: null })
    .eq("site_id", ctx.site.id)
    .eq("id", post.id)
    .select(POST_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Időközben készült egy cikk ugyanezzel az URL-névvel - azt nevezd át, és utána állítsd vissza ezt." };
    }
    return { ok: false, error: dbError(error, "Visszaállítás sikertelen") };
  }

  const pub = await publish(ctx, data.status === "published");
  return { ok: true, post: data, ...pub };
}

export async function deletePostForever({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = await loadPost(ctx, id);
  if (!post?.deleted_at) return { ok: false, error: "Véglegesen csak a kukában lévő cikk törölhető." };

  const { error } = await ctx.supabase.from("posts").delete().eq("site_id", ctx.site.id).eq("id", post.id);
  if (error) return { ok: false, error: dbError(error, "Törlés sikertelen") };
  await removeObjects(ctx, [post.cover_path, post.og_path]);
  return { ok: true };
}

// A lista megnyitásakor: a 30 napnál régebben kukába tett cikkek végleges törlése (képekkel). Nem dob.
export async function purgeTrash(siteSlug) {
  try {
    const ctx = await context(siteSlug);
    if (ctx.error) return 0;
    const cutoff = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString();
    const { data } = await ctx.supabase
      .from("posts")
      .delete()
      .eq("site_id", ctx.site.id)
      .lt("deleted_at", cutoff)
      .select("cover_path, og_path");
    await removeObjects(ctx, (data ?? []).flatMap((p) => [p.cover_path, p.og_path]));
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

// ── Borítókép ───────────────────────────────────────────────────────────────

// A böngésző feltöltötte a borítót (WebP) és a megosztási képet (JPEG) a cikk mappájába; itt kötjük a cikkhez.
export async function commitPostCover({ siteSlug, id, path, ogPath, width, height, alt }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = await loadPost(ctx, id);
  if (!post || post.deleted_at) return { ok: false, error: "A cikk nem található." };

  const folder = `${ctx.site.id}/blog/${post.id}/`;
  const name = String(path ?? "").slice(folder.length);
  const ogName = String(ogPath ?? "").slice(folder.length);
  if (!String(path).startsWith(folder) || !/^[0-9a-f-]{36}\.webp$/.test(name)) return { ok: false, error: "Érvénytelen fájl-útvonal." };
  if (!String(ogPath).startsWith(folder) || !/^og-[0-9a-f-]{36}\.jpg$/.test(ogName)) return { ok: false, error: "Érvénytelen fájl-útvonal." };
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > COVER.maxWidth) {
    return { ok: false, error: "A kép mérete nem megfelelő." };
  }
  const coverAlt = String(alt ?? "").replace(/\s+/g, " ").trim();
  if (!coverAlt) return { ok: false, error: "Add meg a kép leírását (alt szöveg)." };
  if (coverAlt.length > LIMITS.coverAlt) return { ok: false, error: `A kép leírása túl hosszú (max ${LIMITS.coverAlt}).` };

  // Hogy a fájlok tényleg léteznek (WebP / JPEG, ≤ 3 MB), azt a posts tábla triggere ellenőrzi (0015_hardening).
  const { data, error } = await ctx.supabase
    .from("posts")
    .update({ cover_path: path, cover_width: w, cover_height: h, cover_alt: coverAlt, og_path: ogPath })
    .eq("site_id", ctx.site.id)
    .eq("id", post.id)
    .select(POST_COLUMNS)
    .single();
  if (error) return { ok: false, error: dbError(error, "Mentés sikertelen") };

  await removeObjects(ctx, [post.cover_path !== path && post.cover_path, post.og_path !== ogPath && post.og_path]);
  const pub = await publish(ctx, post.status === "published");
  return { ok: true, post: data, ...pub };
}

export async function removePostCover({ siteSlug, id }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = await loadPost(ctx, id);
  if (!post || post.deleted_at) return { ok: false, error: "A cikk nem található." };

  const { data, error } = await ctx.supabase
    .from("posts")
    .update({ cover_path: null, cover_width: null, cover_height: null, cover_alt: null, og_path: null })
    .eq("site_id", ctx.site.id)
    .eq("id", post.id)
    .select(POST_COLUMNS)
    .single();
  if (error) return { ok: false, error: dbError(error, "Törlés sikertelen") };

  await removeObjects(ctx, [post.cover_path, post.og_path]);
  const pub = await publish(ctx, post.status === "published");
  return { ok: true, post: data, ...pub };
}

export async function retryBlogPublish({ siteSlug }) {
  const ctx = await context(siteSlug);
  if (ctx.error) return { ok: false, error: ctx.error };
  const pub = await publishSite(ctx.supabase, ctx.site);
  return { ok: pub.published, error: pub.error };
}

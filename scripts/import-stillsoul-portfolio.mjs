#!/usr/bin/env node
// One-off: imports the StillSoul portfolio (own Supabase: categories + portfolio_items, and
// images in public/) into the Ügyfél Admin gallery module, converting every image to WebP.
// The source is only READ (anon key).
//
//   node scripts/import-stillsoul-portfolio.mjs <stillsoul-copy-repo> [--run] [--replace]
//
//   (default)  dry run: converts everything in memory, prints counts and sizes, writes nothing
//   --run      upload + insert into the site set in the copy's cms.manifest (stillsoul-demo)
//   --replace  with --run: delete the site's existing gallery (rows + files) first
//
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
// Reads the copy's .env.local for the source: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "site-media";
const SITE_SLUG = "stillsoul-demo";
const PHOTO_MAX_WIDTH = 2000;
const COVER_MAX_WIDTH = 1280;
const QUALITY = 80;

const args = process.argv.slice(2);
const repo = args.find((a) => !a.startsWith("--"));
const RUN = args.includes("--run");
const REPLACE = args.includes("--replace");
if (!repo || !existsSync(join(repo, ".env.local"))) {
  console.error("Használat: node scripts/import-stillsoul-portfolio.mjs <stillsoul-cms-másolat> [--run] [--replace]");
  process.exit(1);
}

process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
const src = parseEnv(readFileSync(join(repo, ".env.local"), "utf8"));
const source = createClient(src.NEXT_PUBLIC_SUPABASE_URL, src.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const target = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const kb = (n) => `${Math.round(n / 1024)} KB`;

async function readImage(url) {
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const file = join(repo, "public", decodeURIComponent(url));
  if (!existsSync(file)) throw new Error(`Nincs ilyen fájl: public${url}`);
  return readFileSync(file);
}

// EXIF rotation applied, metadata dropped (sharp's default), never enlarged.
async function toWebp(buffer, maxWidth) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, inBytes: buffer.length };
}

const localized = (hu, en) => Object.fromEntries(Object.entries({ hu, en }).filter(([, v]) => v && String(v).trim()));

// ── Source ──────────────────────────────────────────────────────────────────
const [{ data: cats, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
  source.from("categories").select("*").order("sort_order"),
  source.from("portfolio_items").select("*").order("category").order("sort_order"),
]);
if (e1 || e2) {
  console.error("Forrás olvasása sikertelen:", (e1 ?? e2).message);
  process.exit(1);
}

const { data: site, error: e3 } = await target.from("sites").select("id, gallery").eq("slug", SITE_SLUG).single();
if (e3 || !site?.gallery) {
  console.error(`A(z) ${SITE_SLUG} site nem található, vagy nincs galéria a manifestjében (futtasd a sync-et).`);
  process.exit(1);
}
const linkKeys = new Set((site.gallery.links ?? []).map((l) => l.key));

// Categories that only appear on items (no row in `categories`) are created too.
const catBySlug = new Map(cats.map((c) => [c.slug, c]));
for (const r of rows) {
  if (!catBySlug.has(r.category)) {
    console.warn(`! A(z) "${r.category}" kategória csak elemeken szerepel — létrehozom, névként a slugot használva.`);
    catBySlug.set(r.category, { slug: r.category, title_hu: r.category, title_en: null, service_key: null, sort_order: 999 });
  }
}
const categories = [...catBySlug.values()].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

console.log(`Forrás: ${categories.length} kategória, ${rows.length} elem (${rows.filter((r) => r.kind === "photo").length} fotó, ${rows.filter((r) => r.kind !== "photo").length} videó)`);
console.log(`Cél: ${SITE_SLUG} (${site.id}) — ${RUN ? (REPLACE ? "ÉLES FUTÁS, meglévő galéria törlésével" : "ÉLES FUTÁS") : "próbafutás, nem ír semmit"}\n`);

// ── Existing gallery ───────────────────────────────────────────────────────
const { data: existing } = await target.from("gallery_categories").select("id").eq("site_id", site.id);
if (existing.length && RUN && !REPLACE) {
  console.error(`A site-nak már van ${existing.length} galéria-kategóriája. Felülíráshoz: --replace`);
  process.exit(1);
}
if (existing.length && RUN && REPLACE) {
  const { data: old } = await target.from("gallery_items").select("path").eq("site_id", site.id).not("path", "is", null);
  if (old.length) await target.storage.from(BUCKET).remove(old.map((o) => o.path));
  await target.from("gallery_categories").delete().eq("site_id", site.id);
  console.log(`Régi galéria törölve (${existing.length} kategória, ${old.length} fájl).\n`);
}

// ── Import ──────────────────────────────────────────────────────────────────
let totalIn = 0;
let totalOut = 0;
let failures = 0;

for (const [ci, c] of categories.entries()) {
  const title = localized(c.title_hu, c.title_en);
  const link = c.service_key && linkKeys.has(c.service_key) ? c.service_key : null;
  let catId = randomUUID();
  if (RUN) {
    const { data, error } = await target
      .from("gallery_categories")
      .insert({ id: catId, site_id: site.id, slug: c.slug, title, link_key: link, position: ci })
      .select("id")
      .single();
    if (error) throw new Error(`Kategória (${c.slug}): ${error.message}`);
    catId = data.id;
  }
  const items = rows.filter((r) => r.category === c.slug);
  console.log(`▸ ${c.slug} — ${title.hu ?? ""}${link ? ` (gomb: ${link})` : ""}: ${items.length} elem`);

  for (const [ii, r] of items.entries()) {
    const isPhoto = r.kind === "photo";
    try {
      let file = null;
      if (r.image_url) {
        file = await toWebp(await readImage(r.image_url), isPhoto ? PHOTO_MAX_WIDTH : COVER_MAX_WIDTH);
        totalIn += file.inBytes;
        totalOut += file.data.length;
      } else if (isPhoto) {
        throw new Error("fotó kép nélkül");
      }

      let path = null;
      if (file && RUN) {
        path = `${site.id}/gallery/${catId}/${randomUUID()}.webp`;
        const { error } = await target.storage
          .from(BUCKET)
          .upload(path, file.data, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
        if (error) throw new Error(`feltöltés: ${error.message}`);
      }

      if (RUN) {
        const row = {
          site_id: site.id,
          category_id: catId,
          kind: isPhoto ? "photo" : "video",
          path,
          youtube_id: isPhoto ? null : r.youtube_id,
          width: file?.width ?? null,
          height: file?.height ?? null,
          bytes: file?.data.length ?? null,
          title: localized(r.title_hu, r.title_en),
          year: r.year ?? null,
          // Alt text: the category name — refine per photo in the admin.
          alt: isPhoto ? title : {},
          position: ii,
        };
        const { error } = await target.from("gallery_items").insert(row);
        if (error) {
          if (path) await target.storage.from(BUCKET).remove([path]);
          throw new Error(`sor: ${error.message}`);
        }
      }

      const info = file ? `${file.width}×${file.height}, ${kb(file.inBytes)} → ${kb(file.data.length)}` : "YouTube borító";
      console.log(`   ${isPhoto ? "fotó " : "videó"} ${String(ii + 1).padStart(2)}  ${info}${isPhoto ? "" : `  [${r.youtube_id}] ${r.title_hu ?? ""}`}`);
    } catch (e) {
      failures++;
      console.error(`   ✗ ${r.id} (${r.image_url ?? r.youtube_id}): ${e.message}`);
    }
  }
}

console.log(`\nKépek: ${kb(totalIn)} → ${kb(totalOut)} (${totalIn ? Math.round((1 - totalOut / totalIn) * 100) : 0}% kisebb). Hibák: ${failures}.`);
if (!RUN) console.log("Próbafutás volt — éles futás: --run");

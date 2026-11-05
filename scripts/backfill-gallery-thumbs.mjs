#!/usr/bin/env node
// One-off: a már feltöltött galéria-képekhez (fotó + saját videó-borító) legenerálja a kicsi
// (~800 px) WebP bélyegképet, és beírja a gallery_items.thumb_path-ba. Az új feltöltéseknél ezt
// már az admin csinálja (lib/image/process.js → makeThumb).
//
//   node scripts/backfill-gallery-thumbs.mjs [--site <slug>] [--run]
//
//   (default)    dry run: kiírja, mely elemekhez készülne bélyegkép, nem ír semmit
//   --run        letölti a nagy képet, kicsinyít (sharp), feltölti, és beírja a thumb_path-ot
//   --site slug  csak egy weboldal (pl. stillsoul); nélküle az összes
//
// Csak azokat az elemeket érinti, ahol thumb_path üres és a kép szélesebb THUMB_WIDTH-nél.
// Futás után a weboldalak a következő revalidate-nél (vagy egy admin-mentésnél) kapják meg.
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { THUMB_QUALITY, THUMB_WIDTH } from "../lib/image/process.js";

const BUCKET = "site-media";
const args = process.argv.slice(2);
const RUN = args.includes("--run");
const siteIdx = args.indexOf("--site");
const SITE_SLUG = siteIdx >= 0 ? args[siteIdx + 1] : null;
if (siteIdx >= 0 && !SITE_SLUG) {
  console.error("Használat: node scripts/backfill-gallery-thumbs.mjs [--site <slug>] [--run]");
  process.exit(1);
}

const envFile = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Hiányzik: NEXT_PUBLIC_SUPABASE_URL és/vagy SUPABASE_SECRET_KEY (.env.local)");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

let siteFilter = null;
if (SITE_SLUG) {
  const { data: site, error } = await db.from("sites").select("id").eq("slug", SITE_SLUG).maybeSingle();
  if (error || !site) {
    console.error(`Ismeretlen weboldal: ${SITE_SLUG}`);
    process.exit(1);
  }
  siteFilter = site.id;
}

let q = db
  .from("gallery_items")
  .select("id, site_id, category_id, kind, path, width")
  .not("path", "is", null)
  .is("thumb_path", null)
  .order("created_at");
if (siteFilter) q = q.eq("site_id", siteFilter);
const { data: items, error } = await q;
if (error) {
  console.error(`Lekérdezés sikertelen: ${error.message}`);
  process.exit(1);
}

// Fotónál a width ismert; videó-borítónál nincs eltárolva → letöltés után döntünk.
const todo = items.filter((it) => it.width == null || it.width > THUMB_WIDTH);
console.log(`${todo.length} elem bélyegkép nélkül${RUN ? "" : " (dry run — futtatáshoz: --run)"}${SITE_SLUG ? ` [${SITE_SLUG}]` : ""}`);
if (!RUN) {
  for (const it of todo) console.log(`  ${it.kind}  ${it.width ?? "?"}px  ${it.path}`);
  process.exit(0);
}

let done = 0;
let skipped = 0;
let savedBytes = 0;
for (const it of todo) {
  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(it.path);
  if (dlErr) {
    console.error(`  ✗ letöltés: ${it.path}: ${dlErr.message}`);
    continue;
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (meta.width <= THUMB_WIDTH) {
    skipped++;
    continue;
  }
  const thumb = await sharp(buf).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: THUMB_QUALITY }).toBuffer();

  // Ugyanabba a mappába, mint a nagy kép (a storage-szabályok ezt a formát engedik).
  const dir = it.path.slice(0, it.path.lastIndexOf("/"));
  const thumbPath = `${dir}/${randomUUID()}.webp`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(thumbPath, thumb, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) {
    console.error(`  ✗ feltöltés: ${thumbPath}: ${upErr.message}`);
    continue;
  }
  // thumb_path is null feltétel: ha közben az admin már adott neki bélyegképet, nem írjuk felül.
  const { data: upd, error: dbErr } = await db
    .from("gallery_items")
    .update({ thumb_path: thumbPath })
    .eq("id", it.id)
    .is("thumb_path", null)
    .select("id");
  if (dbErr || !upd?.length) {
    await db.storage.from(BUCKET).remove([thumbPath]);
    console.error(`  ✗ mentés: ${it.id}: ${dbErr?.message ?? "közben megváltozott"}`);
    continue;
  }
  done++;
  savedBytes += buf.length - thumb.length;
  console.log(`  ✓ ${Math.round(buf.length / 1024)} KB → ${Math.round(thumb.length / 1024)} KB  ${it.path}`);
}
console.log(`✓ ${done} bélyegkép kész, ${skipped} kihagyva (eleve kicsi). Kártyánként megtakarítás összesen: ${Math.round(savedBytes / 1024 / 1024)} MB.`);

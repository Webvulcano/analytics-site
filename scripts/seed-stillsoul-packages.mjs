#!/usr/bin/env node
// One-off: StillSoul „Kész csomagjaink” → packages modul (2 esküvői csomag + PDF).
// Uploads the PDFs to site-media/{site_id}/packages/<uuid>.pdf and inserts the rows.
// Refuses to run when the site already has packages (no duplicates).
//
//   node scripts/seed-stillsoul-packages.mjs <foto.pdf> <video.pdf>
//
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SLUG = "stillsoulproduction";
const BUCKET = "site-media";

const envFile = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Hiányzik: NEXT_PUBLIC_SUPABASE_URL és/vagy SUPABASE_SECRET_KEY (.env.local)");
  process.exit(1);
}

const [fotoPdf, videoPdf] = process.argv.slice(2);
if (!fotoPdf || !videoPdf || !existsSync(fotoPdf) || !existsSync(videoPdf)) {
  console.error("Használat: node scripts/seed-stillsoul-packages.mjs <foto.pdf> <video.pdf>");
  process.exit(1);
}

const PACKAGES = [
  {
    pdf: fotoPdf,
    title: { hu: "Esküvői fotózás", en: "Wedding photography" },
    tiers: { hu: "Alap · Deluxe · Kreatív", en: "Basic · Deluxe · Creative" },
    price: { hu: "200 000 Ft-tól", en: "from 200 000 HUF" },
  },
  {
    pdf: videoPdf,
    title: { hu: "Esküvői videózás", en: "Wedding videography" },
    tiers: { hu: "Alap · Deluxe · Ultra", en: "Basic · Deluxe · Ultra" },
    price: { hu: "225 000 Ft-tól", en: "from 225 000 HUF" },
  },
];

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: site, error: siteErr } = await supabase.from("sites").select("id, packages").eq("slug", SLUG).single();
if (siteErr) throw new Error(`Site: ${siteErr.message}`);
if (!site.packages) throw new Error("A site-on nincs csomag-modul — előbb manifest sync (packages: { label }).");

const { count } = await supabase.from("packages").select("id", { count: "exact", head: true }).eq("site_id", site.id);
if (count) {
  console.error(`Már van ${count} csomag — kilépek (nem duplikálok).`);
  process.exit(1);
}

for (const [i, p] of PACKAGES.entries()) {
  const path = `${site.id}/packages/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, readFileSync(p.pdf), {
    contentType: "application/pdf",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) throw new Error(`Feltöltés (${p.pdf}): ${upErr.message}`);

  const { error: insErr } = await supabase.from("packages").insert({
    site_id: site.id,
    title: p.title,
    tiers: p.tiers,
    price: p.price,
    files: { hu: path },
    position: i,
  });
  if (insErr) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Mentés (${p.title.hu}): ${insErr.message}`);
  }
  console.log(`✓ ${p.title.hu} → ${path}`);
}
console.log("Kész. Az oldal frissítéséhez: admin-mentés vagy POST /api/revalidate.");

#!/usr/bin/env node
// Removes orphaned files from the `site-media` bucket: objects no image row points to
// (abandoned uploads, failed commits, replaced images whose delete failed).
// Only objects older than 24 h are touched, so in-flight uploads are never removed.
//
//   node scripts/gc-storage.mjs            dry run: list what would be deleted
//   node scripts/gc-storage.mjs --delete   delete them
//
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "site-media";
const BATCH = 100;

const envFile = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Hiányzik: NEXT_PUBLIC_SUPABASE_URL és/vagy SUPABASE_SECRET_KEY (.env.local)");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: orphans, error } = await supabase.rpc("cms_orphan_objects");
if (error) {
  console.error(`Lekérdezés sikertelen: ${error.message}`);
  process.exit(1);
}

if (orphans.length === 0) {
  console.log("Nincs árva fájl.");
  process.exit(0);
}

const doDelete = process.argv.includes("--delete");
console.log(`${orphans.length} árva fájl${doDelete ? " törlése" : " (dry run — törléshez: --delete)"}:`);
for (const name of orphans) console.log(`  ${name}`);
if (!doDelete) process.exit(0);

let removed = 0;
for (let i = 0; i < orphans.length; i += BATCH) {
  const { data, error: err } = await supabase.storage.from(BUCKET).remove(orphans.slice(i, i + BATCH));
  if (err) {
    console.error(`Törlés sikertelen: ${err.message}`);
    process.exit(1);
  }
  removed += data.length;
}
console.log(`✓ ${removed} fájl törölve.`);

#!/usr/bin/env node
// Copies the CMS client kit into a client website repo (overwrites kit files only).
//   node scripts/copy-client-kit.mjs <client-repo-root>

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const FILES = [
  "lib/cms.js",
  "lib/cms-manifest.js",
  "lib/cms-richtext.js",
  "lib/cms-bridge-protocol.js",
  "components/cms/RichText.jsx",
  "components/cms/CmsBridge.jsx",
  "components/cms/JsonLd.jsx",
  "app/api/revalidate/route.js",
];

const target = process.argv[2];
if (!target || !existsSync(join(target, "package.json"))) {
  console.error("Használat: node scripts/copy-client-kit.mjs <ügyféloldal repo gyökere>");
  process.exit(1);
}

const kit = resolve(import.meta.dirname, "../client-kit");
for (const file of FILES) {
  const dest = join(target, file);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(kit, file), dest);
  console.log(`  ✓ ${file}`);
}

console.log(`
Következő lépések az ügyféloldalon:
  1. cms.manifest.js a repo gyökerébe (minta: projektek/automoso sablon/sablon1/kod/cms.manifest.js)
  2. .env.local: CMS_SITE_SLUG, CMS_SUPABASE_URL, CMS_SUPABASE_PUBLISHABLE_KEY,
     CMS_REVALIDATE_SECRET, NEXT_PUBLIC_CMS_ADMIN_ORIGIN
  3. <CmsBridge /> a root layoutba, frame-ancestors header a next.config-ba
  4. Admin repóban: npx tsx scripts/sync-manifest.mjs <repo>/cms.manifest.js --print-secret`);

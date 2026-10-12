#!/usr/bin/env node
// Syncs a client website's cms.manifest.js into Supabase (site, locales, members,
// pages, fields, image slots). Existing content values are never overwritten.
//
//   npx tsx scripts/sync-manifest.mjs <path>/cms.manifest.js [--prune] [--print-payload] [--print-secret]
//
//   --prune          also remove locales/members missing from the manifest
//   --print-payload  only print the RPC payload JSON (no network call)
//   --print-secret   print the site's CMS_REVALIDATE_SECRET (needs CMS_MASTER_SECRET)
//
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, CMS_MASTER_SECRET.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeManifest } from "../client-kit/lib/cms-manifest.js";
import { deriveRevalidateSecret } from "../lib/secrets.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const manifestPath = args.find((a) => !a.startsWith("--"));

if (!manifestPath) {
  console.error("Használat: npx tsx scripts/sync-manifest.mjs <útvonal>/cms.manifest.js [--prune] [--print-payload] [--print-secret]");
  process.exit(1);
}

const envFile = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const mod = await import(pathToFileURL(resolve(manifestPath)).href);
const normalized = normalizeManifest(mod.default ?? mod);
const payload = {
  ...normalized,
  manifest_hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16),
  prune: flags.has("--prune"),
};

if (flags.has("--print-payload")) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

console.log(`Site: ${payload.site.slug} (${payload.site.name})`);
console.log(`  ${payload.fields.length} mező, ${payload.slots.length} képhely, ${payload.locales.length} nyelv, ${payload.members.length} tag`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Hiányzik NEXT_PUBLIC_SUPABASE_URL vagy SUPABASE_SECRET_KEY a .env.local-ból.");
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/rpc/cms_sync_manifest`, {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify({ p: payload }),
});
const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`Sync hiba (HTTP ${res.status}):`, body?.message ?? body);
  process.exit(1);
}
console.log("Kész:", JSON.stringify(body));

if (flags.has("--print-secret")) {
  console.log(`\nCMS_REVALIDATE_SECRET=${deriveRevalidateSecret(payload.site.slug)}`);
}

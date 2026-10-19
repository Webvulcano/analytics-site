#!/usr/bin/env node
// Invite link for e-mail + password login (no e-mail is sent — you send the link yourself).
//
//   node scripts/create-invite.mjs <email> [--days 7] [--base https://analytics.webvulcano.hu]
//
// The e-mail must already be a site member (cms.members.local.json → sync-manifest) or a superadmin.
// Creates the auth user if missing (confirmed e-mail, random password nobody knows), then a
// one-time invite: /meghivo/<token> lets the member set their own password. Running it again
// for the same e-mail = new link (e.g. forgotten password); older unused links stop working.
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const email = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))?.trim().toLowerCase();
const days = Number(opt("--days", "7"));
const base = opt("--base", "https://analytics.webvulcano.hu").replace(/\/$/, "");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !(days > 0 && days <= 30)) {
  console.error("Használat: node scripts/create-invite.mjs <email> [--days 7] [--base https://analytics.webvulcano.hu]");
  process.exit(1);
}

const envFile = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Hiányzik NEXT_PUBLIC_SUPABASE_URL vagy SUPABASE_SECRET_KEY a .env.local-ból.");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function api(path, init = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${body?.msg ?? body?.message ?? ""}`);
  return body;
}

// 1. member or superadmin?
const q = `email=eq.${encodeURIComponent(email)}&select=email`;
const [members, admins] = await Promise.all([api(`/rest/v1/site_members?${q}`), api(`/rest/v1/superadmins?${q}`)]);
if (!members.length && !admins.length) {
  console.error(`${email} nem tag egy weboldalnál sem. Előbb: cms.members.local.json + sync-manifest.`);
  process.exit(1);
}

// 2. auth user (created with a random password; the invite page replaces it)
try {
  await api("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: randomBytes(32).toString("base64url"), email_confirm: true }),
  });
  console.log(`Fiók létrehozva: ${email}`);
} catch (e) {
  if (!/HTTP 422/.test(e.message)) throw e; // 422 = already registered → fine
  console.log(`Fiók már létezik: ${email}`);
}

// 3. invite: only the hash is stored; older unused links of this e-mail are revoked
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
await api(`/rest/v1/member_invites?email=eq.${encodeURIComponent(email)}&used_at=is.null`, {
  method: "PATCH",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({ expires_at: new Date().toISOString() }),
});
await api("/rest/v1/member_invites", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({ email, token_hash: tokenHash, expires_at: new Date(Date.now() + days * 864e5).toISOString() }),
});

console.log(`\nMeghívó link (${days} napig, egyszer használható):\n${base}/meghivo/${token}\n`);

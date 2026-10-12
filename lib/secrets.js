import { createHmac } from "node:crypto";

// Per-site revalidate secret, derived from one master secret → nothing stored in the DB,
// and a leaked site secret only affects that site.
// No "server-only" import here: the sync script (plain Node) uses it too.
export function deriveRevalidateSecret(slug, master = process.env.CMS_MASTER_SECRET) {
  if (!master) throw new Error("CMS_MASTER_SECRET nincs beállítva");
  return createHmac("sha256", master).update(`revalidate:${slug}`).digest("base64url");
}

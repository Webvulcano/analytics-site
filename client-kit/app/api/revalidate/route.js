import { revalidateTag } from "next/cache";
import { createHash, timingSafeEqual } from "node:crypto";
import { cmsPagePaths, cmsReachable, cmsTag } from "@/lib/cms";

// Called by the admin after every save. Fixed tag (no input from the request body),
// so a leaked secret can at most trigger a refresh of this one site.
export async function POST(request) {
  const secret = process.env.CMS_REVALIDATE_SECRET;
  if (!secret) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!token || !timingSafeEqual(a, b)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  // CMS answers → expire the cached content now, so the warm-up below already renders the new
  // content (with "max" the warm-up itself got the stale data and the first visitors saw old text).
  // CMS unreachable → "max" (stale-while-revalidate): the last good page keeps being served
  // ({ expire: 0 } with a dead CMS would make the site return 500).
  const fresh = await cmsReachable();
  revalidateTag(cmsTag(), fresh ? { expire: 0 } : "max");

  // Warm every page now, so the regeneration runs immediately and the next visitor
  // already gets the fresh content.
  const origin = new URL(request.url).origin;
  const warmed = await Promise.allSettled(
    cmsPagePaths().map((path) =>
      fetch(new URL(path, origin), { cache: "no-store", signal: AbortSignal.timeout(8000) })
    )
  );

  return Response.json({ ok: true, mode: fresh ? "expire" : "stale", warmed: warmed.filter((r) => r.status === "fulfilled").length });
}

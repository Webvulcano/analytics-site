import { revalidateTag } from "next/cache";
import { createHash, timingSafeEqual } from "node:crypto";
import { cmsPagePaths, cmsTag } from "@/lib/cms";

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

  // "max" = stale-while-revalidate: if the CMS is down during regeneration, the last good
  // page keeps being served (with { expire: 0 } the site would return 500 instead).
  revalidateTag(cmsTag(), "max");

  // Warm every page now, so the regeneration runs immediately and the next visitor
  // already gets the fresh content.
  const origin = new URL(request.url).origin;
  const warmed = await Promise.allSettled(
    cmsPagePaths().map((path) =>
      fetch(new URL(path, origin), { cache: "no-store", signal: AbortSignal.timeout(8000) })
    )
  );

  return Response.json({ ok: true, warmed: warmed.filter((r) => r.status === "fulfilled").length });
}

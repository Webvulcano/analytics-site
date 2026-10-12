// Napi ping (Vercel Cron, ld. vercel.json) → a Supabase ingyenes projekt nem áll le 7 nap tétlenség miatt.
// (Ugyanaz a minta, mint a StillSoul oldalán.) Egy olcsó, valódi adatbázis-lekérdezés a publikus kulccsal.
// Ha a CRON_SECRET be van állítva (Vercel), csak a cron hívhatja: a Vercel `Authorization: Bearer <CRON_SECRET>`-et küld.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/cms_list_posts?p_site=_keepalive&p_locale=hu`;
  try {
    const res = await fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return Response.json({ ok: res.ok, at: new Date().toISOString() }, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message ?? "hiba" }, { status: 502 });
  }
}

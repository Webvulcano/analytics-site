import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Kilépés: csak POST (link-előtöltés ne léptessen ki), és csak a saját oldalunkról
// (egy idegen oldal űrlapja ne tudja kiléptetni a felhasználót).
export async function POST(request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    return new Response(null, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// TEMP "/spike/": Fázis 4 image spike (client-only, no data) — remove after Fázis 4.
const PUBLIC_PATHS = ["/login", "/auth/", "/spike/"];

// Session frissítés + optimista auth-kapu. A valódi jogosultság-ellenőrzés a DAL-ban (lib/dal.js) van.
export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() validálja a JWT-t és szükség esetén frissíti a tokent — ne tegyél kódot elé.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // A frissített/törölt session cookie-k ne vesszenek el az átirányításnál.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}

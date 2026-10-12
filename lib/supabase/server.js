import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

// Szerver-oldali Supabase kliens a felhasználó sessionjével → minden lekérdezésre RLS vonatkozik.
export async function createClient() {
  const cookieStore = await cookies();
  // Partial prefetching mellett a cookie-k prefetchkor is elérhetők, de a Supabase auth
  // Date.now()-val vizsgálja a token lejáratát → csak valódi kérésnél futhat.
  await connection();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Componentből nem lehet cookie-t írni — a proxy frissíti a sessiont.
          }
        },
      },
    }
  );
}

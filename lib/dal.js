import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer: minden oldal és server action innen kérdezi a usert és a site-ot.
// A Supabase lekérdezések a user sessionjével futnak → RLS szűr (csak saját site-ok).

export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect("/login");
  return {
    id: claims.sub,
    email: claims.email?.toLowerCase() ?? null,
    name: claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? null,
    avatarUrl: claims.user_metadata?.avatar_url ?? null,
  };
});

export const listMySites = cache(async () => {
  await getCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, slug, name, site_url, status")
    .order("name");
  if (error) throw new Error(`Site lista hiba: ${error.message}`);
  return data;
});

// Site betöltése slug alapján. Ha nem tag (RLS nem adja vissza) → 404, nem árulja el hogy létezik.
export const requireSite = cache(async (slug) => {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data: site, error } = await supabase
    .from("sites")
    .select("id, slug, name, site_url, preview_url, revalidate_url, default_locale, status, editing_locked, ga4_property_id, gsc_site_url, gallery, blog")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Site betöltési hiba: ${error.message}`);
  if (!site) notFound();
  return { site, user };
});

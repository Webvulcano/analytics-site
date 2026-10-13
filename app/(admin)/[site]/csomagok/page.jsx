import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PACKAGE_COLS } from "@/lib/packages";
import PackagesManager from "@/components/packages/PackagesManager";

export const metadata = { title: "Csomagok" };

export default async function PackagesPage({ params }) {
  const { site: slug } = await params;
  const { site } = await requireSite(slug);
  if (!site.packages) notFound();
  const supabase = await createClient();

  const [packages, locales] = await Promise.all([
    supabase.from("packages").select(PACKAGE_COLS).eq("site_id", site.id).order("position").order("created_at"),
    supabase.from("site_locales").select("locale, label").eq("site_id", site.id).order("sort"),
  ]);
  const failed = [packages, locales].find((r) => r.error);
  if (failed) throw new Error(`Csomagok nem tölthetők be: ${failed.error.message}`);

  return (
    <PackagesManager
      site={{
        id: site.id,
        slug: site.slug,
        label: site.packages.label ?? "Csomagok",
        defaultLocale: site.default_locale,
        readOnly: site.status !== "active",
      }}
      locales={locales.data}
      initialPackages={packages.data}
    />
  );
}

import { requireSite } from "@/lib/dal";

export const metadata = { title: "Analitika" };

export default async function AnalyticsPage({ params }) {
  const { site: slug } = await params;
  const { site } = await requireSite(slug);
  const connected = Boolean(site.ga4_property_id || site.gsc_site_url);

  return (
    <div className="p-6 md:p-10">
      <h1 className="text-2xl font-semibold">Analitika</h1>
      <p className="mt-1 text-sm text-zinc-500">Google Analytics + Search Console</p>
      <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        {connected ? "Az analitika hamarosan itt lesz (5. fázis)." : "Az analitika még nincs bekötve ehhez a weboldalhoz."}
      </div>
    </div>
  );
}

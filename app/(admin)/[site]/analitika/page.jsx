import { Suspense } from "react";
import { requireSite } from "@/lib/dal";
import { getVercelAnalytics, parseRange, RANGES } from "@/lib/vercel-analytics";
import { ConversionList, DailyChart, ListCard, RangeTabs, StatCard } from "@/components/analytics/Dashboard";

export const metadata = { title: "Analitika" };

const DEVICES = { desktop: "Számítógép", mobile: "Mobil", tablet: "Tablet" };
const countryName = new Intl.DisplayNames(["hu"], { type: "region" });

export default async function AnalyticsPage({ params, searchParams }) {
  const [{ site: slug }, { range }] = await Promise.all([params, searchParams]);
  const { site } = await requireSite(slug);
  const rangeKey = parseRange(range);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analitika</h1>
          <p className="mt-1 text-sm text-zinc-500">Látogatók és konverziók a weboldalon</p>
        </div>
        {site.vercel_project_id && <RangeTabs slug={site.slug} active={rangeKey} />}
      </div>

      {site.vercel_project_id ? (
        <Suspense key={rangeKey} fallback={<DashboardSkeleton />}>
          <AnalyticsData
            project={{
              projectId: site.vercel_project_id,
              teamId: site.vercel_team_id,
              conversions: (site.cta_buttons ?? []).filter((c) => typeof c === "string"),
            }}
            rangeKey={rangeKey}
          />
        </Suspense>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          Az analitika még nincs bekötve ehhez a weboldalhoz.
        </div>
      )}
    </div>
  );
}

async function AnalyticsData({ project, rangeKey }) {
  let data;
  try {
    data = await getVercelAnalytics(project, rangeKey, new Date().toISOString().slice(0, 10));
  } catch (err) {
    console.error("Vercel analytics:", err);
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        Az analitika most nem elérhető. Próbáld újra pár perc múlva.
      </div>
    );
  }

  const { totals } = data;
  const rate = totals.visitors ? `${Math.round((totals.converters / totals.visitors) * 100)}%` : "–";
  const goalNames = data.conversions.filter((c) => c.goal).map((c) => c.name).join(", ");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Oldalmegtekintés" value={totals.pageviews} info="Minden egyes oldalbetöltés. Ha valaki 3 oldalt megnéz, az 3 megtekintés." />
        <StatCard label="Látogató" value={totals.visitors} info="Hány különböző ember járt az oldalon. Süti nélkül, naponta újraszámolva: aki több napon is visszajön, vagy telefonról és gépről is megnézi, többször számít." />
        <StatCard
          label="Konverzió"
          value={totals.converters}
          info={`Hány különböző látogató lépett kapcsolatba legalább egyszer: ${goalNames || "—"}. Aki többször kattint, egynek számít. Kattintások összesen: ${totals.conversionClicks}.`}
        />
        <StatCard
          label="Konverziós arány"
          value={rate}
          info="Konvertáló látogatók ÷ összes látogató. Megmutatja, a látogatók hány százaléka foglalt, telefonált vagy írt."
        />
      </div>

      <DailyChart days={data.daily} rangeLabel={RANGES[rangeKey].label} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Konverziók</h2>
          <p className="text-sm text-zinc-500">
            Kattintások eseményenként — kattints egy sorra: melyik oldalon, melyik szekcióban, melyik gombra kattintottak.
            {totals.interest > 0 && <> Az „érdeklődés” jelűek nem konverziók (pl. útvonal, vélemények): {totals.interest} kattintás.</>}
          </p>
        </div>
        <ConversionList events={data.conversions} />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <ListCard title="Legnézettebb oldalak" items={data.pages} />
        <ListCard title="Honnan jöttek" items={data.referrers.map((r) => ({ ...r, label: r.label || "Közvetlen / ismeretlen" }))} />
        <ListCard title="Országok" items={data.countries.map((r) => ({ ...r, label: r.label === "Others" ? r.label : safeCountry(r.label) }))} />
        <ListCard title="Eszközök" items={data.devices.map((r) => ({ ...r, label: DEVICES[r.label] ?? r.label }))} />
      </div>

      <p className="text-xs text-zinc-500">Forrás: Vercel Web Analytics (csak az éles oldal). Napok UTC szerint; az adatok kb. 15 percenként frissülnek.</p>
    </div>
  );
}

function safeCountry(code) {
  try {
    return code ? countryName.of(code) : "Ismeretlen";
  } catch {
    return code;
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-40 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

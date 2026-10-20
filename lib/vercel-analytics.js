import "server-only";
import { cacheLife, cacheTag } from "next/cache";

// Vercel Web Analytics (REST API) for the Analitika page. The token stays on the server
// (VERCEL_API_TOKEN): the browser only ever gets the aggregated numbers.
// Endpoints: /v1/query/web-analytics/{visits|events}/aggregate — `by` max 2 dimensions,
// default filter = production only, `limit` caps groups (the rest → "Others").

const API = "https://api.vercel.com/v1/query/web-analytics";

// Event properties shown per page as a cross table (hely × gomb) when an event has them;
// other events (e.g. Visszahívás-kérés) are broken down by page only.
const CROSS_KEYS = ["hely", "gomb"];
// Pages listed per event; the rest is grouped into "Egyéb" by the API.
const MAX_PAGES = 10;

// Runs fn over items with at most `limit` requests in flight (keeps API bursts small).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const RANGES = {
  "7d": { label: "7 nap", days: 7 },
  "28d": { label: "28 nap", days: 28 },
  "90d": { label: "90 nap", days: 90 },
};
export const DEFAULT_RANGE = "28d";

export function parseRange(value) {
  return RANGES[value] ? value : DEFAULT_RANGE;
}

async function query(kind, { projectId, teamId }, params) {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("VERCEL_API_TOKEN nincs beállítva");
  const qs = new URLSearchParams({ projectId });
  if (teamId) qs.set("teamId", teamId);
  for (const [key, value] of Object.entries(params)) {
    for (const v of [value].flat()) if (v != null) qs.append(key, String(v));
  }
  const res = await fetch(`${API}/${kind}/aggregate?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Vercel API ${res.status}: ${body?.error?.message ?? res.statusText}`);
  }
  return (await res.json()).data ?? [];
}

// OData string literal: quotes doubled.
const odata = (s) => `'${String(s).replaceAll("'", "''")}'`;

// `today` (UTC day, YYYY-MM-DD) is an argument so a new day gets a new cache entry.
// project.conversions: event names that are real conversions (manifest); empty → every event.
export async function getVercelAnalytics(project, rangeKey, today) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  cacheTag(`va:${project.projectId}`);

  const { days } = RANGES[rangeKey];
  const end = new Date(`${today}T00:00:00Z`);
  const since = new Date(end.getTime() - (days - 1) * 86400000).toISOString();
  const until = new Date(end.getTime() + 86400000 - 1000).toISOString();
  const range = { since, until };
  const visits = (by, limit = 10) => query("visits", project, { ...range, by, limit });
  const events = (by, extra) => query("events", project, { ...range, by, limit: 100, ...extra });

  const goals = project.conversions ?? [];
  const isGoal = (name) => !goals.length || goals.includes(name);
  const [totals, daily, pages, referrers, countries, devices, eventTotals, eventKeys, converters] = await Promise.all([
    visits("environment"),
    visits("day"),
    visits("requestPath"),
    visits("referrerHostname"),
    visits("country"),
    visits("deviceType"),
    events("eventName"),
    events(["eventName", "eventData"]),
    // Distinct visitors with at least one conversion (one row: production).
    events("environment", goals.length ? { filter: `eventName in (${goals.map(odata).join(",")})` } : {}),
  ]);

  // Per event: on which page (requestPath, recorded by Vercel) → then hely × gomb on that page.
  // `by` allows only 2 dimensions, so the page level is a filter: one call per (event, page).
  const named = eventTotals
    .filter((e) => e.eventName && e.eventName !== "Others")
    .sort((a, b) => isGoal(b.eventName) - isGoal(a.eventName) || b.count - a.count);
  const eventPages = await Promise.all(
    named.map((e) => events("requestPath", { limit: MAX_PAGES, filter: `eventName eq ${odata(e.eventName)}` }))
  );
  const conversions = await Promise.all(
    named.map(async (e, i) => {
      const keys = eventKeys.filter((k) => k.eventName === e.eventName && k.eventData).map((k) => k.eventData);
      const breakdownKeys = CROSS_KEYS.filter((k) => keys.includes(k));
      const pages = eventPages[i].sort((a, b) => (a.requestPath === "Others") - (b.requestPath === "Others") || b.count - a.count);
      return {
        name: e.eventName,
        goal: isGoal(e.eventName),
        count: e.count,
        visitors: e.visitors,
        keys: breakdownKeys,
        pages: await mapLimit(pages, 4, async (p) => {
          // "Others" (pages beyond the limit) cannot be filtered on → total only.
          const rows =
            breakdownKeys.length && p.requestPath !== "Others"
              ? await events(breakdownKeys.map((k) => `eventData/${k}`), {
                  filter: `eventName eq ${odata(e.eventName)} and requestPath eq ${odata(p.requestPath)}`,
                })
              : [];
          return {
            path: p.requestPath,
            count: p.count,
            rows: rows
              .map((r) => ({ values: breakdownKeys.map((k) => r[`eventData/${k}`] ?? ""), count: r.count }))
              .sort((a, b) => b.count - a.count),
          };
        }),
      };
    })
  );

  const list = (rows, key) =>
    rows.map((r) => ({ label: r[key], value: r.pageviews, visitors: r.visitors })).sort((a, b) => b.value - a.value);

  return {
    totals: {
      pageviews: totals.reduce((s, r) => s + r.pageviews, 0),
      visitors: totals.reduce((s, r) => s + r.visitors, 0),
      converters: converters.reduce((s, r) => s + r.visitors, 0),
      conversionClicks: conversions.filter((c) => c.goal).reduce((s, c) => s + c.count, 0),
      interest: conversions.filter((c) => !c.goal).reduce((s, c) => s + c.count, 0),
    },
    daily: daily.map((d) => ({ day: d.timestamp.slice(0, 10), pageviews: d.pageviews, visitors: d.visitors })),
    pages: list(pages, "requestPath"),
    referrers: list(referrers, "referrerHostname"),
    countries: list(countries, "country"),
    devices: list(devices, "deviceType"),
    conversions,
  };
}

import Link from "next/link";
import { RANGES } from "@/lib/vercel-analytics";

// Analitika building blocks (server components, no client JS): hover/focus tooltips and
// expandable rows are plain CSS + <details>.

const nf = new Intl.NumberFormat("hu-HU");
const fmt = (v) => (typeof v === "number" ? nf.format(Math.round(v)) : v);
const dayFmt = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric", timeZone: "UTC" });
const CARD = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

// "Others" = the groups beyond the API limit → always last, in Hungarian.
function withOthersLast(items) {
  const others = items.filter((i) => i.label === "Others").map((i) => ({ ...i, label: "Egyéb" }));
  return [...items.filter((i) => i.label !== "Others"), ...others];
}

export function RangeTabs({ slug, active }) {
  return (
    <nav aria-label="Időszak" className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
      {Object.entries(RANGES).map(([key, { label }]) => (
        <Link
          key={key}
          href={`/${slug}/analitika?range=${key}`}
          aria-current={key === active ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            key === active
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function StatCard({ label, value, info }) {
  return (
    <div className={CARD}>
      <p className="flex items-center gap-1 text-xs font-medium text-zinc-500">
        {label}
        {info && <InfoTip text={info} />}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(value)}</p>
    </div>
  );
}

// Small ⓘ with an explanation on hover / keyboard focus / tap (focus).
export function InfoTip({ text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="rounded-full text-zinc-400 outline-none hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:text-zinc-200"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v4.5M10 6.5v.01" strokeLinecap="round" />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-64 rounded-md bg-zinc-900 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block dark:bg-white dark:text-zinc-900"
      >
        {text}
      </span>
    </span>
  );
}

export function ListCard({ title, items }) {
  const rows = withOthersLast(items);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-zinc-500">megtekintés</span>
      </div>
      {rows.length ? (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="relative flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-md bg-zinc-100 dark:bg-zinc-800"
                style={{ width: `${(r.value / max) * 100}%` }}
              />
              <span className="relative min-w-0 truncate" title={r.label}>{r.label}</span>
              <span className="relative shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{fmt(r.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-zinc-500">Nincs adat ebben az időszakban.</p>
      )}
    </div>
  );
}

// Daily pageviews: one series → one ink, no legend; every bar has a hover/focus tooltip.
export function DailyChart({ days, rangeLabel }) {
  const max = Math.max(1, ...days.map((d) => d.pageviews));
  const ticks = [0, Math.floor(days.length / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure className={CARD}>
      <figcaption className="mb-4 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">Oldalmegtekintések naponta</span>
        <span className="text-xs text-zinc-500">utolsó {rangeLabel}</span>
      </figcaption>
      <div className="relative h-40 border-b border-zinc-200 dark:border-zinc-800">
        <span className="absolute -top-1 left-0 text-[11px] tabular-nums text-zinc-400">{fmt(max)}</span>
        <div className="absolute inset-0 top-4 flex items-end gap-0.5">
          {days.map((d) => (
            <div
              key={d.day}
              tabIndex={0}
              aria-label={`${dayFmt.format(new Date(d.day))}: ${d.pageviews} megtekintés, ${d.visitors} látogató`}
              className="group relative flex h-full flex-1 items-end outline-none"
            >
              <div
                className="w-full rounded-t bg-zinc-800 transition group-hover:bg-zinc-500 group-focus:bg-zinc-500 dark:bg-zinc-300 dark:group-hover:bg-white"
                style={{ height: d.pageviews ? `max(${(d.pageviews / max) * 100}%, 3px)` : 0 }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white shadow group-hover:block group-focus:block dark:bg-white dark:text-zinc-900">
                <span className="font-semibold">{dayFmt.format(new Date(d.day))}</span>
                <br />
                {fmt(d.pageviews)} megtekintés · {fmt(d.visitors)} látogató
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-zinc-400">
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute"
            style={i === 0 ? { left: 0 } : i === days.length - 1 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }}
          >
            {dayFmt.format(new Date(days[i].day))}
          </span>
        ))}
      </div>
    </figure>
  );
}

function pageLabel(path) {
  if (path === "/") return "Főoldal";
  if (path === "Others") return "Egyéb oldalak";
  return path.split("/").filter(Boolean).at(-1).replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
}

export function ConversionList({ events }) {
  if (!events.length) {
    return (
      <div className={`${CARD} py-8 text-center text-sm text-zinc-500`}>
        Ebben az időszakban még nem volt konverzió.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <details key={e.name} className={`${CARD} group p-0`}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-400 transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="truncate font-medium">{e.name}</span>
              {!e.goal && (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">érdeklődés</span>
              )}
            </span>
            <span className="shrink-0 text-sm tabular-nums">
              <span className="font-semibold">{fmt(e.count)}</span>
              <span className="text-zinc-500"> kattintás · {fmt(e.visitors)} látogató</span>
            </span>
          </summary>
          <div className="space-y-3 border-t border-zinc-200 p-3 md:p-4 dark:border-zinc-800">
            {e.pages.map((p) => (
              <PageBreakdown key={p.path} page={p} keys={e.keys} total={e.count} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

const val = (v) => (v === "Others" ? "Egyéb" : v);

// One page of an event: header (page + share of the event's clicks), then one row per
// szekció × gomb with a bar proportional to the page's busiest row.
function PageBreakdown({ page, keys, total }) {
  const max = Math.max(1, ...page.rows.map((r) => r.count));
  const share = Math.round((page.count / Math.max(1, total)) * 100);
  const placeIdx = keys.indexOf("hely");
  const buttonIdx = keys.indexOf("gomb");
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M11.5 2.5H5.5a1 1 0 00-1 1v13a1 1 0 001 1h9a1 1 0 001-1V6.5l-4-4z" />
            <path d="M11.5 2.5v4h4" />
          </svg>
          <span className="truncate text-sm font-semibold" title={page.path}>{pageLabel(page.path)}</span>
          {page.path !== "/" && page.path !== "Others" && (
            <span className="hidden truncate text-xs text-zinc-500 sm:inline">{page.path}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
          <span className="font-semibold">{fmt(page.count)}</span>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">{share}%</span>
        </span>
      </div>
      {page.rows.length > 0 && (
        <ul className="space-y-1.5 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          {page.rows.map((r, i) => {
            const place = placeIdx >= 0 ? r.values[placeIdx] : "";
            const button = buttonIdx >= 0 ? r.values[buttonIdx] : "";
            return (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem]">
                <span className="min-w-0">
                  <span className="inline-block max-w-full truncate rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" title={place}>
                    {val(place) || "ismeretlen szekció"}
                  </span>
                  <span className="mt-0.5 block truncate text-sm sm:hidden">{button ? `„${val(button)}”` : <span className="text-zinc-400">gomb felirat nélkül</span>}</span>
                </span>
                <span className="hidden min-w-0 truncate text-sm sm:block" title={button}>
                  {button ? `„${val(button)}”` : <span className="text-zinc-400">gomb felirat nélkül</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <span className="block h-full rounded-full bg-zinc-800 dark:bg-zinc-300" style={{ width: `${(r.count / max) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right text-sm font-semibold tabular-nums">{fmt(r.count)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import SignOutButton from "./SignOutButton";

const NAV = [
  { segment: "szerkesztes", label: "Szerkesztés", icon: PencilIcon },
  { segment: "analitika", label: "Analitika", icon: ChartIcon },
];

export default function Sidebar({ site, sites, user }) {
  const nav = site.galleryLabel
    ? [NAV[0], { segment: "portfolio", label: site.galleryLabel, icon: GridIcon }, ...NAV.slice(1)]
    : NAV;
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobil fejléc */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 md:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <span className="truncate font-semibold">{site.name}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="admin-sidebar"
          className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {open ? "Bezár" : "Menü"}
        </button>
      </div>

      <aside
        id="admin-sidebar"
        className={`${open ? "flex" : "hidden"} w-full flex-col border-b border-zinc-200 bg-white md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950`}
      >
        <div className="hidden px-5 pt-6 pb-4 md:block">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Ügyfél Admin</p>
          <p className="mt-1 truncate font-semibold">{site.name}</p>
        </div>

        {sites.length > 1 && (
          <div className="px-3 pt-3 md:pt-0">
            <label className="sr-only" htmlFor="site-switcher">Weboldal váltás</label>
            <select
              id="site-switcher"
              value={site.slug}
              onChange={(e) => router.push(`/${e.target.value}/szerkesztes`)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              {sites.map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex flex-col gap-1 p-3" aria-label="Fő menü">
          {nav.map(({ segment, label, icon: Icon }) => {
            const href = `/${site.slug}/${segment}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={segment}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <a
            href={site.siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Weboldal megnyitása ↗
          </a>
          <div className="flex items-center justify-between gap-2 px-3 py-1">
            <span className="truncate text-xs text-zinc-500" title={user.email}>{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </aside>
    </>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" strokeLinejoin="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <path d="M3 17h14M6 14V9M10 14V5M14 14v-3" strokeLinecap="round" />
    </svg>
  );
}

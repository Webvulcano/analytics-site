"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePostForever, restorePost, setPostStatus, trashPost } from "@/app/(admin)/[site]/blog/actions";
import { mediaUrl } from "@/lib/image/upload";
import { STATUS, TRASH_DAYS, postState, postUrl, previewUrl, trashDaysLeft } from "@/lib/blog";
import { Notice } from "@/components/gallery/Modal";
import { blogNotice } from "./notice";

const TABS = [
  { key: "all", label: "Mind" },
  { key: "published", label: "Közzétett" },
  { key: "hidden", label: "Rejtett" },
  { key: "draft", label: "Piszkozat" },
  { key: "trash", label: "Kuka" },
];

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("hu-HU", { year: "numeric", month: "short", day: "numeric" }) : "—");

export default function BlogList({ site, locales, posts }) {
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const [busy, setBusy] = useState(null); // post id
  const [status, setStatus] = useState(null);
  const multiLocale = locales.length > 1;
  const localeLabel = Object.fromEntries(locales.map((l) => [l.locale, l.label]));

  const counts = Object.fromEntries(TABS.map((t) => [t.key, 0]));
  for (const p of posts) {
    const s = postState(p);
    counts[s] += 1;
    if (s !== "trash") counts.all += 1;
  }
  const visible = posts.filter((p) => (tab === "all" ? !p.deleted_at : postState(p) === tab));

  async function run(post, fn, okText, { confirm } = {}) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(post.id);
    setStatus(null);
    try {
      const res = await fn({ siteSlug: site.slug, id: post.id });
      setStatus(blogNotice(res, okText));
      if (res.ok) router.refresh();
    } catch {
      setStatus({ type: "error", text: "Hálózati hiba - próbáld újra." });
    } finally {
      setBusy(null);
    }
  }

  const btn =
    "rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{site.blog.label ?? "Blog"}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cikkek írása, szerkesztése, elrejtése. A törölt cikk {TRASH_DAYS} napig a Kukában marad, onnan visszaállítható.
          </p>
        </div>
        {!site.readOnly && (
          <Link
            href={`/${site.slug}/blog/uj`}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            + Új cikk
          </Link>
        )}
      </div>

      <Notice status={status} onDismiss={() => setStatus(null)} />

      <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" role="tablist" aria-label="Szűrés">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300"
            }`}
          >
            {t.label} <span className="text-xs text-zinc-400">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {tab === "trash"
            ? "A Kuka üres."
            : posts.length === 0
              ? "Még nincs cikk. Írd meg az elsőt a „+ Új cikk” gombbal."
              : "Ebben a nézetben nincs cikk."}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {visible.map((p) => {
            const state = postState(p);
            const live = postUrl(site.siteUrl, site.blog, p);
            const preview = previewUrl(site.previewBase, p);
            const disabled = site.readOnly || busy === p.id;
            return (
              <li key={p.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                    {p.cover_path && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(p.cover_path)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0">
                    {state === "trash" ? (
                      <p className="truncate font-medium text-zinc-500">{p.title}</p>
                    ) : (
                      <Link href={`/${site.slug}/blog/${p.id}`} className="block truncate font-medium hover:underline">
                        {p.title}
                      </Link>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS[state].tone}`}>{STATUS[state].label}</span>
                      {multiLocale && <span>{localeLabel[p.locale] ?? p.locale}</span>}
                      <span>{state === "trash" ? `${trashDaysLeft(p.deleted_at)} nap múlva végleg törlődik` : fmtDate(p.published_at)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                  {state === "trash" ? (
                    <>
                      <button type="button" className={btn} disabled={disabled} onClick={() => run(p, restorePost, "Visszaállítva")}>
                        Visszaállítás
                      </button>
                      <button
                        type="button"
                        className={`${btn} text-red-600 dark:text-red-400`}
                        disabled={disabled}
                        onClick={() =>
                          run(p, deletePostForever, "Véglegesen törölve", {
                            confirm: `Véglegesen törlöd: „${p.title}”? A borítókép is törlődik, és nem lehet visszahozni.`,
                          })
                        }
                      >
                        Végleges törlés
                      </button>
                    </>
                  ) : (
                    <>
                      <Link href={`/${site.slug}/blog/${p.id}`} className={btn}>
                        Szerkesztés
                      </Link>
                      {state === "published" && live ? (
                        <a href={live} target="_blank" rel="noopener noreferrer" className={btn}>
                          Megnézem ↗
                        </a>
                      ) : (
                        preview && (
                          <a href={preview} target="_blank" rel="noopener noreferrer" className={btn}>
                            Előnézet ↗
                          </a>
                        )
                      )}
                      {state === "published" && (
                        <button type="button" className={btn} disabled={disabled} onClick={() => run(p, (a) => setPostStatus({ ...a, status: "hidden" }), "Elrejtve")}>
                          Elrejtés
                        </button>
                      )}
                      {state === "hidden" && (
                        <button type="button" className={btn} disabled={disabled} onClick={() => run(p, (a) => setPostStatus({ ...a, status: "published" }), "Újra közzétéve")}>
                          Közzététel
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                        disabled={disabled}
                        onClick={() =>
                          run(p, trashPost, `Cikk törölve (a Kukából ${TRASH_DAYS} napig visszaállítható)`, {
                            confirm: `Törlöd ezt a cikket: „${p.title}”? A Kukába kerül, onnan ${TRASH_DAYS} napig visszaállítható.`,
                          })
                        }
                      >
                        Cikk törlése
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

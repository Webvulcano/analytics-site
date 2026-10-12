"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCategory, reorderCategories } from "@/app/(admin)/[site]/portfolio/actions";
import { coverUrl, takenLinks } from "./utils";
import CategoryForm from "./CategoryForm";
import SortableGrid from "./SortableGrid";
import { Notice, publishNotice } from "./Modal";

// Category overview: cards with cover + count, drag to reorder, "+ Új kategória".
export default function GalleryCategories({ site, locales, categories }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState(null);
  const links = site.gallery.links ?? [];
  const linkLabel = Object.fromEntries(links.map((l) => [l.key, l.label]));

  async function handleCreate(values) {
    const res = await createCategory({ siteSlug: site.slug, ...values });
    if (!res.ok) return res.error;
    setCreating(false);
    setStatus(publishNotice(res, "Kategória létrehozva"));
    router.push(`/${site.slug}/portfolio/${res.category.id}`);
    return null;
  }

  async function handleReorder(next) {
    const res = await reorderCategories({ siteSlug: site.slug, ids: next.map((c) => c.id) });
    setStatus(publishNotice(res, "Sorrend mentve"));
    router.refresh();
    return res.ok;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{site.gallery.label}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Kategóriák a weboldalon látható sorrendben. Húzással átrendezheted, kattintással megnyitod.
          </p>
        </div>
        {!site.readOnly && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            + Új kategória
          </button>
        )}
      </div>

      <Notice status={status} onDismiss={() => setStatus(null)} />

      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Még nincs kategória. Hozd létre az elsőt a „+ Új kategória” gombbal.
        </div>
      ) : (
        <CategoryGrid
          key={categories.map((c) => `${c.id}:${c.position}`).join("|")}
          categories={categories}
          siteSlug={site.slug}
          readOnly={site.readOnly}
          defaultLocale={site.defaultLocale}
          linkLabel={linkLabel}
          onReorder={handleReorder}
        />
      )}

      {creating && (
        <CategoryForm
          title="Új kategória"
          locales={locales}
          defaultLocale={site.defaultLocale}
          links={links}
          taken={takenLinks(categories, site.defaultLocale)}
          onSubmit={handleCreate}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

// Keyed by the server order: remounts (resets local order) whenever fresh data arrives.
function CategoryGrid({ categories, siteSlug, readOnly, defaultLocale, linkLabel, onReorder }) {
  const [order, setOrder] = useState(categories);

  async function reorder(next) {
    const prev = order;
    setOrder(next);
    if (!(await onReorder(next))) setOrder(prev);
  }

  return (
    <SortableGrid
      id="gallery-categories"
      items={order}
      onReorder={reorder}
      disabled={readOnly}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      renderItem={(c) => {
        const src = coverUrl(c.cover);
        return (
          <Link
            href={`/${siteSlug}/portfolio/${c.id}`}
            draggable={false}
            className="group block overflow-hidden rounded-xl border border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="aspect-[4/3] bg-zinc-100 dark:bg-zinc-800">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" draggable={false} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-zinc-400">Üres</div>
              )}
            </div>
            <div className="space-y-1 p-3">
              <p className="truncate text-sm font-semibold">{c.title?.[defaultLocale] ?? c.slug}</p>
              <p className="text-xs text-zinc-500">{c.count} elem</p>
              {c.link_key && (
                <p className="truncate text-xs text-indigo-600 dark:text-indigo-400" title={linkLabel[c.link_key]}>
                  ↖ {linkLabel[c.link_key] ?? c.link_key}
                </p>
              )}
            </div>
          </Link>
        );
      }}
    />
  );
}

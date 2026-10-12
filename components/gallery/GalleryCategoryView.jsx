"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  addPhoto,
  deleteCategory,
  publishGallery,
  reorderItems,
  updateCategory,
} from "@/app/(admin)/[site]/portfolio/actions";
import { processImage } from "@/lib/image/process";
import { discardUpload, uploadGalleryImage } from "@/lib/image/upload";
import CategoryForm from "./CategoryForm";
import ItemPanel from "./ItemPanel";
import SortableGrid from "./SortableGrid";
import VideoForm from "./VideoForm";
import { Notice, publishNotice } from "./Modal";
import { itemThumb, takenLinks } from "./utils";

const PARALLEL = 2;

// One category: upload photos (many at once), add YouTube videos, reorder, edit, delete.
export default function GalleryCategoryView({ site, locales, category, categories, items }) {
  const router = useRouter();
  const fileRef = useRef(null);
  const [queue, setQueue] = useState([]); // [{ id, name, state, error }]
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(false);
  const [addingVideo, setAddingVideo] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [dropping, setDropping] = useState(false);

  const def = site.defaultLocale;
  const name = category.title?.[def] ?? category.slug;
  const link = (site.gallery.links ?? []).find((l) => l.key === category.link_key);
  const uploading = queue.some((q) => q.state !== "done" && q.state !== "error");
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const setJob = (id, patch) => setQueue((q) => q.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function uploadOne(job, file) {
    let path = null;
    try {
      setJob(job.id, { state: "processing" });
      const out = await processImage(file, { maxWidth: site.gallery.maxWidth ?? 2000, quality: site.gallery.quality ?? 80 });
      setJob(job.id, { state: "uploading", bytes: out.blob.size });
      path = await uploadGalleryImage({ siteId: site.id, categoryId: category.id, blob: out.blob });
      // Alt text defaults to the category name; it can be refined per photo later.
      const res = await addPhoto({
        siteSlug: site.slug,
        categoryId: category.id,
        path,
        width: out.width,
        height: out.height,
        bytes: out.blob.size,
        alt: category.title,
        deferPublish: true,
      });
      if (!res.ok) throw new Error(res.error);
      setJob(job.id, { state: "done" });
    } catch (e) {
      if (path) await discardUpload(path);
      setJob(job.id, { state: "error", error: e?.message ?? "Ismeretlen hiba" });
    }
  }

  async function handleFiles(fileList) {
    const files = [...(fileList ?? [])];
    if (!files.length || site.readOnly) return;
    const jobs = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, state: "waiting" }));
    setQueue((q) => [...q.filter((j) => j.state !== "done"), ...jobs]);
    setStatus(null);

    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        await uploadOne(jobs[i], files[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));

    const pub = await publishGallery({ siteSlug: site.slug });
    setStatus(publishNotice({ ...pub, ok: true }, "Feltöltés kész"));
    router.refresh();
  }

  async function handleReorder(next) {
    const res = await reorderItems({ siteSlug: site.slug, categoryId: category.id, ids: next.map((i) => i.id) });
    setStatus(publishNotice(res, "Sorrend mentve"));
    router.refresh();
    return res.ok;
  }

  async function handleUpdateCategory(values) {
    const res = await updateCategory({ siteSlug: site.slug, id: category.id, ...values });
    if (!res.ok) return res.error;
    setEditing(false);
    setStatus(publishNotice(res, "Kategória mentve"));
    router.refresh();
    return null;
  }

  async function handleDeleteCategory() {
    const msg = items.length
      ? `Törlöd a(z) „${name}” kategóriát és mind a ${items.length} elemét? Ez nem vonható vissza.`
      : `Törlöd a(z) „${name}” kategóriát?`;
    if (!window.confirm(msg)) return null;
    const res = await deleteCategory({ siteSlug: site.slug, id: category.id });
    if (!res.ok) return res.error;
    router.push(`/${site.slug}/portfolio`);
    return null;
  }

  const doneCount = queue.filter((j) => j.state === "done").length;
  const errorJobs = queue.filter((j) => j.state === "error");

  return (
    <div
      className="relative mx-auto max-w-6xl space-y-6 p-4 md:p-8"
      onDragOver={(e) => {
        if (site.readOnly || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDropping(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div>
        <Link href={`/${site.slug}/portfolio`} className="text-sm text-zinc-500 hover:underline">
          ← Összes kategória
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{name}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {items.length} elem
              {link ? ` · Főoldali gomb: ${link.label}` : " · Nincs főoldali gombhoz kötve"}
            </p>
          </div>
          {!site.readOnly && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Kategória szerkesztése
              </button>
              <button
                type="button"
                onClick={() => setAddingVideo(true)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                + YouTube videó
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
              >
                {uploading ? "Feltöltés…" : "+ Fotók feltöltése"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      </div>

      <Notice status={status} onDismiss={() => setStatus(null)} />

      {queue.length > 0 && (
        <div className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">
              {uploading ? "Feltöltés folyamatban…" : `${doneCount} kép feltöltve${errorJobs.length ? `, ${errorJobs.length} hiba` : ""}`}
            </span>
            {!uploading && (
              <button type="button" onClick={() => setQueue([])} className="text-xs text-zinc-500 hover:underline">
                Lista törlése
              </button>
            )}
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {queue.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-zinc-600 dark:text-zinc-300">{j.name}</span>
                <span
                  className={`shrink-0 text-xs ${
                    j.state === "error" ? "text-red-600" : j.state === "done" ? "text-emerald-600" : "text-zinc-500"
                  }`}
                  title={j.error}
                >
                  {
                    {
                      waiting: "várakozik",
                      processing: "WebP-re alakítás…",
                      uploading: `feltöltés (${Math.round((j.bytes ?? 0) / 1024)} KB)…`,
                      done: "kész ✓",
                      error: `hiba: ${j.error}`,
                    }[j.state]
                  }
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Ez a kategória még üres. Húzz ide fotókat, vagy használd a „+ Fotók feltöltése” / „+ YouTube videó” gombot.
        </div>
      ) : (
        <ItemsGrid
          key={items.map((i) => `${i.id}:${i.position}`).join("|")}
          items={items}
          readOnly={site.readOnly}
          defaultLocale={def}
          onReorder={handleReorder}
          onSelect={setSelectedId}
        />
      )}

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-indigo-500/10 ring-4 ring-inset ring-indigo-500">
          <span className="rounded-lg bg-white px-4 py-2 text-sm font-semibold shadow dark:bg-zinc-900">
            Engedd el a fotókat a feltöltéshez
          </span>
        </div>
      )}

      {editing && (
        <CategoryForm
          title="Kategória szerkesztése"
          initial={category}
          locales={locales}
          defaultLocale={def}
          links={site.gallery.links ?? []}
          taken={takenLinks(categories, def, category.id)}
          onSubmit={handleUpdateCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setEditing(false)}
        />
      )}

      {addingVideo && (
        <VideoForm
          site={site}
          locales={locales}
          categoryId={category.id}
          onDone={(res) => {
            setAddingVideo(false);
            setStatus(publishNotice(res, "Videó hozzáadva"));
            router.refresh();
          }}
          onClose={() => setAddingVideo(false)}
        />
      )}

      {selected && (
        <ItemPanel
          key={selected.id}
          site={site}
          locales={locales}
          item={selected}
          categories={categories}
          onDone={(res, text) => {
            setStatus(publishNotice(res, text));
            if (res.deleted || res.item?.category_id !== category.id) setSelectedId(null);
            router.refresh();
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// Keyed by the server order: remounts (resets local order) whenever fresh data arrives.
function ItemsGrid({ items, readOnly, defaultLocale, onReorder, onSelect }) {
  const [order, setOrder] = useState(items);

  async function reorder(next) {
    const prev = order;
    setOrder(next);
    if (!(await onReorder(next))) setOrder(prev);
  }

  return (
    <SortableGrid
      id="gallery-items"
      items={order}
      onReorder={reorder}
      disabled={readOnly}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      renderItem={(item) => (
        <button
          type="button"
          onClick={() => onSelect(item.id)}
          className="group block w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-left hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="relative aspect-[4/3] bg-zinc-100 dark:bg-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={itemThumb(item)} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" />
            {item.kind === "video" && (
              <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                ▶ VIDEÓ
              </span>
            )}
          </div>
          <div className="px-2 py-1.5">
            <p className="truncate text-xs font-medium">{item.title?.[defaultLocale] || <span className="text-zinc-400">Nincs cím</span>}</p>
            {item.year && <p className="text-[11px] text-zinc-500">{item.year}</p>}
          </div>
        </button>
      )}
    />
  );
}

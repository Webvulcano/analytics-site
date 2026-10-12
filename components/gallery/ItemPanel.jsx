"use client";

import { useState } from "react";
import { deleteItem, updateItem } from "@/app/(admin)/[site]/portfolio/actions";
import { processImage } from "@/lib/image/process";
import { discardUpload, uploadGalleryImage } from "@/lib/image/upload";
import { youtubeThumb } from "@/lib/gallery";
import { itemThumb } from "./utils";
import { Notice, inputClass } from "./Modal";

// Side panel for one photo / video: title, year, alt text, move to another category, delete.
export default function ItemPanel({ site, locales, item, categories, onDone, onClose }) {
  const [title, setTitle] = useState(item.title ?? {});
  const [alt, setAlt] = useState(item.alt ?? {});
  const [year, setYear] = useState(item.year ? String(item.year) : "");
  const [categoryId, setCategoryId] = useState(item.category_id);
  const [cover, setCover] = useState(undefined); // video: undefined = unchanged, null = YouTube, { blob, url, ... } = new
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isPhoto = item.kind === "photo";
  const preview = cover === undefined ? itemThumb(item) : cover === null ? youtubeThumb(item.youtube_id) : cover.url;

  async function pickCover(file) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const out = await processImage(file, { maxWidth: 1280, quality: 80 });
      setCover({ blob: out.blob, url: URL.createObjectURL(out.blob) });
    } catch (e) {
      setError(e?.message ?? "A képet nem sikerült feldolgozni.");
    } finally {
      setBusy(false);
    }
  }
  const def = site.defaultLocale;

  async function save(e) {
    e.preventDefault();
    if (isPhoto && !alt[def]?.trim()) {
      setError("Add meg a kép leírását (alt szöveg).");
      return;
    }
    setBusy(true);
    setError(null);
    let coverPath;
    try {
      if (cover === null) coverPath = null;
      else if (cover) coverPath = await uploadGalleryImage({ siteId: site.id, categoryId: item.category_id, blob: cover.blob });
    } catch (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    const res = await updateItem({ siteSlug: site.slug, id: item.id, title, alt, year, categoryId, coverPath });
    setBusy(false);
    if (!res.ok) {
      if (coverPath) await discardUpload(coverPath);
      setError(res.error);
    } else onDone(res, categoryId !== item.category_id ? "Áthelyezve" : "Mentve");
  }

  async function remove() {
    if (!window.confirm(isPhoto ? "Törlöd ezt a fotót? Ez nem vonható vissza." : "Törlöd ezt a videót a listából?")) return;
    setBusy(true);
    const res = await deleteItem({ siteSlug: site.slug, id: item.id });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDone({ ...res, deleted: true }, "Törölve");
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl sm:w-96 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">{isPhoto ? "Fotó" : "Videó"}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Panel bezárása" className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          ✕
        </button>
      </div>

      <form id="item-form" onSubmit={save} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="" className="max-h-64 w-full rounded-lg bg-zinc-100 object-contain dark:bg-zinc-800" />
        {!isPhoto && !site.readOnly && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="cursor-pointer font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Saját borítókép feltöltése
              <input
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  pickCover(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {(cover ? true : cover === undefined && item.path) && (
              <button type="button" onClick={() => setCover(null)} className="text-zinc-500 hover:underline">
                YouTube borítókép használata
              </button>
            )}
            {cover !== undefined && <span className="text-amber-600">nincs mentve</span>}
          </div>
        )}
        <p className="text-xs text-zinc-500">
          {isPhoto ? (
            `${item.width}×${item.height} px${item.bytes ? `, ${Math.round(item.bytes / 1024)} KB` : ""}, WebP`
          ) : (
            <a href={`https://www.youtube.com/watch?v=${item.youtube_id}`} target="_blank" rel="noopener noreferrer" className="underline">
              Megnyitás YouTube-on ↗
            </a>
          )}
        </p>

        {locales.map((l) => (
          <div key={`t-${l.locale}`}>
            <label htmlFor={`item-title-${l.locale}`} className="mb-1 block text-sm font-medium">
              Cím ({l.label})
            </label>
            <input
              id={`item-title-${l.locale}`}
              value={title[l.locale] ?? ""}
              maxLength={120}
              onChange={(e) => setTitle((t) => ({ ...t, [l.locale]: e.target.value }))}
              disabled={site.readOnly}
              className={inputClass}
            />
          </div>
        ))}

        <div>
          <label htmlFor="item-year" className="mb-1 block text-sm font-medium">
            Évszám
          </label>
          <input
            id="item-year"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            disabled={site.readOnly}
            placeholder="pl. 2025"
            className={`${inputClass} max-w-32`}
          />
        </div>

        {isPhoto &&
          locales.map((l) => (
            <div key={`a-${l.locale}`}>
              <label htmlFor={`item-alt-${l.locale}`} className="mb-1 block text-sm font-medium">
                Kép leírása — alt ({l.label}){l.locale === def && <span className="text-red-600"> *</span>}
              </label>
              <input
                id={`item-alt-${l.locale}`}
                value={alt[l.locale] ?? ""}
                maxLength={300}
                onChange={(e) => setAlt((a) => ({ ...a, [l.locale]: e.target.value }))}
                disabled={site.readOnly}
                className={inputClass}
              />
            </div>
          ))}
        {isPhoto && (
          <p className="-mt-2 text-xs text-zinc-500">Röviden, mit látni a képen — a Google és a képernyőolvasók ebből tudják.</p>
        )}

        <div>
          <label htmlFor="item-category" className="mb-1 block text-sm font-medium">
            Kategória
          </label>
          <select
            id="item-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={site.readOnly}
            className={inputClass}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title?.[def] ?? c.slug}
              </option>
            ))}
          </select>
        </div>

        <Notice status={error ? { type: "error", text: error } : null} />
      </form>

      {!site.readOnly && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
          <button type="button" onClick={remove} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-40">
            Törlés
          </button>
          <button type="submit" form="item-form" disabled={busy} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
            {busy ? "Mentés…" : "Mentés"}
          </button>
        </div>
      )}
    </aside>
  );
}

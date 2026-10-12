"use client";

import { useState } from "react";
import { addVideo } from "@/app/(admin)/[site]/portfolio/actions";
import { parseYouTubeId, youtubeThumb } from "@/lib/gallery";
import Modal, { Notice, inputClass } from "./Modal";

// Add a YouTube video: paste the link → thumbnail preview → title / year (optional).
export default function VideoForm({ site, locales, categoryId, onDone, onClose }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState({});
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const id = parseYouTubeId(url);

  async function submit(e) {
    e.preventDefault();
    if (!id) {
      setError("Illeszd be a videó YouTube-linkjét.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addVideo({ siteSlug: site.slug, categoryId, url, title, year });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDone(res);
  }

  return (
    <Modal
      title="YouTube videó hozzáadása"
      onClose={onClose}
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Mégse
          </button>
          <button type="submit" form="video-form" disabled={busy || !id} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
            {busy ? "Mentés…" : "Hozzáadás"}
          </button>
        </div>
      }
    >
      <form id="video-form" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="video-url" className="mb-1 block text-sm font-medium">
            YouTube-link <span className="text-red-600">*</span>
          </label>
          <input
            id="video-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className={inputClass}
            autoFocus
          />
          {url && !id && <p className="mt-1 text-xs text-red-600">Nem ismerem fel a linket.</p>}
        </div>

        {id && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={youtubeThumb(id)} alt="" className="aspect-video w-full rounded-lg object-cover" />
        )}

        {locales.map((l) => (
          <div key={l.locale}>
            <label htmlFor={`video-title-${l.locale}`} className="mb-1 block text-sm font-medium">
              Cím ({l.label})
            </label>
            <input
              id={`video-title-${l.locale}`}
              value={title[l.locale] ?? ""}
              maxLength={120}
              onChange={(e) => setTitle((t) => ({ ...t, [l.locale]: e.target.value }))}
              className={inputClass}
            />
          </div>
        ))}

        <div>
          <label htmlFor="video-year" className="mb-1 block text-sm font-medium">
            Évszám
          </label>
          <input
            id="video-year"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="pl. 2025"
            className={`${inputClass} max-w-32`}
          />
        </div>

        <Notice status={error ? { type: "error", text: error } : null} />
      </form>
    </Modal>
  );
}

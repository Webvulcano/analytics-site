"use client";

import { useRef, useState } from "react";
import { processImage } from "@/lib/image/process";
import { discardUpload, mediaUrl, uploadSlotImage } from "@/lib/image/upload";
import {
  addSlotImage,
  deleteSlotImage,
  reorderSlotImages,
  retryPublish,
  updateSlotImageAlt,
} from "@/app/(admin)/[site]/szerkesztes/actions";
import SortableGrid from "@/components/gallery/SortableGrid";
import { Notice, publishNotice } from "@/components/gallery/Modal";

const PARALLEL = 2;
const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950";
const checker =
  "bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fff_0_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)]";

// "acme-corp_logo.png" → "acme corp logo": default name/alt for a new image (editable later).
const nameFromFile = (name) =>
  name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "Logó";

// Multi-image slot (e.g. client logos): upload several at once, reorder by dragging,
// name (alt) per language, delete. Every change is saved and published immediately;
// onSaved() lets the editor reload the preview.
export default function GallerySlotEditor({ site, slot, locales, images, onImagesChange, onSaved, disabled }) {
  const fileRef = useRef(null);
  const [queue, setQueue] = useState([]); // [{ id, name, state, error }]
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState(null);
  const [over, setOver] = useState(false);
  const busy = queue.some((j) => j.state === "working" || j.state === "waiting");
  const full = slot.max_items != null && images.length >= slot.max_items;
  const selected = images.find((i) => i.id === selectedId) ?? null;

  function done(res, text) {
    setStatus(publishNotice(res, text));
    if (res.ok) onSaved();
  }

  async function handleFiles(fileList) {
    const room = slot.max_items != null ? slot.max_items - images.length : Infinity;
    const files = [...(fileList ?? [])].slice(0, Math.max(0, room));
    if (!files.length || disabled) {
      if (full) setStatus({ type: "error", text: `Legfeljebb ${slot.max_items} kép lehet itt.` });
      return;
    }
    setStatus(null);
    const jobs = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, state: "waiting" }));
    setQueue(jobs);
    const setJob = (id, patch) => setQueue((q) => q.map((j) => (j.id === id ? { ...j, ...patch } : j)));

    const added = [];
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        const job = jobs[i];
        let path = null;
        setJob(job.id, { state: "working" });
        try {
          const out = await processImage(files[i], { maxWidth: slot.max_width, maxHeight: slot.max_height, quality: slot.quality });
          path = await uploadSlotImage({ siteId: site.id, slotKey: slot.key, blob: out.blob });
          const name = nameFromFile(files[i].name);
          const res = await addSlotImage({
            siteSlug: site.slug,
            slotKey: slot.key,
            path,
            width: out.width,
            height: out.height,
            alt: Object.fromEntries(locales.map((l) => [l.locale, name])),
            deferPublish: true,
          });
          if (!res.ok) throw new Error(res.error);
          added.push(res.image);
          setJob(job.id, { state: "done" });
        } catch (e) {
          if (path) await discardUpload(path);
          setJob(job.id, { state: "error", error: e?.message ?? "Ismeretlen hiba" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));

    if (added.length) {
      onImagesChange([...images, ...added].sort((a, b) => a.position - b.position));
      const pub = await retryPublish({ siteSlug: site.slug });
      done({ ok: true, published: pub.ok, publishError: pub.error }, `${added.length} kép feltöltve`);
    }
    setQueue((q) => q.filter((j) => j.state === "error"));
  }

  async function handleReorder(next) {
    const prev = images;
    onImagesChange(next);
    const res = await reorderSlotImages({ siteSlug: site.slug, slotKey: slot.key, ids: next.map((i) => i.id) });
    if (!res.ok) onImagesChange(prev);
    done(res, "Sorrend mentve");
  }

  return (
    <div className="space-y-4">
      {slot.help && <p className="text-xs text-zinc-500">{slot.help}</p>}

      <div
        onDragOver={(e) => {
          if (disabled || ![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg ${over ? "ring-2 ring-indigo-500" : ""}`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy || full}
          className="w-full rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm font-medium hover:border-indigo-500 hover:text-indigo-600 disabled:opacity-50 dark:border-zinc-700"
        >
          {busy ? "Feltöltés…" : full ? "Megtelt" : "+ Képek feltöltése"}
          <span className="mt-0.5 block text-xs font-normal text-zinc-500">
            több is egyszerre, vagy húzd ide · PNG (átlátszó háttérrel), JPG, WebP
          </span>
        </button>
      </div>

      {queue.length > 0 && (
        <ul className="space-y-1 text-xs">
          {queue.map((j) => (
            <li key={j.id} className={j.state === "error" ? "text-red-600" : "text-zinc-500"}>
              {j.name} — {j.state === "waiting" ? "vár" : j.state === "working" ? "feldolgozás…" : j.state === "done" ? "kész ✓" : j.error}
            </li>
          ))}
        </ul>
      )}

      <Notice status={status} onDismiss={() => setStatus(null)} />

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {images.length}
          {slot.max_items != null && ` / ${slot.max_items}`} kép · húzással rendezheted, kattints egyre a szerkesztéshez
        </span>
      </div>

      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Még nincs kép. Amíg üres, a weboldalon ez a rész nem jelenik meg.
        </p>
      ) : (
        <SortableGrid
          id={`slot-${slot.key}`}
          items={images}
          onReorder={handleReorder}
          disabled={disabled || busy}
          className="grid grid-cols-3 gap-2"
          renderItem={(img) => (
            <button
              type="button"
              onClick={() => setSelectedId(img.id === selectedId ? null : img.id)}
              title={img.alt?.[site.defaultLocale] ?? ""}
              className={`flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-lg border p-2 ${checker} ${
                img.id === selectedId ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(img.path)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            </button>
          )}
        />
      )}

      {selected && (
        <ImageForm
          key={selected.id}
          site={site}
          slot={slot}
          locales={locales}
          image={selected}
          disabled={disabled}
          onClose={() => setSelectedId(null)}
          onUpdated={(img, res) => {
            onImagesChange(images.map((i) => (i.id === img.id ? img : i)));
            done(res, "Mentve");
          }}
          onDeleted={(res) => {
            onImagesChange(images.filter((i) => i.id !== selected.id));
            setSelectedId(null);
            done(res, "Törölve");
          }}
        />
      )}
    </div>
  );
}

// Name / alt text of one image (all languages at once) + delete.
function ImageForm({ site, slot, locales, image, disabled, onClose, onUpdated, onDeleted }) {
  const [alt, setAlt] = useState(image.alt ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const def = site.defaultLocale;
  const changed = locales.some((l) => (alt[l.locale] ?? "") !== (image.alt?.[l.locale] ?? ""));

  async function save(e) {
    e.preventDefault();
    if (!alt[def]?.trim()) return setError("Az alapnyelvi név (alt szöveg) kötelező.");
    setSaving(true);
    setError(null);
    const res = await updateSlotImageAlt({ siteSlug: site.slug, slotKey: slot.key, id: image.id, alt });
    setSaving(false);
    if (!res.ok) setError(res.error);
    else onUpdated(res.image, res);
  }

  async function remove() {
    if (!window.confirm("Törlöd ezt a képet? Ez nem vonható vissza.")) return;
    setSaving(true);
    const res = await deleteSlotImage({ siteSlug: site.slug, slotKey: slot.key, id: image.id });
    setSaving(false);
    if (!res.ok) setError(res.error);
    else onDeleted(res);
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Kiválasztott kép</p>
        <button type="button" onClick={onClose} aria-label="Bezárás" className="text-zinc-500">
          ✕
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {image.width}×{image.height} px{image.bytes ? `, ${Math.max(1, Math.round(image.bytes / 1024))} KB` : ""}, WebP
      </p>
      {locales.map((l) => (
        <div key={l.locale}>
          <label htmlFor={`slot-alt-${image.id}-${l.locale}`} className="mb-1 block text-sm font-medium">
            Név / leírás ({l.label}){l.locale === def && <span className="text-red-600"> *</span>}
          </label>
          <input
            id={`slot-alt-${image.id}-${l.locale}`}
            value={alt[l.locale] ?? ""}
            maxLength={300}
            onChange={(e) => setAlt((a) => ({ ...a, [l.locale]: e.target.value }))}
            disabled={disabled || saving}
            placeholder="pl. a cég neve"
            className={input}
          />
        </div>
      ))}
      <p className="text-xs text-zinc-500">A Google és a képernyőolvasók ebből tudják, mi van a képen (logónál: a cég neve).</p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        <button type="button" onClick={remove} disabled={disabled || saving} className="text-sm text-red-600 hover:underline disabled:opacity-40">
          Törlés
        </button>
        <button
          type="submit"
          disabled={disabled || saving || !changed}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          {saving ? "Mentés…" : "Mentés"}
        </button>
      </div>
    </form>
  );
}

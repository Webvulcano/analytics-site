"use client";

import { useRef, useState } from "react";
import { processImage } from "@/lib/image/process";
import { mediaUrl } from "@/lib/image/upload";

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Single image slot: pick a photo → converted to WebP in the browser → previewed on the
// page right away. Nothing is uploaded until "Mentés".
export default function ImageEditor({ slot, image, draft, onChange, disabled, siteUrl, locale }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);

  const shown = draft.upload
    ? { src: draft.upload.url, width: draft.upload.width, height: draft.upload.height }
    : image
      ? { src: mediaUrl(image.path), width: image.width, height: image.height }
      : slot.default_src
        ? { src: new URL(slot.default_src, siteUrl).toString(), width: slot.default_width, height: slot.default_height }
        : null;

  const isDefault = !draft.upload && !image;
  const defaultAlt = slot.default_alt?.[locale] ?? "";

  async function handleFile(file) {
    if (!file || busy || disabled) return;
    setError(null);
    setBusy(true);
    try {
      const out = await processImage(file, {
        maxWidth: slot.max_width,
        maxHeight: slot.max_height,
        quality: slot.quality,
      });
      if (draft.upload) URL.revokeObjectURL(draft.upload.url);
      onChange({
        ...draft,
        upload: {
          blob: out.blob,
          url: URL.createObjectURL(out.blob),
          width: out.width,
          height: out.height,
          bytes: out.blob.size,
          sourceName: file.name,
          sourceBytes: file.size,
          source: out.source,
        },
      });
    } catch (e) {
      setError(e?.message ?? "A képet nem sikerült feldolgozni.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`relative overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fff_0_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)] ${
          over ? "border-indigo-500 ring-2 ring-indigo-500/30" : "border-zinc-200 dark:border-zinc-800"
        }`}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown.src} alt="" className="max-h-72 w-full object-contain" />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-500">Nincs kép</div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-medium dark:bg-zinc-900/70">
            Kép feldolgozása…
          </div>
        )}
      </div>

      {draft.upload && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950">
          <span className="text-emerald-900 dark:text-emerald-100">
            Új kép mérete: <b>{kb(draft.upload.bytes)}</b>
          </span>
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            eredeti {kb(draft.upload.sourceBytes)}
            {draft.upload.sourceBytes > draft.upload.bytes &&
              ` · −${Math.round((1 - draft.upload.bytes / draft.upload.sourceBytes) * 100)}%`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {draft.upload
            ? `${draft.upload.width}×${draft.upload.height} px, WebP — még nincs mentve`
            : image
              ? `Feltöltött kép: ${image.width}×${image.height}, ${kb(image.bytes)}`
              : "Eredeti (sablon) kép"}
        </span>
        <span>max. {slot.max_width}px széles</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || disabled}
        className="w-full rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm font-medium hover:border-indigo-500 hover:text-indigo-600 disabled:opacity-50 dark:border-zinc-700"
      >
        {busy ? "Feldolgozás…" : "Új kép kiválasztása"}
        <span className="mt-0.5 block text-xs font-normal text-zinc-500">vagy húzd ide · JPG, PNG, HEIC, WebP</span>
      </button>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div>
        <label htmlFor={`alt-${slot.key}`} className="mb-1 block text-sm font-medium">
          Kép leírása (alt szöveg) <span className="text-red-600">*</span>
        </label>
        <input
          id={`alt-${slot.key}`}
          type="text"
          value={draft.alt}
          maxLength={300}
          placeholder={isDefault ? defaultAlt : "Mit ábrázol a kép?"}
          onChange={(e) => onChange({ ...draft, alt: e.target.value })}
          disabled={disabled || isDefault}
          required={!isDefault}
          aria-invalid={!isDefault && !draft.alt.trim() ? true : undefined}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <p className="mt-1 text-xs text-zinc-500">
          {isDefault
            ? "Saját kép feltöltése után adhatsz meg leírást."
            : "Kötelező. Röviden, mit látni a képen (pl. „Fényezett fekete BMW a mosás után”) — a Google és a képernyőolvasók ezt „látják”."}
        </p>
      </div>
    </div>
  );
}

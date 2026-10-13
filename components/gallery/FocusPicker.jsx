"use client";

import { useRef } from "react";

const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));

// "16/9" → "16 / 9" (CSS aspect-ratio); falls back to 16/9.
export function cssAspect(aspect) {
  return /^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(aspect ?? "") ? aspect.replace("/", " / ") : "16 / 9";
}

// The thumbnail exactly as the client site renders it: cover → cropped around the focus point,
// contain → whole image over a blurred, cover-filled copy of itself. Fills its (relative) parent.
export function FramedImage({ src, focus, fit, className = "" }) {
  if (fit === "contain") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} loading="lazy" className={`relative h-full w-full object-contain ${className}`} />
      </>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      className={`h-full w-full object-cover ${className}`}
      style={{ objectPosition: `${focus.x}% ${focus.y}%` }}
    />
  );
}

// Click / drag on the full image to set the crop anchor; arrow keys move it by 1% (Shift: 10%).
// Below: live preview in the site's card shape (manifest gallery.aspect).
export default function FocusPicker({ src, focus, fit, aspect, readOnly, onChange }) {
  const imgRef = useRef(null);
  const dragging = useRef(false);

  function setFromPointer(e) {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r?.width || !r?.height) return;
    onChange({ focus: { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) }, fit });
  }

  function onKeyDown(e) {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onChange({ focus: { x: clamp(focus.x + d[0]), y: clamp(focus.y + d[1]) }, fit });
  }

  const cover = fit !== "contain";
  const editable = cover && !readOnly;

  return (
    <div className="space-y-3">
      <div className="flex justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
        <div className="relative inline-block max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            className={`block max-h-64 max-w-full select-none ${editable ? "cursor-crosshair touch-none" : ""}`}
            onPointerDown={(e) => {
              if (!editable) return;
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setFromPointer(e);
            }}
            onPointerMove={(e) => dragging.current && setFromPointer(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          />
          {cover && (
            <button
              type="button"
              aria-label={`Fókuszpont: ${focus.x}% vízszintesen, ${focus.y}% függőlegesen. Nyilakkal mozgatható.`}
              disabled={readOnly}
              onKeyDown={onKeyDown}
              className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-500/40 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] focus-visible:pointer-events-auto focus-visible:outline-2 focus-visible:outline-indigo-500"
              style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
              tabIndex={editable ? 0 : -1}
            />
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input type="checkbox" checked={!cover} onChange={(e) => onChange({ focus, fit: e.target.checked ? "contain" : "cover" })} />
            Teljes kép mutatása (nem vág)
          </label>
          {cover && (focus.x !== 50 || focus.y !== 50) && (
            <button type="button" onClick={() => onChange({ focus: { x: 50, y: 50 }, fit })} className="text-zinc-500 hover:underline">
              Középre
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-zinc-500">
        {cover
          ? "Kattints a kép legfontosabb részére (pl. arc) — a weboldal onnan vágja ki a kártyát."
          : "A teljes kép látszik, a maradék helyet a kép elmosott változata tölti ki."}
      </p>

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-500">Így jelenik meg a weboldalon:</p>
        <div className="relative w-full overflow-hidden rounded-lg bg-zinc-900" style={{ aspectRatio: cssAspect(aspect) }}>
          <FramedImage src={src} focus={focus} fit={fit} />
        </div>
      </div>
    </div>
  );
}

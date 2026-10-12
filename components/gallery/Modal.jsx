"use client";

import { useEffect } from "react";

// Minimal modal: Escape and backdrop click close it (unless busy).
export default function Modal({ title, onClose, busy, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Bezárás"
            className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950";

export function Notice({ status, onDismiss }) {
  if (!status) return null;
  const tone =
    status.type === "ok"
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : status.type === "warn"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
  return (
    <div role="status" className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${tone}`}>
      <span>{status.text}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Üzenet bezárása" className="opacity-60 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}

// Result of a save that also published the client site.
export function publishNotice(res, okText) {
  if (!res.ok) return { type: "error", text: res.error };
  if (res.published === false) {
    return { type: "warn", text: `${okText} — de a weboldal frissítése nem sikerült (${res.publishError}). Pár perc múlva magától frissül.` };
  }
  return { type: "ok", text: `${okText} ✓ Pár másodperc múlva a weboldalon is látszik.` };
}

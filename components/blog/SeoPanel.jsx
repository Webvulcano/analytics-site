"use client";

import { LIMITS, SEO_HINT } from "@/lib/blog";
import { inputClass } from "@/components/gallery/Modal";

function Counter({ value, hint, max }) {
  const n = value.length;
  const tone = n > max ? "text-red-600" : n > hint ? "text-amber-600" : "text-zinc-400";
  return <span className={`text-xs ${tone}`}>{n} / {hint}</span>;
}

// Google-megjelenés: saját cím + leírás (üresen a cikk címe / kivonata megy), találat-előnézettel.
export default function SeoPanel({ form, onChange, url, disabled }) {
  const title = form.metaTitle.trim() || form.title.trim() || "Cikk címe";
  const desc = form.description.trim() || form.excerpt.trim() || "Rövid leírás a cikkről - ez látszik a Google-találat alatt.";

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="flex items-center justify-between text-sm font-medium">
          Cím a Google-ben <Counter value={form.metaTitle} hint={SEO_HINT.metaTitle} max={LIMITS.metaTitle} />
        </span>
        <input
          type="text"
          value={form.metaTitle}
          maxLength={LIMITS.metaTitle}
          disabled={disabled}
          onChange={(e) => onChange({ metaTitle: e.target.value })}
          placeholder="Üresen a cikk címe"
          className={`${inputClass} mt-1`}
        />
      </label>
      <label className="block">
        <span className="flex items-center justify-between text-sm font-medium">
          Leírás a Google-ben <Counter value={form.description} hint={SEO_HINT.description} max={LIMITS.description} />
        </span>
        <textarea
          value={form.description}
          maxLength={LIMITS.description}
          disabled={disabled}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          placeholder="1-2 mondat: miről szól, kinek hasznos. Üresen a kivonat."
          className={`${inputClass} mt-1`}
        />
      </label>

      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950" aria-label="Google-találat előnézet">
        <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">{url ?? "…"}</p>
        <p className="mt-0.5 line-clamp-1 text-base text-[#1a0dab] dark:text-[#8ab4f8]">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{desc}</p>
      </div>
    </div>
  );
}

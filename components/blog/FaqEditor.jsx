"use client";

import { LIMITS } from "@/lib/blog";
import { inputClass } from "@/components/gallery/Modal";

// GYIK a cikk alján (a Google FAQ-találatként is mutathatja). Hozzáadás, törlés, sorrend.
export default function FaqEditor({ items, onChange, disabled }) {
  const update = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const small = "rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800";

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-zinc-500">Nincs kérdés. A GYIK nem kötelező, de segít a Google-találatban.</p>}
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">{i + 1}. kérdés</span>
            <span className="flex gap-1">
              <button type="button" className={small} disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Feljebb">↑</button>
              <button type="button" className={small} disabled={disabled || i === items.length - 1} onClick={() => move(i, 1)} aria-label="Lejjebb">↓</button>
              <button type="button" className={`${small} text-red-600`} disabled={disabled} onClick={() => remove(i)} aria-label="Törlés">✕</button>
            </span>
          </div>
          <input
            type="text"
            value={it.q}
            maxLength={LIMITS.faqQ}
            disabled={disabled}
            onChange={(e) => update(i, { q: e.target.value })}
            placeholder="Kérdés"
            className={inputClass}
          />
          <textarea
            value={it.a}
            maxLength={LIMITS.faqA}
            disabled={disabled}
            onChange={(e) => update(i, { a: e.target.value })}
            placeholder="Válasz"
            rows={3}
            className={inputClass}
          />
        </div>
      ))}
      {items.length < LIMITS.faqItems && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...items, { q: "", a: "" }])}
          className="rounded-lg border border-dashed border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          + Kérdés
        </button>
      )}
    </div>
  );
}

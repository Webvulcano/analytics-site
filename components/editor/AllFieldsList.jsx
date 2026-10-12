"use client";

import { resolveValue, shortText } from "@/lib/editor/content";

// Every editable element, grouped by section — also the only place for hidden fields (SEO).
export default function AllFieldsList({ fields, slots, values, locale, defaultLocale, onSelect, selectedKey }) {
  const sections = [];
  const byKey = new Map();
  for (const entry of [
    ...fields.map((f) => ({ kind: "field", sort: f.sort, def: f })),
    ...slots.map((s) => ({ kind: "slot", sort: s.sort, def: s })),
  ].sort((a, b) => a.sort - b.sort)) {
    const id = `${entry.def.page_key}.${entry.def.section_key}`;
    if (!byKey.has(id)) {
      const section = { id, label: entry.def.section_label, items: [] };
      byKey.set(id, section);
      sections.push(section);
    }
    byKey.get(id).items.push(entry);
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {sections.map((section) => (
          <section key={section.id}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{section.label}</h3>
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {section.items.map(({ kind, def }) => {
                const selected = selectedKey === def.key;
                const preview =
                  kind === "slot" ? "Kép" : shortText(resolveValue(def, values, locale, defaultLocale)) || "—";
                return (
                  <li key={def.key}>
                    <button
                      type="button"
                      onClick={() => onSelect({ key: def.key, i: null, f: null })}
                      className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                        selected ? "bg-indigo-50 dark:bg-indigo-950" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {def.label}
                          {def.options?.hidden && (
                            <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                              nem látszik az oldalon
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">{preview}</span>
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">Szerkesztés →</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

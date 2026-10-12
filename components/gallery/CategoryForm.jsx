"use client";

import { useState } from "react";
import Modal, { Notice, inputClass } from "./Modal";

// Create / edit a category: name per language + which home-page button points to it.
// `taken` = { [linkKey]: name of the category already using it } (the edited one excluded).
export default function CategoryForm({ title, initial, locales, defaultLocale, links, taken, onSubmit, onDelete, onClose }) {
  const [names, setNames] = useState(initial?.title ?? {});
  const [link, setLink] = useState(initial?.link_key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!names[defaultLocale]?.trim()) {
      setError("Add meg a kategória nevét.");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSubmit({ title: names, link: link || null });
    setBusy(false);
    if (err) setError(err);
  }

  async function remove() {
    setBusy(true);
    const err = await onDelete();
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <div className="flex items-center justify-between gap-2">
          {onDelete ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-40">
              Kategória törlése
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Mégse
            </button>
            <button type="submit" form="category-form" disabled={busy} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
              {busy ? "Mentés…" : "Mentés"}
            </button>
          </div>
        </div>
      }
    >
      <form id="category-form" onSubmit={submit} className="space-y-4">
        {locales.map((l) => (
          <div key={l.locale}>
            <label htmlFor={`cat-name-${l.locale}`} className="mb-1 block text-sm font-medium">
              Név ({l.label}){l.locale === defaultLocale && <span className="text-red-600"> *</span>}
            </label>
            <input
              id={`cat-name-${l.locale}`}
              value={names[l.locale] ?? ""}
              maxLength={120}
              onChange={(e) => setNames((n) => ({ ...n, [l.locale]: e.target.value }))}
              className={inputClass}
              autoFocus={l.locale === defaultLocale}
            />
          </div>
        ))}

        {links.length > 0 && (
          <div>
            <label htmlFor="cat-link" className="mb-1 block text-sm font-medium">
              Főoldali gomb
            </label>
            <select id="cat-link" value={link} onChange={(e) => setLink(e.target.value)} className={inputClass}>
              <option value="">Nincs — nem visz ide főoldali gomb</option>
              {links.map((l) => (
                <option key={l.key} value={l.key} disabled={Boolean(taken[l.key])}>
                  {l.label}
                  {taken[l.key] ? ` — foglalt (${taken[l.key]})` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              A főoldalon erre a gombra kattintva a látogató ehhez a kategóriához görget. Egy gomb csak egy kategóriához tartozhat.
            </p>
          </div>
        )}

        {initial && (
          <p className="text-xs text-zinc-500">
            A kategória webcíme (<code>{initial.slug}</code>) átnevezéskor nem változik, így a régi linkek is működnek.
          </p>
        )}

        <Notice status={error ? { type: "error", text: error } : null} />
      </form>
    </Modal>
  );
}

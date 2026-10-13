"use client";

import { useState } from "react";
import {
  createReview,
  deleteReview,
  reorderReviews,
  setReviewVisible,
  updateReview,
} from "@/app/(admin)/[site]/ertekelesek/actions";
import { MAX_AUTHOR, MAX_BODY, MAX_SUBTITLE } from "@/lib/reviews";
import SortableGrid from "@/components/gallery/SortableGrid";
import { Notice, inputClass, publishNotice } from "@/components/gallery/Modal";

// Reviews module: cards in website order (drag to reorder), visible/hidden switch,
// side panel to add / edit / delete. Every change is saved and published immediately.
export default function ReviewsManager({ site, locales, initialReviews }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [editing, setEditing] = useState(null); // review object, or "new"
  const [status, setStatus] = useState(null);
  const def = site.defaultLocale;
  const visibleCount = reviews.filter((r) => r.visible).length;

  async function handleReorder(next) {
    const prev = reviews;
    setReviews(next);
    const res = await reorderReviews({ siteSlug: site.slug, ids: next.map((r) => r.id) });
    if (!res.ok) setReviews(prev);
    setStatus(publishNotice(res, "Sorrend mentve"));
  }

  async function toggleVisible(review) {
    const res = await setReviewVisible({ siteSlug: site.slug, id: review.id, visible: !review.visible });
    if (res.ok) setReviews((list) => list.map((r) => (r.id === review.id ? res.review : r)));
    setStatus(publishNotice(res, res.review?.visible ? "Megjelenítve" : "Elrejtve"));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{site.label}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {reviews.length} értékelés, ebből {visibleCount} látható a weboldalon. Húzással rendezheted, kattints egyre a szerkesztéshez.
          </p>
        </div>
        {!site.readOnly && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            + Új értékelés
          </button>
        )}
      </div>

      <Notice status={status} onDismiss={() => setStatus(null)} />

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Még nincs értékelés. Amíg nincs látható értékelés, a weboldalon ez a rész nem jelenik meg.
        </div>
      ) : (
        <SortableGrid
          id="reviews"
          items={reviews}
          onReorder={handleReorder}
          disabled={site.readOnly}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          renderItem={(r) => (
            <div
              className={`flex h-full flex-col rounded-xl border bg-white p-4 dark:bg-zinc-900 ${
                r.visible ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 opacity-60 dark:border-zinc-700"
              }`}
            >
              <button type="button" onClick={() => setEditing(r)} className="flex-1 text-left">
                <Stars value={r.rating} />
                <p className="mt-2 line-clamp-4 text-sm text-zinc-700 dark:text-zinc-300">{r.body?.[def]}</p>
                <p className="mt-3 text-sm font-semibold">{r.author}</p>
                {r.subtitle?.[def] && <p className="text-xs text-zinc-500">{r.subtitle[def]}</p>}
              </button>
              <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                <span className="text-zinc-500">
                  {locales.filter((l) => l.locale !== def).map((l) => (r.body?.[l.locale] ? `${l.label} ✓` : `${l.label}: nincs`)).join(" · ")}
                </span>
                {!site.readOnly && (
                  <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                    <input type="checkbox" checked={r.visible} onChange={() => toggleVisible(r)} />
                    Látható
                  </label>
                )}
              </div>
            </div>
          )}
        />
      )}

      {editing && (
        <ReviewPanel
          key={editing === "new" ? "new" : editing.id}
          site={site}
          locales={locales}
          review={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(review, res, isNew) => {
            setReviews((list) => (isNew ? [review, ...list] : list.map((r) => (r.id === review.id ? review : r))));
            setStatus(publishNotice(res, isNew ? "Értékelés hozzáadva" : "Mentve"));
            setEditing(null);
          }}
          onDeleted={(id, res) => {
            setReviews((list) => list.filter((r) => r.id !== id));
            setStatus(publishNotice(res, "Törölve"));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Stars({ value, onChange, disabled }) {
  return (
    <div className="flex gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label={`${value} csillag`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} csillag`}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`text-2xl leading-none transition ${n <= value ? "text-amber-400" : "text-zinc-300 dark:text-zinc-600"} hover:scale-110`}
          >
            ★
          </button>
        ) : (
          <span key={n} aria-hidden="true" className={n <= value ? "text-amber-400" : "text-zinc-300 dark:text-zinc-600"}>
            ★
          </span>
        )
      )}
    </div>
  );
}

// Add / edit one review: name, subtitle and text per language (default language required), stars.
function ReviewPanel({ site, locales, review, onClose, onSaved, onDeleted }) {
  const [author, setAuthor] = useState(review?.author ?? "");
  const [subtitle, setSubtitle] = useState(review?.subtitle ?? {});
  const [body, setBody] = useState(review?.body ?? {});
  const [rating, setRating] = useState(review?.rating ?? 5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const def = site.defaultLocale;
  const ro = site.readOnly;

  async function save(e) {
    e.preventDefault();
    if (!author.trim()) return setError("A név kötelező.");
    if (!body[def]?.trim()) return setError("Az értékelés szövege (alapnyelven) kötelező.");
    setBusy(true);
    setError(null);
    const input = { siteSlug: site.slug, author, subtitle, body, rating };
    const res = review ? await updateReview({ ...input, id: review.id }) : await createReview(input);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onSaved(res.review, res, !review);
  }

  async function remove() {
    if (!window.confirm(`Törlöd ${review.author} értékelését? Ez nem vonható vissza.`)) return;
    setBusy(true);
    const res = await deleteReview({ siteSlug: site.slug, id: review.id });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDeleted(review.id, res);
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl sm:w-[28rem] dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">{review ? "Értékelés szerkesztése" : "Új értékelés"}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Panel bezárása" className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          ✕
        </button>
      </div>

      <form id="review-form" onSubmit={save} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <p className="mb-1 text-sm font-medium">Értékelés</p>
          <Stars value={rating} onChange={ro ? undefined : setRating} disabled={busy} />
        </div>

        <div>
          <label htmlFor="review-author" className="mb-1 block text-sm font-medium">
            Név <span className="text-red-600">*</span>
          </label>
          <input
            id="review-author"
            value={author}
            maxLength={MAX_AUTHOR}
            onChange={(e) => setAuthor(e.target.value)}
            disabled={ro}
            placeholder="pl. Kiss Anna & Péter"
            className={inputClass}
          />
        </div>

        {locales.map((l) => {
          const isDef = l.locale === def;
          const text = body[l.locale] ?? "";
          return (
            <fieldset key={l.locale} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-xs font-medium text-zinc-500">
                {l.label}
                {!isDef && " — opcionális fordítás (ha üres, az eredeti szöveg jelenik meg)"}
              </legend>
              <div>
                <label htmlFor={`review-sub-${l.locale}`} className="mb-1 block text-sm font-medium">
                  Alcím
                </label>
                <input
                  id={`review-sub-${l.locale}`}
                  value={subtitle[l.locale] ?? ""}
                  maxLength={MAX_SUBTITLE}
                  onChange={(e) => setSubtitle((s) => ({ ...s, [l.locale]: e.target.value }))}
                  disabled={ro}
                  placeholder={isDef ? "pl. Esküvő, 2025 — vagy cégnév, pozíció" : ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`review-body-${l.locale}`} className="mb-1 block text-sm font-medium">
                  Szöveg {isDef && <span className="text-red-600">*</span>}
                </label>
                <textarea
                  id={`review-body-${l.locale}`}
                  value={text}
                  maxLength={MAX_BODY}
                  rows={5}
                  onChange={(e) => setBody((b) => ({ ...b, [l.locale]: e.target.value }))}
                  disabled={ro}
                  className={`${inputClass} resize-y`}
                />
                <p className="mt-1 flex justify-between text-xs text-zinc-500">
                  <span>A weboldalon kb. 5 sor után „…”-tal levágva jelenik meg.</span>
                  <span>
                    {text.length}/{MAX_BODY}
                  </span>
                </p>
              </div>
            </fieldset>
          );
        })}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
      </form>

      {!ro && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
          {review ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-40">
              Törlés
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            form="review-form"
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {busy ? "Mentés…" : review ? "Mentés" : "Hozzáadás"}
          </button>
        </div>
      )}
    </aside>
  );
}

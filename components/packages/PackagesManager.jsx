"use client";

import { useRef, useState } from "react";
import {
  createPackage,
  deletePackage,
  reorderPackages,
  setPackageVisible,
  updatePackage,
} from "@/app/(admin)/[site]/csomagok/actions";
import { MAX_PDF_BYTES, MAX_PRICE, MAX_TIERS, MAX_TITLE } from "@/lib/packages";
import { discardUpload, mediaUrl, uploadPackagePdf } from "@/lib/image/upload";
import SortableGrid from "@/components/gallery/SortableGrid";
import { Notice, inputClass, publishNotice } from "@/components/gallery/Modal";

// Packages module: ready-made offers with a downloadable PDF (e.g. "Kész csomagjaink" popup).
// Cards in website order (drag to reorder), visible/hidden switch, side panel to add / edit / delete.
// Every change is saved and published immediately.
export default function PackagesManager({ site, locales, initialPackages }) {
  const [packages, setPackages] = useState(initialPackages);
  const [editing, setEditing] = useState(null); // package object, or "new"
  const [status, setStatus] = useState(null);
  const def = site.defaultLocale;
  const visibleCount = packages.filter((p) => p.visible).length;

  async function handleReorder(next) {
    const prev = packages;
    setPackages(next);
    const res = await reorderPackages({ siteSlug: site.slug, ids: next.map((p) => p.id) });
    if (!res.ok) setPackages(prev);
    setStatus(publishNotice(res, "Sorrend mentve"));
  }

  async function toggleVisible(pkg) {
    const res = await setPackageVisible({ siteSlug: site.slug, id: pkg.id, visible: !pkg.visible });
    if (res.ok) setPackages((list) => list.map((p) => (p.id === pkg.id ? res.pkg : p)));
    setStatus(publishNotice(res, res.pkg?.visible ? "Megjelenítve" : "Elrejtve"));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{site.label}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {packages.length} csomag, ebből {visibleCount} látható a weboldalon. Húzással rendezheted, kattints egyre a szerkesztéshez.
          </p>
        </div>
        {!site.readOnly && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            + Új csomag
          </button>
        )}
      </div>

      <Notice status={status} onDismiss={() => setStatus(null)} />

      {packages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Még nincs csomag. Amíg nincs látható csomag, a weboldalon ez a rész nem jelenik meg.
        </div>
      ) : (
        <SortableGrid
          id="packages"
          items={packages}
          onReorder={handleReorder}
          disabled={site.readOnly}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          renderItem={(p) => (
            <div
              className={`flex h-full flex-col rounded-xl border bg-white p-4 dark:bg-zinc-900 ${
                p.visible ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 opacity-60 dark:border-zinc-700"
              }`}
            >
              <button type="button" onClick={() => setEditing(p)} className="flex-1 text-left">
                <p className="font-semibold">{p.title?.[def]}</p>
                {p.tiers?.[def] && <p className="mt-1 text-sm text-zinc-500">{p.tiers[def]}</p>}
                {p.price?.[def] && <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{p.price[def]}</p>}
              </button>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                <span className="text-zinc-500">
                  {locales.map((l) => `${l.label} PDF ${p.files?.[l.locale] ? "✓" : "—"}`).join(" · ")}
                </span>
                {!site.readOnly && (
                  <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                    <input type="checkbox" checked={p.visible} onChange={() => toggleVisible(p)} />
                    Látható
                  </label>
                )}
              </div>
            </div>
          )}
        />
      )}

      {editing && (
        <PackagePanel
          key={editing === "new" ? "new" : editing.id}
          site={site}
          locales={locales}
          pkg={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(pkg, res, isNew) => {
            setPackages((list) => (isNew ? [...list, pkg] : list.map((p) => (p.id === pkg.id ? pkg : p))));
            setStatus(publishNotice(res, isNew ? "Csomag hozzáadva" : "Mentve"));
            setEditing(null);
          }}
          onDeleted={(id, res) => {
            setPackages((list) => list.filter((p) => p.id !== id));
            setStatus(publishNotice(res, "Törölve"));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// Add / edit one package: name, tiers, price and PDF per language (name + PDF required on the default language).
function PackagePanel({ site, locales, pkg, onClose, onSaved, onDeleted }) {
  const [title, setTitle] = useState(pkg?.title ?? {});
  const [tiers, setTiers] = useState(pkg?.tiers ?? {});
  const [price, setPrice] = useState(pkg?.price ?? {});
  const [files, setFiles] = useState(pkg?.files ?? {}); // locale → stored path
  const [picked, setPicked] = useState({}); // locale → File waiting for upload (null = remove)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const def = site.defaultLocale;
  const ro = site.readOnly;

  function pickFile(locale, file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setError("Csak PDF tölthető fel.");
    if (file.size > MAX_PDF_BYTES) return setError(`A PDF túl nagy (max ${MAX_PDF_BYTES / 1024 / 1024} MB).`);
    setError(null);
    setPicked((m) => ({ ...m, [locale]: file }));
  }

  function removeFile(locale) {
    setPicked((m) => ({ ...m, [locale]: null }));
  }

  // Effective state of one locale's PDF: a new file, the stored one, or none.
  const fileState = (l) => (l in picked ? picked[l] : files[l] ? { stored: files[l] } : null);

  async function save(e) {
    e.preventDefault();
    if (!title[def]?.trim()) return setError("A csomag neve (alapnyelven) kötelező.");
    if (!fileState(def)) return setError("A PDF (alapnyelven) kötelező.");
    setBusy(true);
    setError(null);

    // Upload the newly picked PDFs first; the action only attaches their paths.
    const uploaded = [];
    const nextFiles = {};
    try {
      for (const l of locales.map((x) => x.locale)) {
        const st = fileState(l);
        if (!st) continue;
        if (st.stored) nextFiles[l] = st.stored;
        else {
          const path = await uploadPackagePdf({ siteId: site.id, file: st });
          uploaded.push(path);
          nextFiles[l] = path;
        }
      }
    } catch (err) {
      await Promise.all(uploaded.map(discardUpload));
      setBusy(false);
      return setError(err.message);
    }

    const input = { siteSlug: site.slug, title, tiers, price, files: nextFiles };
    const res = pkg ? await updatePackage({ ...input, id: pkg.id }) : await createPackage(input);
    setBusy(false);
    if (!res.ok) {
      await Promise.all(uploaded.map(discardUpload));
      setError(res.error);
    } else {
      setFiles(res.pkg.files);
      setPicked({});
      onSaved(res.pkg, res, !pkg);
    }
  }

  async function remove() {
    if (!window.confirm(`Törlöd a(z) „${pkg.title?.[def]}” csomagot a PDF-ekkel együtt? Ez nem vonható vissza.`)) return;
    setBusy(true);
    const res = await deletePackage({ siteSlug: site.slug, id: pkg.id });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDeleted(pkg.id, res);
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl sm:w-[28rem] dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">{pkg ? "Csomag szerkesztése" : "Új csomag"}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Panel bezárása" className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          ✕
        </button>
      </div>

      <form id="package-form" onSubmit={save} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {locales.map((l) => {
          const isDef = l.locale === def;
          const id = (k) => `package-${k}-${l.locale}`;
          return (
            <fieldset key={l.locale} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-xs font-medium text-zinc-500">
                {l.label}
                {!isDef && " — opcionális fordítás (ha üres, az eredeti jelenik meg)"}
              </legend>
              <div>
                <label htmlFor={id("title")} className="mb-1 block text-sm font-medium">
                  Csomag neve {isDef && <span className="text-red-600">*</span>}
                </label>
                <input
                  id={id("title")}
                  value={title[l.locale] ?? ""}
                  maxLength={MAX_TITLE}
                  onChange={(e) => setTitle((m) => ({ ...m, [l.locale]: e.target.value }))}
                  disabled={ro}
                  placeholder={isDef ? "pl. Esküvői fotózás" : ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={id("tiers")} className="mb-1 block text-sm font-medium">
                  Változatok
                </label>
                <input
                  id={id("tiers")}
                  value={tiers[l.locale] ?? ""}
                  maxLength={MAX_TIERS}
                  onChange={(e) => setTiers((m) => ({ ...m, [l.locale]: e.target.value }))}
                  disabled={ro}
                  placeholder={isDef ? "pl. Alap · Deluxe · Kreatív" : ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={id("price")} className="mb-1 block text-sm font-medium">
                  Ár
                </label>
                <input
                  id={id("price")}
                  value={price[l.locale] ?? ""}
                  maxLength={MAX_PRICE}
                  onChange={(e) => setPrice((m) => ({ ...m, [l.locale]: e.target.value }))}
                  disabled={ro}
                  placeholder={isDef ? "pl. 200 000 Ft-tól" : ""}
                  className={inputClass}
                />
              </div>
              <PdfInput
                label={isDef ? "PDF" : "PDF (ha üres, az eredeti töltődik le)"}
                required={isDef}
                state={fileState(l.locale)}
                disabled={ro || busy}
                onPick={(f) => pickFile(l.locale, f)}
                onRemove={isDef ? null : () => removeFile(l.locale)}
              />
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
          {pkg ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-40">
              Törlés
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            form="package-form"
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {busy ? "Mentés…" : pkg ? "Mentés" : "Hozzáadás"}
          </button>
        </div>
      )}
    </aside>
  );
}

// PDF picker: shows the stored file (link) or the newly picked one; drop or click to replace.
function PdfInput({ label, required, state, disabled, onPick, onRemove }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const name = state?.stored ? "Feltöltött PDF" : state?.name;

  return (
    <div>
      <p className="mb-1 text-sm font-medium">
        {label} {required && <span className="text-red-600">*</span>}
      </p>
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) onPick(e.dataTransfer.files?.[0]);
        }}
        className={`flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5 text-sm ${
          over ? "border-zinc-900 bg-zinc-50 dark:border-white dark:bg-zinc-800" : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
          {state ? (
            state.stored ? (
              <a href={mediaUrl(state.stored)} target="_blank" rel="noreferrer" className="underline">
                {name}
              </a>
            ) : (
              <>📄 {name} <span className="text-xs text-zinc-400">(mentéskor töltődik fel)</span></>
            )
          ) : (
            <span className="text-zinc-400">Húzd ide a PDF-et, vagy válaszd ki</span>
          )}
        </span>
        <span className="flex shrink-0 gap-2">
          {state && onRemove && (
            <button type="button" onClick={onRemove} disabled={disabled} className="text-xs text-red-600 hover:underline disabled:opacity-40">
              Eltávolítás
            </button>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {state ? "Csere" : "Kiválasztás"}
          </button>
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

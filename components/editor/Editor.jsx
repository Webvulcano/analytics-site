"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MSG } from "@/client-kit/lib/cms-bridge-protocol";
import { hasOwnValue, previewKind, resolveValue, sameTarget } from "@/lib/editor/content";
import {
  commitImage,
  resetField,
  resetImage,
  retryPublish,
  saveField,
  saveImageAlt,
} from "@/app/(admin)/[site]/szerkesztes/actions";
import { discardUpload, uploadSlotImage } from "@/lib/image/upload";
import PreviewFrame from "./PreviewFrame";
import EditPanel from "./EditPanel";
import AllFieldsList from "./AllFieldsList";
import ResizableAside, { usePanelWidth } from "./ResizableAside";

const clone = (v) => (v === undefined ? v : structuredClone(v));
// Client sites mark gallery-module areas with data-cms="@gallery": managed on the gallery page.
const GALLERY_KEY = "@gallery";

// The page's path in the given locale; pages without per-locale paths use `path` everywhere.
const localePath = (page, locale) => page.paths?.[locale] ?? page.path;

export default function Editor({ site, fields, initialValues, initialImages, slots, locales, pages }) {
  const frameRef = useRef(null);
  // The framed site: the preview deploy if the site has one (e.g. for not-yet-live languages).
  const siteOrigin = useMemo(() => new URL(site.previewUrl).origin, [site.previewUrl]);
  const fieldsByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const slotsByKey = useMemo(() => new Map(slots.map((s) => [s.key, s])), [slots]);

  const [values, setValues] = useState(initialValues);
  const [images, setImages] = useState(initialImages); // { [slotKey]: saved image }
  const [locale, setLocale] = useState(site.defaultLocale);
  const [pageKey, setPageKey] = useState(pages[0].key);
  const [device, setDevice] = useState("desktop");
  const [mode, setMode] = useState("edit");
  const [tab, setTab] = useState("preview");
  const [connected, setConnected] = useState(false);

  const [target, setTarget] = useState(null); // { key, i, f }
  const [draft, setDraft] = useState(undefined); // field value, or { alt, upload } for an image slot
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [revision, setRevision] = useState(0); // remounts editors after cancel/reset
  const [galleryHint, setGalleryHint] = useState(false);
  const [panelWidth, setPanelWidth, commitPanelWidth] = usePanelWidth();

  const page = pages.find((p) => p.key === pageKey) ?? pages[0];
  const src = new URL(localePath(page, locale), site.previewUrl).toString();
  // Does the preview show the selected language? (only if the page has a path for it)
  const previewInLocale = locale === site.defaultLocale || Boolean(page.paths?.[locale]);

  const post = useCallback(
    (msg) => frameRef.current?.contentWindow?.postMessage(msg, siteOrigin),
    [siteOrigin]
  );

  // Refs so the message listener always sees the latest state without re-subscribing.
  const stateRef = useRef({ mode, dirty, target, draft });
  useEffect(() => {
    stateRef.current = { mode, dirty, target, draft };
  }, [mode, dirty, target, draft]);

  // Editor state of an image slot: alt text of the saved image + a not-yet-saved upload.
  const slotDraft = useCallback(
    (key, loc) => ({ alt: images[key]?.alt?.[loc] ?? "", upload: null }),
    [images]
  );

  // Frees the in-memory WebP of an abandoned upload.
  const dropUpload = useCallback(() => {
    const url = stateRef.current.draft?.upload?.url;
    if (url) URL.revokeObjectURL(url);
  }, []);

  const selectTarget = useCallback(
    (next) => {
      const { dirty: isDirty, target: current } = stateRef.current;
      if (sameTarget(current, next)) return;
      if (isDirty && !window.confirm("Van nem mentett módosításod. Elveted?")) return;
      if (isDirty && current) post({ type: MSG.REVERT, key: current.key });
      dropUpload();

      const field = fieldsByKey.get(next.key);
      setTarget(next);
      setDraft(
        field
          ? clone(resolveValue(field, values, locale, site.defaultLocale))
          : slotsByKey.has(next.key)
            ? slotDraft(next.key, locale)
            : undefined
      );
      setDirty(false);
      setStatus(null);
      setRevision((r) => r + 1);
    },
    [fieldsByKey, slotsByKey, values, locale, site.defaultLocale, post, slotDraft, dropUpload]
  );

  // Bridge messages from the iframe.
  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== siteOrigin || e.source !== frameRef.current?.contentWindow) return;
      const msg = e.data;
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === MSG.HELLO) {
        post({ type: MSG.INIT, mode: stateRef.current.mode });
      } else if (msg.type === MSG.PATH) {
        setConnected(true);
      } else if (msg.type === MSG.SELECT && typeof msg.key === "string") {
        if (msg.key === GALLERY_KEY && site.galleryLabel) {
          setGalleryHint(true);
          return;
        }
        if (!fieldsByKey.has(msg.key) && !slotsByKey.has(msg.key)) return;
        setGalleryHint(false);
        selectTarget({ key: msg.key, i: msg.i ?? null, f: msg.f ?? null });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [siteOrigin, post, selectTarget, fieldsByKey, slotsByKey, site.galleryLabel]);

  // On a full page load the framed site can hydrate before this page does: its HELLO and
  // the iframe's load event both fire before we listen. If so, its bridge is already
  // listening — so greet it once on mount (runs after the listener above is attached).
  useEffect(() => {
    post({ type: MSG.INIT, mode: stateRef.current.mode });
  }, [post]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const field = target ? fieldsByKey.get(target.key) : null;
  const slot = target ? slotsByKey.get(target.key) : null;

  function handleChange(value, sub) {
    if (slot) {
      // value = { alt, upload } — a new upload is shown on the page immediately.
      if (value.upload && value.upload !== draft?.upload) {
        post({ type: MSG.PREVIEW, key: slot.key, kind: "image", value: { blob: value.upload.blob } });
      }
      setDraft(value);
      setDirty(true);
      setStatus(null);
      return;
    }
    if (!field) return;
    if (field.type === "list" && sub) {
      const def = field.options.itemFields.find((d) => d.key === sub.f);
      setDraft((list) => list.map((item, i) => (i === sub.i ? { ...item, [sub.f]: value } : item)));
      post({ type: MSG.PREVIEW, key: field.key, i: sub.i, f: sub.f, kind: previewKind(def), value });
    } else {
      setDraft(value);
      post({ type: MSG.PREVIEW, key: field.key, kind: previewKind(field), value });
    }
    setDirty(true);
    setStatus(null);
  }

  // Push a whole field value into the preview (used after reset to default).
  function previewWhole(f, value) {
    if (f.type === "list") {
      value.forEach((item, i) =>
        f.options.itemFields.forEach((def) =>
          post({ type: MSG.PREVIEW, key: f.key, i, f: def.key, kind: previewKind(def), value: item[def.key] ?? "" })
        )
      );
    } else {
      post({ type: MSG.PREVIEW, key: f.key, kind: previewKind(f), value });
    }
  }

  function publishStatus(res) {
    return res.published
      ? { type: "ok", text: "Mentve és élesítve ✓ — pár másodperc múlva a weboldalon is látszik." }
      : { type: "warn", text: `Mentve, de a weboldal frissítése nem sikerült (${res.publishError}).`, retry: true };
  }

  async function saveSlot() {
    if (!draft.alt.trim()) {
      setStatus({ type: "error", text: "Add meg a kép leírását (alt szöveg) — a Google és a képernyőolvasók ebből tudják, mi van a képen." });
      return;
    }
    setSaving(true);
    setStatus(null);
    let uploaded = null;
    try {
      let res;
      if (draft.upload) {
        uploaded = await uploadSlotImage({ siteId: site.id, slotKey: slot.key, blob: draft.upload.blob });
        res = await commitImage({
          siteSlug: site.slug,
          slotKey: slot.key,
          path: uploaded,
          width: draft.upload.width,
          height: draft.upload.height,
          alt: draft.alt,
          locale,
        });
        if (!res.ok) await discardUpload(uploaded);
      } else {
        res = await saveImageAlt({ siteSlug: site.slug, slotKey: slot.key, alt: draft.alt, locale });
      }
      if (!res.ok) {
        setStatus({ type: "error", text: res.error });
        return;
      }
      const saved = res.image ?? { ...images[slot.key], alt: res.alt };
      setImages((m) => ({ ...m, [slot.key]: saved }));
      post({ type: MSG.COMMIT, key: slot.key });
      dropUpload();
      setDraft({ alt: saved.alt?.[locale] ?? "", upload: null });
      setDirty(false);
      setStatus(publishStatus(res));
    } catch (e) {
      if (uploaded) await discardUpload(uploaded);
      setStatus({ type: "error", text: e?.message?.startsWith("Feltöltés") ? e.message : "Hálózati hiba — a kép nincs mentve. Próbáld újra." });
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (slot && dirty) return saveSlot();
    if (!field || !dirty) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await saveField({ siteSlug: site.slug, key: field.key, locale, value: draft });
      if (!res.ok) {
        setStatus({ type: "error", text: res.error });
        return;
      }
      setValues((v) => ({ ...v, [field.key]: { ...v[field.key], [res.locale]: res.value } }));
      setDraft(clone(res.value));
      setDirty(false);
      post({ type: MSG.COMMIT, key: field.key });
      setStatus(publishStatus(res));
    } catch {
      setStatus({ type: "error", text: "Hálózati hiba — a módosítás nincs mentve. Próbáld újra." });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (!field && !slot) return;
    post({ type: MSG.REVERT, key: target.key });
    dropUpload();
    setDraft(slot ? slotDraft(slot.key, locale) : clone(resolveValue(field, values, locale, site.defaultLocale)));
    setDirty(false);
    setStatus(null);
    setRevision((r) => r + 1);
  }

  async function resetSlot() {
    if (!window.confirm("Visszaállítod az eredeti (sablon) képet? A feltöltött kép törlődik.")) return;
    setSaving(true);
    try {
      const res = await resetImage({ siteSlug: site.slug, slotKey: slot.key });
      if (!res.ok) {
        setStatus({ type: "error", text: res.error });
        return;
      }
      setImages((m) => {
        const next = { ...m };
        delete next[slot.key];
        return next;
      });
      if (slot.default_src) {
        post({ type: MSG.PREVIEW, key: slot.key, kind: "image", value: { src: new URL(slot.default_src, site.previewUrl).toString() } });
      }
      post({ type: MSG.COMMIT, key: slot.key });
      dropUpload();
      setDraft({ alt: "", upload: null });
      setDirty(false);
      setRevision((r) => r + 1);
      setStatus(publishStatus(res));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (slot) return resetSlot();
    if (!field || !window.confirm("Visszaállítod az eredeti (sablon) szöveget? A mostani szöveg elvész.")) return;
    setSaving(true);
    try {
      const res = await resetField({ siteSlug: site.slug, key: field.key, locale });
      if (!res.ok) {
        setStatus({ type: "error", text: res.error });
        return;
      }
      const nextValues = { ...values, [field.key]: { ...values[field.key] } };
      delete nextValues[field.key][res.locale];
      setValues(nextValues);
      const def = resolveValue(field, nextValues, locale, site.defaultLocale);
      previewWhole(field, def);
      post({ type: MSG.COMMIT, key: field.key });
      setDraft(clone(def));
      setDirty(false);
      setRevision((r) => r + 1);
      setStatus(publishStatus(res));
    } finally {
      setSaving(false);
    }
  }

  async function handleRetryPublish() {
    const res = await retryPublish({ siteSlug: site.slug });
    setStatus(res.ok ? { type: "ok", text: "Élesítve ✓" } : { type: "warn", text: `Még mindig nem sikerült (${res.error}).`, retry: true });
  }

  function closePanel() {
    if (dirty && !window.confirm("Van nem mentett módosításod. Elveted?")) return;
    if (dirty && target) post({ type: MSG.REVERT, key: target.key });
    dropUpload();
    setTarget(null);
    setDirty(false);
    setStatus(null);
  }

  function changeMode(next) {
    setMode(next);
    post({ type: MSG.MODE, mode: next });
  }

  function changeLocale(next) {
    if (dirty && !window.confirm("Van nem mentett módosításod. Elveted?")) return;
    if (dirty && target) post({ type: MSG.REVERT, key: target.key });
    dropUpload();
    // Another language may live at another path → the iframe reloads and reconnects.
    if (localePath(page, next) !== localePath(page, locale)) setConnected(false);
    setLocale(next);
    setDirty(false);
    setStatus(null);
    if (field) setDraft(clone(resolveValue(field, values, next, site.defaultLocale)));
    if (slot) setDraft(slotDraft(slot.key, next));
    setRevision((r) => r + 1);
  }

  function selectFromList(next) {
    selectTarget(next);
    post({ type: MSG.SCROLL_TO, key: next.key });
  }

  const localeNote =
    slot && locales.length > 1
      ? "A kép minden nyelven ugyanaz; a leírást a választott nyelven szerkeszted."
      : field && !field.translatable && locales.length > 1
      ? "Ez a mező minden nyelven ugyanaz."
      : field && !previewInLocale
        ? "Az előnézet a weboldal alapnyelvét mutatja; itt a választott nyelv szövegét szerkeszted."
        : null;

  const seg = (active) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300"
    }`;

  return (
    <div className="flex h-[calc(100dvh-49px)] flex-col md:h-dvh">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" role="tablist" aria-label="Nézet">
          <button type="button" role="tab" aria-selected={tab === "preview"} className={seg(tab === "preview")} onClick={() => setTab("preview")}>
            Oldal
          </button>
          <button type="button" role="tab" aria-selected={tab === "all"} className={seg(tab === "all")} onClick={() => setTab("all")}>
            Összes mező
          </button>
        </div>

        {pages.length > 1 && (
          <select
            aria-label="Oldal"
            value={pageKey}
            onChange={(e) => {
              setConnected(false);
              setPageKey(e.target.value);
            }}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            {pages.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        )}

        {locales.length > 1 && (
          <select
            aria-label="Nyelv"
            value={locale}
            onChange={(e) => changeLocale(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            {locales.map((l) => (
              <option key={l.locale} value={l.locale}>{l.label}</option>
            ))}
          </select>
        )}

        {tab === "preview" && (
          <>
            <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" aria-label="Eszköz">
              <button type="button" className={seg(device === "desktop")} onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"}>
                Asztali
              </button>
              <button type="button" className={seg(device === "mobile")} onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"}>
                Mobil
              </button>
            </div>
            <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" aria-label="Mód">
              <button type="button" className={`${seg(mode === "edit")} disabled:opacity-50`} onClick={() => changeMode("edit")} aria-pressed={mode === "edit"} disabled={!connected}>
                Szerkesztés
              </button>
              <button type="button" className={`${seg(mode === "navigate")} disabled:opacity-50`} onClick={() => changeMode("navigate")} aria-pressed={mode === "navigate"} disabled={!connected}>
                Böngészés
              </button>
            </div>
          </>
        )}

        <span className="ml-auto text-xs text-zinc-500">
          {tab === "preview" && !connected
            ? "Kapcsolódás a weboldalhoz…"
            : mode === "edit" && tab === "preview"
              ? "Kattints egy szövegre vagy képre a szerkesztéshez"
              : ""}
        </span>
      </div>

      {/* Preview / list + panel */}
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1 bg-zinc-100 dark:bg-zinc-900">
          <PreviewFrame
            src={src}
            device={device}
            frameRef={frameRef}
            hidden={tab !== "preview"}
            onLoad={() => post({ type: MSG.INIT, mode })}
          />
          {tab === "preview" && !connected && (
            // Until the bridge answers, clicks would just browse the site — block them.
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-100/70 dark:bg-zinc-900/70">
              <span className="rounded-lg bg-white px-3 py-1.5 text-sm text-zinc-600 shadow-sm dark:bg-zinc-800 dark:text-zinc-300">
                Kapcsolódás a weboldalhoz…
              </span>
            </div>
          )}
          {tab === "all" && (
            <AllFieldsList
              fields={fields}
              slots={slots}
              values={values}
              locale={locale}
              defaultLocale={site.defaultLocale}
              selectedKey={target?.key}
              onSelect={selectFromList}
            />
          )}
        </div>

        {galleryHint && !(target && (field || slot)) && (
          <ResizableAside
            width={panelWidth}
            onResize={setPanelWidth}
            onResizeEnd={commitPanelWidth}
            className="border-t border-zinc-200 bg-white p-4 text-sm md:border-l md:border-t-0 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{site.galleryLabel}</p>
              <button type="button" onClick={() => setGalleryHint(false)} aria-label="Bezárás" className="text-zinc-500">
                ✕
              </button>
            </div>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Ezeket az elemeket (képek, videók, kategóriák) a {site.galleryLabel} menüben kezeled.
            </p>
            <a href={`/${site.slug}/portfolio`} className="mt-3 inline-block font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
              Megnyitás →
            </a>
          </ResizableAside>
        )}

        {target && (field || slot) && (
          <EditPanel
            key={`${target.key}|${target.i}|${target.f}|${locale}|${revision}`}
            item={field ? { kind: "field", field } : { kind: "slot", slot }}
            target={target}
            draft={draft}
            onChange={handleChange}
            onSave={handleSave}
            onCancel={handleCancel}
            onReset={handleReset}
            onClose={closePanel}
            onRetryPublish={handleRetryPublish}
            dirty={dirty}
            saving={saving}
            status={status}
            canReset={field ? hasOwnValue(field, values, locale, site.defaultLocale) : Boolean(images[slot.key])}
            readOnly={site.readOnly}
            localeNote={localeNote}
            siteUrl={site.siteUrl}
            image={slot ? images[slot.key] : undefined}
            locale={locale}
            panelWidth={panelWidth}
            onPanelResize={setPanelWidth}
            onPanelResizeEnd={commitPanelWidth}
          />
        )}
      </div>
    </div>
  );
}


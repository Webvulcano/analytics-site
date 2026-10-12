"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { retryBlogPublish, savePost, setPostStatus, trashPost } from "@/app/(admin)/[site]/blog/actions";
import RichTextEditor from "@/components/editor/RichTextEditor";
import { Notice, inputClass } from "@/components/gallery/Modal";
import { LIMITS, STATUS, TRASH_DAYS, dateInputValue, postSlug, postState, postUrl, previewUrl } from "@/lib/blog";
import { blogNotice } from "./notice";
import CoverField from "./CoverField";
import FaqEditor from "./FaqEditor";
import SeoPanel from "./SeoPanel";

const EMPTY_DOC = { type: "doc", content: [] };

function formFromPost(post, { locale, author }) {
  return {
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    locale: post?.locale ?? locale,
    body: post?.body ?? EMPTY_DOC,
    excerpt: post?.excerpt ?? "",
    metaTitle: post?.meta_title ?? "",
    description: post?.description ?? "",
    author: post?.author ?? author ?? "",
    publishedAt: dateInputValue(post?.published_at),
    coverAlt: post?.cover_alt ?? "",
    faq: post?.faq ?? [],
  };
}

function Section({ title, children }) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PostEditor({ site, post: initialPost, initialLocale, translationOf, siblings }) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [form, setForm] = useState(() => formFromPost(initialPost, { locale: initialLocale, author: site.blog.author }));
  const [saved, setSaved] = useState(form);
  const [slugTouched, setSlugTouched] = useState(Boolean(initialPost));
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);

  const state = post ? postState(post) : "draft";
  const slugLocked = Boolean(post && post.status !== "draft");
  const readOnly = site.readOnly || state === "trash";
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const live = post && post.status === "published" ? postUrl(site.siteUrl, site.blog, post) : null;
  const preview = post ? previewUrl(site.previewBase, post) : null;
  const futureUrl = postUrl(site.siteUrl, site.blog, { locale: form.locale, slug: form.slug || "url-nev" });
  const multiLocale = site.locales.length > 1;
  const localeLabel = Object.fromEntries(site.locales.map((l) => [l.locale, l.label]));

  // Nem mentett változás → figyelmeztetés oldalelhagyáskor
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function change(patch) {
    setForm((f) => {
      const next = { ...f, ...patch };
      // Az URL-név a címből készül, amíg kézzel nem írták át (és a cikk még nem jelent meg).
      if ("title" in patch && !slugTouched && !slugLocked) next.slug = postSlug(patch.title);
      return next;
    });
  }

  // A szerver által visszaadott cikk lesz az új „mentett" állapot.
  function applySaved(res, okText) {
    setStatus(blogNotice(res, okText));
    if (!res.ok || !res.post) return;
    const isNew = !post;
    setPost(res.post);
    const next = formFromPost(res.post, { locale: res.post.locale, author: site.blog.author });
    setForm(next);
    setSaved(next);
    if (isNew) router.replace(`/${site.slug}/blog/${res.post.id}`);
  }

  async function act(name, fn, okText) {
    setBusy(name);
    setStatus(null);
    try {
      applySaved(await fn(), okText);
    } catch {
      setStatus({ type: "error", text: "Hálózati hiba - a módosítás nincs mentve. Próbáld újra." });
    } finally {
      setBusy(null);
    }
  }

  const save = (action, okText) =>
    act(action, () => savePost({ siteSlug: site.slug, id: post?.id, data: form, action, group: translationOf?.id }), okText);

  const setVisibility = (next, okText) => act(next, () => setPostStatus({ siteSlug: site.slug, id: post.id, status: next }), okText);

  async function toTrash() {
    if (!window.confirm(`Kukába teszed ezt a cikket? ${TRASH_DAYS} napig visszaállítható.`)) return;
    setBusy("trash");
    try {
      const res = await trashPost({ siteSlug: site.slug, id: post.id });
      if (!res.ok) {
        setStatus(blogNotice(res, ""));
        return;
      }
      setSaved(form); // nincs „nem mentett" figyelmeztetés a navigációnál
      router.push(`/${site.slug}/blog`);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    const res = await retryBlogPublish({ siteSlug: site.slug });
    setStatus(res.ok ? { type: "ok", text: "A weboldal frissítve ✓" } : { type: "warn", text: `Még mindig nem sikerült (${res.error}).`, retry: true });
  }

  const primary = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900";
  const secondary = "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
  const canAct = !readOnly && !busy;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${site.slug}/blog`} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Vissza a cikkekhez
        </Link>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS[state].tone}`}>
          {STATUS[state].label}
          {dirty && " · nem mentett változás"}
        </span>
      </div>

      {translationOf && !post && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
          Fordítás ({localeLabel[form.locale] ?? form.locale}) ehhez: „{translationOf.title}”
        </p>
      )}
      {state === "trash" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Ez a cikk a Kukában van - a Blog listában, a Kuka fülön állíthatod vissza.
        </p>
      )}

      <Notice status={status} onDismiss={() => setStatus(null)} />
      {status?.retry && (
        <button type="button" onClick={retry} className="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
          Weboldal frissítése újra
        </button>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Fő oszlop: cím + szöveg */}
        <div className="space-y-4">
          <Section title="Cikk">
            <label className="block">
              <span className="text-sm font-medium">Cím</span>
              <input
                type="text"
                value={form.title}
                maxLength={LIMITS.title}
                disabled={readOnly}
                onChange={(e) => change({ title: e.target.value })}
                placeholder="Pl. Hogyan válasszunk hallókészüléket?"
                className={`${inputClass} mt-1 text-lg font-semibold`}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">URL-név</span>
              <input
                type="text"
                value={form.slug}
                maxLength={LIMITS.slug}
                disabled={readOnly || slugLocked}
                onChange={(e) => {
                  setSlugTouched(true);
                  change({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") });
                }}
                className={`${inputClass} mt-1 font-mono text-xs`}
              />
              <span className="mt-1 block truncate text-xs text-zinc-500">
                {slugLocked
                  ? "A közzétett cikk URL-je nem módosítható (a Google és a megosztott linkek erre mutatnak)."
                  : futureUrl}
              </span>
            </label>
            {multiLocale && (
              <p className="text-sm text-zinc-500">
                Nyelv: <strong>{localeLabel[form.locale] ?? form.locale}</strong>
              </p>
            )}
            <div>
              <span className="text-sm font-medium">Szöveg</span>
              <p className="mb-1 text-xs text-zinc-500">
                Tagold alcímekkel (H2), azon belül kisebb alcímekkel (H3) - így könnyebb olvasni, és a Google is jobban érti.
              </p>
              <RichTextEditor
                value={form.body}
                onChange={(body) => change({ body })}
                disabled={readOnly}
                headings
                minHeight="min-h-96"
              />
            </div>
            <label className="block">
              <span className="text-sm font-medium">Kivonat</span>
              <textarea
                value={form.excerpt}
                maxLength={LIMITS.excerpt}
                disabled={readOnly}
                onChange={(e) => change({ excerpt: e.target.value })}
                rows={3}
                placeholder="1-2 mondat a blog-listába: miért érdemes elolvasni?"
                className={`${inputClass} mt-1`}
              />
            </label>
          </Section>

          <Section title="Gyakori kérdések a cikk alján">
            <FaqEditor items={form.faq} onChange={(faq) => change({ faq })} disabled={readOnly} />
          </Section>
        </div>

        {/* Oldalsáv: műveletek, borító, SEO, adatok */}
        <div className="space-y-4">
          <Section title="Közzététel">
            <div className="flex flex-wrap gap-2">
              {(!post || post.status === "draft") && (
                <>
                  <button type="button" className={secondary} disabled={!canAct || (post && !dirty)} onClick={() => save("save", "Piszkozat mentve")}>
                    {busy === "save" ? "Mentés…" : "Mentés piszkozatként"}
                  </button>
                  <button type="button" className={primary} disabled={!canAct} onClick={() => save("publish", "Közzétéve")}>
                    {busy === "publish" ? "Közzététel…" : "Közzététel"}
                  </button>
                </>
              )}
              {post?.status === "published" && (
                <>
                  <button type="button" className={primary} disabled={!canAct || !dirty} onClick={() => save("publish", "Frissítve")}>
                    {busy === "publish" ? "Mentés…" : "Frissítés"}
                  </button>
                  <button type="button" className={secondary} disabled={!canAct || dirty} onClick={() => setVisibility("hidden", "Elrejtve")} title={dirty ? "Előbb mentsd a változásokat" : undefined}>
                    Elrejtés
                  </button>
                </>
              )}
              {post?.status === "hidden" && (
                <>
                  <button type="button" className={secondary} disabled={!canAct || !dirty} onClick={() => save("save", "Mentve")}>
                    {busy === "save" ? "Mentés…" : "Mentés"}
                  </button>
                  <button type="button" className={primary} disabled={!canAct} onClick={() => save("publish", "Újra közzétéve")}>
                    Közzététel
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {live && (
                <a href={live} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  Megnézem a weboldalon ↗
                </a>
              )}
              {preview && (
                <a
                  href={dirty ? undefined : preview}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={dirty}
                  title={dirty ? "Az előnézet a mentett változatot mutatja - előbb ments." : undefined}
                  className={`font-medium ${dirty ? "cursor-not-allowed text-zinc-400" : "text-indigo-600 hover:underline dark:text-indigo-400"}`}
                >
                  Előnézet ↗
                </a>
              )}
            </div>
            <label className="block">
              <span className="text-sm font-medium">Megjelenés dátuma</span>
              <input
                type="date"
                value={form.publishedAt}
                disabled={readOnly}
                onChange={(e) => change({ publishedAt: e.target.value })}
                className={`${inputClass} mt-1`}
              />
              <span className="mt-1 block text-xs text-zinc-500">Üresen a közzététel napja.</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Szerző</span>
              <input
                type="text"
                value={form.author}
                maxLength={LIMITS.author}
                disabled={readOnly}
                onChange={(e) => change({ author: e.target.value })}
                className={`${inputClass} mt-1`}
              />
            </label>
            {post && state !== "trash" && (
              <button type="button" disabled={!canAct} onClick={toTrash} className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400">
                Kukába
              </button>
            )}
          </Section>

          <Section title="Borítókép">
            <CoverField
              site={site}
              post={post}
              alt={form.coverAlt}
              onAltChange={(coverAlt) => change({ coverAlt })}
              onSaved={(res, okText) => {
                setStatus(blogNotice(res, okText));
                if (!res.ok || !res.post) return;
                setPost(res.post);
                // csak a borító-mezők frissülnek, a többi szerkesztés megmarad
                setForm((f) => ({ ...f, coverAlt: res.post.cover_alt ?? "" }));
                setSaved((s) => ({ ...s, coverAlt: res.post.cover_alt ?? "" }));
              }}
              onStatus={setStatus}
              disabled={readOnly}
            />
          </Section>

          <Section title="Google-megjelenés">
            <SeoPanel form={form} onChange={change} url={futureUrl} disabled={readOnly} />
          </Section>

          {post && multiLocale && (
            <Section title="Fordítások">
              <ul className="space-y-1 text-sm">
                {site.locales
                  .filter((l) => l.locale !== post.locale)
                  .map((l) => {
                    const sib = siblings.find((s) => s.locale === l.locale);
                    return (
                      <li key={l.locale}>
                        {sib ? (
                          <Link href={`/${site.slug}/blog/${sib.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                            {l.label}: {sib.title}
                          </Link>
                        ) : (
                          <Link href={`/${site.slug}/blog/uj?forditas=${post.id}&nyelv=${l.locale}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                            + {l.label} fordítás készítése
                          </Link>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

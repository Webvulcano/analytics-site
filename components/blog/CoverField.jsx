"use client";

import { useRef, useState } from "react";
import { commitPostCover, removePostCover } from "@/app/(admin)/[site]/blog/actions";
import { processImage } from "@/lib/image/process";
import { discardUpload, mediaUrl, uploadPostImage } from "@/lib/image/upload";
import { makeOgImage } from "@/lib/blog/og";
import { COVER, LIMITS } from "@/lib/blog";
import { inputClass } from "@/components/gallery/Modal";

// Borítókép: WebP a meglévő képfeldolgozóval (max 1600 px) + 1200×630 JPEG megosztási kép, egy lépésben.
// Csak mentett cikkhez (a fájlok a cikk mappájába kerülnek). Az alt szöveg a cikkel együtt mentődik.
export default function CoverField({ site, post, alt, onAltChange, onSaved, onStatus, disabled }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(null); // "upload" | "remove"

  async function upload(file) {
    if (!file) return;
    setBusy("upload");
    onStatus(null);
    const uploaded = [];
    try {
      const out = await processImage(file, COVER);
      const og = await makeOgImage(out.blob);
      const path = await uploadPostImage({ siteId: site.id, postId: post.id, blob: out.blob });
      uploaded.push(path);
      const ogPath = await uploadPostImage({ siteId: site.id, postId: post.id, blob: og, og: true });
      uploaded.push(ogPath);
      const res = await commitPostCover({
        siteSlug: site.slug,
        id: post.id,
        path,
        ogPath,
        width: out.width,
        height: out.height,
        alt: alt?.trim() || post.title,
      });
      if (!res.ok) {
        await Promise.all(uploaded.map(discardUpload));
        onStatus({ type: "error", text: res.error });
        return;
      }
      onSaved(res, "Borítókép feltöltve");
    } catch (e) {
      await Promise.all(uploaded.map(discardUpload));
      onStatus({ type: "error", text: e?.message || "A kép feltöltése nem sikerült." });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm("Eltávolítod a borítóképet?")) return;
    setBusy("remove");
    try {
      const res = await removePostCover({ siteSlug: site.slug, id: post.id });
      if (!res.ok) onStatus({ type: "error", text: res.error });
      else onSaved(res, "Borítókép eltávolítva");
    } finally {
      setBusy(null);
    }
  }

  if (!post?.id) {
    return <p className="text-sm text-zinc-500">A borítóképet az első mentés után töltheted fel (mentsd el piszkozatként).</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[1200/630] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
        {post.cover_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(post.cover_path)} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">Nincs borítókép</div>
        )}
        {busy === "upload" && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-medium dark:bg-zinc-900/70">
            Feldolgozás és feltöltés…
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {post.cover_path ? "Kép cseréje" : "Kép feltöltése"}
        </button>
        {post.cover_path && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={remove}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
          >
            Eltávolítás
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
      <p className="text-xs text-zinc-500">
        Bármilyen fotó jó (JPG, PNG, HEIC): automatikusan WebP-re alakítjuk (max {COVER.maxWidth} px), és elkészül belőle a megosztási kép is (1200×630).
      </p>

      <label className="block">
        <span className="text-sm font-medium">Kép leírása (alt szöveg)</span>
        <input
          type="text"
          value={alt}
          maxLength={LIMITS.coverAlt}
          disabled={disabled}
          onChange={(e) => onAltChange(e.target.value)}
          placeholder="Mi látható a képen? (a Google és a képernyőolvasók ebből tudják)"
          className={`${inputClass} mt-1`}
        />
      </label>
    </div>
  );
}

import { cache } from "react";
import manifest from "@/cms.manifest";
import { normalizeManifest, offlineContent } from "./cms-manifest";
import { isSafeHref, toPlainText } from "./cms-richtext";

// CMS content for this website. Reads the cms_get_site_content RPC from Supabase,
// cached with the tag `cms:<slug>`; the admin revalidates it via /api/revalidate on save.
//
// If Supabase is unreachable this THROWS on purpose: the revalidation fails and Next
// keeps serving the last good page (stale-while-revalidate, see api/revalidate) instead
// of silently reverting the client's edits to defaults.
// For local development without the CMS set CMS_OFFLINE=1 (manifest defaults only).

const SLUG = process.env.CMS_SITE_SLUG;
const SUPABASE_URL = process.env.CMS_SUPABASE_URL;
const SUPABASE_KEY = process.env.CMS_SUPABASE_PUBLISHABLE_KEY;
const BUCKET = "site-media";

export function cmsTag() {
  return `cms:${SLUG}`;
}

// Élesben force-cache + tag (az admin mentéskor revalidál). Dev-ben no-store: a revalidate-webhook
// csak a manifest url-jére (a deployolt oldalra) megy, így a lokális dev szerver örökre a régi
// tartalmat mutatná.
function cmsCache() {
  return process.env.NODE_ENV === "development"
    ? { cache: "no-store" }
    : { cache: "force-cache", next: { tags: [cmsTag()] } };
}

// Page paths from the manifest, every locale (used to warm pages right after a revalidate).
export function cmsPagePaths() {
  const paths = normalizeManifest(manifest).pages.flatMap((p) => [p.path, ...Object.values(p.paths)]);
  return [...new Set(paths)];
}

// Does the CMS answer right now? (uncached, short timeout) - the revalidate route uses it to decide
// between expiring the cache immediately and stale-while-revalidate.
export async function cmsReachable() {
  if (process.env.CMS_OFFLINE === "1" || !SLUG || !SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cms_get_site_content?p_site=${encodeURIComponent(SLUG)}`, {
      headers: { apikey: SUPABASE_KEY, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok && (await res.json()) != null;
  } catch {
    return false;
  }
}

async function loadContent() {
  if (process.env.CMS_OFFLINE === "1") return offlineContent(normalizeManifest(manifest));

  if (!SLUG || !SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("CMS env hiányzik: CMS_SITE_SLUG, CMS_SUPABASE_URL, CMS_SUPABASE_PUBLISHABLE_KEY");
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/cms_get_site_content?p_site=${encodeURIComponent(SLUG)}`,
    {
      headers: { apikey: SUPABASE_KEY, Accept: "application/json" },
      ...cmsCache(),
    }
  );
  if (!res.ok) throw new Error(`CMS lekérés sikertelen: HTTP ${res.status}`);
  const data = await res.json();
  if (!data) throw new Error(`CMS: ismeretlen weboldal "${SLUG}" — futott a manifest sync?`);
  return data;
}

export function publicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// ---- Blog (posts) ----------------------------------------------------------------------------
// Ugyanaz a cache-tag (cms:<slug>), mint a tartalomé → az admin mentése / közzététele frissíti.
// Hiba esetén dob (mint a loadContent): a revalidate elbukik, a legutóbbi jó oldal marad.
async function rpc(name, params, { preview = false } = {}) {
  const qs = new URLSearchParams({ p_site: SLUG, ...params });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}?${qs}`, {
    headers: { apikey: SUPABASE_KEY, Accept: "application/json" },
    ...(preview ? { cache: "no-store" } : cmsCache()),
  });
  if (!res.ok) throw new Error(`CMS ${name}: HTTP ${res.status}`);
  return res.json();
}

const offline = () => process.env.CMS_OFFLINE === "1";

// Közzétett cikkek egy nyelven (meta, törzs nélkül), újak elöl.
export const getPosts = cache(async (locale) => (offline() ? [] : (await rpc("cms_list_posts", { p_locale: locale })) ?? []));

// Egy közzétett cikk (törzs, GYIK, nyelvi párok) - null, ha nincs ilyen.
export const getPost = cache(async (locale, slug) =>
  offline() ? null : rpc("cms_get_post", { p_locale: locale, p_slug: slug })
);

// Előnézet (piszkozat is), a cikk titkos tokenjével - cache nélkül.
export async function getPostPreview(id, token) {
  if (offline()) return null;
  return rpc("cms_get_post_preview", { p_id: id, p_token: token }, { preview: true });
}

export function splitLines(value) {
  return String(value ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Values from the DB are shaped defensively (the DB validates them too, this is the second line):
// a malformed value renders as empty instead of crashing the page or injecting a javascript: link.
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : "");

// List item: only string or rich-text-doc values survive.
function cleanItem(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === "string" || (isPlainObject(v) && v.type === "doc")) out[k] = v;
  }
  return out;
}

function createAccessor(data, requestedLocale) {
  const def = data.defaultLocale;
  const locale = data.locales.includes(requestedLocale) ? requestedLocale : def;

  const pick = (map) => map?.[locale] ?? map?.[def];
  const resolve = (field) => (field ? field.v?.[locale] ?? field.d?.[locale] ?? field.v?.[def] ?? field.d?.[def] : undefined);

  const toImage = (item, slot) => ({
    src: publicUrl(item.path),
    width: item.w,
    height: item.h,
    alt: pick(item.alt) ?? pick(slot.d.alt) ?? "",
  });
  const toDefault = (slot) =>
    slot.d.src ? { src: slot.d.src, width: slot.d.w ?? undefined, height: slot.d.h ?? undefined, alt: pick(slot.d.alt) ?? "" } : null;

  return {
    locale,
    locales: data.locales,

    // Közzétett cikkek száma a nyelven (null: nincs blog-modul) - menü / hreflang ebből tudja, van-e blog.
    postCount(loc = locale) {
      return data.posts ? data.posts[loc] ?? 0 : null;
    },

    // Plain string (rich text gets flattened). url fields: only safe links (https:, mailto:, tel:, /, #), else "".
    text(key) {
      const field = data.fields[key];
      const v = resolve(field);
      if (v == null) return "";
      const s = typeof v === "string" ? v : toPlainText(v);
      if (field.t === "url" && s.trim() && !isSafeHref(s)) return "";
      return s;
    },
    // Tiptap doc or string → render with <RichText value={...} />.
    rich(key) {
      return resolve(data.fields[key]) ?? "";
    },
    // textarea with lines: true → string[]
    lines(key) {
      return splitLines(this.text(key));
    },
    // list field → array of item objects (string / rich text values only)
    list(key) {
      const v = resolve(data.fields[key]);
      return Array.isArray(v) ? v.filter(isPlainObject).map(cleanItem) : [];
    },
    // single image slot → { src, width, height, alt } | null
    image(key) {
      const slot = data.images[key];
      if (!slot) return null;
      return slot.items.length ? toImage(slot.items[0], slot) : toDefault(slot);
    },
    // gallery slot → array of images
    images(key) {
      const slot = data.images[key];
      if (!slot) return [];
      if (slot.items.length) return slot.items.map((item) => toImage(item, slot));
      const d = toDefault(slot);
      return d ? [d] : [];
    },
    // Gallery module: { categories: [{ slug, title, link }], items: [{ id, category, kind, src, width, height, youtubeId, title, year, alt, focus, fit, objectPosition }] }
    // focus = { x, y } in % (crop anchor for object-fit: cover), fit = "cover" | "contain" (show the whole image).
    // Titles/alts resolved to the current locale. null when the site has no gallery.
    gallery() {
      const g = data.gallery;
      if (!g) return null;
      return {
        categories: g.categories.map((c) => ({ slug: c.slug, title: str(pick(c.title)), link: c.link ?? null })),
        items: g.items.map((it) => ({
          id: it.id,
          category: it.c,
          kind: it.k,
          src: it.path ? publicUrl(it.path) : null,
          width: it.w ?? undefined,
          height: it.h ?? undefined,
          youtubeId: it.yt ?? null,
          title: str(pick(it.title)),
          year: it.year ?? null,
          alt: str(pick(it.alt)),
          focus: { x: it.fx ?? 50, y: it.fy ?? 50 },
          fit: it.fit === "contain" ? "contain" : "cover",
          objectPosition: `${it.fx ?? 50}% ${it.fy ?? 50}%`,
        })),
      };
    },
    // Reviews module: [{ id, author, subtitle, body, rating, translated }] in admin order (visible only).
    // body/subtitle in the current locale, falling back to the original (default-locale) text;
    // translated = false when the original is shown on another language. null when the site has no module.
    reviews() {
      const list = data.reviews;
      if (!list) return null;
      return list.map((r) => ({
        id: r.id,
        author: r.author,
        subtitle: str(pick(r.subtitle)),
        body: str(pick(r.body)),
        rating: r.rating,
        translated: locale === data.defaultLocale || Boolean(r.body?.[locale]),
      }));
    },
    // Packages module: [{ id, title, tiers, price, file, fileLocale }] in admin order (visible only).
    // Texts in the current locale (fallback: default locale). file = download URL of the PDF in the
    // current locale, else the default-locale PDF (fileLocale tells which one); null when no PDF.
    // null when the site has no module.
    packages() {
      const list = data.packages;
      if (!list) return null;
      return list.map((k) => {
        const fileLocale = k.files?.[locale] ? locale : k.files?.[def] ? def : null;
        return {
          id: k.id,
          title: str(pick(k.title)),
          tiers: str(pick(k.tiers)),
          price: str(pick(k.price)),
          file: fileLocale ? publicUrl(k.files[fileLocale]) : null,
          fileLocale,
        };
      });
    },
    // data attributes for the visual editor (harmless outside the admin iframe)
    attr(key, i, f) {
      return {
        "data-cms": key,
        ...(i != null ? { "data-cms-i": String(i) } : {}),
        ...(f ? { "data-cms-f": f } : {}),
      };
    },
  };
}

// Per-request memoized; the underlying fetch is cached across requests by tag.
export const getCms = cache(async (locale) => createAccessor(await loadContent(), locale));

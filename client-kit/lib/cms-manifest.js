import { textToDoc } from "./cms-richtext";

// Turns a site's cms.manifest.js into the normalized structure stored in Supabase.
// Used by the admin sync script (→ cms_sync_manifest RPC) and by client websites in
// CMS_OFFLINE mode (local development without the CMS).

const KEY = /^[a-z0-9_]+$/;
const FIELD_TYPES = new Set(["text", "textarea", "richtext", "url", "list"]);
const ITEM_TYPES = new Set(["text", "textarea", "richtext", "url"]);

function fail(msg) {
  throw new Error(`cms.manifest: ${msg}`);
}

// page.path: "/rolunk" (minden nyelven ugyanaz) vagy { hu: "/rolunk", en: "/en/about-us" }.
// → path = az alapnyelv útvonala (kötelező), paths = nyelvenkénti útvonalak (üres, ha egy közös van).
function normalizePagePath(page, locales, defaultLocale) {
  const raw = page.path ?? "/";
  if (typeof raw === "string") {
    if (!raw.startsWith("/")) fail(`page.path "/"-rel kezdődjön: ${page.key}`);
    return { path: raw, paths: {} };
  }
  if (typeof raw !== "object") fail(`page.path string vagy { nyelv: útvonal } legyen: ${page.key}`);
  const paths = {};
  for (const [loc, p] of Object.entries(raw)) {
    if (!locales.includes(loc)) fail(`page.path ismeretlen nyelv (${loc}): ${page.key}`);
    if (typeof p !== "string" || !p.startsWith("/")) fail(`page.path.${loc} "/"-rel kezdődjön: ${page.key}`);
    paths[loc] = p;
  }
  if (!paths[defaultLocale]) fail(`page.path.${defaultLocale} (alapnyelv) kötelező: ${page.key}`);
  return { path: paths[defaultLocale], paths };
}

function normalizeOrigin(url, what) {
  const m = /^(https?:\/\/[^/]+)\/?$/.exec(url ?? "");
  if (!m) fail(`${what} csak origin lehet (útvonal nélkül), pl. https://preview.pelda.hu: ${url}`);
  return m[1];
}

function normalizeScalar(type, value, { lines } = {}) {
  if (value == null) return undefined;
  if (type === "richtext") return typeof value === "string" ? textToDoc(value) : value;
  if (lines && Array.isArray(value)) return value.join("\n");
  return String(value);
}

function normalizeListValue(itemFields, items) {
  if (!Array.isArray(items)) fail("list default tömb kell legyen");
  return items.map((item) => {
    const out = {};
    for (const f of itemFields) out[f.key] = normalizeScalar(f.type, item?.[f.key], f) ?? "";
    return out;
  });
}

function normalizeFieldValue(field, value) {
  if (field.type === "list") return normalizeListValue(field.itemFields, value);
  return normalizeScalar(field.type, value, field);
}

export function normalizeManifest(manifest) {
  const m = manifest?.default ?? manifest;
  if (!m?.site?.slug || !m.site.name || !m.site.url) fail("site.slug, site.name, site.url kötelező");
  if (!/^[a-z0-9-]{2,40}$/.test(m.site.slug)) fail(`érvénytelen slug: ${m.site.slug}`);

  const locales = (m.locales ?? [{ code: "hu", label: "Magyar" }]).map((l, i) => ({
    locale: l.code,
    label: l.label ?? l.code,
    sort: i,
  }));
  const defaultLocale = locales[0].locale;
  const siteUrl = m.site.url.replace(/\/$/, "");

  const fields = [];
  const slots = [];
  const pages = [];
  const seen = new Set();

  (m.pages ?? []).forEach((page, pi) => {
    if (!KEY.test(page.key ?? "")) fail(`érvénytelen page key: ${page.key}`);
    const { path, paths } = normalizePagePath(page, locales.map((l) => l.locale), defaultLocale);
    pages.push({ key: page.key, label: page.label ?? page.key, path, paths, sort: pi });

    (page.sections ?? []).forEach((section, si) => {
      if (!KEY.test(section.key ?? "")) fail(`érvénytelen section key: ${page.key}.${section.key}`);
      const base = { page_key: page.key, section_key: section.key, section_label: section.label ?? section.key };

      (section.fields ?? []).forEach((f, fi) => {
        const key = `${page.key}.${section.key}.${f.key}`;
        if (!KEY.test(f.key ?? "")) fail(`érvénytelen field key: ${key}`);
        if (seen.has(key)) fail(`duplikált kulcs: ${key}`);
        seen.add(key);
        if (!FIELD_TYPES.has(f.type)) fail(`ismeretlen típus (${f.type}): ${key}`);

        const options = {};
        if (f.maxLength) options.maxLength = f.maxLength;
        if (f.lines) options.lines = true;
        if (f.hidden) options.hidden = true;
        if (f.type === "list") {
          if (!Array.isArray(f.itemFields) || f.itemFields.length === 0) fail(`list itemFields kell: ${key}`);
          for (const it of f.itemFields) {
            if (!KEY.test(it.key ?? "") || !ITEM_TYPES.has(it.type)) fail(`hibás itemField: ${key}.${it.key}`);
          }
          options.itemFields = f.itemFields.map((it) => ({
            key: it.key,
            label: it.label ?? it.key,
            type: it.type,
            ...(it.maxLength ? { maxLength: it.maxLength } : {}),
            ...(it.lines ? { lines: true } : {}),
          }));
          options.count = Array.isArray(f.default) ? f.default.length : 0; // MVP: fix darabszám
        }

        const normalized = { ...f, itemFields: options.itemFields };
        const default_value = {};
        if (f.default !== undefined) default_value[defaultLocale] = normalizeFieldValue(normalized, f.default);
        for (const [loc, val] of Object.entries(f.translations ?? {})) {
          default_value[loc] = normalizeFieldValue(normalized, val);
        }

        fields.push({
          key,
          ...base,
          label: f.label ?? f.key,
          help: f.help ?? null,
          type: f.type,
          translatable: f.translatable !== false,
          options,
          default_value,
          sort: si * 1000 + fi,
        });
      });

      (section.images ?? []).forEach((img, ii) => {
        const key = `${page.key}.${section.key}.${img.key}`;
        if (!KEY.test(img.key ?? "")) fail(`érvénytelen image key: ${key}`);
        if (seen.has(key)) fail(`duplikált kulcs: ${key}`);
        seen.add(key);
        const kind = img.kind ?? "single";
        if (kind !== "single" && kind !== "gallery") fail(`ismeretlen kind (${kind}): ${key}`);
        const def = img.default ?? {};
        slots.push({
          key,
          ...base,
          label: img.label ?? img.key,
          help: img.help ?? null,
          kind,
          max_width: img.maxWidth ?? 1920,
          max_height: img.maxHeight ?? null,
          aspect: img.aspect ?? null,
          quality: img.quality ?? 80,
          max_items: kind === "gallery" ? img.maxItems ?? 24 : 1,
          default_src: def.src ?? null,
          default_width: def.width ?? null,
          default_height: def.height ?? null,
          // alt: szöveg (alapnyelv) vagy { hu, en, de } nyelvenként
          default_alt: !def.alt ? {} : typeof def.alt === "object" ? { ...def.alt } : { [defaultLocale]: def.alt },
          sort: si * 1000 + 500 + ii,
        });
      });
    });
  });

  let gallery = null;
  if (m.gallery) {
    const g = m.gallery;
    const links = (g.links ?? []).map((l) => {
      if (!/^[a-z0-9_-]{1,40}$/.test(l.key ?? "")) fail(`érvénytelen gallery link key: ${l.key}`);
      return { key: l.key, label: l.label ?? l.key };
    });
    // aspect = the card shape the site shows thumbnails in ("16/9", "1/1", "4/5"…) → admin focus preview.
    const aspect = g.aspect ?? "16/9";
    if (!/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(aspect)) fail(`érvénytelen gallery.aspect: ${aspect} (pl. "16/9")`);
    gallery = { label: g.label ?? "Galéria", maxWidth: g.maxWidth ?? 2000, quality: g.quality ?? 80, aspect, links };
  }

  // Blog-modul: cikkek az adminban (Blog menü). locales = mely nyelveken van blog; path / postPath nyelvenként
  // ({slug} helyére a cikk slugja kerül) - az admin ebből tudja a „Megnézem" és az előnézet linkjét.
  let blog = null;
  if (m.blog) {
    const b = m.blog;
    const codes = locales.map((l) => l.locale);
    const blogLocales = b.locales ?? [defaultLocale];
    for (const l of blogLocales) if (!codes.includes(l)) fail(`blog.locales ismeretlen nyelv: ${l}`);
    const pathMap = (v, what) => {
      const out = typeof v === "string" ? { [defaultLocale]: v } : { ...(v ?? {}) };
      for (const l of blogLocales) {
        if (typeof out[l] !== "string" || !out[l].startsWith("/")) fail(`blog.${what}.${l} "/"-rel kezdődő útvonal kell`);
      }
      return out;
    };
    const postPath = pathMap(b.postPath, "postPath");
    for (const l of blogLocales) if (!postPath[l].includes("{slug}")) fail(`blog.postPath.${l}: {slug} hiányzik`);
    blog = { label: b.label ?? "Blog", locales: blogLocales, path: pathMap(b.path, "path"), postPath, author: b.author ?? null };
  }

  // Értékelések-modul: vélemények az adminban (Értékelések menü) → cms.reviews().
  const reviews = m.reviews ? { label: m.reviews.label ?? "Értékelések" } : null;

  const a = m.analytics ?? {};
  return {
    site: {
      slug: m.site.slug,
      name: m.site.name,
      site_url: siteUrl,
      revalidate_url: `${siteUrl}${m.site.revalidatePath ?? "/api/revalidate"}`,
      default_locale: defaultLocale,
      // Előnézeti deploy (pl. még nem élesített nyelvekhez): a szerkesztő ezt framelli, a publish ezt is frissíti.
      preview_url: m.site.previewUrl ? normalizeOrigin(m.site.previewUrl, "site.previewUrl") : null,
      ga4_property_id: a.ga4PropertyId ?? null,
      gsc_site_url: a.gscSiteUrl ?? null,
      cta_event: a.ctaEvent ?? "cta_click",
      cta_buttons: a.ctaButtons ?? [],
      gallery,
      blog,
      reviews,
    },
    locales,
    members: (m.members ?? []).map((x) => ({ email: x.email.toLowerCase(), role: x.role ?? "editor" })),
    pages,
    fields,
    slots,
  };
}

// Same shape as the cms_get_site_content RPC, built only from manifest defaults.
export function offlineContent(normalized) {
  return {
    slug: normalized.site.slug,
    defaultLocale: normalized.site.default_locale,
    locales: normalized.locales.map((l) => l.locale),
    fields: Object.fromEntries(
      normalized.fields.map((f) => [f.key, { t: f.type, d: f.default_value, v: {} }])
    ),
    gallery: normalized.site.gallery ? { categories: [], items: [] } : null,
    posts: normalized.site.blog ? {} : null,
    reviews: normalized.site.reviews ? [] : null,
    images: Object.fromEntries(
      normalized.slots.map((s) => [
        s.key,
        {
          k: s.kind,
          d: { src: s.default_src, w: s.default_width, h: s.default_height, alt: s.default_alt },
          items: [],
        },
      ])
    ),
  };
}

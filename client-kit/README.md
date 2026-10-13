# CMS client kit

Ezt a csomagot másoljuk be minden CMS-es ügyféloldalba. A forrás itt van, az ügyféloldalakon lévő példányokat ne szerkeszd kézzel: módosítsd itt, és másold be újra.

```bash
node scripts/copy-client-kit.mjs <ügyféloldal repo>
```

## Fájlok
| Fájl | Mit csinál |
|---|---|
| `lib/cms.js` | `getCms(locale?)`: tartalom a `cms_get_site_content` RPC-ből, `cms:<slug>` cache taggel. Metódusok: `text`, `rich`, `lines`, `list`, `image`, `images`, `attr`. |
| `lib/cms-manifest.js` | Manifest normalizálás. A sync script és a `CMS_OFFLINE=1` mód használja. |
| `lib/cms-richtext.js` | Rich text allowlist (Tiptap JSON). Ugyanez fut mentéskor és rendereléskor. |
| `lib/cms-bridge-protocol.js` | postMessage üzenettípusok az admin szerkesztő és a bridge között. |
| `components/cms/RichText.jsx` | Biztonságos rich text renderer. |
| `components/cms/CmsBridge.jsx` | Vizuális szerkesztő híd. Csak az admin iframe-jében aktív. |
| `components/cms/JsonLd.jsx` | JSON-LD `<script>` (`<JsonLd data={schema} />`). Mindig ezt használd `dangerouslySetInnerHTML` + `JSON.stringify` helyett — az nem escape-eli a `</script>`-et (XSS CMS-szövegből). |
| `app/api/revalidate/route.js` | POST, Bearer secret. `revalidateTag(…, "max")`, utána bemelegíti az oldalakat. |

## Bekötés egy ügyféloldalba
1. `cms.manifest.js` a repo gyökerébe. Minta: `projektek/automoso sablon/sablon1/kod/cms.manifest.js`.
2. Az `.env.local` tartalma (minta: a sablon1 `.env.example`-je):
   - `CMS_SITE_SLUG`
   - `CMS_SUPABASE_URL`
   - `CMS_SUPABASE_PUBLISHABLE_KEY`
   - `CMS_REVALIDATE_SECRET`
   - `NEXT_PUBLIC_CMS_ADMIN_ORIGIN`
3. `<CmsBridge />` a root layoutba.
4. A `next.config`-ba `frame-ancestors` header, csak az admin originnek.
5. Az oldal tartalma `const cms = await getCms()`-ből jön. A szerkeszthető elemekre `{...cms.attr(key, i?, f?)}` kerül.
6. Sync az admin repóból:
   ```bash
   npx tsx scripts/sync-manifest.mjs <repo>/cms.manifest.js --print-secret
   ```

## Frissítés mentés után
- A revalidate route ellenőrzi, hogy a CMS válaszol-e. Ha igen: `revalidateTag(tag, { expire: 0 })` → az oldal-bemelegítés már az új tartalommal generál, az első látogató is frisset kap. Ha nem: `"max"` (stale-while-revalidate) → a legutóbbi jó oldal marad kint.
- ⚠️ Dinamikus route-oknál (`[slug]` + `generateStaticParams`) **`dynamicParams = true`** kell (ismeretlen slugra a page maga hívjon `notFound()`-ot). `false`-szal a lejáratás után a Next nem generál újra → 404 (NoFallbackError).

## Blog-modul
- Manifest: `blog: { label, locales: ['hu'], path: { hu: '/blog' }, postPath: { hu: '/blog/{slug}' }, author }` → sync → az adminban megjelenik a Blog menü (írás, szerkesztés, elrejtés, Kuka 30 napig, borítókép + OG-kép, GYIK, Google-előnézet).
- Weboldal: `getPosts(locale)` (lista, újak elöl), `getPost(locale, slug)` (törzs, `faq`, `translations`), a törzs: `<RichText value={post.body} />` (h2/h3 horgony-id-vel). Képek: `publicUrl(post.cover.path)`, `publicUrl(post.og)`.
- Van-e blog egy nyelven: `cms.postCount(locale)` (a site-tartalomból, külön lekérés nélkül) → menü / hreflang / sitemap.
- Előnézet: az admin linkje `{siteUrl}/api/preview?post=<id>&token=<token>` - a weboldalon kell egy route, ami `getPostPreview(id, token)`-nel ellenőriz, `draftMode()`-ot kapcsol és a cikkre irányít (minta: Hallásgondozó `app/api/preview`).
- Meglévő MDX-cikkek átvétele: `node scripts/import-mdx-posts.mjs <repo> [--run]` (admin repó).

## Galéria (portfólió) — fókuszpont
- Manifest: `gallery: { label, maxWidth, aspect: "16/9", links }` — `aspect` = a kártyák aránya a weboldalon (az admin ebben mutat előnézetet).
- `cms.gallery().items[i]`: `objectPosition` (`"x% y%"`), `fit` (`"cover"` | `"contain"`), `focus: { x, y }`.
- Kártyán: `cover` → `object-cover` + `style={{ objectPosition }}`; `contain` → a kép `object-contain`, mögötte ugyanaz `object-cover blur` háttérnek (minta: StillSoul `app/portfolio/CoverImage.jsx`).

## Többnyelvű oldal
- `locales`: az első az alapnyelv. Fordítás mezőnként: `default` (alapnyelv) + `translations: { en: …, de: … }`.
- Ha a nyelvek külön útvonalon vannak, `page.path` nyelvenként: `{ hu: "/hallokeszulekek", en: "/en/hearing-aids" }`. A szerkesztő az előnézetben a választott nyelv oldalát tölti be.
- A tartalom `getCms(locale)`-ből jön.
- Kép-slot alt szövege nyelvenként: `default: { src, alt: { hu: "…", en: "…" } }` (sima szöveg = csak az alapnyelv). A kép minden nyelven ugyanaz.
- Még nem élesített nyelvekhez: `site.previewUrl` egy külön előnézeti deploy originje, ahol minden nyelv él és `noindex`. A szerkesztő ezt framelli, a publish az élest és ezt is frissíti (ugyanaz a `CMS_REVALIDATE_SECRET`). A preview deployon is kell `frame-ancestors`, és kikapcsolt Vercel Deployment Protection.

## Viselkedés
- **Mentés után:** a revalidate route frissít. Az oldal kb. 1–3 másodpercen belül friss (stale-while-revalidate).
- **Ha a Supabase nem elérhető:** az oldal a legutóbbi jó verziót szolgálja ki (HTTP 200), nem esik vissza az alapértékekre.
- **Build közben** a CMS-nek elérhetőnek kell lennie. Lokális fejlesztéshez CMS nélkül: `CMS_OFFLINE=1`.
- **Feltöltött képek:** a `site-media` bucketből jönnek, Next képoptimalizálás nélkül (`unoptimized`), mert eleve WebP-ként kerülnek fel.

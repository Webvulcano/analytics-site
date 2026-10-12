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

## Többnyelvű oldal
- `locales`: az első az alapnyelv. Fordítás mezőnként: `default` (alapnyelv) + `translations: { en: …, de: … }`.
- Ha a nyelvek külön útvonalon vannak, `page.path` nyelvenként: `{ hu: "/hallokeszulekek", en: "/en/hearing-aids" }`. A szerkesztő az előnézetben a választott nyelv oldalát tölti be.
- A tartalom `getCms(locale)`-ből jön.
- Még nem élesített nyelvekhez: `site.previewUrl` egy külön előnézeti deploy originje, ahol minden nyelv él és `noindex`. A szerkesztő ezt framelli, a publish az élest és ezt is frissíti (ugyanaz a `CMS_REVALIDATE_SECRET`). A preview deployon is kell `frame-ancestors`, és kikapcsolt Vercel Deployment Protection.

## Viselkedés
- **Mentés után:** a revalidate route frissít. Az oldal kb. 1–3 másodpercen belül friss (stale-while-revalidate).
- **Ha a Supabase nem elérhető:** az oldal a legutóbbi jó verziót szolgálja ki (HTTP 200), nem esik vissza az alapértékekre.
- **Build közben** a CMS-nek elérhetőnek kell lennie. Lokális fejlesztéshez CMS nélkül: `CMS_OFFLINE=1`.
- **Feltöltött képek:** a `site-media` bucketből jönnek, Next képoptimalizálás nélkül (`unoptimized`), mert eleve WebP-ként kerülnek fel.

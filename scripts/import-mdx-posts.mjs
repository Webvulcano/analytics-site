#!/usr/bin/env node
// One-off: imports a website's MDX blog posts (content/blog/<locale>/*.mdx, `export const meta = {…}` + Markdown)
// into the Ügyfél Admin blog module. The source files are only READ.
//
//   node scripts/import-mdx-posts.mjs <site-repo> [--run]
//
//   (default)  dry run: parses every post, prints what would be imported, writes nothing
//   --run      upload cover (WebP) + OG image (JPEG) and insert the posts as published, with their
//              original dates. Posts whose (locale, slug) already exists are skipped.
//
// Markdown supported: ## / ### headings, paragraphs, - / 1. lists, **bold**, *italic*, [links](url).
// Anything else (tables, images, HTML, quotes) stops the import - nothing is dropped silently.
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY. The site slug comes from the
// site repo's .env.local (CMS_SITE_SLUG).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { sanitizeDoc } from "../client-kit/lib/cms-richtext.js";
import { validatePost } from "../lib/blog/validate.js";
import { COVER, OG } from "../lib/blog.js";

const BUCKET = "site-media";
const args = process.argv.slice(2);
const repo = args.find((a) => !a.startsWith("--"));
const RUN = args.includes("--run");

if (!repo || !existsSync(join(repo, "content/blog"))) {
  console.error("Használat: node scripts/import-mdx-posts.mjs <weboldal-repo> [--run]");
  process.exit(1);
}
process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
const siteEnv = parseEnv(readFileSync(join(repo, ".env.local"), "utf8"));
const SITE_SLUG = siteEnv.CMS_SITE_SLUG;
if (!SITE_SLUG) throw new Error("A weboldal .env.local-jában nincs CMS_SITE_SLUG.");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const kb = (n) => `${Math.round(n / 1024)} KB`;

// ── MDX → meta + Tiptap doc ────────────────────────────────────────────────

function parseMdx(file) {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("export const meta =");
  if (start < 0) throw new Error(`${file}: nincs "export const meta"`);
  // the meta object ends at the first "\n}\n" after the start (top-level closing brace)
  const end = src.indexOf("\n}\n", start);
  const objectText = src.slice(src.indexOf("{", start), end + 2);
  // Our own repo file (trusted): evaluate the object literal.
  const meta = Function(`"use strict"; return (${objectText});`)();
  const body = src
    .slice(end + 3)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // JSX comments
    .trim();
  return { meta, body };
}

// **bold**, *italic* / _italic_, [text](url) → text nodes with marks
function inline(text, marks = []) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\w])[*_](?![*\s])(.+?)(?<![\s*])[*_](?![*\w])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index), ...(marks.length ? { marks } : {}) });
    if (m[1] != null) out.push(...inline(m[1], [...marks, { type: "bold" }]));
    else if (m[2] != null) out.push(...inline(m[2], [...marks, { type: "link", attrs: { href: m[3] } }]));
    else out.push(...inline(m[4], [...marks, { type: "italic" }]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last), ...(marks.length ? { marks } : {}) });
  return out.filter((n) => n.text !== "");
}

function markdownToDoc(md, file) {
  const content = [];
  for (const block of md.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split("\n").map((l) => l.trim());
    const h = /^(#{2,3})\s+(.+)$/.exec(block);
    if (h && lines.length === 1) {
      content.push({ type: "heading", attrs: { level: h[1].length }, content: inline(h[2]) });
    } else if (lines.every((l) => /^[-*]\s+/.test(l))) {
      content.push({ type: "bulletList", content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(l.replace(/^[-*]\s+/, "")) }] })) });
    } else if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      content.push({ type: "orderedList", content: lines.map((l) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(l.replace(/^\d+\.\s+/, "")) }] })) });
    } else if (lines.some((l) => /^(#|>|\||!\[|<|```)/.test(l))) {
      throw new Error(`${file}: nem támogatott Markdown-szerkezet:\n${block.slice(0, 200)}`);
    } else {
      content.push({ type: "paragraph", content: inline(lines.join(" ")) });
    }
  }
  return sanitizeDoc({ type: "doc", content });
}

// ── Képek ───────────────────────────────────────────────────────────────────

function publicFile(path) {
  const file = join(repo, "public", path);
  if (!existsSync(file)) throw new Error(`Nincs ilyen kép: public${path}`);
  return readFileSync(file);
}

async function coverWebp(path) {
  const buf = publicFile(path);
  const img = sharp(buf).rotate();
  const { width, format } = await img.metadata();
  const out =
    format === "webp" && width <= COVER.maxWidth
      ? { data: buf, info: await sharp(buf).metadata() }
      : await img.resize({ width: COVER.maxWidth, withoutEnlargement: true }).webp({ quality: COVER.quality }).toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

async function ogJpeg(ogPath, coverPath) {
  if (ogPath) {
    const buf = publicFile(ogPath);
    const m = await sharp(buf).metadata();
    if (m.format === "jpeg" && m.width === OG.width && m.height === OG.height) return buf;
  }
  return sharp(publicFile(ogPath ?? coverPath))
    .resize(OG.width, OG.height, { fit: "cover" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: Math.round(OG.quality * 100) })
    .toBuffer();
}

// ── Import ──────────────────────────────────────────────────────────────────

const { data: site, error: siteErr } = await db.from("sites").select("id, slug, blog").eq("slug", SITE_SLUG).single();
if (siteErr) throw siteErr;
if (!site.blog) throw new Error(`A(z) ${SITE_SLUG} site-nak nincs blog-modulja (manifest blog blokk + sync).`);
const locales = site.blog.locales ?? ["hu"];

const posts = [];
for (const locale of readdirSync(join(repo, "content/blog"))) {
  const dir = join(repo, "content/blog", locale);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".mdx"))) {
    const file = join(dir, name);
    const { meta, body } = parseMdx(file);
    const doc = markdownToDoc(body, file);
    const checked = validatePost(
      {
        title: meta.title,
        slug: meta.slug,
        locale,
        metaTitle: meta.metaTitle,
        description: meta.description,
        excerpt: meta.excerpt,
        author: meta.author,
        publishedAt: meta.datePublished,
        coverAlt: meta.imageAlt,
        faq: meta.faq,
        body: doc,
      },
      { locales }
    );
    if (!checked.ok) throw new Error(`${file}: ${checked.error}`);
    posts.push({ file, meta, row: checked.value });
  }
}

console.log(`Site: ${site.slug} · ${posts.length} cikk${RUN ? "" : " (próbafuttatás, nem ír semmit)"}`);
const groups = new Map(); // translationKey → group_id
let created = 0;
for (const { file, meta, row } of posts) {
  const kinds = row.body.content.reduce((acc, n) => ({ ...acc, [n.type]: (acc[n.type] ?? 0) + 1 }), {});
  const cover = meta.image ? await coverWebp(meta.image) : null;
  const og = meta.image || meta.ogImage ? await ogJpeg(meta.ogImage, meta.image) : null;
  console.log(
    `\n• [${row.locale}] ${row.slug}\n  ${row.title}\n  szöveg: ${JSON.stringify(kinds)} · GYIK: ${row.faq.length}` +
      `\n  dátum: ${meta.datePublished} / ${meta.dateModified ?? "-"} · borító: ${cover ? `${cover.width}×${cover.height}, ${kb(cover.data.length)}` : "-"} · OG: ${og ? kb(og.length) : "-"}`
  );

  const { data: exists } = await db
    .from("posts")
    .select("id")
    .eq("site_id", site.id)
    .eq("locale", row.locale)
    .eq("slug", row.slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (exists) {
    console.log("  → már létezik, kihagyva");
    if (meta.translationKey) groups.set(meta.translationKey, groups.get(meta.translationKey) ?? exists.id);
    continue;
  }
  if (!RUN) continue;

  const id = randomUUID();
  const upload = async (name, data, contentType) => {
    const path = `${site.id}/blog/${id}/${name}`;
    const { error } = await db.storage.from(BUCKET).upload(path, data, { contentType, cacheControl: "31536000", upsert: false });
    if (error) throw new Error(`Feltöltés (${name}): ${error.message}`);
    return path;
  };
  const coverPath = cover ? await upload(`${randomUUID()}.webp`, cover.data, "image/webp") : null;
  const ogPath = og ? await upload(`og-${randomUUID()}.jpg`, og, "image/jpeg") : null;

  const groupId = meta.translationKey ? groups.get(meta.translationKey) ?? id : id;
  if (meta.translationKey) groups.set(meta.translationKey, groupId);
  const modified = meta.dateModified ? `${meta.dateModified}T12:00:00Z` : row.published_at;

  const { error } = await db.from("posts").insert({
    id,
    site_id: site.id,
    group_id: groupId,
    ...row,
    cover_path: coverPath,
    cover_width: cover?.width ?? null,
    cover_height: cover?.height ?? null,
    og_path: ogPath,
    status: "published",
    updated_at: modified,
  });
  if (error) {
    await db.storage.from(BUCKET).remove([coverPath, ogPath].filter(Boolean));
    throw new Error(`${file}: ${error.message}`);
  }
  created += 1;
  console.log(`  → importálva (${id})`);
}
console.log(`\n${RUN ? `Kész: ${created} új cikk.` : "Próbafuttatás vége. Éles import: --run"}`);

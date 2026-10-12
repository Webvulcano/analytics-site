// Rich text allowlist (Tiptap JSON). Shared by the admin (validation on save) and the
// client websites (rendering). Anything not explicitly allowed is dropped, so stored
// content can never inject markup — even if written directly through the database API.

const NODES = new Set(["doc", "paragraph", "heading", "text", "hardBreak", "bulletList", "orderedList", "listItem"]);
// Címsor csak 2-es és 3-as szint (a h1 az oldal címe). Csak a blog-szerkesztő kínálja, de a renderer mindenhol ismeri.
const HEADING_LEVELS = new Set([2, 3]);
const MARKS = new Set(["bold", "italic", "link"]);
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const MAX_DEPTH = 8;

export function isSafeHref(href) {
  return typeof href === "string" && href.length <= 2000 && SAFE_HREF.test(href.trim());
}

function sanitizeMarks(marks) {
  if (!Array.isArray(marks)) return undefined;
  const out = [];
  for (const m of marks) {
    if (!m || !MARKS.has(m.type)) continue;
    if (m.type === "link") {
      const href = m.attrs?.href;
      if (!isSafeHref(href)) continue;
      out.push({ type: "link", attrs: { href: href.trim() } });
    } else {
      out.push({ type: m.type });
    }
  }
  return out.length ? out : undefined;
}

function sanitizeNode(node, depth) {
  if (!node || typeof node !== "object" || !NODES.has(node.type) || depth > MAX_DEPTH) return null;
  if (node.type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) return null;
    const marks = sanitizeMarks(node.marks);
    return marks ? { type: "text", text: node.text, marks } : { type: "text", text: node.text };
  }
  if (node.type === "hardBreak") return { type: "hardBreak" };
  const content = Array.isArray(node.content)
    ? node.content.map((c) => sanitizeNode(c, depth + 1)).filter(Boolean)
    : [];
  if (node.type === "heading") {
    const level = HEADING_LEVELS.has(node.attrs?.level) ? node.attrs.level : 2;
    return { type: "heading", attrs: { level }, content };
  }
  return { type: node.type, content };
}

// Returns a clean Tiptap doc. Plain strings become paragraphs (blank line = new paragraph).
export function sanitizeDoc(value) {
  if (typeof value === "string") return textToDoc(value);
  const doc = sanitizeNode(value, 0);
  if (!doc || doc.type !== "doc") return { type: "doc", content: [] };
  return doc;
}

export function textToDoc(text) {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}

export function toPlainText(value) {
  if (typeof value === "string") return value;
  const parts = [];
  (function walk(node) {
    if (!node) return;
    if (node.type === "text") parts.push(node.text);
    if (node.type === "hardBreak") parts.push("\n");
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (node.type === "paragraph" || node.type === "listItem" || node.type === "heading") parts.push("\n");
  })(value);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

// Horgony-id egy címsorhoz (mint a GitHub / rehype-slug: kisbetű, ékezet marad, írásjel ki, szóköz → kötőjel).
export function slugifyHeading(text) {
  return String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

// A doc címsorainak egyedi id-jei (ismétlődő címnél -1, -2 utótag), sorrendben.
export function headingIds(doc) {
  const seen = new Map();
  const ids = [];
  for (const node of doc?.content ?? []) {
    if (node.type !== "heading") continue;
    const base = slugifyHeading(toPlainText(node)) || "szakasz";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.push(n ? `${base}-${n}` : base);
  }
  return ids;
}

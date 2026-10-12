// Rich text allowlist (Tiptap JSON). Shared by the admin (validation on save) and the
// client websites (rendering). Anything not explicitly allowed is dropped, so stored
// content can never inject markup — even if written directly through the database API.

const NODES = new Set(["doc", "paragraph", "text", "hardBreak", "bulletList", "orderedList", "listItem"]);
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
    if (node.type === "paragraph" || node.type === "listItem") parts.push("\n");
  })(value);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

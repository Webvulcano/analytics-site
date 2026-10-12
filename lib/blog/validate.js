import { sanitizeDoc, toPlainText } from "../../client-kit/lib/cms-richtext.js";
import { LIMITS, SLUG_RE } from "../blog.js";

// Server-side validation of a post edited in the admin. Returns { ok: true, value } with the
// cleaned DB columns, or { ok: false, error } with a message for the editor panel.

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const cleanMultiline = (v) => String(v ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();

function text(label, value, max, { required = false, multiline = false } = {}) {
  const v = multiline ? cleanMultiline(value) : clean(value);
  if (required && !v) return { error: `${label}: kötelező.` };
  if (v.length > max) return { error: `${label}: túl hosszú (max ${max} karakter, most ${v.length}).` };
  return { value: v || null };
}

// "2026-04-22" → ISO timestamp (noon UTC, so the date never shifts across time zones); empty → null
function date(value) {
  const v = clean(value);
  if (!v) return { value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) {
    return { error: "A dátum formátuma: ÉÉÉÉ-HH-NN." };
  }
  return { value: `${v}T12:00:00Z` };
}

export function validatePost(input, { locales }) {
  const out = {};
  const fields = [
    ["title", text("Cím", input.title, LIMITS.title, { required: true })],
    ["meta_title", text("Google-cím", input.metaTitle, LIMITS.metaTitle)],
    ["description", text("Google-leírás", input.description, LIMITS.description, { multiline: true })],
    ["excerpt", text("Kivonat", input.excerpt, LIMITS.excerpt, { multiline: true })],
    ["author", text("Szerző", input.author, LIMITS.author)],
    ["cover_alt", text("Borítókép leírása", input.coverAlt, LIMITS.coverAlt)],
    ["published_at", date(input.publishedAt)],
  ];
  for (const [key, r] of fields) {
    if (r.error) return { ok: false, error: r.error };
    out[key] = r.value;
  }

  const slug = clean(input.slug);
  if (!SLUG_RE.test(slug) || slug.length > LIMITS.slug) {
    return { ok: false, error: "Az URL-név csak kisbetűt, számot és kötőjelet tartalmazhat (pl. hallokeszulek-tippek)." };
  }
  out.slug = slug;

  if (!locales.includes(input.locale)) return { ok: false, error: "Ismeretlen nyelv." };
  out.locale = input.locale;

  const body = sanitizeDoc(input.body ?? { type: "doc", content: [] });
  if (toPlainText(body).length > LIMITS.bodyChars) {
    return { ok: false, error: `A cikk szövege túl hosszú (max ${LIMITS.bodyChars} karakter).` };
  }
  out.body = body;

  const faq = [];
  for (const [i, item] of (Array.isArray(input.faq) ? input.faq : []).entries()) {
    const q = clean(item?.q);
    const a = cleanMultiline(item?.a);
    if (!q && !a) continue; // empty row: dropped
    if (!q || !a) return { ok: false, error: `GYIK ${i + 1}.: a kérdés és a válasz is kell.` };
    if (q.length > LIMITS.faqQ) return { ok: false, error: `GYIK ${i + 1}.: a kérdés túl hosszú (max ${LIMITS.faqQ}).` };
    if (a.length > LIMITS.faqA) return { ok: false, error: `GYIK ${i + 1}.: a válasz túl hosszú (max ${LIMITS.faqA}).` };
    faq.push({ q, a });
  }
  if (faq.length > LIMITS.faqItems) return { ok: false, error: `Legfeljebb ${LIMITS.faqItems} GYIK-kérdés lehet.` };
  out.faq = faq;

  return { ok: true, value: out };
}

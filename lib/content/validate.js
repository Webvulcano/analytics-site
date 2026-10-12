import { isSafeHref, sanitizeDoc, toPlainText } from "../../client-kit/lib/cms-richtext.js";

// Server-side validation of an edited value against its field definition.
// Returns { ok: true, value } with the cleaned value, or { ok: false, error }.

const MAX_TEXT = 5000;
const MAX_RICH = 20000;

function scalar(def, value, label) {
  const max = def.maxLength ?? (def.type === "richtext" ? MAX_RICH : MAX_TEXT);

  if (def.type === "richtext") {
    const doc = sanitizeDoc(value);
    if (toPlainText(doc).length > max) return { ok: false, error: `${label}: túl hosszú (max ${max} karakter)` };
    return { ok: true, value: doc };
  }

  if (typeof value !== "string") return { ok: false, error: `${label}: szöveg kell` };
  const text = value.replace(/\r\n/g, "\n");
  if (text.length > max) return { ok: false, error: `${label}: túl hosszú (max ${max} karakter)` };
  if (def.type === "url" && text.trim() && !isSafeHref(text)) {
    return { ok: false, error: `${label}: érvénytelen link (https://, tel: vagy mailto: kell)` };
  }
  if (def.type === "text" && text.includes("\n")) return { ok: false, error: `${label}: nem lehet benne sortörés` };
  return { ok: true, value: text };
}

export function validateFieldValue(field, value) {
  const opts = field.options ?? {};

  if (field.type !== "list") {
    return scalar({ type: field.type, maxLength: opts.maxLength }, value, field.label);
  }

  if (!Array.isArray(value)) return { ok: false, error: `${field.label}: lista kell` };
  if (opts.count && value.length !== opts.count) {
    return { ok: false, error: `${field.label}: ${opts.count} elem kell (most: ${value.length})` };
  }
  const items = [];
  for (const [i, item] of value.entries()) {
    const clean = {};
    for (const def of opts.itemFields ?? []) {
      const r = scalar(def, item?.[def.key] ?? "", `${field.label} ${i + 1}. ${def.label}`);
      if (!r.ok) return r;
      clean[def.key] = r.value;
    }
    items.push(clean);
  }
  return { ok: true, value: items };
}

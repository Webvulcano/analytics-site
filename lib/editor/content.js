import { toPlainText } from "@/client-kit/lib/cms-richtext";

// Client-safe helpers for the editor UI.

export function effectiveLocale(field, locale, defaultLocale) {
  return field.translatable ? locale : defaultLocale;
}

// Saved value → manifest default → same for the default locale.
export function resolveValue(field, values, locale, defaultLocale) {
  const loc = effectiveLocale(field, locale, defaultLocale);
  const own = values[field.key] ?? {};
  const def = field.default_value ?? {};
  return own[loc] ?? def[loc] ?? own[defaultLocale] ?? def[defaultLocale] ?? (field.type === "list" ? [] : "");
}

export function hasOwnValue(field, values, locale, defaultLocale) {
  const loc = effectiveLocale(field, locale, defaultLocale);
  return values[field.key]?.[loc] !== undefined;
}

// How the bridge should apply a preview for this (item) field definition.
export function previewKind(def) {
  if (def.type === "richtext") return "rich";
  if (def.lines || def.options?.lines) return "lines";
  return "text";
}

export function shortText(value, max = 80) {
  const text = Array.isArray(value)
    ? `${value.length} elem`
    : typeof value === "string"
      ? value
      : toPlainText(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function sameTarget(a, b) {
  return a?.key === b?.key && (a?.i ?? null) === (b?.i ?? null) && (a?.f ?? null) === (b?.f ?? null);
}

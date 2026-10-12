// Gallery module helpers, shared by the admin UI and its server actions.

export const MAX_TITLE = 120;
export const MAX_ALT = 300;

// "Esküvők és rendezvények" → "eskuvok-es-rendezvenyek". Used once, when a category is created.
export function slugify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

// Accepts a bare ID or any common YouTube URL (watch, youtu.be, shorts, embed, live).
export function parseYouTubeId(input) {
  const s = String(input ?? "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let url;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function youtubeThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function cleanText(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// { hu: " x ", en: "" } → { hu: "x" } (empty languages dropped), only known locales kept.
export function cleanLocaleMap(map, locales, max) {
  const out = {};
  for (const loc of locales) {
    const v = cleanText(map?.[loc], max);
    if (v) out[loc] = v;
  }
  return out;
}

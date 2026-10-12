// Blog module helpers, shared by the admin UI and its server actions.
// Limits mirror the posts table checks (migration 0010_blog).

export const LIMITS = {
  title: 160,
  slug: 80,
  metaTitle: 70,
  description: 170,
  excerpt: 400,
  author: 120,
  coverAlt: 300,
  faqItems: 30,
  faqQ: 200,
  faqA: 1500,
  bodyChars: 60000,
};

// Google shows ~60 / ~155 characters - the counters warn above these.
export const SEO_HINT = { metaTitle: 60, description: 155 };

export const TRASH_DAYS = 30;

export const POST_COLUMNS =
  "id, site_id, locale, group_id, slug, title, meta_title, description, excerpt, body, author, cover_path, cover_width, cover_height, cover_alt, og_path, faq, status, preview_token, published_at, updated_at, deleted_at, created_at";
export const COVER = { maxWidth: 1600, quality: 80 };
export const OG = { width: 1200, height: 630, quality: 0.85 };

export const STATUS = {
  draft: { label: "Piszkozat", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  published: { label: "Közzétéve", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  hidden: { label: "Rejtett", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  trash: { label: "Kukában", tone: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// "Rosszul hall egy családtagom?" → "rosszul-hall-egy-csaladtagom"
export function postSlug(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, "");
}

// Public URL of a post on the client website (blog.postPath: { hu: '/blog/{slug}' }).
export function postUrl(baseUrl, blog, post) {
  const pattern = blog?.postPath?.[post.locale];
  if (!pattern || !baseUrl) return null;
  return new URL(pattern.replace("{slug}", post.slug), baseUrl).toString();
}

// Draft preview on the client website (app/api/preview route there).
export function previewUrl(baseUrl, post) {
  if (!baseUrl || !post?.id) return null;
  const u = new URL("/api/preview", baseUrl);
  u.searchParams.set("post", post.id);
  u.searchParams.set("token", post.preview_token);
  return u.toString();
}

export function trashDaysLeft(deletedAt, now = Date.now()) {
  const ms = new Date(deletedAt).getTime() + TRASH_DAYS * 864e5 - now;
  return Math.max(0, Math.ceil(ms / 864e5));
}

export function postState(post) {
  return post.deleted_at ? "trash" : post.status;
}

// "2026-04-22T00:00:00+00:00" → "2026-04-22" (date input value)
export function dateInputValue(iso) {
  return iso ? String(iso).slice(0, 10) : "";
}

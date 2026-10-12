import { mediaUrl } from "@/lib/image/upload";
import { youtubeThumb } from "@/lib/gallery";

// Photo → its WebP; video → own cover if uploaded, else the YouTube thumbnail.
export function itemThumb(item) {
  if (item.path) return mediaUrl(item.path);
  return youtubeThumb(item.youtube_id);
}

export function coverUrl(cover) {
  if (!cover) return null;
  return cover.path ? mediaUrl(cover.path) : cover.youtubeId ? youtubeThumb(cover.youtubeId) : null;
}

// { [linkKey]: name of the category using it } — the edited category excluded.
export function takenLinks(categories, defaultLocale, exceptId) {
  const out = {};
  for (const c of categories) {
    if (c.link_key && c.id !== exceptId) out[c.link_key] = c.title?.[defaultLocale] ?? c.slug;
  }
  return out;
}

import { createClient } from "@/lib/supabase/client";

export const MEDIA_BUCKET = "site-media";

// Uploads a processed WebP straight to Storage with the user's session (RLS checks the
// site folder + path shape). Objects are immutable: a new uuid name for every upload.
export async function uploadSlotImage({ siteId, slotKey, blob }) {
  const path = `${siteId}/slots/${slotKey}/${crypto.randomUUID()}.webp`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Feltöltés sikertelen: ${error.message}`);
  return path;
}

export async function uploadGalleryImage({ siteId, categoryId, blob }) {
  const path = `${siteId}/gallery/${categoryId}/${crypto.randomUUID()}.webp`;
  const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Feltöltés sikertelen: ${error.message}`);
  return path;
}

// Blog post cover (WebP) or its social preview image (og = true → JPEG, og-<uuid>.jpg).
export async function uploadPostImage({ siteId, postId, blob, og = false }) {
  const name = og ? `og-${crypto.randomUUID()}.jpg` : `${crypto.randomUUID()}.webp`;
  const path = `${siteId}/blog/${postId}/${name}`;
  const { error } = await createClient().storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType: og ? "image/jpeg" : "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Feltöltés sikertelen: ${error.message}`);
  return path;
}

// Best effort: used when the DB commit fails after a successful upload (GC catches the rest).
export async function discardUpload(path) {
  try {
    await createClient().storage.from(MEDIA_BUCKET).remove([path]);
  } catch {
    // ignored
  }
}

export function mediaUrl(path) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}

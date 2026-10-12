import { OG } from "../blog.js";

// Social preview image (Open Graph) from the cover: 1200×630 JPEG, center-cropped.
// JPEG on purpose - WebP previews are not shown everywhere (e.g. some messengers / LinkedIn).
// Runs in the browser; `source` is the processed cover Blob (WebP) or the original File.
export async function makeOgImage(source) {
  const bitmap = await createImageBitmap(source);
  try {
    const { width: W, height: H } = OG;
    const scale = Math.max(W / bitmap.width, H / bitmap.height);
    const sw = W / scale;
    const sh = H / scale;
    const sx = (bitmap.width - sw) / 2;
    const sy = (bitmap.height - sh) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // JPEG has no alpha
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, W, H);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", OG.quality));
    if (!blob || blob.type !== "image/jpeg") throw new Error("A megosztási kép nem készült el.");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

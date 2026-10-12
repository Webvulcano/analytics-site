// Image worker: ImageBitmap in → (lanczos3 resize) → WebP bytes out.
// Runs off the main thread so the editor UI stays responsive during encoding.
import encodeWebp, { init as initWebp } from "@jsquash/webp/encode";
import resize from "@jsquash/resize";

const MAX_BYTES = 1.5 * 1024 * 1024;
const RETRY_QUALITY = 70;

let encoderReady;
function ensureEncoder() {
  encoderReady ??= initWebp().then(
    () => "wasm",
    (err) => {
      console.warn("[image] WebP wasm init failed, using canvas fallback", err);
      return "canvas";
    }
  );
  return encoderReady;
}

function now() {
  return performance.now();
}

function bitmapToImageData(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function canvasWebp(imageData, quality) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: quality / 100 });
  // Safari's canvas silently falls back to PNG when it can't encode WebP.
  if (blob.type !== "image/webp") throw new Error(`Canvas WebP nem támogatott (${blob.type})`);
  return blob.arrayBuffer();
}

async function encode(imageData, { quality, lossless }) {
  const encoder = await ensureEncoder();
  if (encoder === "wasm") {
    const opts = lossless ? { lossless: 1, quality: 100 } : { quality };
    return { buffer: await encodeWebp(imageData, opts), encoder };
  }
  return { buffer: await canvasWebp(imageData, lossless ? 100 : quality), encoder };
}

self.onmessage = async ({ data }) => {
  const { id, bitmap, width, height, quality, lossless } = data;
  const t = { start: now() };
  try {
    let imageData = bitmapToImageData(bitmap);
    t.drawn = now();

    if (imageData.width !== width || imageData.height !== height) {
      imageData = await resize(imageData, { width, height, method: "lanczos3" });
    }
    t.resized = now();

    let usedQuality = lossless ? 100 : quality;
    let { buffer, encoder } = await encode(imageData, { quality, lossless });
    if (!lossless && buffer.byteLength > MAX_BYTES && quality > RETRY_QUALITY) {
      usedQuality = RETRY_QUALITY;
      ({ buffer, encoder } = await encode(imageData, { quality: RETRY_QUALITY, lossless }));
    }
    t.encoded = now();

    self.postMessage(
      {
        id,
        ok: true,
        buffer,
        width: imageData.width,
        height: imageData.height,
        quality: usedQuality,
        encoder,
        timings: {
          draw: t.drawn - t.start,
          resize: t.resized - t.drawn,
          encode: t.encoded - t.resized,
        },
      },
      [buffer]
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};

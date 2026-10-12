// Browser-side image pipeline: any photo → WebP sized for its slot.
// Decode + orientation happen here (main thread, async), resize + encode in the worker.

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 60_000_000;
// iOS Safari refuses canvases above ~16.7 MP, so the worker never gets a bigger bitmap.
const MAX_CANVAS_PIXELS = 16_000_000;
// Browser downscale lands at 2× the target, lanczos3 does the last step for sharpness.
const PRE_SCALE = 2;

export class ImageError extends Error {}

let worker;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./encode.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      data.ok ? job.resolve(data) : job.reject(new ImageError(data.error));
    };
    worker.onerror = (e) => {
      for (const job of pending.values()) job.reject(new ImageError(e.message || "Worker hiba"));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function runWorker(payload, transfer) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...payload }, transfer);
  });
}

const RAW_EXT = /\.(dng|cr2|cr3|nef|arw|raf|orf|rw2|srw|pef)$/i;

function looksLikeRaw(file) {
  return RAW_EXT.test(file.name ?? "") || /image\/x-(adobe-dng|canon|nikon|sony|fuji|panasonic|olympus)/i.test(file.type);
}

function looksLikeHeic(file) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? "");
}

// Decoded size after EXIF rotation, without allocating the full bitmap.
// Uses onload, not img.decode(): decode() never settles while the tab is hidden.
function readDimensions(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("not decodable"));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function fitWithin(w, h, maxW, maxH) {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function intermediateSize(src, target) {
  const capByCanvas = Math.sqrt(MAX_CANVAS_PIXELS / (src.width * src.height));
  const scale = Math.min(1, capByCanvas, (target.width * PRE_SCALE) / src.width);
  return { width: Math.round(src.width * scale), height: Math.round(src.height * scale) };
}

async function decodeHeicFallback(file) {
  const { heicTo, isHeic } = await import("heic-to/next");
  if (!(await isHeic(file))) return null;
  return heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } });
}

// Returns an ImageBitmap no larger than MAX_CANVAS_PIXELS, oriented, plus how it was made.
async function decodeScaled(file, target) {
  let dims = null;
  try {
    dims = await readDimensions(file);
  } catch {
    // Not decodable by <img> (e.g. HEIC outside Safari) — handled below.
  }

  if (dims) {
    if (dims.width * dims.height > MAX_SOURCE_PIXELS) {
      throw new ImageError("A kép túl nagy felbontású (max ~60 MP).");
    }
    const mid = intermediateSize(dims, fitWithin(dims.width, dims.height, target.maxWidth, target.maxHeight));
    const needsScale = mid.width !== dims.width || mid.height !== dims.height;
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      ...(needsScale && { resizeWidth: mid.width, resizeHeight: mid.height, resizeQuality: "high" }),
    });
    if (bitmap.width * bitmap.height > MAX_CANVAS_PIXELS) {
      bitmap.close();
      throw new ImageError("A böngésző nem tudta lekicsinyíteni a képet.");
    }
    return { bitmap, source: dims, decoder: needsScale ? "native+resize" : "native" };
  }

  if (!looksLikeHeic(file)) throw new ImageError("Ezt a képformátumot nem tudom megnyitni.");
  let full;
  try {
    full = await decodeHeicFallback(file);
  } catch {
    full = null;
  }
  if (!full) throw new ImageError("A HEIC képet nem sikerült megnyitni. Mentsd el JPG-ként és próbáld újra.");
  const source = { width: full.width, height: full.height };
  const mid = intermediateSize(source, fitWithin(source.width, source.height, target.maxWidth, target.maxHeight));
  const bitmap = await createImageBitmap(full, { resizeWidth: mid.width, resizeHeight: mid.height, resizeQuality: "high" });
  full.close();
  return { bitmap, source, decoder: "heic-to" };
}

/**
 * @param {File|Blob} file
 * @param {{maxWidth:number, maxHeight?:number|null, quality?:number, lossless?:boolean}} options
 */
export async function processImage(file, options) {
  // RAW first: these are huge, so the size check would give a misleading message.
  if (looksLikeRaw(file)) {
    throw new ImageError("RAW (pl. DNG / ProRAW) fotót nem tudunk feldolgozni. Exportáld JPG-ként, vagy kapcsold ki a ProRAW-t.");
  }
  if (!file.type.startsWith("image/") && !looksLikeHeic(file)) {
    throw new ImageError("Ez nem képfájl.");
  }
  if (file.size > MAX_FILE_BYTES) throw new ImageError("A fájl túl nagy (max 30 MB).");

  const slot = { ...options, maxHeight: options.maxHeight ?? Infinity };

  const t0 = performance.now();
  const { bitmap, source, decoder } = await decodeScaled(file, slot);
  const t1 = performance.now();

  const target = fitWithin(source.width, source.height, slot.maxWidth, slot.maxHeight);
  const out = await runWorker(
    {
      bitmap,
      width: Math.min(target.width, bitmap.width),
      height: Math.min(target.height, bitmap.height),
      quality: slot.quality ?? 80,
      lossless: Boolean(slot.lossless),
    },
    [bitmap]
  );
  const t2 = performance.now();

  return {
    blob: new Blob([out.buffer], { type: "image/webp" }),
    width: out.width,
    height: out.height,
    quality: out.quality,
    encoder: out.encoder,
    decoder,
    source,
    timings: { decode: t1 - t0, ...out.timings, total: t2 - t0 },
  };
}

"use client";

import { useEffect, useState } from "react";
import { processImage } from "@/lib/image/process";

const SLOTS = {
  hero: { label: "Hero (1920×1080, q80)", maxWidth: 1920, maxHeight: 1080, quality: 80 },
  galeria: { label: "Galéria (1600×1600, q80)", maxWidth: 1600, maxHeight: 1600, quality: 80 },
  logo: { label: "Logó (600×600, lossless)", maxWidth: 600, maxHeight: 600, lossless: true },
};

const SAMPLES = ["exif-rot6.jpg", "transparent.png", "48mp.jpg", "sample.heic"];

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const ms = (n) => `${Math.round(n)} ms`;

function env() {
  return {
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory ?? "?",
    offscreen: typeof OffscreenCanvas !== "undefined",
  };
}

export default function ImageSpike() {
  const [slot, setSlot] = useState("hero");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);

  useEffect(() => setInfo(env()), []);

  async function run(files) {
    setBusy(true);
    for (const file of files) {
      const base = { name: file.name, type: file.type || "?", size: file.size };
      try {
        const r = await processImage(file, SLOTS[slot]);
        const srcRatio = r.source.width / r.source.height;
        const outRatio = r.width / r.height;
        const row = {
          ...base,
          ok: true,
          ...r,
          url: URL.createObjectURL(r.blob),
          outSize: r.blob.size,
          ratioOk: Math.abs(srcRatio - outRatio) < 0.02,
        };
        setRows((prev) => [row, ...prev]);
      } catch (err) {
        setRows((prev) => [{ ...base, ok: false, error: String(err?.message ?? err) }, ...prev]);
      }
    }
    setBusy(false);
  }

  async function runSamples() {
    const files = [];
    for (const name of SAMPLES) {
      const res = await fetch(`/spike/samples/${name}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      files.push(new File([blob], name, { type: blob.type }));
    }
    await run(files);
  }

  // Exposed for automated checks in a desktop browser.
  useEffect(() => {
    window.__spikeRows = rows.map(({ url, blob, ...r }) => r);
  }, [rows]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4 text-sm">
      <h1 className="mb-1 text-xl font-semibold">Kép spike — WebP pipeline</h1>
      <p className="mb-4 text-gray-500">Válassz képet (iPhone: Fotók → több is). Semmi nem töltődik fel.</p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
          className="rounded border px-2 py-2"
        >
          {Object.entries(SLOTS).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded bg-black px-4 py-2 text-white">
          Kép kiválasztása
          <input
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              run([...e.target.files]);
              e.target.value = "";
            }}
          />
        </label>
        <button onClick={runSamples} disabled={busy} className="rounded border px-4 py-2" data-testid="samples">
          Minta-képek
        </button>
        {busy && <span data-testid="busy">Feldolgozás…</span>}
      </div>

      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded border p-3">
            <div className="font-medium">
              {r.name} <span className="text-gray-500">({r.type}, {kb(r.size)})</span>
            </div>
            {r.ok ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_200px]">
                <div className="space-y-0.5">
                  <div>
                    {r.source.width}×{r.source.height} → <b>{r.width}×{r.height}</b>, {kb(r.outSize)}, q{r.quality}
                  </div>
                  <div>
                    dekóder: {r.decoder} · enkóder: <b>{r.encoder}</b> · arány {r.ratioOk ? "OK" : "ROSSZ"}
                  </div>
                  <div className="text-gray-600">
                    dekód {ms(r.timings.decode)} · rajz {ms(r.timings.draw)} · resize {ms(r.timings.resize)} ·
                    enkód {ms(r.timings.encode)} · <b>össz {ms(r.timings.total)}</b>
                  </div>
                  <a href={r.url} download={r.name.replace(/\.\w+$/, "") + ".webp"} className="underline">
                    Letöltés (.webp)
                  </a>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.url}
                  alt=""
                  className="max-h-48 w-full rounded object-contain"
                  style={{ background: "repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/16px 16px" }}
                />
              </div>
            ) : (
              <div className="mt-1 text-red-600">Hiba: {r.error}</div>
            )}
          </li>
        ))}
      </ul>

      {info && (
        <pre className="mt-6 whitespace-pre-wrap break-all rounded bg-gray-100 p-3 text-xs text-gray-600">
          {JSON.stringify(info, null, 2)}
        </pre>
      )}
    </main>
  );
}

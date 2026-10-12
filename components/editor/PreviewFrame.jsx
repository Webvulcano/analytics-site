"use client";

import { useEffect, useRef, useState } from "react";

// Mobile = iPhone 17 screen in CSS px (402×874 pt), shown whole. Desktop fills the height.
const DEVICES = {
  desktop: { w: 1280 },
  mobile: { w: 402, h: 874, radius: 40 },
};
const PAD = 20;

// The client website in an iframe, rendered at a virtual device width and scaled to fit.
export default function PreviewFrame({ src, device, frameRef, onLoad, hidden }) {
  const boxRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  const dev = DEVICES[device] ?? DEVICES.desktop;
  const vw = dev.w;
  const fitW = size.w ? (size.w - PAD * 2) / vw : 1;
  const fitH = size.h && dev.h ? (size.h - PAD * 2) / dev.h : Infinity;
  const scale = Math.max(0.1, Math.min(1, fitW, fitH));
  const frameH = dev.h ?? (size.h ? Math.max(400, (size.h - PAD * 2) / scale) : 800);

  return (
    <div
      ref={boxRef}
      className={`absolute inset-0 overflow-hidden ${hidden ? "pointer-events-none invisible" : ""}`}
      aria-hidden={hidden || undefined}
    >
      <div
        className="mx-auto overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/10"
        style={{
          width: vw * scale,
          height: frameH * scale,
          marginTop: PAD,
          ...(dev.radius && { borderRadius: dev.radius * scale }),
        }}
      >
        <iframe
          ref={frameRef}
          src={src}
          onLoad={onLoad}
          title="Weboldal előnézet"
          // No top-navigation / forms: the framed site can never take over the admin window.
          sandbox="allow-scripts allow-same-origin allow-popups"
          style={{
            width: vw,
            height: frameH,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </div>
  );
}

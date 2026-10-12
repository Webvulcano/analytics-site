"use client";

import { useCallback, useState } from "react";

export const PANEL_DEFAULT = 384;
const PANEL_MIN = 320;
const PANEL_MAX_RATIO = 0.6; // of the editor area
const STORAGE_KEY = "cms-editor-panel-width";

const clampWidth = (w, containerWidth) =>
  Math.round(Math.max(PANEL_MIN, Math.min(w, containerWidth * PANEL_MAX_RATIO)));

const readSaved = () => {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= PANEL_MIN ? saved : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT; // also on the server, where localStorage is undefined
  }
};

// Panel width shared by the right-hand panels, remembered in this browser.
// (The panels only mount after a click, so the server/client initial value can't mismatch.)
export function usePanelWidth() {
  const [width, setWidth] = useState(readSaved);

  const commit = useCallback((w) => {
    setWidth(w);
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {}
  }, []);

  return [width, setWidth, commit];
}

// Right-hand <aside> with a drag handle on its left edge (desktop only; full width on mobile).
export default function ResizableAside({ width, onResize, onResizeEnd, className = "", children }) {
  const [dragging, setDragging] = useState(false);

  const startDrag = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const aside = e.currentTarget.parentElement;
    const container = aside.parentElement.getBoundingClientRect();
    let last = width;

    const move = (ev) => {
      last = clampWidth(container.right - ev.clientX, container.width);
      onResize(last);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setDragging(false);
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    setDragging(true);
  };

  return (
    <aside
      style={{ "--panel-w": `${width}px` }}
      className={`relative w-full md:w-[var(--panel-w)] md:min-w-80 md:max-w-[60%] md:shrink-0 ${className}`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Panel szélességének állítása"
        title="Húzd a szélesség állításához (dupla kattintás: alapméret)"
        onPointerDown={startDrag}
        onDoubleClick={() => onResizeEnd(PANEL_DEFAULT)}
        className="group absolute inset-y-0 -left-1 z-20 hidden w-2 cursor-col-resize md:block"
      >
        <div
          className={`mx-auto h-full w-0.5 transition-colors ${
            dragging ? "bg-indigo-500" : "bg-transparent group-hover:bg-indigo-400"
          }`}
        />
      </div>
      {/* While dragging, cover the page so the preview iframe can't swallow pointer events. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
      {children}
    </aside>
  );
}

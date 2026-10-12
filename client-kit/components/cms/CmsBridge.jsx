"use client";

import { useEffect } from "react";
import { MSG } from "@/lib/cms-bridge-protocol";
import { sanitizeDoc } from "@/lib/cms-richtext";

// Visual editor bridge. Does nothing unless the site is framed by an allowed admin
// origin AND the admin answers the handshake — visitors are never affected.
const ALLOWED = (process.env.NEXT_PUBLIC_CMS_ADMIN_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const STYLE = `
html.cms-edit [data-cms] { cursor: pointer; }
html.cms-edit [data-cms]:hover { outline: 2px dashed #6366f1; outline-offset: 3px; }
html.cms-edit [data-cms].cms-selected { outline: 2px solid #6366f1; outline-offset: 3px; }
`;

function selector({ key, i, f }) {
  let s = `[data-cms="${CSS.escape(key)}"]`;
  if (i != null) s += `[data-cms-i="${CSS.escape(String(i))}"]`;
  if (f) s += `[data-cms-f="${CSS.escape(f)}"]`;
  return s;
}

// Tiptap JSON → DOM nodes, through the same allowlist as the server renderer.
// Built with createElement (never innerHTML), so previewed content cannot inject markup.
function docToNodes(value) {
  const build = (node) => {
    switch (node.type) {
      case "paragraph":
        return withChildren("p", node);
      case "heading":
        return withChildren(node.attrs?.level === 3 ? "h3" : "h2", node);
      case "bulletList":
        return withChildren("ul", node);
      case "orderedList":
        return withChildren("ol", node);
      case "listItem":
        return withChildren("li", node);
      case "hardBreak":
        return document.createElement("br");
      case "text": {
        let n = document.createTextNode(node.text);
        for (const m of node.marks ?? []) {
          const tag = m.type === "bold" ? "strong" : m.type === "italic" ? "em" : "a";
          const w = document.createElement(tag);
          if (tag === "a") {
            w.setAttribute("href", m.attrs.href);
            if (/^https?:\/\//i.test(m.attrs.href)) {
              w.target = "_blank";
              w.rel = "noopener noreferrer";
            }
          }
          w.appendChild(n);
          n = w;
        }
        return n;
      }
      default:
        return null;
    }
  };
  const withChildren = (tag, node) => {
    const el = document.createElement(tag);
    for (const child of node.content ?? []) {
      const c = build(child);
      if (c) el.appendChild(c);
    }
    return el;
  };
  return sanitizeDoc(value).content.map(build).filter(Boolean);
}

// Replace the text of a list element (<ul>/<ol>) line by line, reusing the first
// item as a template so icons and classes stay as the site renders them.
function applyLines(el, lines) {
  if (el.tagName !== "UL" && el.tagName !== "OL") {
    el.textContent = lines.join(" ");
    return;
  }
  const template = el.firstElementChild;
  const items = lines.map((line) => {
    if (!template) {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    }
    const li = template.cloneNode(true);
    const leaf = [...li.querySelectorAll("*")].reverse().find((n) => n.children.length === 0 && n.textContent.trim());
    (leaf ?? li).textContent = line;
    return li;
  });
  el.replaceChildren(...items);
}

// Swap the <img> inside an image slot wrapper. `value.blob` arrives from the admin via
// postMessage (a blob: URL of another origin would not load here); `value.src` is a URL.
function applyImage(el, value, objectUrls) {
  let src = null;
  if (value?.blob instanceof Blob && value.blob.type === "image/webp") {
    src = URL.createObjectURL(value.blob);
    objectUrls.push(src);
  } else if (typeof value?.src === "string" && /^https?:\/\//i.test(value.src)) {
    src = value.src;
  }
  if (!src) return;
  const imgs = el.tagName === "IMG" ? [el] : [...el.querySelectorAll("img")];
  for (const img of imgs) {
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.src = src;
  }
  for (const source of el.querySelectorAll("picture source")) source.remove();
}

function applyPreview(el, { kind, value }, objectUrls) {
  if (kind === "image") {
    applyImage(el, value, objectUrls);
  } else if (kind === "rich") {
    const root = el.matches("[data-cms-rich]") ? el : el.querySelector("[data-cms-rich]") ?? el;
    root.replaceChildren(...docToNodes(value));
  } else if (kind === "lines") {
    applyLines(
      el,
      String(value ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } else {
    el.textContent = String(value ?? "");
  }
}

export default function CmsBridge() {
  useEffect(() => {
    if (window.top === window.self || ALLOWED.length === 0) return;

    let adminOrigin = null;
    let mode = "edit";
    let selected = null;
    let styleEl = null;
    // Original markup of previewed elements (our own rendered DOM), for "Mégse".
    const originals = new Map();
    // blob: URLs of previewed images, freed on revert.
    const objectUrls = [];

    const send = (msg) => {
      if (adminOrigin) window.parent.postMessage(msg, adminOrigin);
    };

    const setMode = (next) => {
      mode = next === "navigate" ? "navigate" : "edit";
      document.documentElement.classList.toggle("cms-edit", mode === "edit");
    };

    const select = (el) => {
      selected?.classList.remove("cms-selected");
      selected = el;
      el?.classList.add("cms-selected");
    };

    const forKey = (key) => [...originals.keys()].filter((el) => el.getAttribute("data-cms") === key);

    const onMessage = (e) => {
      if (e.source !== window.parent || !ALLOWED.includes(e.origin)) return;
      const msg = e.data;
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === MSG.INIT) {
        adminOrigin = e.origin;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.textContent = STYLE;
          document.head.appendChild(styleEl);
        }
        setMode(msg.mode);
        send({ type: MSG.PATH, path: location.pathname });
        return;
      }
      if (!adminOrigin || e.origin !== adminOrigin) return;

      switch (msg.type) {
        case MSG.MODE:
          setMode(msg.mode);
          break;
        case MSG.RELOAD:
          location.reload();
          break;
        case MSG.SCROLL_TO: {
          if (typeof msg.key !== "string") break;
          const el = document.querySelector(selector(msg));
          el?.scrollIntoView({ block: "center", behavior: "smooth" });
          select(el);
          break;
        }
        case MSG.PREVIEW: {
          if (typeof msg.key !== "string") break;
          for (const el of document.querySelectorAll(selector(msg))) {
            if (!originals.has(el)) originals.set(el, el.innerHTML);
            applyPreview(el, msg, objectUrls);
          }
          break;
        }
        case MSG.REVERT:
          for (const el of forKey(msg.key)) {
            el.innerHTML = originals.get(el);
            originals.delete(el);
          }
          // Only abandoned previews are freed; committed images stay on screen.
          while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop());
          break;
        case MSG.COMMIT:
          for (const el of forKey(msg.key)) originals.delete(el);
          objectUrls.length = 0;
          break;
      }
    };

    // Capture phase: runs before the site's own handlers (sliders, accordions, links).
    const onClick = (e) => {
      if (!adminOrigin || mode !== "edit") return;
      const el = e.target instanceof Element ? e.target.closest("[data-cms]") : null;
      if (!el) {
        // Non-editable area: let buttons (e.g. accordion) work, but never navigate away.
        if (e.target instanceof Element && e.target.closest("a[href], form")) e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      select(el);
      const r = el.getBoundingClientRect();
      send({
        type: MSG.SELECT,
        key: el.getAttribute("data-cms"),
        i: el.hasAttribute("data-cms-i") ? Number(el.getAttribute("data-cms-i")) : null,
        f: el.getAttribute("data-cms-f"),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("click", onClick, true);
    for (const origin of ALLOWED) window.parent.postMessage({ type: MSG.HELLO }, origin);

    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", onClick, true);
      document.documentElement.classList.remove("cms-edit");
      styleEl?.remove();
    };
  }, []);

  return null;
}

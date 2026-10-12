// postMessage protocol between the admin editor (parent window) and CmsBridge
// (client website inside the iframe). Keep identical in admin and client-kit.
export const MSG = {
  HELLO: "cms:hello", // iframe → admin: bridge loaded
  INIT: "cms:init", // admin → iframe: { mode } start editing session
  MODE: "cms:mode", // admin → iframe: { mode: "edit" | "navigate" }
  SELECT: "cms:select", // iframe → admin: { key, i, f, rect }
  PATH: "cms:path", // iframe → admin: { path }
  PREVIEW: "cms:preview", // admin → iframe: { key, i?, f?, kind: "text"|"lines"|"rich"|"image", value } (image: { blob } | { src })
  REVERT: "cms:revert", // admin → iframe: { key } restore the page's original content
  COMMIT: "cms:commit", // admin → iframe: { key } saved → the previewed content is the new original
  RELOAD: "cms:reload", // admin → iframe
  SCROLL_TO: "cms:scrollTo", // admin → iframe: { key, i, f }
};

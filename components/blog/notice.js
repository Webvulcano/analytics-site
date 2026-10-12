// Status message after a blog action. published: true / false = the website was / was not refreshed;
// null = nothing public changed (e.g. a draft was saved), so no "visible on the website" promise.
export function blogNotice(res, okText) {
  if (!res.ok) return { type: "error", text: res.error };
  if (res.published === false) {
    return { type: "warn", text: `${okText} - de a weboldal frissítése nem sikerült (${res.publishError}).`, retry: true };
  }
  if (res.published) return { type: "ok", text: `${okText} ✓ Pár másodperc múlva a weboldalon is látszik.` };
  return { type: "ok", text: `${okText} ✓` };
}

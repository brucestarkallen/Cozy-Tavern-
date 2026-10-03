/* Cozy Tavern — engine/pagepatch.js (M575)
 * THE SHOWN VERSION, CHANGED IN ONE PLACE. A page that has versions (swipes) shows one of them; changing its words means
 * changing that version too, or the page and its versions disagree. The same seven lines were written out five times
 * (the brief's put-back, the marks mended, a mend, a mend let go, a mistaken mend put back). His order: no duplicates. */
export function shownTextPatch(page, text, extra = {}) {
  const patch = { ...extra, text };
  if (page && Array.isArray(page.swipes) && page.swipes.length) {
    const idx = Number.isFinite(page.swipeIdx) ? Math.min(page.swipes.length - 1, Math.max(0, page.swipeIdx)) : page.swipes.length - 1;
    const swipes = page.swipes.slice();
    swipes[idx] = { ...swipes[idx], text };
    patch.swipes = swipes;
  }
  return patch;
}

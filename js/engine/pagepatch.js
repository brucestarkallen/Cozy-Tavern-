/* Cozy Tavern — engine/pagepatch.js (M575)
 * THE SHOWN VERSION, CHANGED IN ONE PLACE. A page that has versions (swipes) shows one of them; changing its words means
 * changing that version too, or the page and its versions disagree. The same seven lines were written out five times
 * (the brief's put-back, the marks mended, a mend, a mend let go, a mistaken mend put back). His order: no duplicates. */
/* M576: WHICH VERSION A PAGE SHOWS — the one rule (the chosen one, kept inside the list; the newest when none is chosen;
 * 0 for a page with no versions). It had been written out eight times: the words the wire and the thread read (pageText),
 * the record's own copy of them, the choices' version, the shown-version change, and four checkpoint keys in chat.js. */
export function shownIndex(page) {
  const n = page && Array.isArray(page.swipes) ? page.swipes.length : 0;
  if (!n) return 0;
  return Number.isFinite(page.swipeIdx) ? Math.min(n - 1, Math.max(0, page.swipeIdx)) : n - 1;
}
/* the words a page shows: its shown version's, else its own text, else an imported page's content */
export function shownText(msg) {
  if (msg && Array.isArray(msg.swipes) && msg.swipes.length) {
    const swipe = msg.swipes[shownIndex(msg)];
    if (swipe && typeof swipe.text === 'string') return swipe.text;
  }
  return msg && typeof msg.text === 'string' ? msg.text : (msg && typeof msg.content === 'string' ? msg.content : '');
}
export function shownTextPatch(page, text, extra = {}) {
  const patch = { ...extra, text };
  if (page && Array.isArray(page.swipes) && page.swipes.length) {
    const idx = shownIndex(page);
    const swipes = page.swipes.slice();
    swipes[idx] = { ...swipes[idx], text };
    patch.swipes = swipes;
  }
  return patch;
}

/* M675 — WHICH "MENDS" ARE ONLY THE HOUSE TIDYING A PAGE. A page remembers its earlier words in `mended` — and three hands
 * write there: a reader that mended what the page SAYS (the second reader, the keeper, the continuous audit: `why` is
 * the contradiction), the landing finisher that took off marks or an echoed rule ("tidied — took off …"), and the
 * header's fill ("the header named only the area …"). "A page already mended is never mended again" is about the
 * first kind: a page the finisher had merely trimmed was passed over by the continuous audit for good, whatever it
 * said against the story. Pure. */
export function isHouseTidy(mended) {
  const why = mended && typeof mended === 'object' && typeof mended.why === 'string' ? mended.why : '';
  return /^tidied — took off /.test(why) || /^the header named only the area/.test(why);
}

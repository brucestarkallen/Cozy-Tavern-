/* Cozy Tavern — engine/pagecut.js
 * M259: A PAGE IS READ TO ITS END.
 *
 * Every worker cut the page it read at a fixed length from the FRONT — the
 * extractor, the world agent, the scribe and the second reader at 8,000
 * characters, the auditor at 5,000, the record keeper at 6,000 a page and
 * 24,000 a batch, the mender at 6,000 — and the writer's storyteller may
 * write a page several times that long. So the END of a long page, which is
 * where the scene now stands, was never read by the workers told to write it
 * down; the record never held it; and the mender, shown a page's first 6,000
 * characters and asked for "the complete page", handed back a page without
 * its ending.
 *
 * A page is read whole. Only a page past `cap` is shortened, and then from
 * the MIDDLE, never the end. No imports: the record keeper and the engine
 * both use it. */

export const PAGE_CAP = 60000;

/* M265: the room a connection has, in characters (about three a token, less
 * the answer's own budget) — here, with no imports, so the record keeper and
 * every worker measure it the same way. A connection with no size set is taken
 * at 128,000 tokens. */
export function roomChars(connection, maxTokens = 6000) {
  const size = connection && typeof connection.contextSize === 'number' && connection.contextSize > 0 ? connection.contextSize : 128000;
  return Math.max(30000, Math.floor((size - maxTokens - 2000) * 3));
}

export function wholePage(text, cap = PAGE_CAP) {
  const s = String(text || '');
  if (!Number.isFinite(cap) || cap <= 0 || s.length <= cap) return s;
  const head = Math.floor(cap * 0.35);
  const tail = cap - head;
  const gap = s.length - head - tail;
  return s.slice(0, head)
    + '\n[… ' + gap + ' characters from the middle of this page are not shown here; its end, below, is where the scene now stands …]\n'
    + s.slice(s.length - tail);
}

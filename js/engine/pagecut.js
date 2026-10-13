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
 * the MIDDLE, never the end. The record keeper and the engine both use it. */

import { workerRoom } from '../agents/call.js'; /* M752: a worker's room, measured as its call is refused */
export const PAGE_CAP = 60000;

/* M265: the room a connection has, in characters (about three a token, less
 * the answer's own budget), so the record keeper and every worker measure it
 * the same way. M285: a connection with no size set is taken at its
 * provider's (providers/room.js).
 * M752: MEASURED AS THE CALL IS REFUSED. It was (context − the asked answer − 2,000) × 3, while the provider adapters refuse
 * a body past budget.js refusalRoom: its wrappers counted, a 3,000 margin, and the answer room the call really carries —
 * raised to 16,000 for a worker whose connection thinks (call.js workerConnection; Kimi K3 always does). A look-up round
 * filled to its room was refused before sending on 64k and 128k connections (on a thinking 64k at 85% of it). One measure
 * now: call.js workerRoom, the same one the cast weighing and the planner size themselves by. */
export function roomChars(connection, maxTokens = 6000) {
  return Math.max(30000, workerRoom(connection && typeof connection === 'object' ? connection : {}, { maxTokens }));
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

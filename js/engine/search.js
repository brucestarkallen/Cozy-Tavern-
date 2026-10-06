/* Cozy Tavern — searching inside the tales (M622).
 *
 * His word: "a search section on the sidebar so I can search words inside the story, from the latest story to oldest".
 * One reading of a tale's pages, shared by the browser (the tales it holds) and mirrored by the device (serve.py
 * search_books, for the tales only the device holds — M313): his words and the story's, never a hidden page, never the
 * thinking; the phrase matched as typed, any case, across line breaks; the newest page first; a snippet around each
 * place with the match itself apart, so the screen can mark it. */
export const SEARCH_MIN = 2;      /* a single letter matches everything — two at least */
export const HITS_KEPT = 20;      /* places kept per tale; the count says how many there are in all */
const AROUND = 70;                /* characters of context either side of a match */

export function searchKey(q) { return String(q == null ? '' : q).replace(/\s+/g, ' ').trim().toLowerCase(); }

export function searchPages(pages, query, { kept = HITS_KEPT } = {}) {
  const key = searchKey(query);
  if (key.length < SEARCH_MIN) return { count: 0, hits: [] };
  const list = Array.isArray(pages) ? pages : [];
  const hits = [];
  let count = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.hidden === true || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const flat = String(typeof m.text === 'string' ? m.text : '').replace(/\s+/g, ' ');
    const at = flat.toLowerCase().indexOf(key);
    if (at < 0) continue;
    count += 1;
    if (hits.length >= kept) continue;
    const start = Math.max(0, at - AROUND);
    const end = Math.min(flat.length, at + key.length + AROUND);
    hits.push({
      id: m.id,
      role: m.role,
      before: (start > 0 ? '…' : '') + flat.slice(start, at),
      match: flat.slice(at, at + key.length),
      after: flat.slice(at + key.length, end) + (end < flat.length ? '…' : ''),
    });
  }
  return { count, hits };
}

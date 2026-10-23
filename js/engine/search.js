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

/* M768 — HIS: "The search function is very slow i can't search anything.. Especially all tales". Every search (every pause
 * in his typing) flattened and lower-cased every page of every tale again, and read every tale's whole rows — versions and
 * thinking too — into memory to do it. A tale's pages are made into an index once — each page's words in lower case only
 * (the shelf keeps one copy of its words, not the rows) — and a search only looks through the index; the few places shown
 * take their words from the page itself (dress). */
export const flatOf = (text) => String(typeof text === 'string' ? text : '').replace(/\s+/g, ' ');

export function indexPages(pages) {
  const out = [];
  for (const m of Array.isArray(pages) ? pages : []) {
    if (!m || m.hidden === true || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const low = flatOf(m.text).toLowerCase();
    if (low) out.push({ id: m.id, role: m.role, low });
  }
  return out;
}

/* the places in a tale's index, newest page first: how many there are, and the first `kept` of them (where each is) */
export function searchIndex(index, query, { kept = HITS_KEPT } = {}) {
  const key = searchKey(query);
  if (key.length < SEARCH_MIN) return { count: 0, hits: [] };
  const list = Array.isArray(index) ? index : [];
  const hits = [];
  let count = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const at = list[i].low.indexOf(key);
    if (at < 0) continue;
    count += 1;
    if (hits.length < kept) hits.push({ id: list[i].id, role: list[i].role, at });
  }
  return { count, hits };
}

/* a place's words, from its page's own text: the match apart, the words around it (null when the page no longer holds them) */
export function dress(hit, text, query) {
  const key = searchKey(query);
  const flat = flatOf(text);
  let at = Number.isInteger(hit.at) && flat.slice(hit.at, hit.at + key.length).toLowerCase() === key ? hit.at : flat.toLowerCase().indexOf(key);
  if (at < 0) return null; /* the page changed while it was searched: no place to show */
  const start = Math.max(0, at - AROUND);
  const end = Math.min(flat.length, at + key.length + AROUND);
  return {
    id: hit.id,
    role: hit.role,
    before: (start > 0 ? '…' : '') + flat.slice(start, at),
    match: flat.slice(at, at + key.length),
    after: flat.slice(at + key.length, end) + (end < flat.length ? '…' : ''),
  };
}

export function searchPages(pages, query, options = {}) {
  const r = searchIndex(indexPages(pages), query, options);
  const text = new Map((Array.isArray(pages) ? pages : []).map((m) => [m && m.id, m && m.text]));
  return { count: r.count, hits: r.hits.map((h) => dress(h, text.get(h.id), query)).filter(Boolean) };
}

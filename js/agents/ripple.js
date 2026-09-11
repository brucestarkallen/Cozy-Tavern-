/* Cozy Tavern — agents/ripple.js
 * M100: THE RIPPLE. An edit is a statement of truth — the writer's hand on a
 * page, or a housekeeper card that landed — and the rest of the story must
 * agree with it or the house has just written a contradiction. Nothing in
 * the chain did this for the writer's own edits, and the housekeeper's sweep
 * was a nudge the model could ignore. This is the law in code:
 *
 *   factChange(before, after) — what one edit changed, as {removed, added},
 *     when the change is one fact and not a rewrite (short, on one line).
 *   isNameLike(text) — a capitalized name or phrase: a person, a place.
 *   replaceWord(text, from, to) — a whole-word replacement, possessives kept.
 *   renameInState(state, from, to) — every key and field of the ledger.
 *
 * chat.js runs the ripple after an edit lands (rippleAfterEdit):
 *   - a NAME-LIKE change is applied in code everywhere the old name stands
 *     with word boundaries: the ledger (people.rename — journaled, undoable),
 *     the record's lines, the brief and the cast notes, and every other
 *     storyteller page in the story (each as a mend, with its take-back);
 *   - any other fact (a colour, an age, a place written in lowercase) goes
 *     to the mender with the change spelled out, page by page where the old
 *     words stand, and a [Correction] joins the record; the auditor relocks
 *     the canon on the next page.
 */

export function factChange(before, after) {
  const a = String(before || ''); const b = String(after || '');
  if (a === b) return null;
  /* the same word changed everywhere on the page ("Liara" → "Mirela", five
   * times) is ONE fact: token by token, every differing token is the same
   * pair, punctuation aside */
  const ta = a.split(/(\s+)/); const tb = b.split(/(\s+)/);
  if (ta.length === tb.length) {
    const strip = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/(?:’s|'s)$/u, '');
    let pair = null; let ok = true; let hits = 0;
    for (let i = 0; i < ta.length && ok; i += 1) {
      if (ta[i] === tb[i]) continue;
      const x = strip(ta[i]); const y = strip(tb[i]);
      if (!x || !y || ta[i].replace(x, '') !== tb[i].replace(y, '')) { ok = false; break; }
      if (!pair) pair = [x, y];
      else if (pair[0] !== x || pair[1] !== y) { ok = false; break; }
      hits += 1;
    }
    if (ok && pair && hits >= 1 && pair[0].toLowerCase() !== pair[1].toLowerCase()) return { removed: pair[0], added: pair[1] };
  }
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  /* widen to word boundaries so "Kim" → "Kris" is not "im" → "ris" */
  while (head > 0 && /[\p{L}\p{N}'’]/u.test(a[head - 1])) head -= 1;
  while (tail > 0 && /[\p{L}\p{N}'’]/u.test(a[a.length - tail])) tail -= 1;
  const removed = a.slice(head, a.length - tail).trim();
  const added = b.slice(head, b.length - tail).trim();
  if (!removed || !added) return null;
  if (removed.length > 48 || added.length > 48 || /\n/.test(removed) || /\n/.test(added)) return null; /* a rewrite, not a fact */
  if (removed.toLowerCase() === added.toLowerCase()) return null;
  return { removed, added };
}

export function isNameLike(text) {
  const t = String(text || '').trim();
  if (t.length < 2 || t.length > 40) return false;
  return /^\p{Lu}[\p{L}'’\-]*(?:\s+(?:\p{Lu}[\p{L}'’\-]*|of|on|the|de|van|von|da|di|del|la|le))*$/u.test(t);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function wordRe(from) { return new RegExp('(?<![\\p{L}\\p{N}])' + escapeRe(from) + '(?![\\p{L}\\p{N}])', 'gu'); }
export function hasWord(text, from) { return wordRe(from).test(String(text || '')); }
export function replaceWord(text, from, to) { return String(text || '').replace(wordRe(from), to); }

/* The ledger renamed, pure: keys and text fields alike. Returns the new state
 * and a count of what moved. */
export function renameInState(state, from, to) {
  const next = JSON.parse(JSON.stringify(state));
  let n = 0;
  const same = (k) => String(k || '').trim().toLowerCase() === String(from).trim().toLowerCase();
  const rekey = (map) => {
    if (!map || typeof map !== 'object') return map;
    const out = {};
    for (const [k, v] of Object.entries(map)) {
      if (same(k)) { out[to] = v; n += 1; } else out[k] = v;
    }
    return out;
  };
  next.characters = rekey(next.characters);
  next.offscreen = rekey(next.offscreen);
  next.relationships = rekey(next.relationships);
  next.knowledge = rekey(next.knowledge);
  next.canon = rekey(next.canon);
  next.bodies = rekey(next.bodies);
  if (next.sheet && same(next.sheet.playerName)) { next.sheet.playerName = to; n += 1; }
  for (const p of (next.present || [])) if (p && same(p.name)) { p.name = to; n += 1; }
  for (const t of (next.threads || [])) {
    if (!t || typeof t !== 'object') continue;
    if (same(t.owner)) { t.owner = to; n += 1; }
    if (typeof t.title === 'string' && hasWord(t.title, from)) { t.title = replaceWord(t.title, from, to); n += 1; }
    if (typeof t.next === 'string' && hasWord(t.next, from)) { t.next = replaceWord(t.next, from, to); n += 1; }
  }
  for (const c of Object.values(next.characters || {})) {
    if (!c || typeof c !== 'object') continue;
    for (const k of ['core', 'state', 'arc']) if (typeof c[k] === 'string' && hasWord(c[k], from)) { c[k] = replaceWord(c[k], from, to); n += 1; }
    if (Array.isArray(c.threads)) c.threads = c.threads.map((t) => (typeof t === 'string' && hasWord(t, from) ? (n += 1, replaceWord(t, from, to)) : t));
  }
  for (const list of Object.values(next.knowledge || {})) {
    if (!Array.isArray(list)) continue;
    for (const k of list) if (k && typeof k.fact === 'string' && hasWord(k.fact, from)) { k.fact = replaceWord(k.fact, from, to); n += 1; }
  }
  for (const c of Object.values(next.canon || {})) {
    if (!c || !Array.isArray(c.facts)) continue;
    for (const f of c.facts) if (f && typeof f.value === 'string' && hasWord(f.value, from)) { f.value = replaceWord(f.value, from, to); n += 1; }
  }
  for (const s of Object.values(next.offscreen || {})) {
    if (!s || typeof s !== 'object') continue;
    for (const k of ['location', 'activity', 'agenda']) if (typeof s[k] === 'string' && hasWord(s[k], from)) { s[k] = replaceWord(s[k], from, to); n += 1; }
  }
  for (const f of Object.values(next.factions || {})) {
    if (!f || typeof f !== 'object') continue;
    for (const k of ['stance', 'agenda', 'move']) if (typeof f[k] === 'string' && hasWord(f[k], from)) { f[k] = replaceWord(f[k], from, to); n += 1; }
  }
  return { state: next, count: n };
}

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

import { sameFact } from '../engine/world.js'; /* M163: the same fact in different clothes */

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
/* M163: A RENAME ONTO A NAME THE LEDGER ALREADY HOLDS MERGES THE TWO.
 * rekey wrote `out[to] = v` flat, so renaming Mirela to Mira — the commonest
 * ripple there is, a writer fixing a name the extractor misheard — silently
 * threw away the REAL Mira: her page, her standing, her open wound and
 * everything she knew, replaced by the typo's thin entry. Measured before
 * this fix: core, arc, a p+40 standing, a split lip and one known fact, all
 * gone in one edit, with only the take-back to notice it by. Nothing is lost
 * now — where the two disagree the standing entry keeps its word, and where
 * it is silent the other speaks. */
function mergeEntry(kind, held, coming) {
  if (!held || typeof held !== 'object') return coming;
  if (!coming || typeof coming !== 'object') return held;
  const firstOf = (a, b) => (String(a || '').trim() ? a : b);
  if (kind === 'characters') {
    const threads = [];
    for (const t of [...(held.threads || []), ...(coming.threads || [])]) {
      if (typeof t === 'string' && t.trim() && !threads.some((x) => x.trim().toLowerCase() === t.trim().toLowerCase())) threads.push(t);
    }
    return {
      ...coming, ...held,
      core: firstOf(held.core, coming.core),
      state: firstOf(held.state, coming.state),
      arc: firstOf(held.arc, coming.arc),
      threads: threads.slice(0, 8),
      updatedAtTurn: Math.max(Number(held.updatedAtTurn) || 0, Number(coming.updatedAtTurn) || 0),
    };
  }
  if (kind === 'relationships') {
    const pick = (a, b) => (Math.abs(Number(a) || 0) >= Math.abs(Number(b) || 0) ? (Number(a) || 0) : (Number(b) || 0));
    const history = [...(held.history || []), ...(coming.history || [])]
      .filter((h) => h && typeof h === 'object')
      .sort((x, y) => (Number(x.atMinutes) || 0) - (Number(y.atMinutes) || 0));
    return { ...coming, ...held, p: pick(held.p, coming.p), r: pick(held.r, coming.r), s: pick(held.s, coming.s), history: history.slice(-30) };
  }
  if (kind === 'bodies') {
    return {
      ...coming, ...held,
      injuries: [...(held.injuries || []), ...(coming.injuries || [])],
      strain: [...(held.strain || []), ...(coming.strain || [])].slice(-12),
    };
  }
  if (kind === 'canon') {
    const facts = [...(held.facts || [])];
    for (const f of (coming.facts || [])) {
      if (!f || typeof f.key !== 'string') continue;
      if (!facts.some((x) => x && String(x.key).trim().toLowerCase() === f.key.trim().toLowerCase())) facts.push(f);
    }
    return { ...coming, ...held, facts };
  }
  if (kind === 'offscreen') return String(held.location || held.activity || '').trim() ? held : coming;
  if (kind === 'knowledge') {
    const out = Array.isArray(held) ? held.slice() : [];
    for (const k of (Array.isArray(coming) ? coming : [])) {
      if (!k || typeof k.fact !== 'string') continue;
      if (!out.some((x) => x && sameFact(x.fact, k.fact))) out.push(k);
    }
    return out.slice(-12);
  }
  return { ...coming, ...held };
}

export function renameInState(state, from, to) {
  const next = JSON.parse(JSON.stringify(state));
  let n = 0;
  const same = (k) => String(k || '').trim().toLowerCase() === String(from).trim().toLowerCase();
  const isTo = (k) => String(k || '').trim().toLowerCase() === String(to).trim().toLowerCase();
  const rekey = (map, kind) => {
    if (!map || typeof map !== 'object') return map;
    const out = {};
    let moved;
    let found = false;
    for (const [k, v] of Object.entries(map)) {
      if (same(k)) { moved = v; found = true; n += 1; continue; }
      out[k] = v;
    }
    if (!found) return out;
    const at = Object.keys(out).find(isTo);
    out[at || to] = at ? mergeEntry(kind, out[at], moved) : moved;
    return out;
  };
  next.characters = rekey(next.characters, 'characters');
  next.offscreen = rekey(next.offscreen, 'offscreen');
  next.relationships = rekey(next.relationships, 'relationships');
  next.knowledge = rekey(next.knowledge, 'knowledge');
  next.canon = rekey(next.canon, 'canon');
  next.bodies = rekey(next.bodies, 'bodies');
  if (next.sheet && same(next.sheet.playerName)) { next.sheet.playerName = to; n += 1; }
  for (const p of (next.present || [])) if (p && same(p.name)) { p.name = to; n += 1; }
  /* M163: and the scene never seats the same person twice after a merge. */
  if (Array.isArray(next.present)) {
    const seen = new Set();
    next.present = next.present.filter((p) => {
      const key = String((p && p.name) || '').trim().toLowerCase();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
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


/* M330: THE BRIEF OUTRANKS A VALUE SOMEBODY CHANGED ON A PAGE.
 * The writer's brief said Jovan is 16. The housekeeper (its cards land by themselves unless that is unticked)
 * changed "sixteen" to "seventeen" on one page — and the ripple, which exists to make ONE changed fact true
 * everywhere, never looked at the brief: it sent the mender through the other pages and wrote into the record
 * "[Correction] 'sixteen' is now 'seventeen' (the housekeeper's edit); what said otherwise before is in error" —
 * a line with no subject, read on every later turn, which the storyteller took for Jovan's age and set above
 * the brief ("the ledger is canon over the brief per the correction mechanics").
 * A value the brief or the cast notes state — in words or in figures — and whose replacement they do not, is
 * the writer's own canon: a change away from it is not rippled. */
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWord(n) {
  if (n < 20) return SMALL[n];
  const t = TENS[Math.floor(n / 10)]; const u = n % 10;
  return u ? t + '-' + SMALL[u] : t;
}
/* every way the same value is written: "sixteen" ↔ "16", "twenty-one" ↔ "twenty one" ↔ "21" */
export function valueForms(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return [];
  const forms = new Set([v]);
  if (/^\d{1,2}$/.test(v)) { const w = numberWord(Number(v)); forms.add(w); forms.add(w.replace('-', ' ')); }
  else {
    const plain = v.replace(/\s+/g, '-');
    for (let n = 0; n < 100; n += 1) if (numberWord(n) === plain) { forms.add(String(n)); forms.add(numberWord(n)); forms.add(numberWord(n).replace('-', ' ')); }
  }
  return [...forms];
}
const holds = (text, value) => valueForms(value).some((f) => new RegExp('(^|[^\\p{L}\\p{N}])' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'iu').test(String(text || '')));
/* true when what the writer set down holds the OLD value and not the new one */
export function againstTheBrief(written, removed, added) {
  const text = Array.isArray(written) ? written.filter(Boolean).join('\n') : String(written || '');
  if (!text.trim()) return false;
  return holds(text, removed) && !holds(text, added);
}

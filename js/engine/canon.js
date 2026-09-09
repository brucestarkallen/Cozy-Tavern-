/* Cozy Tavern — engine/canon.js
 * The canon store: what's true of them. Per character, a small shelf of
 * locked facts — "hair: black", "eyes: grey", "a limp from the war" — things
 * the story has decided are simply so. Hand-editable in the ledger drawer,
 * seedable by mutation (apply.js v3: canon.lock / canon.unlock), and the
 * source the continuity check reads each finished page against.
 *
 * Contract (SPEC.md M6):
 *   state.canon = { [name]: {facts:[{key, value, atMinutes}]} }
 *   lockFact(canon, name, {key, value}, m)   — m = the story clock's minutes
 *   unlockFact(canon, name, key)
 *   renderCanon(canon, presentNames)         — present characters' facts
 *                                              only, compact
 *
 * Pure functions in the ledger house style: fresh copies out, never a
 * mutation in place. Matching is case-insensitive (on the name AND on the
 * fact's key); the casing already written down wins. renderCanon output
 * joins the state-of-things slot and counts toward its 1600-char budget —
 * it sheds after the body ledger when words run long (see state.js).
 */

/* A fact's key and value are free text, but capped short — canon is a shelf
 * of certainties, not a biography, and no single entry may blow the render
 * budget. (The applier caps again on the way in; the caps here keep direct
 * callers honest too.) */
const KEY_CAP = 40;
const VALUE_CAP = 140;
const FACTS_SHOWN = 6; // per character, in the compact render

function clean(text, cap) {
  if (typeof text !== 'string') return '';
  const tidied = text.trim().replace(/\s+/g, ' ');
  return tidied.length > cap ? tidied.slice(0, cap - 1).trimEnd() + '…' : tidied;
}

function clone(canon) {
  if (!canon || typeof canon !== 'object') return {};
  try { return JSON.parse(JSON.stringify(canon)); } catch (err) { return {}; }
}

/* Find the character's key as actually written, case-insensitively. */
export function findCanonKey(canon, name) {
  if (!canon || typeof canon !== 'object' || typeof name !== 'string') return null;
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  for (const key of Object.keys(canon)) {
    if (key.trim().toLowerCase() === wanted) return key;
  }
  return null;
}

/* Find a fact on a character, by key, case-insensitively. Returns
 * {entry, index} or null. */
export function findFact(entry, key) {
  if (!entry || !Array.isArray(entry.facts) || typeof key !== 'string') return null;
  const wanted = key.trim().toLowerCase();
  if (!wanted) return null;
  const index = entry.facts.findIndex(
    (f) => f && typeof f.key === 'string' && f.key.trim().toLowerCase() === wanted
  );
  return index === -1 ? null : { entry: entry.facts[index], index };
}

/* Write a certainty down (or rewrite it — a key already held is updated,
 * not duplicated). Returns a fresh canon map. */
export function lockFact(canon, name, fact, m) {
  const next = clone(canon);
  const who = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  const key = clean(fact && fact.key, KEY_CAP);
  const value = clean(fact && fact.value, VALUE_CAP);
  if (!who || !key || !value) return next;
  const clockMinutes = Number.isFinite(m) ? m : null;
  const found = findCanonKey(next, who);
  const canonKey = found || who;
  if (!found) next[canonKey] = { facts: [] };
  const entry = next[canonKey];
  if (!Array.isArray(entry.facts)) entry.facts = [];
  const held = findFact(entry, key);
  if (held) {
    entry.facts[held.index] = { ...held.entry, key: held.entry.key, value, atMinutes: clockMinutes };
  } else {
    entry.facts.push({ key, value, atMinutes: clockMinutes });
  }
  return next;
}

/* Let a certainty go. Returns a fresh canon map; a character with no facts
 * left keeps no empty shelf. */
export function unlockFact(canon, name, key) {
  const next = clone(canon);
  const canonKey = findCanonKey(next, name);
  if (!canonKey) return next;
  const entry = next[canonKey];
  const held = findFact(entry, key);
  if (!held) return next;
  entry.facts.splice(held.index, 1);
  if (!entry.facts.length) delete next[canonKey];
  return next;
}

/* The compact render: present characters only, one line each —
 * "Mara — hair: black; eyes: grey." Returns '' when no one present carries
 * a locked fact, so the state-of-things slot can omit the section. */
export function renderCanon(canon, presentNames) {
  if (!canon || typeof canon !== 'object') return '';
  const names = Array.isArray(presentNames) ? presentNames : [];
  const lines = [];
  for (const raw of names) {
    const who = typeof raw === 'string' ? raw.trim() : '';
    if (!who) continue;
    const canonKey = findCanonKey(canon, who);
    if (!canonKey) continue;
    const facts = Array.isArray(canon[canonKey].facts) ? canon[canonKey].facts : [];
    const shown = facts
      .filter((f) => f && typeof f.key === 'string' && typeof f.value === 'string' && f.key.trim() && f.value.trim())
      .slice(0, FACTS_SHOWN)
      .map((f) => f.key.trim() + ': ' + f.value.trim());
    if (shown.length) lines.push(canonKey + ' — ' + shown.join('; ') + '.');
  }
  return lines.join('\n');
}

/* Cozy Tavern — engine/relationships.js
 * The relationship ledger. For each named soul who shares pages with the
 * main character, three numbers say how they stand: P (platonic warmth),
 * R (romantic pull), S (sensual charge) — each from -100 to 100, moving only
 * on what happens on-page, and only toward the MC.
 *
 * Contract (SPEC.md M4):
 *   state.relationships = { [name]: {p, r, s,
 *                             history:[{atMinutes, axis, delta, cause}]} }
 *   shift(relationships, name, {axis, delta, cause}, clockMinutes) -> copy
 *   renderRelationships(relationships)
 *     // "Samantha — warm (P+40), drawn (R+15)"; zero/zero/zero = omit line
 *
 * The laws of this ledger:
 *   - Axis lock: NPC → MC only. There is no NPC↔NPC axis anywhere in the
 *     vocabulary, so no such standing can ever be written.
 *   - Zero-init: no entry exists until the first caused shift (a hand-seeded
 *     rel.set counts — the drawer always asks for a cause).
 *   - Every shift needs a cause in words, quoting the beat that earned it;
 *     the applier rejects any that arrives without one.
 *   - Per-event delta clamps to [-20..+20]; totals clamp to [-100..100].
 *
 * Pure functions: fresh copies out. apply.js validates and logs.
 */

export const AXES = ['p', 'r', 's'];
export const MAX_DELTA = 20;   // the most a single on-page beat can move
export const MAX_TOTAL = 100;  // the ends of the scale

const HISTORY_KEPT = 30;

/* Plain words for a standing on each axis — strongest first. */
const AXIS_WORDS = {
  p: [
    [60, 'devoted'], [25, 'warm'], [5, 'friendly'],
    [-5, ''], [-25, 'wary'], [-60, 'cold'], [-Infinity, 'bitter'],
  ],
  r: [
    [60, 'smitten'], [25, 'drawn'], [5, 'a spark'],
    [-5, ''], [-25, 'distant'], [-60, 'guarded'], [-Infinity, 'closed off'],
  ],
  s: [
    [60, 'burning'], [25, 'wanting'], [5, 'a charge'],
    [-5, ''], [-25, 'cool'], [-60, 'put off'], [-Infinity, 'repelled'],
  ],
};

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function clampTotal(n) {
  return Math.min(MAX_TOTAL, Math.max(-MAX_TOTAL, Math.round(n)));
}

function copyRelationships(relationships) {
  const safe = relationships && typeof relationships === 'object' ? relationships : {};
  const out = {};
  for (const [name, rel] of Object.entries(safe)) {
    if (!rel || typeof rel !== 'object') continue;
    out[name] = {
      ...rel,
      p: Number.isFinite(rel.p) ? rel.p : 0,
      r: Number.isFinite(rel.r) ? rel.r : 0,
      s: Number.isFinite(rel.s) ? rel.s : 0,
      history: Array.isArray(rel.history) ? rel.history.map((h) => ({ ...h })) : [],
    };
  }
  return out;
}

export function findRelationship(relationships, name) {
  const wanted = cleanText(name).toLowerCase();
  if (!wanted) return null;
  const safe = relationships && typeof relationships === 'object' ? relationships : {};
  const key = Object.keys(safe).find((k) => k.trim().toLowerCase() === wanted);
  return key ? { key, rel: safe[key] } : null;
}

/* ---------- the contract ---------- */

/* Move one axis by a caused delta. Validation lives in apply.js; here the
 * clamps are simply how the ledger holds its shape. Zero-init: the entry
 * comes into being with this shift, starting from zero. */
export function shift(relationships, name, { axis, delta, cause } = {}, clockMinutes) {
  const next = copyRelationships(relationships);
  const who = cleanText(name);
  if (!who || !AXES.includes(axis)) return next;
  const found = findRelationship(next, who);
  const key = found ? found.key : who;
  if (!found) next[key] = { p: 0, r: 0, s: 0, history: [] };
  const rel = next[key];
  const amount = Math.min(MAX_DELTA, Math.max(-MAX_DELTA, Math.round(Number(delta) || 0)));
  rel[axis] = clampTotal((rel[axis] || 0) + amount);
  if (amount !== 0) {
    rel.history.push({
      atMinutes: Number.isFinite(clockMinutes) ? Math.round(clockMinutes) : null,
      axis,
      delta: amount,
      cause: cleanText(cause),
    });
    if (rel.history.length > HISTORY_KEPT) {
      rel.history = rel.history.slice(rel.history.length - HISTORY_KEPT);
    }
  }
  return next;
}

/* Words for a single axis value: "warm (P+40)". '' at zero — a zero axis
 * says nothing. */
export function axisWords(axis, value) {
  const v = Math.round(Number(value) || 0);
  if (v === 0) return '';
  const ladder = AXIS_WORDS[axis] || [];
  let word = '';
  for (const [floor, words] of ladder) {
    if (v >= floor) { word = words; break; }
  }
  const signed = (v > 0 ? '+' : '') + v;
  return word
    ? word + ' (' + axis.toUpperCase() + signed + ')'
    : axis.toUpperCase() + signed;
}

/* One line per soul with any nonzero standing:
 * "Samantha — warm (P+40), drawn (R+15)". All-zero entries say nothing. */
export function renderRelationships(relationships) {
  const safe = relationships && typeof relationships === 'object' ? relationships : {};
  const lines = [];
  for (const [name, rel] of Object.entries(safe)) {
    if (!rel || typeof rel !== 'object') continue;
    const parts = AXES.map((axis) => axisWords(axis, rel[axis])).filter(Boolean);
    if (parts.length) lines.push(name + ' — ' + parts.join(', '));
  }
  return lines.join('\n');
}

/* The drawer's history line: how the standing has been moving, with the last
 * cause in plain words — "grew warmer after the chapel". '' when there's
 * nothing to say. */
export function historyWords(rel) {
  if (!rel || !Array.isArray(rel.history) || !rel.history.length) return '';
  const last = rel.history[rel.history.length - 1];
  if (!last || !last.cause) return '';
  const axis = AXES.includes(last.axis) ? last.axis : 'p';
  const grew = last.delta >= 0;
  const verb = { p: grew ? 'grew warmer' : 'cooled',
                 r: grew ? 'drew closer' : 'stepped back',
                 s: grew ? 'kindled' : 'banked' }[axis];
  return verb + ' after ' + last.cause.replace(/\.+$/, '');
}

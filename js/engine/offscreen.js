/* Cozy Tavern — engine/offscreen.js
 * The off-screen world. Where the named souls who have stepped out of the
 * scene have gone, what they're doing there, and what they're meaning to do
 * next — so the world keeps breathing while the page looks elsewhere.
 *
 * Contract (SPEC.md M4):
 *   state.offscreen = { [name]: {location, activity, agenda?, sinceMinutes} }
 *   seat(offscreen, name, {location, activity, agenda}, clockMinutes) -> copy
 *   unseat(offscreen, name)                                          -> copy
 *   renderOffscreen(offscreen, present)  // top 6 by recency; skips anyone
 *                                        // present
 *
 * Two laws of the door:
 *   - presence.leave does NOT auto-seat — only an explicit offscreen.set
 *     (proposed by the extractor, or placed by hand) writes down where
 *     someone went. The prose has to say.
 *   - presence.enter auto-unseats: walk back into the scene and the
 *     elsewhere-note lets go of you (apply.js wires this, and its undo
 *     puts the seat back).
 *
 * Entries carry an additive atTurn (the log's length when seated, like M3's
 * undo payload) so "recency" stays true even when the story clock isn't set.
 * Pure functions: fresh copies out.
 */

import { renderArrival } from './world.js'; /* M29: stance and arrival on the clock */

const RENDER_TOP = 6;

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function copyOffscreen(offscreen) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  const out = {};
  for (const [name, entry] of Object.entries(safe)) {
    if (!entry || typeof entry !== 'object') continue;
    out[name] = { ...entry };
  }
  return out;
}

/* ---------- the contract ---------- */

export function seat(offscreen, name, { location, activity, agenda, stance, etaMinutes } = {}, clockMinutes, atTurn) {
  const next = copyOffscreen(offscreen);
  const who = cleanText(name);
  if (!who) return next;
  const found = findSeat(next, who); // casing already written wins
  const entry = {
    location: cleanText(location),
    activity: cleanText(activity),
    sinceMinutes: Number.isFinite(clockMinutes) ? Math.round(clockMinutes) : null,
    atTurn: Number.isFinite(atTurn) ? atTurn : null,
  };
  const what = cleanText(agenda);
  if (what) entry.agenda = what;
  /* M29: a stance toward the main character, and an arrival on the clock.
   * etaMinutes is "from now"; with a clock set it becomes an absolute
   * arrivesAtMinutes (so the clock moving forward makes them nearer, never
   * the seat re-written); without one the relative figure is kept. */
  const st = cleanText(stance).toLowerCase();
  if (st) entry.stance = st;
  const eta = Number(etaMinutes);
  if (Number.isFinite(eta) && eta >= 0) {
    if (Number.isFinite(clockMinutes)) entry.arrivesAtMinutes = Math.round(clockMinutes + eta);
    else entry.etaMinutes = Math.round(eta);
  }
  next[found ? found.key : who] = entry;
  return next;
}

export function unseat(offscreen, name) {
  const next = copyOffscreen(offscreen);
  const wanted = cleanText(name).toLowerCase();
  const key = Object.keys(next).find((k) => k.trim().toLowerCase() === wanted);
  if (key) delete next[key];
  return next;
}

/* Find a seat by name, case-insensitive. Returns {key, entry} | null. */
export function findSeat(offscreen, name) {
  const wanted = cleanText(name).toLowerCase();
  if (!wanted) return null;
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  const key = Object.keys(safe).find((k) => k.trim().toLowerCase() === wanted);
  return key ? { key, entry: safe[key] } : null;
}

/* Recency: the turn the seat was written is the truest ordering (the log
 * only ever grows); clock minutes stand in for older entries. */
function recencyKey(entry) {
  if (Number.isFinite(entry.atTurn)) return entry.atTurn;
  if (Number.isFinite(entry.sinceMinutes)) return entry.sinceMinutes;
  return -Infinity;
}

function seatWords(name, entry, clockMinutes) {
  const parts = [];
  if (cleanText(entry.location)) parts.push(cleanText(entry.location));
  if (cleanText(entry.activity)) parts.push(cleanText(entry.activity));
  let line = name + ' — ' + (parts.join(', ') || 'somewhere out of sight');
  if (cleanText(entry.agenda)) line += ' (meaning to ' + cleanText(entry.agenda).replace(/\.+$/, '') + ')';
  const approach = renderArrival(entry, clockMinutes);
  if (approach) line += ' — ' + approach;
  return line;
}

/* The six most recently seated who are NOT in the scene right now.
 * `present` is state.present ([{name}] — plain strings tolerated). */
export function renderOffscreen(offscreen, present, clockMinutes, top = RENDER_TOP) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  const here = new Set(
    (Array.isArray(present) ? present : [])
      .map((p) => cleanText(typeof p === 'string' ? p : p && p.name).toLowerCase())
      .filter(Boolean)
  );
  const rows = [];
  for (const [name, entry] of Object.entries(safe)) {
    if (!entry || typeof entry !== 'object') continue;
    if (here.has(name.trim().toLowerCase())) continue; // they're in the scene
    rows.push({ line: seatWords(name, entry, clockMinutes), recency: recencyKey(entry), rank: stanceRank(entry, clockMinutes) });
  }
  /* M86: the writer's ACW rotation, not recency alone — whoever is moving
   * toward the main character (nearest arrival first) outranks whoever is
   * searching, who outranks unresolved tension, then the busy, then the
   * waiting; recency breaks ties. The storyteller's six lines are the six
   * that can reach the scene, never the six most recently written. */
  rows.sort((a, b) => (a.rank - b.rank) || (b.recency - a.recency));
  return rows.slice(0, top).map((r) => r.line).join('\n');
}

/* Lower is nearer the scene. `toward` and `seeking` carry their arrival: due
 * or overdue first, then by how soon; a stance with no clock sits behind
 * one with a clock. */
function stanceRank(entry, clockMinutes) {
  const st = typeof entry.stance === 'string' ? entry.stance : '';
  const base = st === 'toward' ? 0 : st === 'seeking' ? 100 : st === 'tense' ? 200 : st === 'busy' ? 300 : st === 'waiting' ? 400 : 500;
  if (st === 'toward' || st === 'seeking') {
    if (Number.isFinite(entry.arrivesAtMinutes) && Number.isFinite(clockMinutes)) {
      const left = entry.arrivesAtMinutes - clockMinutes;
      /* due or overdue = 0; then every five minutes a step, capped */
      return base + Math.min(99, Math.max(0, Math.ceil(left / 5)));
    }
    return base + 99;
  }
  return base;
}

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
 *
 * M304: SOMEONE WHO LEAVES THE PAGE IS NEVER NOWHERE. Walking into the scene
 * lets a seat go, and walking out wrote nothing — so everyone the main
 * character had recently been WITH was the one group the world held no
 * whereabouts for, and "What's happening elsewhere" thinned to whoever a
 * worker had happened to seat that page. presence.leave (engine/apply.js) now
 * keeps the one thing the ledger knows for certain — where they were last
 * seen, and when — as a seat marked `lastSeen`. It invents nothing: it reads
 * "last seen at the Bluebird (as of 40 minutes ago)", and the world agent,
 * shown exactly those words, moves them on by the clock. A seat the prose or
 * the world agent writes replaces it whole.
 */

import { renderArrival } from './world.js'; /* M29: stance and arrival on the clock */
import { samePersonName, isHere } from './names.js'; /* M396: one answer to "the same person?" */

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

export function seat(offscreen, name, { location, activity, agenda, stance, etaMinutes, lastSeen } = {}, clockMinutes, atTurn) {
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
  if (lastSeen === true) entry.lastSeen = true; /* M304: the house's own bookkeeping, not a worker's word */
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
/* M320: ONE PERSON, ONE NAME, IN EVERY BOOK. A seat was found by its EXACT name and written under whatever
 * name a worker used — while the people's pages have known since M238 that "Vanessa" IS "Vanessa Reynolds"
 * (findPersonKey: a first or last name, a name cut short, a slip of spelling — and only when exactly one
 * person answers). So the world agent seated "Rias" while her page stood as "Rias Gremory", and the two
 * never met: "What's happening elsewhere" said where she was this hour; her page in "The people" read
 * "Last seen 14 pages ago", her card told the storyteller nothing of her seat, and the world agent was
 * told she had NO SEAT and wrote another. The seat is found the way a page is. The resolver is handed in
 * by engine/people.js (which already reads this file — no circle of imports). */
let nearName = null;
export function setSeatResolver(fn) { nearName = typeof fn === 'function' ? fn : null; }
export function findSeat(offscreen, name) {
  const wanted = cleanText(name).toLowerCase();
  if (!wanted) return null;
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  let key = Object.keys(safe).find((k) => k.trim().toLowerCase() === wanted);
  /* M396: the same person under another form of the name (folded letters, a first name, canon's other name) — only
   * when exactly one seat answers */
  if (!key) { const hits = Object.keys(safe).filter((k) => samePersonName(k, name)); if (hits.length === 1) key = hits[0]; }
  if (!key && nearName) { try { key = nearName(safe, cleanText(name)) || undefined; } catch (err) { key = undefined; } }
  return key ? { key, entry: safe[key] } : null;
}

/* Recency: the turn the seat was written is the truest ordering (the log
 * only ever grows); clock minutes stand in for older entries. */
function recencyKey(entry) {
  if (Number.isFinite(entry.atTurn)) return entry.atTurn;
  if (Number.isFinite(entry.sinceMinutes)) return entry.sinceMinutes;
  return -Infinity;
}

/* M300: A SEAT SAYS HOW OLD IT IS. A seat is written with the story clock
 * (sinceMinutes) and then stood as "now" for as long as nobody re-seated its
 * person — "the Bluebird, closing up" at two the next afternoon, read as the
 * present by the storyteller, the world agent and the drawer alike. Past
 * half an hour of story time the seat says its age; past three hours it says
 * the person has likely moved on — so the storyteller does not write them
 * where they were, and the world agent, shown the same words, re-seats them. */
export function seatAgeWords(entry, clockMinutes) {
  if (!entry || !Number.isFinite(entry.sinceMinutes) || !Number.isFinite(clockMinutes)) return '';
  const ago = Math.round(clockMinutes - entry.sinceMinutes);
  if (ago < 30) return '';
  const span = ago < 60 ? ago + ' minutes'
    : ago < 24 * 60 ? 'about ' + Math.round(ago / 60) + (Math.round(ago / 60) === 1 ? ' hour' : ' hours')
      : Math.round(ago / (24 * 60)) + (Math.round(ago / (24 * 60)) === 1 ? ' day' : ' days');
  return 'as of ' + span + ' ago' + (ago >= 180 ? '; likely elsewhere by now' : '');
}

/* M304: one line for a seat, wherever it is read — the storyteller's state of
 * things, the world agent's list, the drawer. (The drawer had its own copy of
 * these words and never learned to say a seat's age.) */
export function seatLine(name, entry, clockMinutes) { return seatWords(name, entry || {}, clockMinutes); }

/* where and what, as one reads it of a person: "the Bluebird, closing up",
 * or — for the house's own sighting — "last seen at the Bluebird"; then the
 * want, the approach and the age, each when asked for and when there is one. */
export function seatNowWords(entry, clockMinutes, { agenda = false, arrival = false } = {}) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const where = cleanText(e.location);
  const what = cleanText(e.activity);
  let words = e.lastSeen === true
    ? 'last seen ' + (where ? 'at ' + where.replace(/^(at|in|on)\s+/i, '') : 'where the scene stood') + (what ? ', ' + what : '')
    : ([where, what].filter(Boolean).join(', ') || 'somewhere out of sight');
  if (agenda && cleanText(e.agenda)) words += ' (meaning to ' + cleanText(e.agenda).replace(/\.+$/, '') + ')';
  if (arrival) { const approach = renderArrival(e, clockMinutes); if (approach) words += ' — ' + approach; }
  const age = seatAgeWords(e, clockMinutes);
  if (age) words += ' (' + age + ')';
  return words;
}

function seatWords(name, entry, clockMinutes) {
  return name + ' — ' + seatNowWords(entry, clockMinutes, { agenda: true, arrival: true });
}

/* The six most recently seated who are NOT in the scene right now.
 * `present` is state.present ([{name}] — plain strings tolerated). */
export function renderOffscreen(offscreen, present, clockMinutes, top = RENDER_TOP, characters = {}) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  const rows = [];
  for (const [name, entry] of Object.entries(safe)) {
    if (!entry || typeof entry !== 'object') continue;
    if (isHere({ present, offscreen: safe, characters }, name)) continue; // they're in the scene — under any form of their name (M396)
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

/* M304: the same order, as names — the drawer lists the absent the way the
 * storyteller is told of them */
export function seatOrder(offscreen, clockMinutes) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  return Object.keys(safe)
    .filter((name) => safe[name] && typeof safe[name] === 'object')
    .map((name) => ({ name, recency: recencyKey(safe[name]), rank: stanceRank(safe[name], clockMinutes) }))
    .sort((a, b) => (a.rank - b.rank) || (b.recency - a.recency))
    .map((r) => r.name);
}

/* Lower is nearer the scene. `toward` and `seeking` carry their arrival: due
 * or overdue first, then by how soon; a stance with no clock sits behind
 * one with a clock. */
function stanceRank(entry, clockMinutes) {
  const st = typeof entry.stance === 'string' ? entry.stance : '';
  const base = st === 'toward' ? 0 : st === 'seeking' ? 100 : st === 'tense' ? 200 : st === 'busy' ? 300 : st === 'waiting' ? 400 : entry.lastSeen === true ? 600 : 500; /* M304: a bare sighting says least about who can reach the scene */
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
